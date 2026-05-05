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

/** /var/task/fonts/{fileName} — 없으면 기본 TTF */
function resolveBundledFontPath(fileName) {
  const base = String(fileName || "").trim() || DEFAULT_FONT_FILE;
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
  return {
    topText,
    topTextSize,
    topTextColor,
    topTextOpacity,
    topTextFont,
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
  return { text, textY, textColor, textSize, textOpacity, textFont };
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

function buildHighlightSegmentVf(opts) {
  const {
    cw,
    ih,
    cx,
    topTextFile,
    bottomTextFile,
    topFontSize,
    bottomFontSize,
    topColor,
    topOpacity,
    bottomColor,
    bottomOpacity,
    textY,
    topFontPath,
    bottomFontPath,
  } = opts;
  const parts = [
    `crop=${cw}:${ih}:${cx}:0`,
    `scale=1080:1920:flags=lanczos`,
    "format=yuv420p",
  ];
  const fsTop = Math.round(topFontSize);
  const fsBottom = Math.round(bottomFontSize);

  if (bottomTextFile && bottomFontPath) {
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(bottomFontPath)}:textfile=${escapePathForDrawtextFilter(bottomTextFile)}:fontsize=${fsBottom}:fontcolor=${fontColorForFfmpegWithOpacity(bottomColor, bottomOpacity)}:x=(w-text_w)/2:y=h*${textY}/100`
    );
  }
  if (topTextFile && topFontPath) {
    parts.push(
      `drawtext=fontfile=${escapePathForDrawtextFilter(topFontPath)}:textfile=${escapePathForDrawtextFilter(topTextFile)}:fontsize=${fsTop}:fontcolor=${fontColorForFfmpegWithOpacity(topColor, topOpacity)}:x=(w-text_w)/2:y=h*0.105:shadowx=2:shadowy=2:shadowcolor=black`
    );
  }
  const chain = parts.join(",");
  return /fps=30/.test(chain) ? chain : `${chain},fps=30`;
}

async function runHighlightPipeline(bucket, jobId, workDir, meta) {
  let segments = Array.isArray(meta.segments) ? [...meta.segments] : [];
  if (segments.length < 1) throw new Error("구간 없음");

  const thumbRaw = meta.thumbnailTime;
  const thumbAt =
    thumbRaw !== undefined && thumbRaw !== null && thumbRaw !== ""
      ? Number(thumbRaw)
      : NaN;

  // thumbnail.png S3에 있으면 PNG → 0.3초 클립으로 변환
  const thumbPngKey = `jobs/${jobId}/thumbnail.png`;
  const thumbPngLocal = join(workDir, "thumbnail.png");
  let hasThumbnailPng = false;
  try {
    await getObjectFile(bucket, thumbPngKey, thumbPngLocal);
    hasThumbnailPng = true;
    console.log("[highlight] thumbnail.png found, will prepend as 0.3s clip");
  } catch (e) {
    console.log("[highlight] no thumbnail.png, skipping");
  }

  // thumbnail.png 있으면 PNG 클립 사용, 없으면 기존 thumbnailTime 방식
  if (hasThumbnailPng) {
    // PNG → 0.3초 mp4 클립 생성
    const thumbClipLocal = join(workDir, "thumb_clip.mp4");
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-t",
        String(HIGHLIGHT_THUMBNAIL_DUR_SEC),
        "-i",
        thumbPngLocal,
        "-map",
        "1:v",
        "-map",
        "0:a",
        "-vf",
        `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-shortest",
        thumbClipLocal,
      ],
      workDir,
      "thumb_png_clip"
    );

    // segments 앞에 PNG 클립 마커 추가
    segments = [
      { _pngThumbClip: true, localPath: thumbClipLocal },
      ...segments,
    ];
  } else if (Number.isFinite(thumbAt) && thumbAt >= 0) {
    // 기존 thumbnailTime 방식 유지
    const first = segments[0];
    const thumbSeg = {
      ...first,
      start: thumbAt,
      end: thumbAt + HIGHLIGHT_THUMBNAIL_DUR_SEC,
      startMs: 0,
      endMs: 0,
      [THUMB_SEG_FLAG]: true,
    };
    segments = [thumbSeg, ...segments];
  }

  await putStatus(bucket, jobId, { state: "processing", progress: 18 });
  const sourceKey = `jobs/${jobId}/source.mp4`;
  const sourceLocal = join(workDir, "source.mp4");
  await getObjectFile(bucket, sourceKey, sourceLocal);
  console.log("[highlight] source from S3", sourceKey, "->", sourceLocal);
  const sourceFileName = "source.mp4";

  await putStatus(bucket, jobId, { state: "processing", progress: 32 });

  const { w: iw, h: ih } = probeVideoDimensions(workDir, sourceFileName);
  let cw = Math.floor((ih * 9) / 16);
  cw -= cw % 2;
  cw = Math.min(cw, iw - (iw % 2));

  const {
    topText,
    topTextSize,
    topTextColor,
    topTextOpacity,
    topTextFont,
  } = normalizeHighlightTop(meta);
  const metaWantsText =
    Boolean(topText) ||
    segments.some((s) => s?.text != null && String(s.text).trim() !== "") ||
    Boolean(String(meta.thumbnailText || "").trim());
  const topFontPath = resolveBundledFontPath(topTextFont);
  if (metaWantsText && !resolveBundledFontPath(DEFAULT_FONT_FILE)) {
    console.warn(
      "[highlight] no bundle font under /var/task/fonts — drawtext may be skipped"
    );
  }

  let topTextPath = null;
  if (topText && topFontPath) {
    topTextPath = join(workDir, "hi_top.txt");
    writeFileSync(topTextPath, topText, "utf8");
  }

  const numSeg = segments.length;
  for (let i = 0; i < numSeg; i++) {
    const seg = segments[i];
    if (seg._pngThumbClip === true) {
      // 이미 thumb_clip.mp4 생성됨 → seg_i.mp4 로 복사
      const segOut = join(workDir, `seg_${i}.mp4`);
      copyFileSync(seg.localPath, segOut);
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
      textY,
      textColor: bottomColor,
      textSize: bottomTextSize,
      textOpacity: bottomOpacity,
      textFont: bottomFontName,
    } = bottomParsed;
    const bottomFontPath = resolveBundledFontPath(bottomFontName);
    let bottomPath = null;
    if (bottomTxt && bottomFontPath) {
      bottomPath = join(workDir, `hi_bottom_${i}.txt`);
      writeFileSync(bottomPath, bottomTxt, "utf8");
    }
    const vfSeg = buildHighlightSegmentVf({
      cw,
      ih,
      cx,
      topTextFile: topTextPath,
      bottomTextFile: bottomPath,
      topFontSize: topTextSize,
      bottomFontSize: bottomTextSize,
      topColor: topTextColor,
      topOpacity: topTextOpacity,
      bottomColor,
      bottomOpacity,
      textY,
      topFontPath,
      bottomFontPath,
    });
    await putStatus(bucket, jobId, {
      state: "processing",
      progress: 32 + Math.floor((38 * (i + 1)) / numSeg),
    });
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
  const muteOriginal = coerceMuteOriginal(meta);
  const musicKeyRaw =
    meta.music_s3_key && String(meta.music_s3_key).trim()
      ? String(meta.music_s3_key).trim()
      : "";
  const hasMusic = Boolean(musicKeyRaw);
  const musicOpts = normalizeMusicOptions(meta);

  if (hasMusic) {
    const musicLocal = resolve(join(workDir, "highlight_bgm.mp3"));
    await getObjectFile(bucket, musicKeyRaw, musicLocal);
    if (!existsSync(musicLocal)) {
      throw new Error("BGM 파일을 S3에서 받지 못했습니다.");
    }

    if (muteOriginal) {
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
      console.log("[mux] videoDurForMux:", videoDurForMux);
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
      console.log("[mux] videoDurForMux:", videoDurForMux);
      const fd = Math.min(musicOpts.fadeOutDuration || 2, videoDurForMux);
      const st = Math.max(0, videoDurForMux - fd);
      const chain = buildMusicAf(videoDurForMux, musicOpts);
      const fc = `[0:a]afade=t=out:st=${st.toFixed(4)}:d=${fd.toFixed(4)}[oa];[1:a]${chain}[bm];[oa][bm]amix=inputs=2:duration=first:normalize=0[outa]`;

      const bgmTrimLocal = resolve(join(workDir, "bgm_trim.mp3"));
      const bgmDur = videoDurForMux + 0.5;
      runFfmpeg(
        [
          "-y",
          "-ss",
          String(musicOpts.startTime),
          "-t",
          String(bgmDur),
          "-i",
          musicLocal,
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-ac",
          "2",
          bgmTrimLocal,
        ],
        workDir,
        "bgm_trim"
      );

      runFfmpeg(
        [
          "-y",
          "-i",
          "cropped_va.mp4",
          "-i",
          bgmTrimLocal,
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
      if (existsSync(bgmTrimLocal)) unlinkSync(bgmTrimLocal);
    }
  } else if (muteOriginal) {
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
  console.log("[musicAf] videoDurSec:", videoDurSec, "fdRaw:", fdRaw, "fd:", fd, "st:", st);
  const parts = [`volume=${vol}`];
  if (fd > 0.001) {
    parts.push(`afade=t=out:st=${st.toFixed(4)}:d=${fd.toFixed(4)}`);
  }
  console.log("[musicAf] chain:", parts.join(","));
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
    await putStatus(bucket, jobId, { state: "processing", progress: 15 });

    const metaKey = `jobs/${jobId}/meta.json`;
    const meta = await getJson(bucket, metaKey);

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
