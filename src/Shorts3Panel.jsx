import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { postKbo } from "./api.js";

/** Presigned PUT — 업로드 진행률(0~100), Content-Type 미설정(SigV4 권장) */
function putPresignedWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((100 * e.loaded) / e.total));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            `S3 업로드 실패 HTTP ${xhr.status}${xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : ""}`
          )
        );
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("S3 업로드 네트워크 오류"))
    );
    xhr.open("PUT", url);
    xhr.send(body);
  });
}

const POLL_MS = 1500;
const POLL_MAX_MS = 45 * 60 * 1000;
const MAX_SEGMENTS = 10;

const LOCAL_DOWNLOAD_SERVER = "http://localhost:3838";

const VIDEO_ACCEPT =
  ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo";

const TEXT_COLORS = [
  "#FFFFFF", // 흰색
  "#F4FF00", // 노랑
  "#FF4081", // 핫핑크
  "#00E5FF", // 하늘
  "#00FF94", // 민트
  "#FF9500", // 주황
  "#FFD700", // 골드
  "#C0155A", // 딥핑크
  "#1B2A80", // 인디고
  "#000000", // 검정
];

function paletteColorSelected(value, paletteHex) {
  return (
    String(value || "")
      .trim()
      .toUpperCase() === String(paletteHex || "").trim().toUpperCase()
  );
}

