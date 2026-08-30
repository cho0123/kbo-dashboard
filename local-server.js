import { spawn } from "child_process";
import { randomUUID } from "crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3838;
const CLIPS_DIR = join(__dirname, "clips");
const CLIP_TMP_DIR = join(CLIPS_DIR, "tmp");
const FFMPEG_EXE = join(__dirname, "ffmpeg.exe");

const FFMPEG_ENCODE_OUT_ARGS = [
  "-c:v",
  "libx264",
  "-c:a",
  "aac",
  "-preset",
  "fast",
];

/**
 * yt-dlp 재시도·타임아웃.
 * retries / fragment-retries 는 yt-dlp 기본값과 같은 10 을 명시해 둔 것이고,
 * 실질적인 변화는 socket-timeout 이다 — 기본값이 없어서 응답이 끊기면
 * 소켓이 무한정 대기한다(요청도 같이 매달린다). 30초면 느린 청크는 견디고
 * 죽은 연결은 끊어서 재시도로 넘어간다.
 */
const YTDLP_RETRY_ARGS = [
  "--retries", "10",
  "--fragment-retries", "10",
  "--socket-timeout", "30",
];

/**
 * 최종 파일 경로를 yt-dlp 가 직접 알려주게 한다.
 * after_move 는 병합·재인코딩·이동이 전부 끝난 뒤라 이 값이 곧 최종 파일이다.
 * --print 는 --quiet 를 함의하므로 --no-quiet 로 되돌린다(진행 로그를 남겨야 진단이 된다).
 * after_move 는 늦은 단계라 --simulate 는 함의되지 않는다 — 실제로 다운로드된다.
 */
const YTDLP_FINAL_PATH_MARK = "KBO_FINAL_PATH=";
const YTDLP_PRINT_ARGS = [
  "--print", `after_move:${YTDLP_FINAL_PATH_MARK}%(filepath)s`,
  "--no-quiet",
];

/** yt-dlp 버전이 이만큼 지나면 콘솔에 경고 (유튜브 변경으로 403 이 나기 시작하는 구간) */
const YTDLP_STALE_WARN_DAYS = 60;
/** 서버 시작 시 이보다 오래된 .part 는 실패 잔해로 보고 지운다 */
const ORPHAN_PART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const app = express();
app.use(express.json({ limit: "1mb" }));

function pathRootPrefix() {
  return resolve(__dirname) + (process.platform === "win32" ? "\\" : "/");
}

function assertPathUnderProject(absPath) {
  const resolved = resolve(absPath);
  const root = pathRootPrefix();
  if (!resolved.startsWith(root)) {
    throw new Error("허용되지 않은 경로입니다.");
  }
  if (!existsSync(resolved)) {
    throw new Error("파일이 없습니다.");
  }
  return resolved;
}

function ensureClipsDir() {
  mkdirSync(CLIPS_DIR, { recursive: true });
}

function ensureClipTmpDir() {
  ensureClipsDir();
  mkdirSync(CLIP_TMP_DIR, { recursive: true });
}

const clipFileUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        ensureClipTmpDir();
        cb(null, CLIP_TMP_DIR);
      } catch (e) {
        cb(e instanceof Error ? e : new Error(String(e)));
      }
    },
    filename(_req, file, cb) {
      const raw = basename(String(file.originalname || "upload.mp4"));
      const extMatch = raw.match(/\.(mp4|mov|avi)$/i);
      const ext = extMatch ? extMatch[0] : ".mp4";
      cb(null, `in_${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

async function performClip(inputResolved, startTime, endTime, outputName) {
  ensureClipsDir();
  const safeName = sanitizeClipFileName(outputName);
  const clipPath = join(CLIPS_DIR, safeName);

  await runSpawn(FFMPEG_EXE, [
    "-y",
    "-ss",
    startTime,
    "-to",
    endTime,
    "-i",
    inputResolved,
    ...FFMPEG_ENCODE_OUT_ARGS,
    clipPath,
  ]);

  const size = statSync(clipPath).size;
  return { clipPath, size };
}

function sanitizeClipFileName(name) {
  let s = String(name || "clip").trim();
  s = s.replace(/[/\\?%*:|"<>]/g, "_").replace(/\.\./g, "_");
  if (!s) s = "clip";
  if (!/\.mp4$/i.test(s)) s += ".mp4";
  return s;
}

function ffmpegConcatListPath(p) {
  const normalized = resolve(String(p || ""))
    .replace(/\\/g, "/")
    .replace(/'/g, "'\\''");
  return normalized;
}

function buildConcatListBody(resolvedClips) {
  const lines = [
    "ffconcat version 1.0",
    ...resolvedClips.map((p) => `file '${ffmpegConcatListPath(p)}'`),
  ];
  return lines.join("\n") + "\n";
}

function parseClipsArray(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => (x != null ? String(x).trim() : "")).filter(Boolean);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => (x != null ? String(x).trim() : ""))
          .filter(Boolean);
      }
    } catch {
      /* fall through: treat as single path */
    }
    return [s];
  }
  return [];
}

function runSpawn(cmd, args, cwd = __dirname) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, windowsHide: true, shell: false });
    let combined = "";
    const append = (buf) => {
      combined += buf.toString();
    };
    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(combined);
      else {
        const tail = combined.trim().slice(-2000);
        reject(new Error(tail || `${basename(cmd)} 종료 코드 ${code}`));
      }
    });
  });
}

function videoEncodeAwsClients() {
  const region = process.env.KBO_AWS_REGION || "ap-northeast-2";
  const kboAccessKeyId = process.env.KBO_AWS_ACCESS_KEY_ID;
  const kboSecretAccessKey = process.env.KBO_AWS_SECRET_ACCESS_KEY;
  const credentials =
    kboAccessKeyId && kboSecretAccessKey
      ? { accessKeyId: kboAccessKeyId, secretAccessKey: kboSecretAccessKey }
      : undefined;
  const cfg = { region, ...(credentials ? { credentials } : {}) };
  return {
    region,
    bucket: process.env.S3_VIDEO_BUCKET || "kbo-video-export",
    s3: new S3Client(cfg),
  };
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (/^https:\/\/kbo-dashboard\.netlify\.app$/.test(origin)) {
        return cb(null, true);
      }
      if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
        return cb(null, true);
      }
      cb(new Error("CORS not allowed"));
    },
  })
);

app.get("/status", (_req, res) => {
  res.json({ running: true });
});

function streamVideoMimeType(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

app.get("/stream", (req, res) => {
  const raw = typeof req.query.path === "string" ? req.query.path.trim() : "";
  if (!raw) {
    return res.status(400).json({ ok: false, error: "path가 필요합니다." });
  }

  let filePath;
  try {
    filePath = assertPathUnderProject(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(404).json({ ok: false, error: msg });
  }

  let fileSize;
  try {
    fileSize = statSync(filePath).size;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(404).json({ ok: false, error: msg });
  }

  const contentType = streamVideoMimeType(filePath);
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      return res.end();
    }
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : fileSize - 1;
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end < start ||
      start >= fileSize
    ) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      return res.end();
    }
    const safeEnd = Math.min(end, fileSize - 1);
    const chunkSize = safeEnd - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${safeEnd}/${fileSize}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", chunkSize);
    res.setHeader("Content-Type", contentType);
    createReadStream(filePath, { start, end: safeEnd }).pipe(res);
    return;
  }

  res.status(200);
  res.setHeader("Content-Length", fileSize);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Accept-Ranges", "bytes");
  createReadStream(filePath).pipe(res);
});

app.get("/files", (_req, res) => {
  const dir = join(__dirname, "downloads");
  try {
    if (!existsSync(dir)) {
      return res.json({ ok: true, files: [] });
    }
    const names = readdirSync(dir);
    const files = names.map((name) => {
      const p = join(dir, name);
      const st = statSync(p);
      return {
        name,
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    });
    files.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json({ ok: true, files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post("/download", (req, res) => {
  const body = req.body || {};
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) {
    return res.status(400).json({ ok: false, error: "url이 필요합니다." });
  }

  const rawDir =
    body.outputDir != null && String(body.outputDir).trim()
      ? String(body.outputDir).trim()
      : "downloads";
  const safeSub = rawDir.replace(/^[/\\]+/, "").replace(/\.\./g, "");
  const targetDir = join(__dirname, safeSub);

  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }

  const ytDlp = join(__dirname, "yt-dlp.exe");
  if (!existsSync(ytDlp)) {
    return res.status(500).json({
      ok: false,
      error: "yt-dlp.exe가 프로젝트 폴더에 없습니다.",
    });
  }

  const isTiktok = url.includes("tiktok.com");
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const outFileName = isTiktok ? `tiktok_${timestamp}.mp4` : null;
  const outFilePath = outFileName ? join(targetDir, outFileName) : null;
  const args = [
    "-f",
    "bestvideo[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",
    "--recode-video", "mp4",
    "--ffmpeg-location", ".",
    "-o", isTiktok ? outFilePath : join(targetDir, "%(title).20s_%(upload_date)s.%(ext)s"),
    "--no-playlist",
    "--newline",
    // 끊긴 연결·일시적 403 을 스스로 다시 시도하게 한다. 포맷 선택·병합·저장 규칙은 그대로.
    ...YTDLP_RETRY_ARGS,
    ...YTDLP_PRINT_ARGS,
    url,
  ];
  console.log(`[download] 시작: ${url} → ${safeSub}`);

  const proc = spawn(ytDlp, args, {
    cwd: __dirname,
    windowsHide: true,
    shell: false,
  });

  let combined = "";
  const append = (buf) => {
    combined += buf.toString();
  };
  proc.stdout?.on("data", append);
  proc.stderr?.on("data", append);

  let responded = false;
  const sendOnce = (fn) => {
    if (responded) return;
    responded = true;
    fn();
  };

  const spawnedAtMs = Date.now();

  proc.on("error", (err) => {
    console.error("[download] yt-dlp 실행 실패:", err.message || err);
    sendOnce(() =>
      res.status(500).json({
        ok: false,
        error: err.message || String(err),
      })
    );
  });

  proc.on("close", (code) => {
    if (responded) return;
    if (code !== 0) {
      // 예전에는 실패해도 콘솔에 아무것도 안 남아서 원인을 찾을 수 없었다.
      console.error(
        `[download] 실패 (종료 코드 ${code}) — ${url}\n` +
          `--- yt-dlp 출력 ---\n${combined.trim()}\n-------------------`
      );
      const removed = cleanupPartFiles(targetDir, spawnedAtMs);
      if (removed.length > 0) {
        console.error(`[download] 남은 .part 정리: ${removed.join(", ")}`);
      }
      const tail = combined.trim().slice(-1200);
      return sendOnce(() =>
        res.status(500).json({
          ok: false,
          error: tail || `yt-dlp 종료 코드 ${code}`,
        })
      );
    }

    let fileName = outFileName;
    let filePath = outFilePath;
    if (!isTiktok) {
      fileName = resolveDownloadedFileName(combined) || null;
      filePath = fileName ? join(targetDir, fileName) : null;
      // 마지막 안전망: 출력에서 못 찾았거나 그 파일이 없으면 이번 실행이 만든 최신 파일
      if (!filePath || !existsSync(filePath)) {
        const newest = newestFileSince(targetDir, spawnedAtMs);
        if (newest) {
          console.warn(
            `[download] yt-dlp 출력에서 최종 파일을 못 찾아 최신 파일로 대체: ${newest}`
          );
          fileName = newest;
          filePath = join(targetDir, newest);
        }
      }
    }
    if (!filePath || !existsSync(filePath)) {
      console.error(
        `[download] 종료 코드 0 인데 결과 파일을 못 찾음 — ${url}\n` +
          `--- yt-dlp 출력 ---\n${combined.trim()}\n-------------------`
      );
      return sendOnce(() =>
        res.status(500).json({
          ok: false,
          error: "다운로드 파일을 찾지 못했습니다.",
        })
      );
    }

    const ffmpegExe = join(__dirname, "ffmpeg.exe");
    if (!existsSync(ffmpegExe)) {
      return sendOnce(() =>
        res.status(500).json({
          ok: false,
          error: "ffmpeg.exe가 프로젝트 폴더에 없습니다.",
        })
      );
    }

    const extMatch = fileName.match(/(\.[^.]+)$/);
    const ext = extMatch ? extMatch[1] : ".mp4";
    const baseName = fileName.slice(0, fileName.length - ext.length);
    const rawFileName = `${baseName}_raw${ext}`;
    const rawPath = join(targetDir, rawFileName);

    (async () => {
      try {
        const { renameSync } = await import("fs");
        renameSync(filePath, rawPath);
        await runSpawn(ffmpegExe, [
          "-y",
          "-i",
          rawPath,
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          "-preset",
          "fast",
          filePath,
        ]);
        unlinkSync(rawPath);

        const result = {
          ok: true,
          fileName,
          outputDir: safeSub,
          localPath: filePath,
        };
        console.log("[download] yt-dlp+ffmpeg result:", result);
        console.log("[download] localPath:", filePath);

        sendOnce(() => res.json(result));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[download] ffmpeg H.264 변환 실패:", msg);
        sendOnce(() =>
          res.status(500).json({
            ok: false,
            error: msg || "ffmpeg H.264 변환에 실패했습니다.",
          })
        );
      }
    })();
  });
});

app.post("/upload", async (req, res) => {
  const body = req.body || {};
  const localPath = typeof body.localPath === "string" ? body.localPath : "";
  if (!localPath) {
    return res.status(400).json({ ok: false, error: "localPath가 필요합니다." });
  }

  // 안전: downloads/ 하위만 업로드 허용
  const downloadsRoot = resolve(join(__dirname, "downloads")) + "\\";
  const resolved = resolve(localPath);
  if (!resolved.startsWith(downloadsRoot) || !existsSync(resolved)) {
    return res.status(400).json({
      ok: false,
      error: "허용되지 않은 경로이거나 파일이 없습니다.",
    });
  }

  try {
    const jobId = randomUUID();
    const { s3, bucket } = videoEncodeAwsClients();
    const key = `jobs/${jobId}/source.mp4`;
    const bodyBuf = readFileSync(resolved);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bodyBuf,
        ContentType: "video/mp4",
      })
    );
    return res.json({ ok: true, jobId, bucket, key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: `S3 업로드 실패: ${msg}` });
  }
});

app.post("/clip", (req, res, next) => {
  clipFileUpload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ ok: false, error: msg });
    }
    next();
  });
}, async (req, res) => {
  const body = req.body || {};
  const uploadedPath =
    req.file?.path != null ? String(req.file.path).trim() : "";

  let inputPath = uploadedPath;
  let startTime = "";
  let endTime = "";
  let outputName;

  if (uploadedPath) {
    startTime =
      body.startTime != null ? String(body.startTime).trim() : "";
    endTime = body.endTime != null ? String(body.endTime).trim() : "";
    outputName = body.outputName;
  } else {
    inputPath =
      typeof body.inputPath === "string" ? body.inputPath.trim() : "";
    startTime = body.startTime != null ? String(body.startTime).trim() : "";
    endTime = body.endTime != null ? String(body.endTime).trim() : "";
    outputName = body.outputName;
  }

  if (!inputPath) {
    return res.status(400).json({
      ok: false,
      error:
        req.is("multipart/form-data") || req.file
          ? "file이 필요합니다."
          : "inputPath가 필요합니다.",
    });
  }
  if (!startTime || !endTime) {
    return res.status(400).json({ ok: false, error: "startTime, endTime이 필요합니다." });
  }

  if (!existsSync(FFMPEG_EXE)) {
    return res.status(500).json({
      ok: false,
      error: "ffmpeg.exe가 프로젝트 폴더에 없습니다.",
    });
  }

  try {
    const inputResolved = assertPathUnderProject(inputPath);
    const result = await performClip(inputResolved, startTime, endTime, outputName);
    return res.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  } finally {
    if (req.file?.path) {
      try {
        unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
  }
});

const imageSegmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const mt = String(file.mimetype || "");
    if (mt.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("image/* 파일만 업로드할 수 있습니다."));
  },
});

app.post("/upload-image", (req, res, next) => {
  imageSegmentUpload.single("image")(req, res, (err) => {
    if (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ ok: false, error: msg });
    }
    next();
  });
}, async (req, res) => {
  const jobId =
    typeof req.body?.jobId === "string" ? req.body.jobId.trim() : "";
  if (!jobId) {
    return res.status(400).json({ ok: false, error: "jobId가 필요합니다." });
  }
  if (!req.file?.buffer) {
    return res.status(400).json({ ok: false, error: "image 파일이 필요합니다." });
  }

  try {
    const mime = String(req.file.mimetype || "").toLowerCase();
    let ext = "jpg";
    if (mime.includes("png")) ext = "png";
    else if (mime.includes("webp")) ext = "webp";
    else if (mime.includes("gif")) ext = "gif";
    else if (mime.includes("jpeg") || mime.includes("jpg")) ext = "jpg";
    else {
      const m = String(req.file.originalname || "").match(
        /\.(jpe?g|png|webp|gif)$/i
      );
      if (m) {
        ext = m[1].toLowerCase().replace("jpeg", "jpg");
      }
    }

    const { s3, bucket, region } = videoEncodeAwsClients();
    const key = `jobs/${jobId}/images/${randomUUID()}.${ext}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: mime || `image/${ext}`,
      })
    );
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
    return res.json({ ok: true, s3Key: key, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: `S3 업로드 실패: ${msg}` });
  }
});

