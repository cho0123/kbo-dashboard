import { spawn, spawnSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const region = process.env.AWS_REGION || "ap-northeast-2";
const s3 = new S3Client({ region });

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_FONT_FILE = "NotoSansKR-Bold.ttf";

const VIDEO_VF =
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black";

/**
 * 청크당 최대 슬라이드 수 (xfade 필터 그래프 메모리 상한).
 * 분할 기준은 항상 슬라이드 장수이며, 누적 재생 시간(초)으로 청크를 나누지 않음.
 */
const CHUNK_SLIDES = 10;

function ffmpegBin() {
  const bundled = "/var/task/bin/ffmpeg";
  if (existsSync(bundled)) return bundled;
  const candidates = ["/opt/bin/ffmpeg", "/opt/ffmpeg/ffmpeg"];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

function ytdlpBin() {
  const bundled = "/var/task/bin/yt-dlp";
  if (existsSync(bundled)) return bundled;
  const local = join(__dirname, "bin", "yt-dlp");
  if (existsSync(local)) return local;
  return bundled;
}

function ffprobeBin() {
  const bundled = "/var/task/bin/ffprobe";
  if (existsSync(bundled)) return bundled;
  const candidates = ["/opt/bin/ffprobe", "/opt/ffmpeg/ffprobe"];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "ffprobe";
}

/** prep_N.png(1080×1920) 이후 — 스케일 생략, xfade만 */
function buildXfadeGraphPrepped(n, durations, transitionRaw) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]format=yuv420p,setpts=PTS-STARTPTS,fps=30[v${i}s]`
    );
  }
  let Tf = Math.max(0, Number(transitionRaw) || 0);
  let cur = "[v0s]";
  let acc = durations[0];
  for (let i = 1; i < n; i++) {
    const tf = Math.min(
      Tf,
      Math.max(0.04, acc - 0.02),
      Math.max(0.04, durations[i] - 0.02)
    );
    const offset = Math.max(0, acc - tf);
    const out = i === n - 1 ? "[vout]" : `[vx${i}]`;
    parts.push(
      `${cur}[v${i}s]xfade=transition=fade:duration=${tf}:offset=${offset}${out}`
    );
    acc = acc + durations[i] - tf;
    cur = out;
  }
  return parts.join(";");
}

/** transition=0, 슬라이드 2장 이상: concat 필터 (입력마다 yuv420p/30fps 맞춘 뒤 concat) */
function buildConcatFilterNoTransition(m) {
  const parts = [];
  const links = [];
  for (let i = 0; i < m; i++) {
    const tag = `cv${i}`;
    parts.push(`[${i}:v]format=yuv420p,fps=30[${tag}]`);
    links.push(`[${tag}]`);
  }
  parts.push(`${links.join("")}concat=n=${m}:v=1:a=0[vout]`);
  return parts.join(";");
}

function buildChunkMp4ConcatList(chunkCount) {
  let s = "ffconcat version 1.0\n";
  for (let c = 0; c < chunkCount; c++) {
    s += `file 'chunk_${c}.mp4'\n`;
  }
  return s;
}

/** S3 PNG → 1080×1920 PNG (sharp/jimp 없이 ffmpeg만 사용) */
function prepSlidePngTo1080(workDir, index) {
  const src = `slide_${index}.png`;
  const dst = `prep_${index}.png`;
  runFfmpeg(
    [
      "-y",
      "-i",
      src,
      "-vf",
      `${VIDEO_VF},format=yuv420p`,
      "-frames:v",
      "1",
      dst,
    ],
    workDir,
    `prep_${index}`
  );
  if (existsSync(join(workDir, src))) unlinkSync(join(workDir, src));
}

/** 출력 영상 길이(초) — xfade/concat/단일 슬라이드와 동일 로직 */
function computeVideoDurationSec(n, durations, transitionRaw) {
  const Tf = Math.max(0, Number(transitionRaw) || 0);
  const durs = durations.map((x) => Number(x) || 0);
  if (n < 1) return 0;
  if (n === 1) return Math.max(0.05, durs[0] || 0);
  const useXfade = n > 1 && Tf > 0.001;
  if (useXfade) {
    let acc = durs[0];
    for (let i = 1; i < n; i++) {
      const tf = Math.min(
        Tf,
        Math.max(0.04, acc - 0.02),
        Math.max(0.04, durs[i] - 0.02)
      );
      acc = acc + durs[i] - tf;
    }
    return acc;
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += durs[i];
  return sum;
}

/**
 * 청크별 인코딩(청크 경계는 concat만, xfade 없음)과 동일한 총 길이.
 * 각 청크 내부만 computeVideoDurationSec로 합산하며, 청크 사이에서 transition을 한 번 더 빼지 않음.
 */
function computeChunkedPipelineDurationSec(n, durations, transitionRaw) {
  const durs = durations.map((x) => Number(x) || 0);
  if (n < 1) return 0;
  const nc = Math.ceil(n / CHUNK_SLIDES);
  let sum = 0;
  for (let c = 0; c < nc; c++) {
    const start = c * CHUNK_SLIDES;
    const m = Math.min(CHUNK_SLIDES, n - start);
    const slice = durs.slice(start, start + m);
    const chunkDur = computeVideoDurationSec(m, slice, transitionRaw);
    console.log(
      `[duration] chunk ${c + 1}/${nc} (slides ${start}–${start + m - 1}, n=${m}) → ${chunkDur.toFixed(4)}s`
    );
    sum += chunkDur;
  }
  const singleGraph = computeVideoDurationSec(n, durs, transitionRaw);
  console.log(
    `[duration] chunked_sum=${sum.toFixed(4)}s | single_xfade_graph_if_one_pass=${singleGraph.toFixed(4)}s (청크 인코딩과 불일치—참고만)`
  );
  return sum;
}

function resolveSlideKey(meta, index, jobId) {
  const raw = meta.slideKeys;
  if (Array.isArray(raw) && raw[index] != null && String(raw[index]).trim()) {
    return String(raw[index]).trim();
  }
  return `slide_${index}`;
}

/** 청크 경계: 장수 기준만 사용함을 로그로 남기고, 청크별 슬라이드 키·duration 출력 */
function logChunkSplitDetail(n, durations, meta, jobId) {
  console.log(
    `[chunk] split_basis=slide_count max_slides_per_chunk=${CHUNK_SLIDES} duration_sec_split=false`
  );
  const durs = durations.map((x) => Number(x) || 0);
  const nc = Math.ceil(n / CHUNK_SLIDES);
  for (let c = 0; c < nc; c++) {
    const start = c * CHUNK_SLIDES;
    const m = Math.min(CHUNK_SLIDES, n - start);
    const slides = [];
    for (let j = 0; j < m; j++) {
      const idx = start + j;
      const key = resolveSlideKey(meta, idx, jobId);
      slides.push({
        key,
        inputObjectKey: `jobs/${jobId}/input/slide_${idx}.png`,
        durationSec: durs[idx],
      });
    }
    console.log(
      `[chunk] chunk ${c + 1}/${nc} slide_count=${m} slides=${JSON.stringify(slides)}`
    );
  }
}

function logMetaJsonFull(meta) {
  console.log("[meta] meta.json 전체:");
  console.log(JSON.stringify(meta, null, 2));
}

/** slideKeys와 durations를 인덱스로 매핑해 한 줄씩 출력 (합계는 transition 차감 전) */
function logSlideKeysDurationMapping(meta, n, durations) {
  const keys = Array.isArray(meta.slideKeys) ? meta.slideKeys : [];
  let rawSum = 0;
  for (let i = 0; i < n; i++) {
    const d = Number(durations[i]) || 0;
    rawSum += d;
    const label =
      keys[i] != null && String(keys[i]).trim()
        ? String(keys[i]).trim()
        : "";
    const mid = label ? ` (${label})` : "";
    console.log(`[meta] slide_${i}${mid} → ${d.toFixed(1)}초`);
  }
  console.log(
    `[meta] 전체 합계: ${rawSum.toFixed(1)}초 (transition 차감 전)`
  );
}

function probeFormatDurationSec(workDir, fileName) {
  const bin = ffprobeBin();
  const r = spawnSync(
    bin,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      fileName,
    ],
    {
      cwd: workDir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }
  );
  if (r.status !== 0) {
    console.warn(`[duration] ffprobe failed: ${(r.stderr || "").slice(0, 200)}`);
    return null;
  }
  const t = parseFloat(String(r.stdout || "").trim());
  return Number.isFinite(t) ? t : null;
}

function parseTimeToSeconds(t) {
  if (typeof t === "number" && Number.isFinite(t)) return Math.max(0, t);
  const s = String(t ?? "").trim();
  if (!s) throw new Error("빈 시간 값");
  const parts = s.split(":").map((x) => Number(String(x).trim()));
  if (parts.some((x) => !Number.isFinite(x))) {
    throw new Error(`시간 파싱 실패: ${t}`);
  }
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  throw new Error(`시간 형식 오류: ${t}`);
}

function coerceSegmentFracMs(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(99, Math.max(0, n));
}

const HIGHLIGHT_MIN_SEGMENT_DUR_SEC = 0.1;

/** HH:MM:SS(+선택 startMs/endMs 0~99, 0.01초) 구간 경계 초 — NaN/음수는 0 */
function segmentBoundarySeconds(seg, key) {
  const isStart = key === "start";
  const baseRaw = seg[isStart ? "start" : "end"];
  const fracKey = isStart ? "startMs" : "endMs";
  let base = 0;
  try {
    base = parseTimeToSeconds(baseRaw);
  } catch {
    base = NaN;
  }
  if (!Number.isFinite(base) || base < 0) base = 0;
  const frac = coerceSegmentFracMs(seg?.[fracKey]);
  let t = base + frac / 100;
  if (!Number.isFinite(t) || t < 0) t = 0;
  return t;
}

const HIGHLIGHT_THUMBNAIL_DUR_SEC = 0.3;

/** 썸네일 0.3초 클립 — duration 고정, 일반 구간과 구분 */
const THUMB_SEG_FLAG = "_thumbnailClip";

function probeVideoDimensions(workDir, fileName) {
  const bin = ffprobeBin();
  const r = spawnSync(
    bin,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      fileName,
    ],
    {
      cwd: workDir,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }
  );
  if (r.status !== 0) {
    throw new Error(
      `ffprobe 크기 실패: ${(r.stderr || r.stdout || "").slice(0, 400)}`
    );
  }
  const line = String(r.stdout || "").trim();
  const px = line.split("x");
  const w = parseInt(px[0], 10);
  const h = parseInt(px[1], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`ffprobe 출력 파싱 실패: ${line}`);
  }
  return { w, h };
}

/** 하이라이트 구간 crop x: (iw-cw)/2 + iw * offset% / 100, 짝수·범위 보정 */
function highlightCropXFromOffset(iw, cw, rawOffset) {
  const o = Number(rawOffset);
  const pct = Number.isFinite(o) ? Math.min(50, Math.max(-50, o)) : 0;
  const base = (iw - cw) / 2;
  const rawX = base + (iw * pct) / 100;
  let cx = Math.floor(rawX);
  cx = Math.max(0, Math.min(cx, iw - cw));
  cx -= cx % 2;
  return cx;
}

/** 파일명 별칭 (UI 값 → 패키지 내 실제 TTF) */
const BUNDLED_FONT_ALIASES = {
  "GamjaFlower-Regular": "GamjaFlower-Regular.ttf",
};

/** /var/task/fonts/{fileName} — 없으면 기본 TTF */
function resolveBundledFontPath(fileName) {
  let base = String(fileName || "").trim() || DEFAULT_FONT_FILE;
  if (BUNDLED_FONT_ALIASES[base]) base = BUNDLED_FONT_ALIASES[base];
  const safe = /^[a-zA-Z0-9._-]+\.(ttf|otf|ttc)$/i.test(base)
    ? base
    : DEFAULT_FONT_FILE;
  const full = join("/var/task/fonts", safe);
  if (existsSync(full)) return full;
  const fb = join("/var/task/fonts", DEFAULT_FONT_FILE);
  return existsSync(fb) ? fb : null;
}

function normalizeHexColor(raw, fallback = "#ffffff") {
  const fb = fallback.startsWith("#") ? fallback : `#${fallback}`;
  const s = raw != null ? String(raw).trim() : "";
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fb.toLowerCase();
}