function TextColorPalette({ value, onChange, disabled }) {
  const base = 22;
  const selectedSize = 28;
  return (
    <div
      role="group"
      aria-label="텍스트 색상"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
      }}
    >
      {TEXT_COLORS.map((c) => {
        const selected = paletteColorSelected(value, c);
        const size = selected ? selectedSize : base;
        return (
          <button
            key={c}
            type="button"
            disabled={disabled}
            title={c}
            aria-pressed={selected}
            onClick={() => onChange(c)}
            style={{
              width: size,
              height: size,
              minWidth: size,
              minHeight: size,
              borderRadius: "50%",
              border: selected ? "3px solid rgba(255,255,255,0.95)" : "none",
              background: c,
              padding: 0,
              cursor: disabled ? "not-allowed" : "pointer",
              boxSizing: "border-box",
              flexShrink: 0,
              opacity: disabled ? 0.55 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

function emptySegment() {
  return {
    start: "",
    end: "",
    cropOffset: 0,
    text: "",
    textY: 85,
    textColor: TEXT_COLORS[0],
  };
}

function formatCropOffsetLabel(offset) {
  const n = Math.round(Number(offset) || 0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

/**
 * video.offsetWidth / offsetHeight 기준 9:16 크롭 박스(오버레이 좌표, px).
 * cropWidth = displayHeight * 9/16,
 * cropX = (displayWidth - cropWidth)/2 + displayWidth * offset/100 (클램프)
 */
function computePreviewCropOverlay(videoEl, cropOffsetPct) {
  if (!videoEl) return null;
  const dispW = videoEl.offsetWidth;
  const dispH = videoEl.offsetHeight;
  if (dispW < 2 || dispH < 2) return null;

  const pct = Math.min(50, Math.max(-50, Number(cropOffsetPct) || 0));
  let cropW = dispH * (9 / 16);
  let cropX = (dispW - cropW) / 2 + (dispW * pct) / 100;
  cropX = Math.max(0, Math.min(cropX, dispW - cropW));
  if (cropW > dispW) {
    cropW = dispW;
    cropX = 0;
  }

  const darkRects = [];
  if (cropX > 0.5) {
    darkRects.push({
      left: 0,
      top: 0,
      width: cropX,
      height: dispH,
    });
  }
  const rightW = dispW - cropX - cropW;
  if (rightW > 0.5) {
    darkRects.push({
      left: cropX + cropW,
      top: 0,
      width: rightW,
      height: dispH,
    });
  }

  return {
    darkRects,
    border: {
      left: cropX,
      top: 0,
      width: cropW,
      height: dispH,
    },
  };
}

/** 재생 시각(초) → HH:MM:SS */
function secondsToHhMmSs(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, "0")).join(":");
}

/** HH:MM:SS 또는 MM:SS 등 → 초; 불가 시 null */
function parseHhMmSsToSeconds(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  const parts = s.split(":").map((p) => p.trim());
  const nums = parts.map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : NaN;
  });
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) {
    const [h, m, sec] = nums;
    if (m >= 60 || sec >= 60) return null;
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const [m, sec] = nums;
    if (sec >= 60) return null;
    return m * 60 + sec;
  }
  if (parts.length === 1) return nums[0];
  return null;
}

export default function Shorts3Panel() {
  const [segments, setSegments] = useState([
    emptySegment(),
    emptySegment(),
  ]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const cancelRef = useRef(false);

  const videoInputRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  /** idle | uploading | done */
  const [uploadPhase, setUploadPhase] = useState("idle");
  const [previewUrl, setPreviewUrl] = useState(null);
  /** 미리보기에서 시작/종료 시각을 넣을 구간 인덱스 */
  const [previewSegmentIndex, setPreviewSegmentIndex] = useState(0);
  const previewVideoRef = useRef(null);
  const previewVideoWrapRef = useRef(null);
  const [previewCropOverlay, setPreviewCropOverlay] = useState(null);

  const [muteOriginal, setMuteOriginal] = useState(true);
  const [musicTracks, setMusicTracks] = useState([]);
  const [highlightMusicS3Key, setHighlightMusicS3Key] = useState("");
  const [bgmVolume, setBgmVolume] = useState(0.8);
  const [bgmStartTime, setBgmStartTime] = useState(0);
  const [bgmFadeOut, setBgmFadeOut] = useState(2);

  const [topText, setTopText] = useState("");
  const [topTextColor, setTopTextColor] = useState(TEXT_COLORS[0]);
  const [topTextSize, setTopTextSize] = useState(72);

  const [savedFiles, setSavedFiles] = useState([]);
  const [savedFilesLoading, setSavedFilesLoading] = useState(false);
  const [savedFilesError, setSavedFilesError] = useState(null);

  const [localServerOk, setLocalServerOk] = useState(null);
  const [localYtdlpUrl, setLocalYtdlpUrl] = useState("");
  const [localDownloadBusy, setLocalDownloadBusy] = useState(false);

  const refreshSavedFiles = useCallback(async () => {
    setSavedFilesLoading(true);
    setSavedFilesError(null);
    try {
      const res = await postKbo({ action: "highlight_list" });
      setSavedFiles(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setSavedFilesError(e instanceof Error ? e.message : String(e));
      setSavedFiles([]);
    } finally {
      setSavedFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSavedFiles();
  }, [refreshSavedFiles]);

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const r = await fetch(`${LOCAL_DOWNLOAD_SERVER}/status`, {
          method: "GET",
        });
        const j = await r.json().catch(() => ({}));
        if (!cancelled) {
          setLocalServerOk(Boolean(r.ok && j?.running === true));
        }
      } catch {
        if (!cancelled) setLocalServerOk(false);
      }
    };
    ping();
    const id = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const loadMusicTracks = useCallback(async () => {
    try {
      const res = await postKbo({ action: "music_list" });
      setMusicTracks(Array.isArray(res?.tracks) ? res.tracks : []);
    } catch {
      setMusicTracks([]);
    }
  }, []);

  useEffect(() => {
    loadMusicTracks();
  }, [loadMusicTracks]);

  const updatePreviewCropOverlay = useCallback(() => {
    const video = previewVideoRef.current;
    const cropOffset = segments[previewSegmentIndex]?.cropOffset ?? 0;
    if (!video) {
      setPreviewCropOverlay(null);
      return;
    }
    setPreviewCropOverlay(computePreviewCropOverlay(video, cropOffset));
  }, [segments, previewSegmentIndex]);

  useLayoutEffect(() => {
    updatePreviewCropOverlay();
  }, [updatePreviewCropOverlay, previewUrl]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!previewUrl || !video) return undefined;
    const ro = new ResizeObserver(() => {
      updatePreviewCropOverlay();
    });
    ro.observe(video);
    const onReady = () => updatePreviewCropOverlay();
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    window.addEventListener("resize", onReady);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      window.removeEventListener("resize", onReady);
    };
  }, [previewUrl, updatePreviewCropOverlay]);

  const segmentTotalSec = useMemo(() => {
    let sum = 0;
    for (const seg of segments) {
      const st = String(seg.start || "").trim();
      const en = String(seg.end || "").trim();
      if (!st || !en) continue;
      const a = parseHhMmSsToSeconds(st);
      const b = parseHhMmSsToSeconds(en);
      if (a == null || b == null) continue;
      if (b <= a) continue;
      sum += b - a;
    }
    return sum;
  }, [segments]);

  const segmentTotalWarnStyle = useMemo(() => {
    if (segmentTotalSec > 300) return { color: "#ff6b8a" };
    if (segmentTotalSec > 60) return { color: "#ffb347" };
    return {};
  }, [segmentTotalSec]);

  const addSegment = useCallback(() => {
    setSegments((s) => (s.length >= MAX_SEGMENTS ? s : [...s, emptySegment()]));
  }, []);

  const removeSegment = useCallback((idx) => {
    setSegments((s) => (s.length <= 2 ? s : s.filter((_, i) => i !== idx)));
  }, []);

  useEffect(() => {
    setPreviewSegmentIndex((i) =>
      Math.min(i, Math.max(0, segments.length - 1))
    );
  }, [segments.length]);

  const handleCropOffsetChange = (segIndex, rawVal) => {
    const n = Number(rawVal);
    const v = Number.isFinite(n) ? Math.min(50, Math.max(-50, Math.round(n))) : 0;
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === segIndex ? { ...seg, cropOffset: v } : seg
      )
    );
  };

  const handleSegmentOverlayChange = (segIndex, field, rawVal) => {
    setSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== segIndex) return seg;
        if (field === "textY") {
          const n = Number(rawVal);
          const v = Number.isFinite(n)
            ? Math.min(100, Math.max(0, Math.round(n)))
            : 85;
          return { ...seg, textY: v };
        }
        if (field === "textColor") {
          return { ...seg, textColor: String(rawVal || TEXT_COLORS[0]) };
        }
        if (field === "text") {
          return { ...seg, text: rawVal };
        }
        return seg;
      })
    );
  };

  const handleTimeChange = (segIndex, field, rawVal) => {
    const digits = rawVal.replace(/\D/g, "").slice(0, 6);
    let formatted = digits;
    if (digits.length > 4) {
      formatted =
        digits.slice(0, 2) + ":" + digits.slice(2, 4) + ":" + digits.slice(4);
    } else if (digits.length > 2) {
      formatted = digits.slice(0, 2) + ":" + digits.slice(2);
    }
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === segIndex ? { ...seg, [field]: formatted } : seg
      )
    );
  };

  const onVideoFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setVideoFile(f);
    setJobId(null);
    setUploadPhase("idle");
    setUploadProgress(0);
    setPreviewUrl(null);
    setError(null);
  };

  const resetUploadState = useCallback(() => {
    setJobId(null);
    setUploadPhase("idle");
    setUploadProgress(0);
    setPreviewUrl(null);
    setVideoFile(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
    setDownloadUrl(null);
    setStatus("idle");
    setMessage("");
    setProgress(0);
    setError(null);
  }, []);

  const applyVideoTimeToSegment = useCallback((field) => {
    const el = previewVideoRef.current;
    if (!el) return;
    const hms = secondsToHhMmSs(el.currentTime);
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === previewSegmentIndex ? { ...seg, [field]: hms } : seg
      )
    );
  }, [previewSegmentIndex]);

  const onDeleteSource = async () => {
    if (!jobId) return;
    if (
      !window.confirm(
        "S3에 올린 원본 파일을 삭제하고 처음부터 다시 진행합니다. 계속할까요?"
      )
    ) {
      return;
    }
    setError(null);
    try {
      await postKbo({ action: "highlight_delete", jobId });
      resetUploadState();
      setMessage("");
      await refreshSavedFiles();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const onLoadSavedJob = async (id) => {
    setError(null);
    setJobId(id);
    setUploadPhase("done");
    setVideoFile(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
    setDownloadUrl(null);
    setStatus("idle");
    setProgress(0);
    await fetchPreviewUrl(id);
    setMessage(
      "저장된 원본을 불러왔습니다. 구간을 입력한 뒤 영상 생성을 누르세요."
    );
  };

  const onDeleteSavedJob = async (id) => {
    if (!window.confirm("S3에서 이 원본 파일을 삭제할까요?")) return;
    setError(null);
    try {
      await postKbo({ action: "highlight_delete", jobId: id });
      if (jobId === id) {
        resetUploadState();
        setMessage("");
      }
      await refreshSavedFiles();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const fetchPreviewUrl = async (id) => {
    try {
      const pr = await postKbo({ action: "highlight_preview", jobId: id });
      const url = pr?.previewUrl || pr?.url;
      if (url) setPreviewUrl(url);
    } catch (e) {
      console.warn("[highlight_preview]", e);
      setPreviewUrl(null);
    }
  };

  const onUploadSource = async () => {
    if (!videoFile) {
      window.alert("영상 파일(mp4 / mov / avi)을 선택하세요.");
      return;
    }
    const lower = String(videoFile.name || "").toLowerCase();
    const ok =
      lower.endsWith(".mp4") ||
      lower.endsWith(".mov") ||
      lower.endsWith(".avi");
    if (!ok) {
      window.alert("mp4, mov, avi 파일만 업로드할 수 있습니다.");
      return;
    }

    setError(null);
    setUploadPhase("uploading");
    setUploadProgress(0);
    setJobId(null);
    try {
      const prep = await postKbo({ action: "highlight_upload" });
      const putUrl = prep?.presignedPutUrl;
      const id = prep?.jobId;
      if (!putUrl || !id) throw new Error("highlight_upload 응답 오류");
      setJobId(id);
      await putPresignedWithProgress(putUrl, videoFile, setUploadProgress);
      setUploadPhase("done");
      setMessage("원본 업로드 완료 — 구간을 입력한 뒤 영상 생성을 누르세요.");
      await fetchPreviewUrl(id);
      await refreshSavedFiles();
    } catch (e) {
      setUploadPhase("idle");
      setUploadProgress(0);
      setJobId(null);
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const onLocalDownload = async () => {
    const url = localYtdlpUrl.trim();
    if (!url) {
      window.alert("다운로드할 URL을 입력하세요.");
      return;
    }
    setLocalDownloadBusy(true);
    setError(null);
    try {
      const r = await fetch(`${LOCAL_DOWNLOAD_SERVER}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, outputDir: "downloads" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(
          typeof j.error === "string" ? j.error : `HTTP ${r.status}`
        );
      }
      setMessage("✅ 다운로드 완료! 파일을 업로드해주세요");
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setMessage("");
    } finally {
      setLocalDownloadBusy(false);
    }
  };

  const onGenerate = async () => {
    cancelRef.current = false;
    setError(null);
    setDownloadUrl(null);
    setProgress(0);

    if (!jobId || uploadPhase !== "done") {
      setError(
        new Error("먼저 원본 영상을 선택하고 S3 업로드를 완료하세요.")
      );
      return;
    }

    for (let i = 0; i < segments.length; i++) {
      const { start, end } = segments[i];
      if (!String(start).trim() || !String(end).trim()) {
        setError(new Error(`구간 ${i + 1}: 시작·종료 시간을 모두 입력하세요.`));
        return;
      }
    }

    try {
      setStatus("encoding");
      setMessage("작업 요청 중…");
      const sizeClamp = Math.min(
        200,
        Math.max(20, Math.round(Number(topTextSize) || 72))
      );
      const payload = {
        action: "highlight_video_create",
        jobId,
        topText: topText.trim(),
        topTextColor,
        topTextSize: sizeClamp,
        segments: segments.map((s) => {
          const ty = Number(s.textY);
          const textY = Number.isFinite(ty)
            ? Math.min(100, Math.max(0, Math.round(ty)))
            : 85;
          return {
            start: String(s.start).trim(),
            end: String(s.end).trim(),
            cropOffset:
              typeof s.cropOffset === "number" && Number.isFinite(s.cropOffset)
                ? Math.min(50, Math.max(-50, Math.round(s.cropOffset)))
                : 0,
            text: String(s.text ?? "").trim(),
            textY,
            textColor:
              String(s.textColor ?? TEXT_COLORS[0]).trim() || TEXT_COLORS[0],
          };
        }),
        muteOriginal,
        musicOptions: {
          volume: bgmVolume,
          startTime: bgmStartTime,
          fadeOutDuration: bgmFadeOut,
        },
      };
      if (highlightMusicS3Key.trim()) {
        payload.music_s3_key = highlightMusicS3Key.trim();
      }
      const res = await postKbo(payload);
      if (!res?.jobId) throw new Error("jobId 없음");

      setMessage("서버 인코딩 중… (상태 폴링)");
      const started = Date.now();

      while (Date.now() - started < POLL_MAX_MS) {
        if (cancelRef.current) {
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
        if (data.state === "unknown") continue;
        if (data.state === "done" && data.downloadUrl) {
          setDownloadUrl(data.downloadUrl);
          setProgress(100);
          setStatus("done");
          setMessage("완료 — 아래에서 mp4를 저장하세요.");
          return;
        }
        if (data.state === "error") {
          throw new Error(data.error || "인코딩 실패");
        }
      }
      throw new Error("인코딩 시간 초과");
    } catch (e) {
      if (cancelRef.current) {
        setStatus("idle");
        setMessage("취소됨");
        return;
      }
      setStatus("error");
      setError(e instanceof Error ? e : new Error(String(e)));
      setMessage("");
    }
  };

  const previewCropTextOverlayEl = useMemo(() => {
    if (!previewCropOverlay) return null;
    const b = previewCropOverlay.border;
    const cropH = b.height;
    const scale = cropH > 0 ? cropH / 1920 : 1;
    const previewFontPx = Math.max(8, (Number(topTextSize) || 72) * scale);
    const topColor = /^#[0-9A-Fa-f]{6}$/i.test(String(topTextColor || ""))
      ? topTextColor
      : TEXT_COLORS[0];
    const topLine = String(topText || "").trim();
    const seg = segments[previewSegmentIndex];
    const bottomLine = String(seg?.text ?? "").trim();
    const tyRaw = Number(seg?.textY);
    const textYpct = Number.isFinite(tyRaw)
      ? Math.min(100, Math.max(0, tyRaw))
      : 85;
    const bottomColor = /^#[0-9A-Fa-f]{6}$/i.test(String(seg?.textColor || ""))
      ? seg.textColor
      : TEXT_COLORS[0];
    const shadow = "2px 2px 2px rgba(0,0,0,0.85)";
    return (
      <div
        style={{
          position: "absolute",
          left: b.left,
          top: b.top,
          width: b.width,
          height: b.height,
          zIndex: 3,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {topLine ? (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 30,
              textAlign: "center",
              fontSize: previewFontPx,
              color: topColor,
              fontWeight: 700,
              lineHeight: 1.2,
              textShadow: shadow,
              padding: "0 8px",
              boxSizing: "border-box",
              wordBreak: "break-word",
            }}
          >
            {topLine}
          </div>
        ) : null}
        {bottomLine ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: `${textYpct}%`,
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              maxWidth: "100%",
              fontSize: previewFontPx,
              color: bottomColor,
              fontWeight: 700,
              lineHeight: 1.2,
              textShadow: shadow,
              padding: "0 8px",
              boxSizing: "border-box",
              wordBreak: "break-word",
            }}
          >
            {bottomLine}
          </div>
        ) : null}
      </div>
    );
  }, [
    previewCropOverlay,
    topText,
    topTextColor,
    topTextSize,
    segments,
    previewSegmentIndex,
  ]);

  const busy = status === "encoding";
  const uploading = uploadPhase === "uploading";

  return (
    <div className="section soft">
      <div className="section-title">3. 쇼츠-하이라이트</div>
      <p className="muted" style={{ marginTop: 6 }}>
        로컬 원본 영상(mp4/mov/avi)을 업로드하고 구간(HH:MM:SS)을 지정하면
        9:16(1080×1920)으로 합성된 mp4를 만듭니다.
      </p>

      <div style={{ marginTop: 16, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          로컬 다운로드
        </div>
        <div className="muted" style={{ fontSize: 14, marginBottom: 10 }}>
          {localServerOk === null ? (
            "서버 상태 확인 중…"
          ) : localServerOk ? (
            <span>🟢 연결됨</span>
          ) : (
            <span>
              🔴 연결 안 됨 —{" "}
              <strong style={{ color: "#ffb347" }}>
                서버시작.bat를 실행해주세요
              </strong>
            </span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            type="url"
            placeholder="https://..."
            value={localYtdlpUrl}
            onChange={(e) => setLocalYtdlpUrl(e.target.value)}
            disabled={busy || uploading || localDownloadBusy}
            style={{
              flex: "1 1 220px",
              minWidth: 160,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0f141d",
              color: "var(--text, #e9edf5)",
              fontFamily: "inherit",
              fontSize: 14,
            }}
          />
          <button
            type="button"
            className="primary primary-fill"
            disabled={
              busy ||
              uploading ||
              localDownloadBusy ||
              localServerOk === false
            }
            onClick={onLocalDownload}
          >
            {localDownloadBusy ? "다운로드 중…" : "⬇ 로컬 다운로드"}
          </button>
        </div>
        {localDownloadBusy ? (
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            yt-dlp로 저장 중… (완료될 때까지 기다려 주세요)
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          저장된 파일 목록
        </div>
        {savedFilesLoading ? (
          <div className="muted" style={{ fontSize: 14 }}>
            목록 불러오는 중…
          </div>
        ) : savedFilesError ? (
          <div className="muted" style={{ fontSize: 13, color: "#ffb347" }}>
            {savedFilesError}
          </div>
        ) : savedFiles.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            저장된 원본이 없습니다.
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {savedFiles.map((row) => {
              const jid = row.jobId || "";
              const shortName = jid.slice(0, 8) || "—";
              const when = row.lastModified
                ? new Date(row.lastModified).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    dateStyle: "short",
                    timeStyle: "medium",
                  })
                : "—";
              return (
                <li
                  key={jid}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{shortName}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {when}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {typeof row.size === "number"
                      ? `${Math.round(row.size / 1024)} KB`
                      : ""}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      marginLeft: "auto",
                    }}
                  >
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || uploading}
                      onClick={() => onLoadSavedJob(jid)}
                    >
                      불러오기
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      onClick={() => onDeleteSavedJob(jid)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(255, 107, 138, 0.55)",
                        background:
                          "linear-gradient(135deg, rgba(180,40,70,0.55), rgba(120,24,48,0.75))",
                        color: "#ffd0dc",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        cursor:
                          busy || uploading ? "not-allowed" : "pointer",
                        opacity: busy || uploading ? 0.55 : 1,
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 14, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
          원본 영상 파일
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            ref={videoInputRef}
            type="file"
            accept={VIDEO_ACCEPT}
            style={{ display: "none" }}
            onChange={onVideoFileChange}
          />
          <button
            type="button"
            className="primary"
            disabled={busy || uploading}
            onClick={() => videoInputRef.current?.click()}
          >
            파일 선택
          </button>
          <span className="muted" style={{ fontSize: 13, maxWidth: 280 }}>
            {videoFile
              ? `${videoFile.name} (${Math.round(videoFile.size / 1024)} KB)`
              : "선택 없음 — mp4 · mov · avi"}
          </span>
          <button
            type="button"
            className="primary primary-fill"
            disabled={busy || uploading || !videoFile}
            onClick={onUploadSource}
          >
            {uploading ? "업로드 중…" : "S3에 업로드"}
          </button>
        </div>

        {uploading ? (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
              업로드 진행
            </div>
            <div className="video-export-progress-wrap">
              <div className="video-export-progress-bar">
                <div
                  className="video-export-progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {uploadProgress}%
              </div>
            </div>
          </div>
        ) : uploadPhase === "done" ? (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="muted" style={{ fontWeight: 700 }}>
              업로드 완료 (jobId 저장됨)
            </span>
            <button
              type="button"
              className="ghost"
              disabled={busy || uploading}
              onClick={onDeleteSource}
            >
              파일 삭제
            </button>
          </div>
        ) : null}
      </div>

      {uploadPhase === "done" && previewUrl ? (
        <div style={{ marginTop: 16, maxWidth: 720 }}>
          <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
            원본 미리보기
          </div>
          <div
            ref={previewVideoWrapRef}
            style={{
              position: "relative",
              width: "100%",
              maxHeight: 360,
              borderRadius: 8,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <video
              ref={previewVideoRef}
              src={previewUrl}
              controls
              playsInline
              style={{
                position: "relative",
                zIndex: 0,
                width: "100%",
                maxHeight: 360,
                display: "block",
                objectFit: "contain",
                background: "#000",
              }}
            />
            {previewCropOverlay ? (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 2,
                  pointerEvents: "none",
                }}
              >
                {previewCropOverlay.darkRects.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                      background: "rgba(0,0,0,0.5)",
                    }}
                  />
                ))}
                <div
                  style={{
                    position: "absolute",
                    left: previewCropOverlay.border.left,
                    top: previewCropOverlay.border.top,
                    width: previewCropOverlay.border.width,
                    height: previewCropOverlay.border.height,
                    boxSizing: "border-box",
                    border: "2px solid rgba(255,255,255,0.92)",
                    borderRadius: 2,
                    background: "transparent",
                    zIndex: 2,
                  }}
                />
                {previewCropTextOverlayEl}
              </div>
            ) : null}
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              적용 구간
              <select
                value={previewSegmentIndex}
                onChange={(e) =>
                  setPreviewSegmentIndex(Number(e.target.value) || 0)
                }
                disabled={busy || uploading}
                style={{ padding: 6 }}
              >
                {segments.map((_, i) => (
                  <option key={i} value={i}>
                    #{i + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary"
              disabled={busy || uploading}
              onClick={() => applyVideoTimeToSegment("start")}
            >
              ▶ 시작점 설정
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || uploading}
              onClick={() => applyVideoTimeToSegment("end")}
            >
              ⏹ 종료점 설정
            </button>
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            재생 위치의 시간을 HH:MM:SS로 선택한 구간에 반영합니다.
          </p>
        </div>
      ) : null}

      <div style={{ marginTop: 20, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 10 }}>
          텍스트 오버레이
        </div>
        <label className="preset-field" style={{ marginBottom: 12 }}>
          <span>상단 제목 텍스트 (비우면 미표시)</span>
          <input
            type="text"
            placeholder="예: 오늘의 하이라이트"
            value={topText}
            disabled={busy || uploading}
            onChange={(e) => setTopText(e.target.value)}
          />
        </label>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "flex-end",
            marginBottom: 8,
          }}
        >
          <div
            className="muted"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            폰트 색상
            <TextColorPalette
              value={topTextColor}
              disabled={busy || uploading}
              onChange={setTopTextColor}
            />
          </div>
          <label
            className="muted"
            style={{
              flex: "1 1 220px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              fontSize: 13,
              fontWeight: 700,
              minWidth: 180,
            }}
          >
            폰트 크기 ({Math.round(
              Math.min(200, Math.max(20, Number(topTextSize) || 72))
            )}
            px)
            <input
              type="range"
              min={20}
              max={200}
              step={1}
              value={Math.min(200, Math.max(20, Number(topTextSize) || 72))}
              disabled={busy || uploading}
              onChange={(e) => setTopTextSize(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div className="muted" style={{ fontWeight: 700 }}>
            구간 설정 (최대 {MAX_SEGMENTS}개)
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || uploading}
            onClick={addSegment}
          >
            + 구간 추가
          </button>
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {segments.map((seg, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span className="muted" style={{ minWidth: 40, flexShrink: 0 }}>
                  #{index + 1}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="00:00:00"
                  maxLength={8}
                  value={seg.start}
                  onChange={(e) =>
                    handleTimeChange(index, "start", e.target.value)
                  }
                  disabled={busy || uploading}
                  style={{
                    padding: 8,
                    width: 120,
                    boxSizing: "border-box",
                  }}
                />
                <span className="muted">~</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="00:00:00"
                  maxLength={8}
                  value={seg.end}
                  onChange={(e) =>
                    handleTimeChange(index, "end", e.target.value)
                  }
                  disabled={busy || uploading}
                  style={{
                    padding: 8,
                    width: 120,
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || uploading || segments.length <= 2}
                  onClick={() => removeSegment(index)}
                  title="삭제"
                >
                  ✕
                </button>
              </div>
              <label
                className="muted"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                크롭 오프셋: {formatCropOffsetLabel(seg.cropOffset ?? 0)}
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={seg.cropOffset ?? 0}
                  disabled={busy || uploading}
                  onChange={(e) =>
                    handleCropOffsetChange(index, e.target.value)
                  }
                  style={{ width: "100%", maxWidth: 420 }}
                />
              </label>
              <label className="preset-field" style={{ marginTop: 4 }}>
                <span>하단 텍스트 (비우면 해당 구간 미표시)</span>
                <input
                  type="text"
                  placeholder="구간별 자막"
                  value={seg.text ?? ""}
                  disabled={busy || uploading}
                  onChange={(e) =>
                    handleSegmentOverlayChange(index, "text", e.target.value)
                  }
                />
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  alignItems: "flex-end",
                  marginTop: 8,
                }}
              >
                <label
                  className="muted"
                  style={{
                    flex: "1 1 240px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    minWidth: 200,
                  }}
                >
                  세로 위치: {seg.textY ?? 85}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={seg.textY ?? 85}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      handleSegmentOverlayChange(
                        index,
                        "textY",
                        e.target.value
                      )
                    }
                    style={{ width: "100%", maxWidth: 420 }}
                  />
                  <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                    0% = 최상단 · 100% = 최하단
                  </span>
                </label>
                <div
                  className="muted"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  폰트 색상
                  <TextColorPalette
                    value={seg.textColor}
                    disabled={busy || uploading}
                    onChange={(c) =>
                      handleSegmentOverlayChange(index, "textColor", c)
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 15,
            fontWeight: 700,
            ...segmentTotalWarnStyle,
          }}
        >
          총 구간 합계: {secondsToHhMmSs(segmentTotalSec)} (
          {Math.floor(segmentTotalSec)}초)
        </div>
        <div
          style={{
            marginTop: 14,
            width: "100%",
            display: "flex",
            justifyContent: "flex-start",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: "nowrap",
              alignItems: "center",
              gap: 10,
              whiteSpace: "nowrap",
              cursor: busy || uploading ? "not-allowed" : "pointer",
              opacity: busy || uploading ? 0.65 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={muteOriginal}
              disabled={busy || uploading}
              onChange={(e) => setMuteOriginal(e.target.checked)}
            />
            <span
              className="muted"
              style={{ fontWeight: 700, whiteSpace: "nowrap" }}
            >
              원본 오디오 음소거
            </span>
          </label>
        </div>
      </div>

      <div style={{ marginTop: 20, maxWidth: 480 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 10 }}>
          배경 음원 (BGM)
        </div>
        <label className="preset-field">
          <span>음원 선택</span>
          <select
            value={highlightMusicS3Key}
            disabled={busy || uploading}
            onChange={(e) => setHighlightMusicS3Key(e.target.value)}
          >
            <option value="">— BGM 없음 —</option>
            {musicTracks.map((t) => (
              <option key={t.id} value={t.s3_key}>
                {t.name || t.s3_key}
                {Number.isFinite(Number(t.duration))
                  ? ` (${Math.round(Number(t.duration))}초)`
                  : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="preset-field">
          <span>
            음원 볼륨 ({bgmVolume.toFixed(2)})
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={bgmVolume}
            disabled={busy || uploading}
            onChange={(e) => setBgmVolume(Number(e.target.value))}
          />
        </label>
        <label className="preset-field">
          <span>음원 시작 위치 (초)</span>
          <input
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={bgmStartTime}
            disabled={busy || uploading}
            onChange={(e) =>
              setBgmStartTime(Math.max(0, Number(e.target.value) || 0))
            }
          />
        </label>
        <label className="preset-field">
          <span>
            끝 페이드아웃 ({bgmFadeOut.toFixed(1)}초, 0~5)
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={bgmFadeOut}
            disabled={busy || uploading}
            onChange={(e) => setBgmFadeOut(Number(e.target.value))}
          />
        </label>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          BGM 사용 시 &quot;원본 오디오 음소거&quot;를 끄면 원본과 배경 음원이
          함께 섞입니다. 음소거를 켜면 BGM만 들립니다.
        </p>
      </div>

      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="primary primary-fill"
          disabled={busy || uploading || uploadPhase !== "done"}
          onClick={onGenerate}
        >
          {busy ? "처리 중…" : "영상 생성"}
        </button>
        {busy ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            취소
          </button>
        ) : null}
      </div>

      {busy ? (
        <div style={{ marginTop: 16 }}>
          <div className="video-export-progress-wrap">
            <div className="video-export-progress-bar">
              <div
                className="video-export-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {progress}%
            </div>
          </div>
          <p className="video-export-message">{message}</p>
        </div>
      ) : message ? (
        <div className="muted" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}

      {error ? (
        <pre className="result-error-light" style={{ marginTop: 12 }}>
          {error.message}
        </pre>
      ) : null}

      {downloadUrl ? (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "row",
            flexWrap: "nowrap",
            alignItems: "stretch",
            gap: 8,
          }}
        >
          <a
            href={downloadUrl}
            download="highlight.mp4"
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "10px 16px",
              borderRadius: 8,
              textDecoration: "none",
              color: "#0b1a14",
              fontWeight: 800,
              background: "#0a8f6a",
              boxSizing: "border-box",
            }}
          >
            ⬇ mp4 다운로드
          </a>
          <button
            type="button"
            disabled={busy || uploading || uploadPhase !== "done" || !jobId}
            onClick={() => {
              setError(null);
              onGenerate();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid rgba(19,199,154,0.5)",
              background: "rgba(19,199,154,0.4)",
              color: "#0b1a14",
              fontWeight: 800,
              fontFamily: "inherit",
              cursor:
                busy || uploading || uploadPhase !== "done" || !jobId
                  ? "not-allowed"
                  : "pointer",
              opacity:
                busy || uploading || uploadPhase !== "done" || !jobId
                  ? 0.55
                  : 1,
            }}
          >
            ↺ 다시 생성
          </button>
        </div>
      ) : null}
    </div>
  );
}