app.post("/merge-upload", async (req, res) => {
  const body = req.body || {};
  const clips = parseClipsArray(body.clips);
  const jobId =
    typeof body.jobId === "string" && body.jobId.trim()
      ? body.jobId.trim()
      : randomUUID();

  console.log("[merge-upload] req.body.clips (raw):", body.clips);
  console.log("[merge-upload] parsed clips:", clips.length, clips);

  if (!clips.length) {
    return res.status(400).json({ ok: false, error: "clips 배열이 필요합니다." });
  }
  if (clips.length < 2) {
    return res.status(400).json({
      ok: false,
      error: "합치려면 clips 배열에 2개 이상의 경로가 필요합니다.",
    });
  }

  if (!existsSync(FFMPEG_EXE)) {
    return res.status(500).json({
      ok: false,
      error: "ffmpeg.exe가 프로젝트 폴더에 없습니다.",
    });
  }

  const toDelete = new Set();
  let concatListPath = null;
  let mergedPath = null;

  try {
    ensureClipsDir();
    const resolvedClips = clips.map((p) => {
      const s = typeof p === "string" ? p.trim() : "";
      if (!s) throw new Error("clips 항목 경로가 비어 있습니다.");
      return assertPathUnderProject(s);
    });

    if (resolvedClips.length !== clips.length) {
      throw new Error("clips 경로 해석 개수가 요청과 일치하지 않습니다.");
    }

    concatListPath = join(CLIPS_DIR, `concat_${jobId}.txt`);
    const listContent = buildConcatListBody(resolvedClips);
    writeFileSync(concatListPath, listContent, "utf8");
    toDelete.add(concatListPath);

    console.log("[merge-upload] concat list file:", concatListPath);
    console.log(
      "[merge-upload] listContent (" +
        resolvedClips.length +
        " files):\n" +
        listContent
    );

    const listInputPath = concatListPath.replace(/\\/g, "/");
    mergedPath = join(CLIPS_DIR, `merged_${jobId}.mp4`);
    await runSpawn(FFMPEG_EXE, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listInputPath,
      ...FFMPEG_ENCODE_OUT_ARGS,
      mergedPath,
    ]);
    toDelete.add(mergedPath);

    const { s3, bucket } = videoEncodeAwsClients();
    const key = `jobs/${jobId}/source.mp4`;
    const bodyBuf = readFileSync(mergedPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bodyBuf,
        ContentType: "video/mp4",
      })
    );

    for (const p of resolvedClips) {
      toDelete.add(p);
    }

    for (const p of toDelete) {
      try {
        if (p && existsSync(p)) unlinkSync(p);
      } catch {
        // ignore cleanup errors
      }
    }

    return res.json({ ok: true, jobId, bucket, key });
  } catch (e) {
    for (const p of toDelete) {
      try {
        if (p && existsSync(p)) unlinkSync(p);
      } catch {
        // ignore
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * yt-dlp 출력에서 최종 파일명을 찾는다. 순서가 중요하다.
 *
 * 1) --print after_move — 병합·재인코딩·이동이 모두 끝난 최종 경로.
 *    확장자가 바뀌는 경우(webm 단일 포맷 → --recode-video mp4)까지 유일하게 맞는 값이다.
 * 2) [Merger] Merging formats into "..." — 병합 결과
 * 3) 마지막 [download] Destination: — 첫 번째가 아니라 마지막.
 *    병합이 있으면 첫 Destination 은 영상 트랙(.fNNN)이고 병합 후 삭제되므로,
 *    첫 번째를 쓰면 파일이 정상 생성됐는데도 "찾지 못했습니다" 가 된다.
 */