function fontColorForFfmpeg(hex) {
  const h = normalizeHexColor(hex, "#ffffff");
  return `0x${h.slice(1)}`;
}

function fontColorForFfmpegWithOpacity(hex, opacityRaw) {
  const h = normalizeHexColor(hex, "#ffffff");
  const a = Number(opacityRaw);
  const o = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
  return `0x${h.slice(1)}@${o}`;
}

/** drawtext 필터 인자 앞뒤 경로 이스케이프 */
function escapePathForDrawtextFilter(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function normalizeHighlightTop(meta) {
  const topText =
    meta.topText != null ? String(meta.topText).trim() : "";
  const topTextSizeRaw = Number(meta.topTextSize);
  const topTextSize = Number.isFinite(topTextSizeRaw)
    ? Math.min(200, Math.max(20, Math.round(topTextSizeRaw)))
    : 72;
  const topTextColor = normalizeHexColor(meta.topTextColor, "#ffffff");
  const topOpacityRaw = Number(meta.topTextOpacity);
  const topTextOpacity = Number.isFinite(topOpacityRaw)
    ? Math.min(1, Math.max(0, topOpacityRaw))
    : 1;
  const topTextFont =
    meta.topTextFont != null && String(meta.topTextFont).trim()
      ? String(meta.topTextFont).trim()
      : DEFAULT_FONT_FILE;
  const topTextShadow = Boolean(meta.topTextShadow);
  return {
    topText,
    topTextSize,
    topTextColor,
    topTextOpacity,
    topTextFont,
    topTextShadow,
  };
}

function normalizeSegmentTextOverlay(seg) {
  const text = seg?.text != null ? String(seg.text).trim() : "";
  const ty = Number(seg?.textY);
  const textY = Number.isFinite(ty)
    ? Math.min(100, Math.max(0, Math.round(ty)))
    : 85;
  const textColor = normalizeHexColor(seg?.textColor, "#ffffff");
  const tsRaw = Number(seg?.textSize);
  const textSize = Number.isFinite(tsRaw)
    ? Math.min(200, Math.max(20, Math.round(tsRaw)))
    : 48;
  const opacityRaw = Number(seg?.textOpacity);
  const textOpacity = Number.isFinite(opacityRaw)
    ? Math.min(1, Math.max(0, opacityRaw))
    : 1;
  const textFont =
    seg?.textFont != null && String(seg.textFont).trim()
      ? String(seg.textFont).trim()
      : DEFAULT_FONT_FILE;
  const textShadow = Boolean(seg?.textShadow);

  const text2 = seg?.text2 != null ? String(seg.text2).trim() : "";
  const ty2 = Number(seg?.textY2);
  const textY2 = Number.isFinite(ty2)
    ? Math.min(100, Math.max(0, Math.round(ty2)))
    : 85;
  const textColor2 = normalizeHexColor(seg?.textColor2, "#ffffff");
  const tsRaw2 = Number(seg?.textSize2);
  const textSize2 = Number.isFinite(tsRaw2)
    ? Math.min(200, Math.max(20, Math.round(tsRaw2)))
    : 48;
  const opacityRaw2 = Number(seg?.textOpacity2);
  const textOpacity2 = Number.isFinite(opacityRaw2)
    ? Math.min(1, Math.max(0, opacityRaw2))
    : 1;
  const textFont2 =
    seg?.textFont2 != null && String(seg.textFont2).trim()
      ? String(seg.textFont2).trim()
      : DEFAULT_FONT_FILE;
  const textShadow2 = Boolean(seg?.textShadow2);

  return {
    text,
    textY,
    textColor,
    textSize,
    textOpacity,
    textFont,
    textShadow,
    text2,
    textY2,
    textColor2,
    textSize2,
    textOpacity2,
    textFont2,
    textShadow2,
  };
}

function normalizeThumbnailText(meta) {
  const text =
    meta.thumbnailText != null ? String(meta.thumbnailText).trim() : "";
  const ty = Number(meta.thumbnailTextY);
  const textY = Number.isFinite(ty)
    ? Math.min(100, Math.max(0, Math.round(ty)))
    : 85;
  const textColor = normalizeHexColor(meta.thumbnailTextColor, "#ffffff");
  const tsRaw = Number(meta.thumbnailTextSize);
  const textSize = Number.isFinite(tsRaw)
    ? Math.min(200, Math.max(20, Math.round(tsRaw)))
    : 72;
  const opacityRaw = Number(meta.thumbnailTextOpacity);
  const textOpacity = Number.isFinite(opacityRaw)
    ? Math.min(1, Math.max(0, opacityRaw))
    : 1;
  const textFont =
    meta.thumbnailTextFont != null && String(meta.thumbnailTextFont).trim()
      ? String(meta.thumbnailTextFont).trim()
      : DEFAULT_FONT_FILE;
  return { text, textY, textColor, textSize, textOpacity, textFont };
}

/** 구간 커버박스: 홀(좌우 10px·상하단 패드 제외) 기준 %; enabled만 필터 적용 */
function normalizeCoverBoxForLambda(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.enabled) return null;
  const clamp = (n, d) => {
    const x = Number(n);
    return Number.isFinite(x) ? Math.min(100, Math.max(0, Math.round(x))) : d;
  };
  const x = clamp(raw.x, 50);
  const y = clamp(raw.y, 50);
  const width = clamp(raw.width, 20);
  const height = clamp(raw.height, 10);
  if (width <= 0 || height <= 0) return null;
  return { enabled: true, x, y, width, height };
}

const HIGHLIGHT_TOPBOTTOM_PAD_H = 400;
const HIGHLIGHT_TOPBOTTOM_CONTENT_H = 1120;

function resolveHighlightLayout(meta) {
  const raw =
    meta?.layout != null ? String(meta.layout).trim().toLowerCase() : "kbo";
  if (raw === "fullscreen" || raw === "topbottom") return raw;
  return "kbo";
}

function normalizeVideoScaleY(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.min(150, Math.max(50, Math.round(n)));
}

