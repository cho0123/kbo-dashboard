import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || "ap-northeast-2";
const s3 = new S3Client({ region });

const VIDEO_VF =
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black";

/**
 * 청크당 최대 슬라이드 수 (xfade 필터 그래프 메모리 상한).
 * 분할 기준은 항상 슬라이드 장수이며, 누적 재생 시간(초)으로 청크를 나누지 않음.
 */
const CHUNK_SLIDES = 10;

function ffmpegBin() {
  const candidates = ["/opt/bin/ffmpeg", "/opt/ffmpeg/ffmpeg"];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

function ffprobeBin() {
  const candidates = ["/opt/bin/ffprobe", "/opt/ffmpeg/ffprobe"];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "ffprobe";
}

function ytdlpBin() {
  return join(dirname(fileURLToPath(import.meta.url)), "bin", "yt-dlp");
}

/**
 * URL에서 영상 다운로드(병합 mp4). Lambda 패키지의 bin/yt-dlp 사용.
 * @param {string} url
 * @param {string} outputPath - yt-dlp -o 대상 경로(파일)
 * @param {string} [quality='1080'] - 최대 높이(px) 문자열
 */
async function downloadVideo(url, outputPath, quality = "1080") {
  const bin = ytdlpBin();
  if (!existsSync(bin)) {
    throw new Error(`yt-dlp not found at ${bin}`);
  }
  const fmt = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`;
  const args = [
    "-f",
    fmt,
    "--merge-output-format",
    "mp4",
    "-o",
    outputPath,
    "--no-playlist",
    String(url || "").trim(),
  ];
  await new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.stdout?.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(
            `yt-dlp 실패 (exit ${code}): ${stderr.slice(0, 1200)}`
          )
        );
    });
  });
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

function buildFfconcatPrepList(startIdx, count, durSlice) {
  let s = "ffconcat version 1.0\n";
  for (let j = 0; j < count; j++) {
    s += `file 'prep_${startIdx + j}.png'\n`;
    s += `duration ${durSlice[j]}\n`;
  }
  const last = count - 1;
  s += `file 'prep_${startIdx + last}.png'\n`;
  s += "duration 0\n";
  return s;
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

async function runHighlightPipeline(bucket, jobId, workDir, meta) {
  const url = String(meta.sourceUrl || "").trim();
  const segments = Array.isArray(meta.segments) ? meta.segments : [];
  const cropPosition = String(meta.cropPosition || "center").toLowerCase();
  if (!url) throw new Error("sourceUrl 없음");
  if (segments.length < 1) throw new Error("구간 없음");

  await putStatus(bucket, jobId, { state: "processing", progress: 18 });
  const srcPath = join(workDir, "source.mp4");
  await downloadVideo(url, srcPath, "1080");

  await putStatus(bucket, jobId, { state: "processing", progress: 32 });

  const { w: iw, h: ih } = probeVideoDimensions(workDir, "source.mp4");
  let cw = Math.floor((ih * 9) / 16);
  cw -= cw % 2;
  cw = Math.min(cw, iw - (iw % 2));
  let cx = 0;
  if (cropPosition === "center") cx = Math.floor((iw - cw) / 2);
  else if (cropPosition === "right") cx = iw - cw;
  cx -= cx % 2;

  const numSeg = segments.length;
  for (let i = 0; i < numSeg; i++) {
    const seg = segments[i];
    const a = parseTimeToSeconds(seg.start);
    const b = parseTimeToSeconds(seg.end);
    const dur = b - a;
    if (!(dur > 0.04)) {
      throw new Error(`구간 ${i + 1}: 종료가 시작보다 커야 합니다.`);
    }
    await putStatus(bucket, jobId, {
      state: "processing",
      progress: 32 + Math.floor((38 * (i + 1)) / numSeg),
    });
    runFfmpeg(
      [
        "-y",
        "-ss",
        String(a),
        "-i",
        "source.mp4",
        "-t",
        String(dur),
        "-c",
        "copy",
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

  const vf = `crop=${cw}:${ih}:${cx}:0,scale=1080:1920:flags=lanczos`;
  const outLocal = join(workDir, "output.mp4");
  runFfmpeg(
    [
      "-y",
      "-i",
      "joined_hi.mp4",
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outLocal,
    ],
    workDir,
    "highlight_crop"
  );

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

function runFfmpeg(args, cwd, label) {
  const bin = ffmpegBin();
  const r = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PATH: `/opt/bin:/usr/bin:${process.env.PATH || ""}` },
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
          const listName = `list_chunk_${c}.txt`;
          writeFileSync(
            join(workDir, listName),
            buildFfconcatPrepList(start, m, sub),
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
              listName,
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
            `chunk_${c}_nxf`
          );
          const lp = join(workDir, listName);
          if (existsSync(lp)) unlinkSync(lp);
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
        for (const f of [
          "output.mp4",
          "list_chunks.txt",
          "joined.mp4",
          "music.mp3",
          "source.mp4",
          "joined_hi.mp4",
          "concat_hi.txt",
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