function resolveDownloadedFileName(out) {
  const text = String(out || "");
  const lastCapture = (re) => {
    const all = [...text.matchAll(re)];
    return all.length > 0 ? String(all[all.length - 1][1]).trim() : "";
  };
  const printed = lastCapture(
    new RegExp(`^${YTDLP_FINAL_PATH_MARK}(.+)$`, "gim")
  );
  if (printed) return basename(printed);
  const merged = lastCapture(/\[Merger\]\s+Merging formats into\s+"(.+)"/gi);
  if (merged) return basename(merged);
  const dest = lastCapture(/\[download\]\s+Destination:\s*(.+)/gi);
  if (dest) return basename(dest);
  return "";
}

/** 이번 실행이 만든 파일 중 가장 최근 것 (.part 제외). 없으면 null */
function newestFileSince(dir, sinceMs) {
  try {
    if (!existsSync(dir)) return null;
    const entries = [];
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".part")) continue;
      try {
        const t = statSync(join(dir, name)).mtimeMs;
        if (t >= sinceMs) entries.push({ name, t });
      } catch {
        // ignore
      }
    }
    entries.sort((a, b) => b.t - a.t);
    return entries[0]?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * 다운로드가 실패하면 .part 조각이 남는다. 이번 실행이 만든 것만 골라 지운다
 * (mtime 이 프로세스 시작 이후). 무관한 파일이나 다른 다운로드는 건드리지 않는다.
 * 이어받기(resume)는 포기하는 셈이지만, 여기서 나는 실패는 대부분 403 이라
 * 이어받아도 어차피 안 되고, 남은 조각이 다음 실행에 섞이는 쪽이 더 위험하다.
 */
