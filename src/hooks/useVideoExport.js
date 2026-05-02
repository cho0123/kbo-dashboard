import { useCallback, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  DEFAULT_DURATION_SHORTS1,
  DEFAULT_DURATION_SHORTS2,
  DEFAULT_DURATION_SHORTS3,
} from "../videoPresetDefaults.js";

const CORE_MT_BASE = "https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm";

const SCALE_PAD =
  "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2";

function seoulYyyymmdd() {
  return new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
    .replace(/-/g, "");
}

function resolveDuration(key, preset, shortsType) {
  const raw = preset?.slides?.[key];
  if (Number.isFinite(Number(raw))) return Math.max(0.05, Number(raw));
  const map =
    shortsType === "shorts2"
      ? DEFAULT_DURATION_SHORTS2
      : shortsType === "shorts3"
        ? DEFAULT_DURATION_SHORTS3
        : DEFAULT_DURATION_SHORTS1;
  const v = map[key];
  return Number.isFinite(v) ? v : 2;
}

function buildXfadeGraph(n, durations, transitionRaw) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(
      `[${i}:v]${SCALE_PAD},format=yuv420p,setpts=PTS-STARTPTS,fps=30[v${i}s]`
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

function buildConcatListContent(durations) {
  let s = "ffconcat version 1.0\n";
  for (let i = 0; i < durations.length; i++) {
    s += `file 'slide_${i}.png'\n`;
    s += `duration ${durations[i]}\n`;
  }
  const last = durations.length - 1;
  s += `file 'slide_${last}.png'\n`;
  s += "duration 0\n";
  return s;
}

export function useVideoExport() {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [outputName, setOutputName] = useState("kbo_shorts.mp4");

  const ffmpegRef = useRef(null);
  const cancelledRef = useRef(false);
  const downloadUrlRef = useRef(null);

  const revokeUrl = useCallback(() => {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    setDownloadUrl(null);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setMessage("취소 중…");
    try {
      ffmpegRef.current?.terminate();
    } catch {
      /* ignore */
    }
    ffmpegRef.current = null;
  }, []);

  const exportVideo = useCallback(
    async (slides, preset, musicFile, shortsType = "shorts1") => {
      cancelledRef.current = false;
      revokeUrl();
      setError(null);
      setProgress(0);
      setDownloadUrl(null);
      const st =
        String(preset?.shorts_type || "shorts1").replace(/[^a-z0-9_]/gi, "") ||
        "shorts1";
      setOutputName(`kbo_${st}_${seoulYyyymmdd()}.mp4`);

      if (!Array.isArray(slides) || slides.length === 0) {
        const err = new Error("슬라이드가 없습니다.");
        setStatus("error");
        setError(err);
        setMessage("");
        throw err;
      }

      const presetType = String(preset?.shorts_type || "shorts1");
      const durations = slides.map((s) =>
        resolveDuration(s.key, preset, presetType)
      );

      try {
        setStatus("loading_ffmpeg");
        setMessage("FFmpeg 로드 중…");

        const ffmpeg = new FFmpeg();
        ffmpegRef.current = ffmpeg;

        ffmpeg.on("progress", ({ progress: p }) => {
          if (cancelledRef.current) return;
          const pct = Math.round((Number(p) || 0) * 100);
          setProgress(Math.min(100, Math.max(0, pct)));
        });

        ffmpeg.on("log", ({ message: logMsg }) => {
          if (cancelledRef.current) return;
          if (logMsg && logMsg.includes("error")) {
            console.warn("[ffmpeg]", logMsg);
          }
        });

        const coreURL = await toBlobURL(
          `${CORE_MT_BASE}/ffmpeg-core.js`,
          "text/javascript"
        );
        const wasmURL = await toBlobURL(
          `${CORE_MT_BASE}/ffmpeg-core.wasm`,
          "application/wasm"
        );
        const workerURL = await toBlobURL(
          `${CORE_MT_BASE}/ffmpeg-core.worker.js`,
          "text/javascript"
        );

        await ffmpeg.load({ coreURL, wasmURL, workerURL });

        if (cancelledRef.current) return;

        setStatus("encoding");
        setMessage("입력 파일 준비…");
        setProgress(0);

        for (let i = 0; i < slides.length; i++) {
          const blob = slides[i]?.blob;
          if (!(blob instanceof Blob)) {
            throw new Error(`슬라이드 ${i} Blob이 없습니다.`);
          }
          await ffmpeg.writeFile(
            `slide_${i}.png`,
            await fetchFile(blob)
          );
        }

        if (musicFile instanceof File) {
          await ffmpeg.writeFile("music.mp3", await fetchFile(musicFile));
        }

        if (cancelledRef.current) return;

        const Tf = Number(preset?.transition);
        const useXfade =
          slides.length > 1 && Number.isFinite(Tf) && Tf > 0.001;

        const vfChain = `${SCALE_PAD},format=yuv420p,fps=30`;

        let args;

        if (slides.length === 1) {
          const d0 = String(durations[0]);
          args = [
            "-loop",
            "1",
            "-framerate",
            "30",
            "-t",
            d0,
            "-i",
            "slide_0.png",
            "-vf",
            vfChain,
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
          if (musicFile instanceof File) {
            args.push(
              "-i",
              "music.mp3",
              "-map",
              "0:v",
              "-map",
              "1:a",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-shortest"
            );
          } else {
            args.push("-an");
          }
          args.push("output.mp4");
        } else if (useXfade) {
          const fc = buildXfadeGraph(slides.length, durations, Tf);
          args = [];
          for (let i = 0; i < slides.length; i++) {
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
          if (musicFile instanceof File) {
            args.push("-i", "music.mp3");
          }
          args.push("-filter_complex", fc);
          const mi = slides.length;
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
          if (musicFile instanceof File) {
            args.push(
              "-map",
              `${mi}:a`,
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-shortest"
            );
          } else {
            args.push("-an");
          }
          args.push("output.mp4");
        } else {
          const listTxt = buildConcatListContent(durations);
          await ffmpeg.writeFile("list.txt", listTxt);
          args = [
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            "list.txt",
            "-vf",
            vfChain,
            "-vsync",
            "cfr",
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
          if (musicFile instanceof File) {
            args.push("-i", "music.mp3", "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "128k", "-shortest");
          } else {
            args.push("-an");
          }
          args.push("output.mp4");
        }

        setMessage("인코딩 중…");
        const code = await ffmpeg.exec(args, 600000);
        if (cancelledRef.current) return;
        if (code !== 0) {
          throw new Error(`ffmpeg 종료 코드 ${code}`);
        }

        setMessage("파일 읽기…");
        const data = await ffmpeg.readFile("output.mp4");
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        const blob = new Blob([u8], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        if (downloadUrlRef.current) {
          URL.revokeObjectURL(downloadUrlRef.current);
        }
        downloadUrlRef.current = url;
        setDownloadUrl(url);
        setProgress(100);
        setStatus("done");
        setMessage("완료 — 다운로드 버튼을 누르세요.");
      } catch (e) {
        if (cancelledRef.current) {
          setStatus("idle");
          setMessage("취소됨");
          return;
        }
        console.error(e);
        setStatus("error");
        setError(e instanceof Error ? e : new Error(String(e)));
        setMessage("");
      } finally {
        try {
          ffmpegRef.current?.terminate?.();
        } catch {
          /* ignore */
        }
        ffmpegRef.current = null;
      }
    },
    [revokeUrl]
  );

  const triggerDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = outputName;
    a.rel = "noopener";
    a.click();
  }, [downloadUrl, outputName]);

  return {
    status,
    progress,
    message,
    error,
    cancel,
    exportVideo,
    downloadUrl,
    outputName,
    triggerDownload,
    revokeDownloadUrl: revokeUrl,
  };
}