function normalizeVideoOffsetY(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function highlightVerticalCrop(ih, videoScaleY, videoOffsetY) {
  const ihSafe = Math.max(1, Math.floor(Number(ih) || 1));
  const scaleY = normalizeVideoScaleY(videoScaleY);
  const offsetY = normalizeVideoOffsetY(videoOffsetY);
  let cropH = Math.round((ihSafe * 100) / scaleY);
  cropH = Math.min(ihSafe, Math.max(1, cropH));
  let cropY = Math.round((ihSafe - cropH) * (offsetY / 100));
  cropY = Math.min(ihSafe - cropH, Math.max(0, cropY));
  return { cropH, cropY };
}

function normalizeHighlightBarColor(raw, fallback) {
  const s = raw != null ? String(raw).trim() : "";
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = s.match(/^([0-9A-Fa-f]{6})$/i);
  if (m) return `#${m[1].toLowerCase()}`;
  return normalizeHexColor(fallback, fallback);
}

function appendHighlightBottomDrawtext(parts, opts) {
  const {
    bottomTextFile,
    bottomTextFile2,
    bottomFontSize,
    bottomFontSize2,
    bottomColor,
    bottomColor2,
    bottomOpacity,
    bottomOpacity2,
    bottomShadow,
    bottomShadow2,
    textY,
    textY2,
    bottomFontPath,
    bottomFontPath2,
  } = opts;
  const fsBottom = Math.round(bottomFontSize);
  if (bottomTextFile && bottomFontPath) {
    const shadow = bottomShadow
      ? ":shadowx=1:shadowy=1:shadowcolor=black@0.6"
      : "";
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(bottomFontPath)}:textfile=${escapePathForDrawtextFilter(bottomTextFile)}:fontsize=${fsBottom}:fontcolor=${fontColorForFfmpegWithOpacity(bottomColor, bottomOpacity)}:x=(w-text_w)/2:y=h*${textY}/100${shadow}`
    );
  }
  const fsBottom2 = Math.round(
    Number.isFinite(Number(bottomFontSize2))
      ? Number(bottomFontSize2)
      : fsBottom
  );
  if (bottomTextFile2 && bottomFontPath2) {
    const shadow2 = bottomShadow2
      ? ":shadowx=1:shadowy=1:shadowcolor=black@0.6"
      : "";
    const y2 =
      Number.isFinite(Number(textY2)) ? Number(textY2) : Number(textY) || 85;
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(bottomFontPath2)}:textfile=${escapePathForDrawtextFilter(bottomTextFile2)}:fontsize=${fsBottom2}:fontcolor=${fontColorForFfmpegWithOpacity(bottomColor2 ?? bottomColor, bottomOpacity2 ?? bottomOpacity)}:x=(w-text_w)/2:y=h*${y2}/100${shadow2}`
    );
  }
}

function finalizeHighlightVfChain(parts) {
  const chain = parts.join(",");
  return /fps=30/.test(chain) ? chain : `${chain},fps=30`;
}

function buildHighlightSegmentVfFullscreen(opts) {
  const { cw, ih, cx, videoScaleY, videoOffsetY, baseMode } = opts;
  let parts;
  if (baseMode === "image") {
    parts = ["scale=1080:1920", "setsar=1", "format=yuv420p"];
  } else {
    const { cropH, cropY } = highlightVerticalCrop(
      ih,
      videoScaleY,
      videoOffsetY
    );
    parts = [
      `crop=${cw}:${cropH}:${cx}:${cropY}`,
      "scale=1080:1920:flags=lanczos",
      "format=yuv420p",
    ];
  }
  appendHighlightBottomDrawtext(parts, opts);
  return finalizeHighlightVfChain(parts);
}

function buildHighlightSegmentVfTopBottom(opts) {
  const {
    cw,
    ih,
    cx,
    topBarColor,
    bottomBarColor,
    baseMode,
    videoScaleY,
    videoOffsetY,
  } = opts;
  const topFill = normalizeHighlightBarColor(topBarColor, "#1a1a2e");
  const botFill = normalizeHighlightBarColor(bottomBarColor, "#16213e");
  let parts;
  if (baseMode === "image") {
    const imgCropY = Math.max(
      0,
      Math.floor((1920 - HIGHLIGHT_TOPBOTTOM_CONTENT_H) / 2)
    );
    parts = [
      "scale=-2:1920",
      `crop=1080:${HIGHLIGHT_TOPBOTTOM_CONTENT_H}:(iw-1080)/2:${imgCropY}`,
      "setsar=1",
      `scale=1080:${HIGHLIGHT_TOPBOTTOM_CONTENT_H}`,
      `pad=1080:1920:0:${HIGHLIGHT_TOPBOTTOM_PAD_H}`,
      "format=yuv420p",
    ];
  } else {
    const { cropH, cropY } = highlightVerticalCrop(
      ih,
      videoScaleY,
      videoOffsetY
    );
    parts = [
      `crop=${cw}:${cropH}:${cx}:${cropY}`,
      `scale=1080:${HIGHLIGHT_TOPBOTTOM_CONTENT_H}:flags=lanczos`,
      `pad=1080:1920:0:${HIGHLIGHT_TOPBOTTOM_PAD_H}`,
      "format=yuv420p",
    ];
  }
  parts.push(
    `drawbox=x=0:y=0:w=iw:h=${HIGHLIGHT_TOPBOTTOM_PAD_H}:color=${topFill}@1:t=fill`,
    `drawbox=x=0:y=ih-${HIGHLIGHT_TOPBOTTOM_PAD_H}:w=iw:h=${HIGHLIGHT_TOPBOTTOM_PAD_H}:color=${botFill}@1:t=fill`
  );
  appendHighlightBottomDrawtext(parts, {
    ...opts,
    textY: 86,
    textY2: 93,
  });
  return finalizeHighlightVfChain(parts);
}

function buildHighlightSegmentVfByLayout(layout, opts) {
  if (layout === "fullscreen") return buildHighlightSegmentVfFullscreen(opts);
  if (layout === "topbottom") return buildHighlightSegmentVfTopBottom(opts);
  return buildHighlightSegmentVf(opts);
}