function cleanupPartFiles(dir, sinceMs) {
  const removed = [];
  try {
    if (!existsSync(dir)) return removed;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".part")) continue;
      const p = join(dir, name);
      try {
        if (statSync(p).mtimeMs < sinceMs) continue;
        unlinkSync(p);
        removed.push(name);
      } catch {
        // 사용 중이거나 이미 사라졌으면 넘어간다
      }
    }
  } catch {
    // 디렉터리를 못 읽으면 정리를 건너뛴다
  }
  return removed;
}

/** 서버 시작 시 오래 남은 .part 청소 (이전 실행들이 흘린 것) */
function sweepOrphanPartFiles() {
  const cutoff = Date.now() - ORPHAN_PART_MAX_AGE_MS;
  const dirs = [join(__dirname, "downloads"), CLIPS_DIR];
  const removed = [];
  for (const dir of dirs) {
    try {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".part")) continue;
        const p = join(dir, name);
        try {
          if (statSync(p).mtimeMs > cutoff) continue;
          unlinkSync(p);
          removed.push(name);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  if (removed.length > 0) {
    console.log(
      `[local-server] 24시간 이상 된 .part ${removed.length}개 정리: ${removed.join(", ")}`
    );
  }
}

/**
 * yt-dlp 버전 경과일 확인. 몇 달 지나면 유튜브 변경으로 다운로드가
 * "몇 MB 받다가 HTTP 403" 으로 죽기 시작한다 — 그때 원인을 찾느라 헤매지 않도록 미리 알린다.
 */
function warnIfYtDlpStale() {
  const ytDlp = join(__dirname, "yt-dlp.exe");
  if (!existsSync(ytDlp)) {
    console.warn("[local-server] ⚠ yt-dlp.exe 가 없습니다 — 다운로드 기능을 쓸 수 없습니다.");
    return;
  }
  const proc = spawn(ytDlp, ["--version", "--no-update"], {
    cwd: __dirname,
    windowsHide: true,
    shell: false,
  });
  let out = "";
  proc.stdout?.on("data", (b) => {
    out += b.toString();
  });
  proc.on("error", () => {
    console.warn("[local-server] ⚠ yt-dlp 버전을 확인하지 못했습니다.");
  });
  proc.on("close", () => {
    const m = out.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!m) {
      console.warn(`[local-server] ⚠ yt-dlp 버전 형식을 알 수 없습니다: ${out.trim()}`);
      return;
    }
    const released = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const days = Math.floor((Date.now() - released) / (24 * 60 * 60 * 1000));
    if (days >= YTDLP_STALE_WARN_DAYS) {
      console.warn(
        `[local-server] ⚠ yt-dlp ${m[0]} — ${days}일 지났습니다.\n` +
          `             유튜브 변경으로 다운로드가 도중에 HTTP 403 으로 끊길 수 있습니다.\n` +
          `             프로젝트 폴더에서 "yt-dlp.exe -U" 로 업데이트하세요.`
      );
    } else {
      console.log(`[local-server] yt-dlp ${m[0]} (${days}일 전)`);
    }
  });
}

app.listen(PORT, () => {
  console.log(`[local-server] http://localhost:${PORT} (다운로드 → downloads/)`);
  sweepOrphanPartFiles();
  warnIfYtDlpStale();
});
