import { useCallback, useRef, useState } from "react";
import {
  DEFAULT_DURATION_SHORTS1,
  DEFAULT_DURATION_SHORTS2,
  DEFAULT_DURATION_SHORTS3,
} from "../videoPresetDefaults.js";

const POLL_MS = 1500;
const POLL_MAX_MS = 45 * 60 * 1000;

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
  if (Number.isFinite(v)) return v;
  if (shortsType === "shorts1" && key === "summary_last") {
    const fb = map.summary;
    if (Number.isFinite(fb)) return fb;
  }
  return 2;
}

async function parseJsonOrThrow(res, fallbackLabel) {
  const rawText = await res.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error(rawText || `${fallbackLabel || "응답"} 파싱 실패 (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const err =
      payload?.error ||
      payload?.message ||
      `HTTP ${res.status}`;
    const details =
      payload?.details != null ? ` ${JSON.stringify(payload.details)}` : "";
    throw new Error(String(err) + details);
  }
  return payload;
}

/** S3 presigned PUT — 본문은 Netlify Function을 거치지 않음 (6MB 제한 회피) */
async function putPresigned(url, body, contentType) {
  const res = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `S3 업로드 실패 HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`
    );
  }
}

export function useVideoExport() {
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [outputName, setOutputName] = useState("kbo_shorts.mp4");

  const cancelledRef = useRef(false);
  const downloadUrlRef = useRef(null);

  const revokeUrl = useCallback(() => {
    if (downloadUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(downloadUrlRef.current);
    }
    downloadUrlRef.current = null;
    setDownloadUrl(null);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setMessage("취소 중…");
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
        setStatus("encoding");
        setMessage("업로드 및 인코딩 요청…");
        setProgress(2);

        for (let i = 0; i < slides.length; i++) {
          const blob = slides[i]?.blob;
          if (!(blob instanceof Blob)) {
            throw new Error(`슬라이드 ${i} Blob이 없습니다.`);
          }
        }

        if (cancelledRef.current) {
          setStatus("idle");
          setMessage("취소됨");
          return;
        }

        const transition = Number(preset?.transition);
        const hasMusic = musicFile instanceof File;
        const slideCount = slides.length;

        setMessage("업로드 URL 발급…");
        const prepareRes = await fetch("/api/video-encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "prepare",
            slideCount,
            durations,
            transition: Number.isFinite(transition) ? transition : 0,
            hasMusic,
          }),
        });

        const prepare = await parseJsonOrThrow(prepareRes, "prepare");
        const { jobId, presignedPut } = prepare;
        if (!jobId || !presignedPut?.slides?.length) {
          throw new Error("prepare 응답에 jobId 또는 presignedPut.slides 없음");
        }
        if (presignedPut.slides.length !== slideCount) {
          throw new Error("presigned URL 개수가 슬라이드 수와 일치하지 않습니다.");
        }

        setMessage("S3에 슬라이드 업로드…");
        for (let i = 0; i < slideCount; i++) {
          if (cancelledRef.current) {
            setStatus("idle");
            setMessage("취소됨");
            return;
          }
          const blob = slides[i].blob;
          await putPresigned(presignedPut.slides[i], blob, "image/png");
          setProgress(
            Math.min(18, 2 + Math.round((16 * (i + 1)) / slideCount))
          );
        }

        if (hasMusic) {
          if (cancelledRef.current) {
            setStatus("idle");
            setMessage("취소됨");
            return;
          }
          if (!presignedPut.music) {
            throw new Error("음악 presigned URL이 없습니다.");
          }
          setMessage("S3에 음악 업로드…");
          await putPresigned(presignedPut.music, musicFile, "audio/mpeg");
        }

        if (cancelledRef.current) {
          setStatus("idle");
          setMessage("취소됨");
          return;
        }

        setMessage("인코딩 큐 등록…");
        const finRes = await fetch("/api/video-encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "finalize",
            jobId,
            slideCount,
            durations,
            transition: Number.isFinite(transition) ? transition : 0,
            hasMusic,
          }),
        });

        await parseJsonOrThrow(finRes, "finalize");

        setMessage("서버 인코딩 중… (상태 폴링)");
        const started = Date.now();

        while (Date.now() - started < POLL_MAX_MS) {
          if (cancelledRef.current) {
            setStatus("idle");
            setMessage("취소됨");
            return;
          }

          await new Promise((r) => setTimeout(r, POLL_MS));

          const pollRes = await fetch(
            `/api/video-encode?jobId=${encodeURIComponent(jobId)}`
          );
          const pollText = await pollRes.text();
          let data;
          try {
            data = JSON.parse(pollText);
          } catch {
            throw new Error(pollText || "폴링 응답 오류");
          }

          if (typeof data.progress === "number") {
            setProgress(Math.min(99, Math.max(0, data.progress)));
          }

          if (data.state === "unknown") {
            continue;
          }

          if (data.state === "done" && data.downloadUrl) {
            if (downloadUrlRef.current?.startsWith("blob:")) {
              URL.revokeObjectURL(downloadUrlRef.current);
            }
            downloadUrlRef.current = data.downloadUrl;
            setDownloadUrl(data.downloadUrl);
            setProgress(100);
            setStatus("done");
            setMessage("완료 — 다운로드 버튼을 누르세요.");
            return;
          }

          if (data.state === "error") {
            throw new Error(data.error || "서버 인코딩 실패");
          }
        }

        throw new Error("인코딩 시간 초과");
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
    a.target = "_blank";
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