function buildHighlightSegmentVf(opts) {
  const {
    cw,
    ih,
    cx,
    borderColorPrimary,
    skipTeamBorderBoxes,
    topTextFile,
    bottomTextFile,
    bottomTextFile2,
    topFontSize,
    bottomFontSize,
    bottomFontSize2,
    topColor,
    topOpacity,
    bottomColor,
    bottomColor2,
    bottomOpacity,
    bottomOpacity2,
    bottomShadow,
    bottomShadow2,
    topShadow,
    textY,
    textY2,
    topFontPath,
    bottomFontPath,
    bottomFontPath2,
    coverBox,
    teamColorForCover,
    baseMode,
    videoScaleY,
    videoOffsetY,
  } = opts;
  const parts =
    baseMode === "image"
      ? [
          "scale=-2:1920",
          `crop=1080:1920:${cx}:0`,
          "setsar=1",
          "format=yuv420p",
        ]
      : (() => {
          const { cropH, cropY } = highlightVerticalCrop(
            ih,
            videoScaleY,
            videoOffsetY
          );
          return [
            `crop=${cw}:${cropH}:${cx}:${cropY}`,
            "scale=1080:1640:flags=lanczos",
            "pad=1080:1920:0:280",
            "format=yuv420p",
          ];
        })();
  if (borderColorPrimary && !skipTeamBorderBoxes) {
    const c = `${borderColorPrimary}@1`;
    parts.push(
      `drawbox=x=0:y=0:w=iw:h=10:color=${c}:t=fill`,
      `drawbox=x=0:y=ih-10:w=iw:h=10:color=${c}:t=fill`,
      `drawbox=x=0:y=0:w=10:h=ih:color=${c}:t=fill`,
      `drawbox=x=iw-10:y=0:w=10:h=ih:color=${c}:t=fill`
    );
  }
  if (coverBox?.enabled && teamColorForCover) {
    const hex = String(teamColorForCover).trim();
    const m = hex.match(/^#?([0-9A-Fa-f]{6})$/i);
    const colorCore = m ? `#${m[1]}` : "#074CA1";
    const c = `${colorCore}@1`;
    const xR = coverBox.x / 100;
    const yR = coverBox.y / 100;
    const wR = coverBox.width / 100;
    const hR = coverBox.height / 100;
    const boxDraw = skipTeamBorderBoxes
      ? `drawbox=x='iw*${xR}':y='280+(ih-280-160)*${yR}':w='iw*${wR}':h='(ih-280-160)*${hR}':color=${c}:t=fill`
      : `drawbox=x='10+(iw-20)*${xR}':y='280+(ih-280-160)*${yR}':w='(iw-20)*${wR}':h='(ih-280-160)*${hR}':color=${c}:t=fill`;
    parts.push(boxDraw);
  }
  const fsTop = Math.round(topFontSize);
  const fsBottom = Math.round(bottomFontSize);

  /** 하단 첫 줄(text) */
  if (bottomTextFile && bottomFontPath) {
    const shadow = bottomShadow
      ? ":shadowx=1:shadowy=1:shadowcolor=black@0.6"
      : "";
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(bottomFontPath)}:textfile=${escapePathForDrawtextFilter(bottomTextFile)}:fontsize=${fsBottom}:fontcolor=${fontColorForFfmpegWithOpacity(bottomColor, bottomOpacity)}:x=(w-text_w)/2:y=h*${textY}/100${shadow}`
    );
  }
  const fsBottom2 = Math.round(
    Number.isFinite(Number(bottomFontSize2))
      ? Number(bottomFontSize2)
      : fsBottom
  );
  /** 하단 둘째 줄(text2) — 별도 drawtext */
  if (bottomTextFile2 && bottomFontPath2) {
    const shadow2 = bottomShadow2
      ? ":shadowx=1:shadowy=1:shadowcolor=black@0.6"
      : "";
    const y2 =
      Number.isFinite(Number(textY2)) ? Number(textY2) : Number(textY) || 85;
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(bottomFontPath2)}:textfile=${escapePathForDrawtextFilter(bottomTextFile2)}:fontsize=${fsBottom2}:fontcolor=${fontColorForFfmpegWithOpacity(bottomColor2 ?? bottomColor, bottomOpacity2 ?? bottomOpacity)}:x=(w-text_w)/2:y=h*${y2}/100${shadow2}`
    );
  }
  if (topTextFile && topFontPath) {
    const shadow = topShadow
      ? ":shadowx=1:shadowy=1:shadowcolor=black@0.6"
      : "";
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(topFontPath)}:textfile=${escapePathForDrawtextFilter(topTextFile)}:fontsize=${fsTop}:fontcolor=${fontColorForFfmpegWithOpacity(topColor, topOpacity)}:x=(w-text_w)/2:y=h*0.105${shadow}`
    );
  }
  const chain = parts.join(",");
  return /fps=30/.test(chain) ? chain : `${chain},fps=30`;
}

function resolveSegmentImageS3Key(jobId, imageS3Key) {
  const k = String(imageS3Key || "").trim();
  if (!k) return null;
  if (k.startsWith("jobs/")) return k;
  return `jobs/${jobId}/${k.replace(/^\//, "")}`;
}

function imageLocalExtFromS3Key(key) {
  const m = String(key || "").match(/\.(jpe?g|png|webp|gif)$/i);
  if (!m) return ".jpg";
  const e = m[1].toLowerCase();
  return e === "jpeg" ? ".jpg" : `.${e}`;
}

async function processHighlightImageSegment(ctx) {
  const {
    bucket,
    jobId,
    workDir,
    seg,
    i,
    numSeg,
    layout,
    topBarColor,
    bottomBarColor,
    borderColorPrimary,
    hasThumbnailPng,
    hasOverlayPng,
    topTextPath,
    topTextSize,
    topTextColor,
    topTextOpacity,
    topTextShadow,
    topFontPath,
    coverBoxGlobal,
    muteOriginal,
    cw,
    ih,
    videoScaleY,
    videoOffsetY,
  } = ctx;

  const imageS3Key = resolveSegmentImageS3Key(jobId, seg.imageS3Key);
  if (!imageS3Key) {
    throw new Error(`이미지 구간 ${i + 1}: imageS3Key 없음`);
  }
  const ext = imageLocalExtFromS3Key(imageS3Key);
  const imageFileName = `image_seg_${i}${ext}`;
  const imageLocalAbs = join(workDir, imageFileName);
  await getObjectFile(bucket, imageS3Key, imageLocalAbs);
  if (!existsSync(imageLocalAbs)) {
    throw new Error(`이미지 구간 ${i + 1}: S3 다운로드 실패`);
  }

  const durRaw = Number(seg.duration);
  const duration = Number.isFinite(durRaw)
    ? Math.min(10, Math.max(0.5, durRaw))
    : 3;

  const bottomParsed = normalizeSegmentTextOverlay(seg);
  const {
    text: bottomTxt,
    text2: bottomTxt2,
    textY,
    textY2,
    textColor: bottomColor,
    textColor2: bottomColor2,
    textSize: bottomTextSize,
    textSize2: bottomTextSize2,
    textOpacity: bottomOpacity,
    textOpacity2: bottomOpacity2,
    textFont: bottomFontName,
    textFont2: bottomFontName2,
    textShadow: bottomShadow,
    textShadow2: bottomShadow2,
  } = bottomParsed;
  const bottomFontPath = resolveBundledFontPath(bottomFontName);
  let bottomPath = null;
  if (bottomTxt && bottomFontPath) {
    bottomPath = join(workDir, `hi_bottom_${i}.txt`);
    writeFileSync(bottomPath, bottomTxt, "utf8");
  }
  const bottomFontPath2 = resolveBundledFontPath(bottomFontName2);
  let bottomPath2 = null;
  if (bottomTxt2 && bottomFontPath2) {
    bottomPath2 = join(workDir, `hi_bottom_${i}_2.txt`);
    writeFileSync(bottomPath2, bottomTxt2, "utf8");
  }

  const { w: imgW, h: imgH } = probeVideoDimensions(workDir, imageFileName);
  let scaledW = Math.floor((imgW * 1920) / Math.max(1, imgH));
  scaledW -= scaledW % 2;
  scaledW = Math.max(1080, scaledW);
  const imageCx = highlightCropXFromOffset(scaledW, 1080, seg?.cropOffset);

  const isKboLayout = layout === "kbo";
  const vfSeg = buildHighlightSegmentVfByLayout(layout, {
    cw,
    ih,
    cx: imageCx,
    borderColorPrimary,
    skipTeamBorderBoxes: isKboLayout
      ? hasThumbnailPng || hasOverlayPng
      : true,
    topTextFile: isKboLayout ? topTextPath : null,
    bottomTextFile: bottomPath,
    bottomTextFile2: bottomPath2,
    topFontSize: topTextSize,
    bottomFontSize: bottomTextSize,
    bottomFontSize2: bottomTextSize2,
    topColor: topTextColor,
    topOpacity: topTextOpacity,
    bottomColor,
    bottomColor2,
    bottomOpacity,
    bottomOpacity2,
    topShadow: Boolean(topTextShadow),
    bottomShadow: Boolean(bottomShadow),
    bottomShadow2: Boolean(bottomShadow2),
    textY,
    textY2,
    topFontPath,
    bottomFontPath,
    bottomFontPath2,
    coverBox: coverBoxGlobal,
    teamColorForCover: borderColorPrimary,
    topBarColor,
    bottomBarColor,
    videoScaleY,
    videoOffsetY,
    baseMode: "image",
  });

  const narrS3Key = `jobs/${jobId}/narration_${i}.mp3`;
  const narrLocalRel = `narration_${i}.mp3`;
  const narrLocalAbs = join(workDir, narrLocalRel);
  let hasNarrAudio = false;
  if (seg.narration != null && String(seg.narration).trim() !== "") {
    try {
      await getObjectFile(bucket, narrS3Key, narrLocalAbs);
      hasNarrAudio = existsSync(narrLocalAbs);
    } catch (e) {
      console.warn(
        `[highlight] image seg narration S3 get failed (${narrS3Key}):`,
        e?.message || e
      );
    }
  }

  await putStatus(bucket, jobId, {
    state: "processing",
    progress: 32 + Math.floor((38 * (i + 1)) / numSeg),
  });

  const overlayPngFile =
    isKboLayout && hasOverlayPng
      ? "overlay.png"
      : isKboLayout && hasThumbnailPng
        ? "thumbnail.png"
        : null;
  const durStr = String(duration);
  const narrApadSamples = Math.max(
    1,
    Math.ceil((Number(duration) || 0) * 48000)
  );

  if (overlayPngFile) {
    if (hasNarrAudio) {
      const fc = `[0:v]${vfSeg}[base];[base][1:v]overlay=0:0:format=auto[out];[2:a]adelay=500|500,atrim=duration=${durStr},asetpts=PTS-STARTPTS,aresample=48000,apad=whole_len=${narrApadSamples}[aud]`;
      runFfmpeg(
        [
          "-y",
          "-loop",
          "1",
          "-i",
          imageFileName,
          "-t",
          durStr,
          "-loop",
          "1",
          "-i",
          overlayPngFile,
          "-t",
          durStr,
          "-i",
          narrLocalRel,
          "-filter_complex",
          fc,
          "-map",
          "[out]",
          "-map",
          "[aud]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          `seg_${i}.mp4`,
        ],
        workDir,
        `highlight_img_seg_${i}_overlay_narr`
      );
    } else {
      const muteSegNoNarr = muteOriginal && !hasNarrAudio;
      const fc = muteSegNoNarr
        ? `[0:v]${vfSeg}[base];[base][1:v]overlay=0:0:format=auto[out];anullsrc=r=48000:cl=stereo[aud]`
        : `[0:v]${vfSeg}[base];[base][1:v]overlay=0:0:format=auto[out]`;
      const overlayNoNarrArgs = [
        "-y",
        "-loop",
        "1",
        "-i",
        imageFileName,
        "-t",
        durStr,
        "-loop",
        "1",
        "-i",
        overlayPngFile,
        "-t",
        durStr,
        "-filter_complex",
        fc,
        "-map",
        "[out]",
      ];
      if (muteSegNoNarr) {
        overlayNoNarrArgs.push(
          "-map",
          "[aud]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-shortest",
          `seg_${i}.mp4`
        );
      } else {
        overlayNoNarrArgs.push(
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-shortest",
          `seg_${i}.mp4`
        );
      }
      runFfmpeg(
        overlayNoNarrArgs,
        workDir,
        muteSegNoNarr
          ? `highlight_img_seg_${i}_overlay_mo`
          : `highlight_img_seg_${i}_overlay`
      );
    }
  } else if (hasNarrAudio) {
    const fc = `[0:v]${vfSeg}[v];[1:a]adelay=500|500,atrim=duration=${durStr},asetpts=PTS-STARTPTS,aresample=48000,apad=whole_len=${narrApadSamples}[aud]`;
    runFfmpeg(
      [
        "-y",
        "-loop",
        "1",
        "-i",
        imageFileName,
        "-t",
        durStr,
        "-i",
        narrLocalRel,
        "-filter_complex",
        fc,
        "-map",
        "[v]",
        "-map",
        "[aud]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        `seg_${i}.mp4`,
      ],
      workDir,
      `highlight_img_seg_${i}_narr`
    );
  } else {
    const muteSegNoNarr = muteOriginal && !hasNarrAudio;
    if (muteSegNoNarr) {
      const fc = `[0:v]${vfSeg}[out];anullsrc=r=48000:cl=stereo[aud]`;
      runFfmpeg(
        [
          "-y",
          "-loop",
          "1",
          "-i",
          imageFileName,
          "-t",
          durStr,
          "-filter_complex",
          fc,
          "-map",
          "[out]",
          "-map",
          "[aud]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-shortest",
          `seg_${i}.mp4`,
        ],
        workDir,
        `highlight_img_seg_${i}_mo`
      );
    } else {
      runFfmpeg(
        [
          "-y",
          "-loop",
          "1",
          "-i",
          imageFileName,
          "-t",
          durStr,
          "-vf",
          vfSeg,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-an",
          `seg_${i}.mp4`,
        ],
        workDir,
        `highlight_img_seg_${i}`
      );
    }
  }
}

async function runHighlightPipeline(bucket, jobId, workDir, meta) {
  let segments = Array.isArray(meta.segments) ? [...meta.segments] : [];
  if (segments.length < 1) throw new Error("구간 없음");

  const layout = resolveHighlightLayout(meta);
  const isKboLayout = layout === "kbo";
  console.log("[highlight] layout:", layout);

  const muteOriginal = coerceMuteOriginal(meta);

  const TEAM_COLORS = {
    삼성: { primary: "#074CA1", secondary: "#C0C0C0" },
    KIA: { primary: "#EA0029", secondary: "#05141F" },
    LG: { primary: "#C30452", secondary: "#000000" },
    두산: { primary: "#131230", secondary: "#D00F31" },
    KT: { primary: "#000000", secondary: "#EB1F23" },
    SSG: { primary: "#CE0E2D", secondary: "#FFB81C" },
    롯데: { primary: "#002B5B", secondary: "#D00F31" },
    한화: { primary: "#FF6600", secondary: "#000000" },
    NC: { primary: "#071D36", secondary: "#BFA253" },
    키움: { primary: "#570514", secondary: "#CBAB6D" },
  };
  const teamKey = String(meta?.team || "").trim();
  const borderColorPrimary = TEAM_COLORS[teamKey]?.primary || null;

  await putStatus(bucket, jobId, { state: "processing", progress: 18 });
  const sourceKey = `jobs/${jobId}/source.mp4`;
  const sourceLocal = join(workDir, "source.mp4");
  await getObjectFile(bucket, sourceKey, sourceLocal);
  console.log("[highlight] source from S3", sourceKey, "->", sourceLocal);
  const sourceFileName = "source.mp4";

  // thumbnail.png를 0.3초 prepend 하지 않고, 있으면 각 구간에 오버레이로 합성한다.
  const thumbPngKey = "overlay/thumbnail.png";
  const thumbPngLocal = join(workDir, "thumbnail.png");
  let hasThumbnailPng = false;
  try {
    await getObjectFile(bucket, thumbPngKey, thumbPngLocal);
    hasThumbnailPng = existsSync(thumbPngLocal);
    if (hasThumbnailPng) {
      console.log("[highlight] thumbnail.png found, will overlay per segment");
    }
  } catch {
    hasThumbnailPng = false;
  }

  const overlayKeyRaw =
    meta.overlay_s3_key != null ? String(meta.overlay_s3_key).trim() : "";
  const overlayLocal = join(workDir, "overlay.png");
  let hasOverlayPng = false;
  if (overlayKeyRaw) {
    try {
      await getObjectFile(bucket, overlayKeyRaw, overlayLocal);
      if (existsSync(overlayLocal)) {
        hasOverlayPng = true;
        console.log(
          "[highlight] overlay from S3",
          overlayKeyRaw,
          "->",
          overlayLocal
        );
      }
    } catch (e) {
      console.warn(
        "[highlight] overlay download failed, using drawbox path:",
        e?.message || e
      );
    }
  }

  if (!isKboLayout) {
    hasThumbnailPng = false;
    hasOverlayPng = false;
    console.log(
      `[highlight] layout=${layout}: skip thumbnail/overlay PNG overlay`
    );
  }

  await putStatus(bucket, jobId, { state: "processing", progress: 32 });

  const { w: iw, h: ih } = probeVideoDimensions(workDir, sourceFileName);
  const videoScaleY = normalizeVideoScaleY(meta?.videoScaleY);
  const videoOffsetY = normalizeVideoOffsetY(meta?.videoOffsetY);
  const { cropH } = highlightVerticalCrop(ih, videoScaleY, videoOffsetY);
  let cw;
  if (layout === "fullscreen") {
    cw = Math.floor((cropH * 1080) / 1920);
  } else if (layout === "topbottom") {
    cw = Math.floor((cropH * 1080) / 1120);
  } else {
    cw = Math.floor((cropH * 1080) / 1640);
  }
  cw -= cw % 2;
  cw = Math.min(cw, iw - (iw % 2));

  const {
    topText,
    topTextSize,
    topTextColor,
    topTextOpacity,
    topTextFont,
    topTextShadow,
  } = normalizeHighlightTop(meta);
  const metaWantsText =
    Boolean(topText) ||
    segments.some((s) => {
      const t1 = s?.text != null ? String(s.text).trim() : "";
      const t2 = s?.text2 != null ? String(s.text2).trim() : "";
      return t1 !== "" || t2 !== "";
    }) ||
    Boolean(String(meta.thumbnailText || "").trim());
  const topFontPath = resolveBundledFontPath(topTextFont);
  if (metaWantsText && !resolveBundledFontPath(DEFAULT_FONT_FILE)) {
    console.warn(
      "[highlight] no bundle font under /var/task/fonts — drawtext may be skipped"
    );
  }

  let topTextPath = null;
  if (isKboLayout && topText && topFontPath) {
    topTextPath = join(workDir, "hi_top.txt");
    writeFileSync(topTextPath, topText, "utf8");
  }

  const numSeg = segments.length;
  const coverBoxGlobal = isKboLayout
    ? normalizeCoverBoxForLambda(meta?.coverBox)
    : null;
  console.log("[coverBox]", JSON.stringify(coverBoxGlobal));
  for (let i = 0; i < numSeg; i++) {
    const seg = segments[i];
    if (seg?.type === "image") {
      await processHighlightImageSegment({
        bucket,
        jobId,
        workDir,
        seg,
        i,
        numSeg,
        layout,
        topBarColor: meta?.topBarColor,
        bottomBarColor: meta?.bottomBarColor,
        borderColorPrimary,
        hasThumbnailPng,
        hasOverlayPng,
        topTextPath,
        topTextSize,
        topTextColor,
        topTextOpacity,
        topTextShadow,
        topFontPath,
        coverBoxGlobal,
        muteOriginal,
        cw,
        ih,
        videoScaleY,
        videoOffsetY,
      });
      continue;
    }
    let startSec;
    let endSec;
    let duration;
    if (seg[THUMB_SEG_FLAG] === true) {
      const rawStart =
        typeof seg.start === "number" && Number.isFinite(seg.start)
          ? seg.start
          : Number(seg.start);
      startSec =
        Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0;
      duration = HIGHLIGHT_THUMBNAIL_DUR_SEC;
      endSec = startSec + duration;
    } else {
      console.log("[seg] startMs:", seg.startMs, "endMs:", seg.endMs);
      startSec = segmentBoundarySeconds(seg, "start");
      endSec = segmentBoundarySeconds(seg, "end");
      duration = endSec - startSec;
      if (duration <= 0) duration = HIGHLIGHT_MIN_SEGMENT_DUR_SEC;
    }
    console.log(
      "[seg] start:",
      startSec,
      "end:",
      endSec,
      "duration:",
      duration
    );
    const cropRaw =
      seg[THUMB_SEG_FLAG] === true
        ? (() => {
            const tr = meta.thumbnailCropOffset;
            if (tr !== undefined && tr !== null && tr !== "") {
              const n = Number(tr);
              if (Number.isFinite(n)) return n;
            }
            return seg?.cropOffset;
          })()
        : seg?.cropOffset;
    const cx = highlightCropXFromOffset(iw, cw, cropRaw);
    let bottomParsed;
    if (seg[THUMB_SEG_FLAG] === true) {
      bottomParsed = normalizeThumbnailText(meta);
    } else {
      bottomParsed = normalizeSegmentTextOverlay(seg);
    }
    const {
      text: bottomTxt,
      text2: bottomTxt2,
      textY,
      textY2,
      textColor: bottomColor,
      textColor2: bottomColor2,
      textSize: bottomTextSize,
      textSize2: bottomTextSize2,
      textOpacity: bottomOpacity,
      textOpacity2: bottomOpacity2,
      textFont: bottomFontName,
      textFont2: bottomFontName2,
      textShadow: bottomShadow,
      textShadow2: bottomShadow2,
    } = bottomParsed;
    const bottomFontPath = resolveBundledFontPath(bottomFontName);
    let bottomPath = null;
    if (bottomTxt && bottomFontPath) {
      bottomPath = join(workDir, `hi_bottom_${i}.txt`);
      writeFileSync(bottomPath, bottomTxt, "utf8");
    }
    const bottomFontPath2 = resolveBundledFontPath(bottomFontName2);
    let bottomPath2 = null;
    if (bottomTxt2 && bottomFontPath2) {
      bottomPath2 = join(workDir, `hi_bottom_${i}_2.txt`);
      writeFileSync(bottomPath2, bottomTxt2, "utf8");
    }
    // 하단 텍스트는 썸네일 구간(THUMB_SEG_FLAG)일 때 meta 기준으로만 달라지고,
    // 커버박스는 meta.coverBox → coverBoxGlobal 을 일반 구간과 동일하게 적용한다.
    const vfSeg = buildHighlightSegmentVfByLayout(layout, {
      cw,
      ih,
      cx,
      borderColorPrimary,
      skipTeamBorderBoxes: isKboLayout
        ? hasThumbnailPng || hasOverlayPng
        : true,
      topTextFile: isKboLayout ? topTextPath : null,
      bottomTextFile: bottomPath,
      bottomTextFile2: bottomPath2,
      topFontSize: topTextSize,
      bottomFontSize: bottomTextSize,
      bottomFontSize2: bottomTextSize2,
      topColor: topTextColor,
      topOpacity: topTextOpacity,
      bottomColor,
      bottomColor2,
      bottomOpacity,
      bottomOpacity2,
      topShadow: Boolean(topTextShadow),
      bottomShadow: Boolean(bottomShadow),
      bottomShadow2: Boolean(bottomShadow2),
      textY,
      textY2,
      topFontPath,
      bottomFontPath,
      bottomFontPath2,
      coverBox: coverBoxGlobal,
      teamColorForCover: borderColorPrimary,
      topBarColor: meta?.topBarColor,
      bottomBarColor: meta?.bottomBarColor,
      videoScaleY,
      videoOffsetY,
    });
    const narrS3Key = `jobs/${jobId}/narration_${i}.mp3`;
    const narrLocalRel = `narration_${i}.mp3`;
    const narrLocalAbs = join(workDir, narrLocalRel);
    let hasNarrAudio = false;
    if (seg.narration != null && String(seg.narration).trim() !== "") {
      try {
        await getObjectFile(bucket, narrS3Key, narrLocalAbs);
        hasNarrAudio = existsSync(narrLocalAbs);
      } catch (e) {
        console.warn(
          `[highlight] narration S3 get failed (${narrS3Key}):`,
          e?.message || e
        );
      }
    }
    await putStatus(bucket, jobId, {
      state: "processing",
      progress: 32 + Math.floor((38 * (i + 1)) / numSeg),
    });
    const overlayPngFile =
      isKboLayout && hasOverlayPng
        ? "overlay.png"
        : isKboLayout && hasThumbnailPng
          ? "thumbnail.png"
          : null;
    const durStr = String(duration);
    const narrApadSamples = Math.max(
      1,
      Math.ceil((Number(duration) || 0) * 48000)
    );
    if (overlayPngFile) {
      if (hasNarrAudio) {
        const fc = `[0:v]${vfSeg}[base];[base][1:v]overlay=0:0:format=auto[out];[2:a]adelay=500|500,atrim=duration=${durStr},asetpts=PTS-STARTPTS,aresample=48000,apad=whole_len=${narrApadSamples}[aud]`;
        runFfmpeg(
          [
            "-y",
            "-ss",
            String(startSec),
            "-t",
            String(duration),
            "-i",
            sourceFileName,
            "-loop",
            "1",
            "-t",
            String(duration),
            "-i",
            overlayPngFile,
            "-i",
            narrLocalRel,
            "-filter_complex",
            fc,
            "-map",
            "[out]",
            "-map",
            "[aud]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            `seg_${i}.mp4`,
          ],
          workDir,
          `highlight_seg_${i}_overlay_narr`
        );
      } else {
        const muteSegNoNarr = muteOriginal && !hasNarrAudio;
        const fc = muteSegNoNarr
          ? `[0:v]${vfSeg}[base];[base][1:v]overlay=0:0:format=auto[out];anullsrc=r=48000:cl=stereo[aud]`
          : `[0:v]${vfSeg}[base];[base][1:v]overlay=0:0:format=auto[out]`;
        const overlayNoNarrArgs = [
          "-y",
          "-ss",
          String(startSec),
          "-t",
          String(duration),
          "-i",
          sourceFileName,
          "-loop",
          "1",
          "-t",
          String(duration),
          "-i",
          overlayPngFile,
          "-filter_complex",
          fc,
          "-map",
          "[out]",
        ];
        if (muteSegNoNarr) {
          overlayNoNarrArgs.push(
            "-map",
            "[aud]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-shortest",
            `seg_${i}.mp4`
          );
        } else {
          overlayNoNarrArgs.push(
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-c:a",
            "aac",
            "-shortest",
            `seg_${i}.mp4`
          );
        }
        runFfmpeg(
          overlayNoNarrArgs,
          workDir,
          muteSegNoNarr
            ? `highlight_seg_${i}_overlay_mo`
            : `highlight_seg_${i}_overlay`
        );
      }
    } else if (hasNarrAudio) {
      const fc = `[0:v]${vfSeg}[v];[1:a]adelay=500|500,atrim=duration=${durStr},asetpts=PTS-STARTPTS,aresample=48000,apad=whole_len=${narrApadSamples}[aud]`;
      runFfmpeg(
        [
          "-y",
          "-ss",
          String(startSec),
          "-t",
          String(duration),
          "-i",
          sourceFileName,
          "-i",
          narrLocalRel,
          "-filter_complex",
          fc,
          "-map",
          "[v]",
          "-map",
          "[aud]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-r",
          "30",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          `seg_${i}.mp4`,
        ],
        workDir,
        `highlight_seg_${i}_narr`
      );
    } else {
      const muteSegNoNarr = muteOriginal && !hasNarrAudio;
      if (muteSegNoNarr) {
        const fc = `[0:v]${vfSeg}[out];anullsrc=r=48000:cl=stereo[aud]`;
        runFfmpeg(
          [
            "-y",
            "-ss",
            String(startSec),
            "-i",
            sourceFileName,
            "-t",
            String(duration),
            "-filter_complex",
            fc,
            "-map",
            "[out]",
            "-map",
            "[aud]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-shortest",
            `seg_${i}.mp4`,
          ],
          workDir,
          `highlight_seg_${i}_mo`
        );
      } else {
        runFfmpeg(
          [
            "-y",
            "-ss",
            String(startSec),
            "-i",
            sourceFileName,
            "-t",
            String(duration),
            "-vf",
            vfSeg,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-c:a",
            "aac",
            `seg_${i}.mp4`,
          ],
          workDir,
          `highlight_seg_${i}`
        );
      }
    }
  }

  let concatBody = "ffconcat version 1.0\n";
  for (let i = 0; i < numSeg; i++) {
    concatBody += `file 'seg_${i}.mp4'\n`;
  }
  writeFileSync(join(workDir, "concat_hi.txt"), concatBody, "utf8");

  runFfmpeg(
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat_hi.txt",
      "-c",
      "copy",
      "joined_hi.mp4",
    ],
    workDir,
    "highlight_concat"
  );

  await putStatus(bucket, jobId, { state: "processing", progress: 78 });

  const outLocal = join(workDir, "output.mp4");
  const musicKeyRaw =
    meta.music_s3_key && String(meta.music_s3_key).trim()
      ? String(meta.music_s3_key).trim()
      : "";
  const hasMusic = Boolean(musicKeyRaw);
  const musicOpts = normalizeMusicOptions(meta);
  const hasNarration = segments.some(
    (s) => s?.narration != null && String(s.narration).trim() !== ""
  );

  if (hasMusic) {
    const musicLocal = resolve(join(workDir, "highlight_bgm.mp3"));
    await getObjectFile(bucket, musicKeyRaw, musicLocal);
    if (!existsSync(musicLocal)) {
      throw new Error("BGM 파일을 S3에서 받지 못했습니다.");
    }

    if (muteOriginal) {
      if (hasNarration) {
        const videoDurSec = probeFormatDurationSec(workDir, "joined_hi.mp4");
        const videoDurForMux =
          videoDurSec != null && Number.isFinite(videoDurSec) ? videoDurSec : 0;
        const chain = buildMusicAf(videoDurForMux, musicOpts);
        const fc = `[1:a]${chain}[bm];[0:a][bm]amix=inputs=2:duration=first:normalize=0[outa]`;
        runFfmpeg(
          [
            "-y",
            "-i",
            "joined_hi.mp4",
            "-stream_loop",
            "-1",
            "-ss",
            String(musicOpts.startTime),
            "-i",
            musicLocal,
            "-filter_complex",
            fc,
            "-map",
            "0:v",
            "-map",
            "[outa]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "320k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-t",
            String(videoDurForMux),
            outLocal,
          ],
          workDir,
          "highlight_mux_mix_mo_narr"
        );
      } else {
        runFfmpeg(
          [
            "-y",
            "-i",
            "joined_hi.mp4",
            "-c:v",
            "copy",
            "-an",
            "cropped_hi.mp4",
          ],
          workDir,
          "highlight_strip_a_for_bgm"
        );
        const videoDurSec = probeFormatDurationSec(workDir, "cropped_hi.mp4");
        const videoDurForMux =
          videoDurSec != null && Number.isFinite(videoDurSec) ? videoDurSec : 0;
        const afChain = buildMusicAf(videoDurForMux, musicOpts);
        const muxArgs = [
          "-y",
          "-i",
          "cropped_hi.mp4",
          "-stream_loop",
          "-1",
          "-ss",
          String(musicOpts.startTime),
          "-i",
          musicLocal,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-c:v",
          "copy",
        ];
        if (afChain) {
          muxArgs.push("-af", afChain);
        }
        muxArgs.push(
          "-c:a",
          "aac",
          "-b:a",
          "320k",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-t",
          String(videoDurForMux),
          outLocal
        );
        runFfmpeg(muxArgs, workDir, "highlight_mux_bgm");
        const ch = join(workDir, "cropped_hi.mp4");
        if (existsSync(ch)) unlinkSync(ch);
      }
    } else {
      runFfmpeg(
        [
          "-y",
          "-i",
          "joined_hi.mp4",
          "-c",
          "copy",
          "cropped_va.mp4",
        ],
        workDir,
        "highlight_copy_for_mix"
      );
      const videoDurSec = probeFormatDurationSec(workDir, "cropped_va.mp4");
      const videoDurForMux =
        videoDurSec != null && Number.isFinite(videoDurSec) ? videoDurSec : 0;
      const chain = buildMusicAf(videoDurForMux, musicOpts);
      const fc = `[1:a]${chain}[bm];[0:a][bm]amix=inputs=2:duration=first:normalize=0[outa]`;
      runFfmpeg(
        [
          "-y",
          "-i",
          "cropped_va.mp4",
          "-stream_loop",
          "-1",
          "-ss",
          String(musicOpts.startTime),
          "-i",
          musicLocal,
          "-filter_complex",
          fc,
          "-map",
          "0:v",
          "-map",
          "[outa]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "320k",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-t",
          String(videoDurForMux),
          outLocal,
        ],
        workDir,
        "highlight_mux_mix"
      );
      const pva = join(workDir, "cropped_va.mp4");
      if (existsSync(pva)) unlinkSync(pva);
    }
  } else if (muteOriginal) {
    if (hasNarration) {
      runFfmpeg(
        ["-y", "-i", "joined_hi.mp4", "-c", "copy", outLocal],
        workDir,
        "highlight_out_keep_narr"
      );
    } else {
      runFfmpeg(
        [
          "-y",
          "-i",
          "joined_hi.mp4",
          "-c:v",
          "copy",
          "-an",
          outLocal,
        ],
        workDir,
        "highlight_out_mute"
      );
    }
  } else {
    runFfmpeg(
      ["-y", "-i", "joined_hi.mp4", "-c", "copy", outLocal],
      workDir,
      "highlight_out_copy"
    );
  }

  const probed = probeFormatDurationSec(workDir, "output.mp4");
  console.log(`[highlight] out_duration_sec=${probed}`);

  const outputKey = `jobs/${jobId}/output/output.mp4`;
  await putOutputMp4(bucket, outputKey, outLocal);

  await putStatus(bucket, jobId, {
    state: "done",
    progress: 100,
    outputKey,
  });
}

