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

  const args = [
    "-f",
    "bestvideo[vcodec^=avc][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "--merge-output-format",
    "mp4",
    "--recode-video",
    "mp4",
    "--ffmpeg-location",
    ".",
    "-o",
    join(targetDir, "%(title).20s_%(upload_date)s.%(ext)s"),
    "--no-playlist",
    "--newline",
    url,
  ];

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

  proc.on("error", (err) => {
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
      const tail = combined.trim().slice(-1200);
      return sendOnce(() =>
        res.status(500).json({
          ok: false,
          error: tail || `yt-dlp 종료 코드 ${code}`,
        })
      );
    }

    let fileName = null;
    if (existsSync(targetDir)) {
      const entries = readdirSync(targetDir).map((name) => ({
        name,
        t: statSync(join(targetDir, name)).mtimeMs,
      }));
      entries.sort((a, b) => b.t - a.t);
      fileName = entries[0]?.name ?? null;
    }

    const filePath = fileName ? join(targetDir, fileName) : null;
    if (!filePath || !existsSync(filePath)) {
      return sendOnce(() =>
        res.status(500).json({
          ok: false,
          error: "다운로드 파일을 찾지 못했습니다.",
        })
      );
    }

    console.log("[debug] fileName:", fileName, "filePath:", filePath);

    const ffmpegExe = join(__dirname, "ffmpeg.exe");
    console.log("[debug] __dirname:", __dirname, "ffmpegExe:", ffmpegExe, "exists:", existsSync(ffmpegExe));
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

app.listen(PORT, () => {
  console.log(`[local-server] http://localhost:${PORT} (다운로드 → downloads/)`);
});
