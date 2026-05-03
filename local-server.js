import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3838;

const app = express();
app.use(express.json({ limit: "1mb" }));

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

  const outputPattern = join(targetDir, "%(title)s [%(id)s].%(ext)s");
  const args = [
    "-o",
    outputPattern,
    "--ffmpeg-location",
    __dirname,
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
    const dest =
      combined.match(/\[download\]\s+Destination:\s*(.+)/i) ||
      combined.match(/\[download\]\s+(.+\.(?:mp4|mkv|webm|m4a|opus))/i) ||
      combined.match(/\[Merger\]\s+Merging formats into\s+"(.+)"/i);
    if (dest) {
      fileName = basename(dest[1].trim());
    }

    if (!fileName && existsSync(targetDir)) {
      const entries = readdirSync(targetDir).map((name) => ({
        name,
        t: statSync(join(targetDir, name)).mtimeMs,
      }));
      entries.sort((a, b) => b.t - a.t);
      fileName = entries[0]?.name ?? null;
    }

    sendOnce(() =>
      res.json({
        ok: true,
        fileName,
        outputDir: safeSub,
      })
    );
  });
});

app.listen(PORT, () => {
  console.log(`[local-server] http://localhost:${PORT} (다운로드 → downloads/)`);
});