/** meta.muteOriginal — true만 음소거; 문자열 "false" 등은 잘못 켜지지 않게 처리 */
function coerceMuteOriginal(meta) {
  const v = meta?.muteOriginal;
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
}

function normalizeMusicOptions(meta) {
  const mo = meta.musicOptions && typeof meta.musicOptions === "object" ? meta.musicOptions : {};
  const volume = Number(mo.volume);
  const startTime = Number(mo.startTime);
  const fadeOutDuration = Number(mo.fadeOutDuration);
  return {
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8,
    startTime: Number.isFinite(startTime) ? Math.max(0, startTime) : 0,
    fadeOutDuration: Number.isFinite(fadeOutDuration)
      ? Math.min(5, Math.max(0, fadeOutDuration))
      : 2,
  };
}

/** FFmpeg -af 체인: volume + 끝 페이드아웃 (st = 영상끝 - fade 길이) */
function buildMusicAf(videoDurSec, opts) {
  const vol = opts.volume;
  const fdRaw = opts.fadeOutDuration;
  const fd = Math.min(fdRaw, videoDurSec);
  const st = Math.max(0, videoDurSec - fd);
  const parts = [`volume=${vol}`];
  if (fd > 0.001) {
    parts.push(`afade=t=out:st=${st.toFixed(4)}:d=${fd.toFixed(4)}`);
  }
  return parts.join(",");
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function getJson(bucket, key) {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const buf = await streamToBuffer(out.Body);
  return JSON.parse(buf.toString("utf8"));
}

async function putStatus(bucket, jobId, payload) {
  const key = `jobs/${jobId}/status.json`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(payload),
      ContentType: "application/json",
    })
  );
}

