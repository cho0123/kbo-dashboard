import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const region = process.env.AWS_REGION || "ap-northeast-2";
const s3 = new S3Client({ region });

const VIDEO_VF =
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black";

/** PNG→세그먼트 인코딩 시 RGBA→yuv420p (concat 단계에서는 디코드만 하도록 사전 변환) */
const SEGMENT_VF = `${VIDEO_VF},format=yuv420p,fps=30`;

/** `df -B1 /tmp`로 /tmp 사용 가능 바이트 (Lambda ephemeral storage) */
function getAvailTmpBytes() {
  const r = spawnSync("df", ["-B1", "/tmp"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  const lines = r.stdout
    .trim()
    .split("\n")
    .filter((l) => l.length);
  if (lines.length < 2) return null;
  const parts = lines[1].trim().split(/\s+/);
  if (parts.length < 4) return null;
  const avail = Number(parts[3]);
  return Number.isFinite(avail) ? avail : null;
}

/** 2단계 인코딩: 세그먼트 mp4 + 최종 concat + PNG 병행 시 /tmp 부족 방지 */
function assertTmpSpaceForTwoPass(slideCount) {
  const avail = getAvailTmpBytes();
  if (avail == null) {
    throw new Error(
      "/tmp 여유 공간을 확인할 수 없습니다 (df /tmp 실패). Lambda ephemeral storage를 확인하세요."
    );
  }
  const reserveOutput = 128 * 1024 * 1024;
  const perSlideBytes = 6 * 1024 * 1024;
  const needed =
    BigInt(reserveOutput) + BigInt(Math.max(0, slideCount)) * BigInt(perSlideBytes);
  if (BigInt(avail) < needed) {
    const avMiB = (avail / (1024 * 1024)).toFixed(1);
    const ndMiB = (Number(needed) / (1024 * 1024)).toFixed(1);
    throw new Error(
      `/tmp 여유 공간 부족: 사용 가능 약 ${avMiB} MiB, 예상 필요 약 ${ndMiB} MiB (슬라이드 ${slideCount}장·2단계 인코딩). Lambda 함수 설정에서 /tmp(512MB~10GB) 용량을 늘리세요.`
    );
  }
  console.log(
    `[/tmp] 여유 약 ${(avail / (1024 * 1024)).toFixed(1)} MiB (추정 필요 ≥ ${(Number(needed) / (1024 * 1024)).toFixed(1)} MiB)`
  );
}

function buildVideoSegmentConcatList(n) {
  let s = "ffconcat version 1.0\n";
  for (let i = 0; i < n; i++) {
    s += `file 'seg_${i}.mp4'\n`;
  }
  return s;
}

function ffmpegBin() {
  const candidates = ["/opt/bin/ffmpeg", "/opt/ffmpeg/ffmpeg"];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

function buildXfadeGraph(n, durations, transitionRaw) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]${VIDEO_VF},format=yuv420p,setpts=PTS-STARTPTS,fps=30[v${i}s]`
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

/** 출력 영상 길이(초) — xfade/concat/단일 슬라이드와 동일 로직 */
function computeVideoDurationSec(n, durations, transitionRaw) {
  const Tf = Math.max(0, Number(transitionRaw) || 0);
  const durs = durations.map((x) => Number(x) || 0);
  if (n < 1) return 0;
  if (n === 1) return Math.max(0.05, durs[0] || 0);
  /** 20장 이상은 concat demuxer만 사용(크로스페이드 없음) → 길이는 구간 합 */
  const useXfade = n > 1 && n < 20 && Tf > 0.001;
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
    const videoDurSec = computeVideoDurationSec(n, durations, transition);
    const afChain = hasMusic ? buildMusicAf(videoDurSec, musicOpts) : "";

    for (let i = 0; i < n; i++) {
      await getObjectFile(
        bucket,
        `jobs/${jobId}/input/slide_${i}.png`,
        join(workDir, `slide_${i}.png`)
      );
    }

    let musicLocal = null;
    if (hasMusic) {
      musicLocal = join(workDir, "music.mp3");
      if (music_s3_key) {
        await getObjectFile(bucket, music_s3_key, musicLocal);
      } else {
        await getObjectFile(bucket, `jobs/${jobId}/input/music.mp3`, musicLocal);
      }
    }

    await putStatus(bucket, jobId, { state: "processing", progress: 35 });

    const outLocal = join(workDir, "output.mp4");
    const Tf = Number(transition);
    /** 슬라이드 20장 이상이면 xfade 대신 concat demuxer(필터 그래프 부담 감소) */
    const useXfade =
      n > 1 && n < 20 && Number.isFinite(Tf) && Tf > 0.001;

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
        "slide_0.png",
        "-vf",
        `${VIDEO_VF},format=yuv420p,fps=30`,
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
      if (hasMusic) {
        args.push(
          "-ss",
          String(musicOpts.startTime),
          "-i",
          "music.mp3",
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
    } else if (useXfade) {
      const args = [];
      for (let i = 0; i < n; i++) {
        args.push(
          "-loop",
          "1",
          "-framerate",
          "30",
          "-t",
          String(durations[i]),
          "-i",
          `slide_${i}.png`
        );
      }
      if (hasMusic) {
        args.push("-ss", String(musicOpts.startTime), "-i", "music.mp3");
      }
      const xfadeGraph = buildXfadeGraph(n, durations, Tf);
      const fc = hasMusic
        ? `${xfadeGraph};[${n}:a]${afChain}[aout]`
        : xfadeGraph;
      args.push("-filter_complex", fc);
      args.push(
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
        "30"
      );
      if (hasMusic) {
        args.push(
          "-map",
          "[aout]",
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
      args.push("-y", "output.mp4");
      runFfmpeg(args, workDir, "xfade");
    } else {
      assertTmpSpaceForTwoPass(n);

      const durs = durations.slice(0, n);
      for (let i = 0; i < n; i++) {
        runFfmpeg(
          [
            "-y",
            "-loop",
            "1",
            "-framerate",
            "30",
            "-t",
            String(durs[i]),
            "-i",
            `slide_${i}.png`,
            "-vf",
            SEGMENT_VF,
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
          `segment_${i}`
        );
        const pngPath = join(workDir, `slide_${i}.png`);
        if (existsSync(pngPath)) unlinkSync(pngPath);
      }

      writeFileSync(
        join(workDir, "list_seg.txt"),
        buildVideoSegmentConcatList(n),
        "utf8"
      );

      const concatArgs = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list_seg.txt",
        "-c:v",
        "copy",
      ];
      if (hasMusic) {
        concatArgs.push(
          "-ss",
          String(musicOpts.startTime),
          "-i",
          "music.mp3",
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
        concatArgs.push("-an");
      }
      concatArgs.push("output.mp4");
      runFfmpeg(concatArgs, workDir, "concat-segments");
    }

    await putStatus(bucket, jobId, { state: "processing", progress: 85 });

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
        for (const f of ["output.mp4", "list_seg.txt", "music.mp3"]) {
          const p = join(workDir, f);
          if (existsSync(p)) unlinkSync(p);
        }
        for (let i = 0; i < 200; i++) {
          const seg = join(workDir, `seg_${i}.mp4`);
          if (existsSync(seg)) unlinkSync(seg);
          const png = join(workDir, `slide_${i}.png`);
          if (existsSync(png)) unlinkSync(png);
        }
      }
    } catch {
      /* ignore */
    }
  }
};