async function getObjectFile(bucket, key, destPath) {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  const buf = await streamToBuffer(out.Body);
  writeFileSync(destPath, buf);
}

async function putOutputMp4(bucket, key, filePath) {
  const body = readFileSync(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    })
  );
}

const EXTRACT_AUDIO_PRESIGN_EXPIRES_SEC = 300;

/** source.mp4 → audio.mp3 S3 업로드 후 presigned GET URL 반환 (Whisper 업로드 크기 완화용) */
async function runExtractAudio(bucket, jobId, workDir) {
  const sourceKey = `jobs/${jobId}/source.mp4`;
  const sourceLocal = join(workDir, "source.mp4");
  await getObjectFile(bucket, sourceKey, sourceLocal);
  runFfmpeg(
    [
      "-y",
      "-i",
      "source.mp4",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "128k",
      "audio.mp3",
    ],
    workDir,
    "extract_audio_mp3"
  );
  const audioLocal = join(workDir, "audio.mp3");
  const audioKey = `jobs/${jobId}/audio.mp3`;
  const mp3Body = readFileSync(audioLocal);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: audioKey,
      Body: mp3Body,
      ContentType: "audio/mpeg",
    })
  );
  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: audioKey }),
    { expiresIn: EXTRACT_AUDIO_PRESIGN_EXPIRES_SEC }
  );
  return {
    ok: true,
    jobId,
    audioKey,
    presignedUrl,
    expiresIn: EXTRACT_AUDIO_PRESIGN_EXPIRES_SEC,
  };
}

/** yt-dlp로 URL에서 받아 jobs/{jobId}/source.mp4 로 저장 */
async function runDownloadUrl(bucket, jobId, workDir, sourceUrl) {
  const trimmed = String(sourceUrl || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: "유효한 http(s) URL이 필요합니다." };
  }
  const bin = ytdlpBin();
  if (!existsSync(bin)) {
    return { ok: false, error: "yt-dlp 바이너리를 찾을 수 없습니다." };
  }
  const r = spawnSync(
    bin,
    [
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bv*+ba/bestvideo+bestaudio/best/b",
      "--merge-output-format",
      "mp4",
      "-o",
      "source.%(ext)s",
      trimmed,
    ],
    {
      cwd: workDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `/var/task/bin:/opt/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
      },
    }
  );
  if (r.status !== 0) {
    const errTail = (r.stderr || r.stdout || "").slice(-1200);
    return {
      ok: false,
      error: `yt-dlp 실패 (exit ${r.status}): ${errTail}`,
    };
  }
  const names = readdirSync(workDir).filter((n) => n.startsWith("source."));
  if (!names.length) {
    return { ok: false, error: "yt-dlp 후 출력 파일이 없습니다." };
  }
  const mp4Name = names.find((n) => n === "source.mp4") || names.find((n) => n.endsWith(".mp4"));
  const picked = mp4Name || names[0];
  const finalPath = join(workDir, "source.mp4");
  if (picked === "source.mp4") {
    // already target name
  } else if (picked.endsWith(".mp4")) {
    copyFileSync(join(workDir, picked), finalPath);
  } else {
    runFfmpeg(
      ["-y", "-i", picked, "-c", "copy", "source.mp4"],
      workDir,
      "ytdlp_remux_mp4"
    );
  }
  if (!existsSync(finalPath)) {
    return { ok: false, error: "source.mp4 생성에 실패했습니다." };
  }
  const outputKey = `jobs/${jobId}/source.mp4`;
  await putOutputMp4(bucket, outputKey, finalPath);
  return { ok: true, jobId, outputKey };
}

function runFfmpeg(args, cwd, label) {
  const bin = ffmpegBin();
  const r = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `/var/task/bin:/opt/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    },
  });
  if (r.status !== 0) {
    console.error(`[ffmpeg ${label}] exit`, r.status, r.stderr || r.stdout);
    throw new Error(
      `ffmpeg 실패 (${label}) code=${r.status}: ${(r.stderr || r.stdout || "").slice(0, 800)}`
    );
  }
}

export const handler = async (event) => {
  const bucket = event.bucket || process.env.S3_BUCKET || "kbo-video-export";
  const jobId = event.jobId;
  if (!jobId) {
    return { ok: false, error: "missing jobId" };
  }

  const workDir = join("/tmp", `job_${jobId}`);
  try {
    mkdirSync(workDir, { recursive: true });

    const metaKey = `jobs/${jobId}/meta.json`;
    let meta;
    if (event.meta && event.meta.type === "extract_audio") {
      meta = event.meta;
    } else if (event.meta && event.meta.type === "download_url") {
      meta = event.meta;
    } else {
      await putStatus(bucket, jobId, { state: "processing", progress: 15 });
      meta = await getJson(bucket, metaKey);
    }

    if (meta.type === "extract_audio") {
      return await runExtractAudio(bucket, jobId, workDir);
    }

    if (meta.type === "download_url") {
      return await runDownloadUrl(
        bucket,
        jobId,
        workDir,
        String(meta.sourceUrl || "").trim()
      );
    }

    if (meta.type === "thumbnail") {
      const { safeBg, vf } = meta;
      const outKey = `jobs/${jobId}/thumbnail.jpg`;

      const ffmpegArgs = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=#${safeBg}:size=1080x1920:rate=1`,
        "-vf",
        vf,
        "-update",
        "1",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "/tmp/thumbnail.jpg",
      ];

      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegBin(), ffmpegArgs, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stderr = "";
        proc.stderr?.on("data", (d) => {
          stderr += d.toString();
        });
        proc.on("close", (code) => {
          console.log("[thumbnail] ffmpeg stderr:", stderr);
          if (code === 0) resolve();
          else
            reject(
              new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`)
            );
        });
      });

      const fileBuffer = readFileSync("/tmp/thumbnail.jpg");
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: outKey,
          Body: fileBuffer,
          ContentType: "image/jpeg",
        })
      );

      return { ok: true, outKey };
    }

    if (meta.type === "highlight") {
      await runHighlightPipeline(bucket, jobId, workDir, meta);
      return {
        ok: true,
        jobId,
        outputKey: `jobs/${jobId}/output/output.mp4`,
      };
    }

    const {
      durations = [],
      transition = 0,
      slideCount = 0,
      hasMusic: hasMusicMeta = false,
    } = meta;
    const music_s3_key =
      meta.music_s3_key && String(meta.music_s3_key).trim()
        ? String(meta.music_s3_key).trim()
        : "";
    const hasMusic = Boolean(music_s3_key) || Boolean(hasMusicMeta);

    const n = Math.min(slideCount, durations.length);
    if (n < 1) throw new Error("slideCount 없음");

    const musicOpts = normalizeMusicOptions(meta);
    const dursForLen = durations.slice(0, n);
    const TfForLen = Number(transition);
    logMetaJsonFull(meta);
    logSlideKeysDurationMapping(meta, n, dursForLen);
    logChunkSplitDetail(n, dursForLen, meta, jobId);
    const videoDurSec = computeChunkedPipelineDurationSec(n, dursForLen, TfForLen);
    console.log(`[meta] transition 차감 후: ${videoDurSec.toFixed(4)}초`);

    for (let i = 0; i < n; i++) {
      await getObjectFile(
        bucket,
        `jobs/${jobId}/input/slide_${i}.png`,
        join(workDir, `slide_${i}.png`)
      );
    }

    let musicLocal = null;
    if (hasMusic) {
      musicLocal = resolve(join(workDir, "music.mp3"));
      if (music_s3_key) {
        await getObjectFile(bucket, music_s3_key, musicLocal);
      } else {
        await getObjectFile(bucket, `jobs/${jobId}/input/music.mp3`, musicLocal);
      }
      console.log(
        `[music] after S3 download path=${musicLocal} exists=${existsSync(musicLocal)}`
      );
    }
    const musicFileOk = Boolean(musicLocal) && existsSync(musicLocal);
    if (hasMusic && !musicFileOk) {
      console.warn(
        "[kbo-video-encoder] hasMusic 메타이지만 music.mp3 없음 — 무음으로 처리"
      );
    }
    const afChain = musicFileOk ? buildMusicAf(videoDurSec, musicOpts) : "";

    await putStatus(bucket, jobId, { state: "processing", progress: 35 });

    const outLocal = join(workDir, "output.mp4");
    const Tf = Number(transition);

    for (let i = 0; i < n; i++) {
      prepSlidePngTo1080(workDir, i);
    }

    if (n === 1) {
      const args = [
        "-y",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        String(durations[0]),
        "-i",
        "prep_0.png",
        "-vf",
        "format=yuv420p,fps=30",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
      ];
      if (musicFileOk) {
        args.push(
          "-stream_loop",
          "-1",
          "-ss",
          String(musicOpts.startTime),
          "-i",
          musicLocal,
          "-map",
          "0:v",
          "-map",
          "1:a",
          "-af",
          afChain,
          "-c:a",
          "aac",
          "-b:a",
          "320k",
          "-ar",
          "48000",
          "-ac",
          "2",
          "-shortest"
        );
      } else {
        args.push("-an");
      }
      args.push("output.mp4");
      runFfmpeg(args, workDir, "single");
    } else {
      const durs = dursForLen;
      const numChunks = Math.ceil(n / CHUNK_SLIDES);

      for (let c = 0; c < numChunks; c++) {
        const start = c * CHUNK_SLIDES;
        const m = Math.min(CHUNK_SLIDES, n - start);
        const sub = durs.slice(start, start + m);

        if (m === 1) {
          runFfmpeg(
            [
              "-y",
              "-loop",
              "1",
              "-framerate",
              "30",
              "-t",
              String(sub[0]),
              "-i",
              `prep_${start}.png`,
              "-vf",
              "format=yuv420p,fps=30",
              "-c:v",
              "libx264",
              "-preset",
              "ultrafast",
              "-crf",
              "23",
              "-pix_fmt",
              "yuv420p",
              "-r",
              "30",
              "-an",
              `chunk_${c}.mp4`,
            ],
            workDir,
            `chunk_${c}_one`
          );
        } else if (Tf > 0.001) {
          const args = [];
          for (let j = 0; j < m; j++) {
            args.push(
              "-loop",
              "1",
              "-framerate",
              "30",
              "-t",
              String(sub[j]),
              "-i",
              `prep_${start + j}.png`
            );
          }
          args.push(
            "-filter_complex",
            buildXfadeGraphPrepped(m, sub, Tf),
            "-map",
            "[vout]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-an",
            "-y",
            `chunk_${c}.mp4`
          );
          runFfmpeg(args, workDir, `chunk_${c}_xfade`);
        } else {
          const args = [];
          for (let j = 0; j < m; j++) {
            args.push(
              "-loop",
              "1",
              "-framerate",
              "30",
              "-t",
              String(sub[j]),
              "-i",
              `prep_${start + j}.png`
            );
          }
          args.push(
            "-filter_complex",
            buildConcatFilterNoTransition(m),
            "-map",
            "[vout]",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "30",
            "-an",
            "-y",
            `chunk_${c}.mp4`
          );
          runFfmpeg(args, workDir, `chunk_${c}_concat`);
        }

        for (let j = 0; j < m; j++) {
          const pp = join(workDir, `prep_${start + j}.png`);
          if (existsSync(pp)) unlinkSync(pp);
        }
      }

      if (numChunks === 1) {
        if (musicFileOk) {
          runFfmpeg(
            [
              "-y",
              "-i",
              "chunk_0.mp4",
              "-stream_loop",
              "-1",
              "-ss",
              String(musicOpts.startTime),
              "-i",
              musicLocal,
              "-map",
              "0:v",
              "-map",
              "1:a",
              "-c:v",
              "copy",
              "-af",
              afChain,
              "-c:a",
              "aac",
              "-b:a",
              "320k",
              "-ar",
              "48000",
              "-ac",
              "2",
              "-shortest",
              "output.mp4",
            ],
            workDir,
            "mux-one-chunk"
          );
        } else {
          runFfmpeg(
            ["-y", "-i", "chunk_0.mp4", "-c:v", "copy", "-an", "output.mp4"],
            workDir,
            "copy-one-chunk"
          );
        }
        const ch0 = join(workDir, "chunk_0.mp4");
        if (existsSync(ch0)) unlinkSync(ch0);
      } else {
        writeFileSync(
          join(workDir, "list_chunks.txt"),
          buildChunkMp4ConcatList(numChunks),
          "utf8"
        );
        runFfmpeg(
          [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            "list_chunks.txt",
            "-c:v",
            "copy",
            "-an",
            "joined.mp4",
          ],
          workDir,
          "concat-chunks"
        );
        for (let c = 0; c < numChunks; c++) {
          const cp = join(workDir, `chunk_${c}.mp4`);
          if (existsSync(cp)) unlinkSync(cp);
        }
        if (musicFileOk) {
          runFfmpeg(
            [
              "-y",
              "-i",
              "joined.mp4",
              "-stream_loop",
              "-1",
              "-ss",
              String(musicOpts.startTime),
              "-i",
              musicLocal,
              "-map",
              "0:v",
              "-map",
              "1:a",
              "-c:v",
              "copy",
              "-af",
              afChain,
              "-c:a",
              "aac",
              "-b:a",
              "320k",
              "-ar",
              "48000",
              "-ac",
              "2",
              "-shortest",
              "output.mp4",
            ],
            workDir,
            "mux-final"
          );
        } else {
          runFfmpeg(
            ["-y", "-i", "joined.mp4", "-c:v", "copy", "-an", "output.mp4"],
            workDir,
            "copy-final"
          );
        }
        const joinedPath = join(workDir, "joined.mp4");
        if (existsSync(joinedPath)) unlinkSync(joinedPath);
      }
    }

    await putStatus(bucket, jobId, { state: "processing", progress: 85 });

    const probedOut = probeFormatDurationSec(workDir, "output.mp4");
    console.log(
      `[duration] expected(chunked)=${videoDurSec.toFixed(4)}s actual_ffprobe=${probedOut != null ? probedOut.toFixed(4) : "n/a"} diff=${probedOut != null ? (probedOut - videoDurSec).toFixed(4) : "n/a"}`
    );

    const outputKey = `jobs/${jobId}/output/output.mp4`;
    await putOutputMp4(bucket, outputKey, outLocal);

    await putStatus(bucket, jobId, {
      state: "done",
      progress: 100,
      outputKey,
    });

    return { ok: true, jobId, outputKey };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[kbo-video-encoder]", msg);
    try {
      await putStatus(bucket, jobId, { state: "error", progress: 0, error: msg });
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg };
  } finally {
    try {
      if (existsSync(workDir)) {
        try {
          for (const name of readdirSync(workDir)) {
            if (name.startsWith("source.")) {
              const p = join(workDir, name);
              if (existsSync(p)) unlinkSync(p);
            }
          }
        } catch {
          /* ignore */
        }
        for (const f of [
          "output.mp4",
          "list_chunks.txt",
          "joined.mp4",
          "music.mp3",
          "joined_hi.mp4",
          "concat_hi.txt",
          "hi_top.txt",
        ]) {
          const p = join(workDir, f);
          if (existsSync(p)) unlinkSync(p);
        }
        for (let i = 0; i < 200; i++) {
          for (const name of [
            `slide_${i}.png`,
            `prep_${i}.png`,
            `chunk_${i}.mp4`,
            `seg_${i}.mp4`,
            `hi_bottom_${i}.txt`,
          ]) {
            const p = join(workDir, name);
            if (existsSync(p)) unlinkSync(p);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
};
