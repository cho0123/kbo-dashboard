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

/** 30fps 기준 1프레임(초) — 미세조정용 */
const ONE_FRAME_30_FPS_SEC = 1 / 30;
const TENTH_SEC = 0.1;

/** 구간 시작/종료 미세조정 버튼 (-1f / ±0.1s / +1f) */
const SEGMENT_NUDGE_BTN_STYLE = {
  background: "#2a2a2a",
  border: "1px solid #555",
  color: "#fff",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 10,
  cursor: "pointer",
};

const LOCAL_DOWNLOAD_SERVER = "http://localhost:3838";

const VIDEO_ACCEPT =
  ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo";

const TEXT_COLORS = [
  "#FFFFFF",
  "#F5F0E8",
  "#FFE066",
  "#FFB347",
  "#7EC8E3",
  "#98E8C1",
  "#FFB3C6",
  "#C8A8E9",
  "#A8D8A8",
  "#000000",
];

const FONTS = [
  { label: "Noto Sans KR (기본)", value: "NotoSansKR-Bold.ttf" },
  { label: "Black Han Sans (임팩트)", value: "BlackHanSans-Regular.ttf" },
  { label: "Noto Serif KR (명조)", value: "NotoSerifKR-Bold.ttf" },
];

const DEFAULT_TEXT_FONT = "NotoSansKR-Bold.ttf";

/** Lambda TTF 파일명 → 미리보기 CSS font-family (Google / 시스템 글꼴에 대응) */
function previewFontFamily(fontFile) {
  const f = String(fontFile || "").trim();
  if (/blackhansans/i.test(f)) return '"Black Han Sans", sans-serif';
  if (/notoserifkr/i.test(f)) return '"Noto Serif KR", "Noto Serif", serif';
  return '"Noto Sans KR", "Noto Sans", sans-serif';
}

function normalizeFontSelectValue(v) {
  const s = String(v ?? "").trim();
  return FONTS.some((f) => f.value === s) ? s : DEFAULT_TEXT_FONT;
}

const TIMELINE_SEGMENT_COLORS = [
  "#13c79a",
  "#7EC8E3",
  "#FFB347",
  "#FFB3C6",
  "#C8A8E9",
];

function roundOpacity01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(1, Math.max(0, n)) * 10) / 10;
}

function hexToRgba(hex, opacity) {
  const h = String(hex || "").replace(/^#/, "").trim();
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return `rgba(255,255,255,${opacity})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.min(1, Math.max(0, opacity));
  return `rgba(${r},${g},${b},${a})`;
}

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
    startMs: 0,
    endMs: 0,
    cropOffset: 0,
    text: "",
    textY: 85,
    textColor: TEXT_COLORS[0],
    textOpacity: 1,
    textSize: 48,
    textFont: DEFAULT_TEXT_FONT,
  };
}

/** HH:MM:SS + startMs/endMs(0~99) → 초; 실패 시 null */
function segmentBoundaryToSeconds(hmsRaw, fracMs) {
  return parseHhMmSsToSeconds(hmsRaw, fracMs);
}

function formatCropOffsetLabel(offset) {
  const n = Math.round(Number(offset) || 0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

/**
 * 미리보기 currentTime(초)이 [start, end]에 들어가는 첫 구간; 없으면 null
 */
function findSegmentAtPreviewTime(ct, segments) {
  if (!Array.isArray(segments)) return null;
  const t = Number(ct);
  if (!Number.isFinite(t)) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const st = String(seg.start ?? "").trim();
    const en = String(seg.end ?? "").trim();
    if (!st || !en) continue;
    const a = segmentBoundaryToSeconds(st, seg.startMs);
    const b = segmentBoundaryToSeconds(en, seg.endMs);
    if (a == null || b == null || b <= a) continue;
    if (t >= a && t <= b) return seg;
  }
  return null;
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

/** 구간 소수 부분 0~99 (0.01초 단위) */
function clampSegmentFracMs(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.min(99, Math.max(0, v));
}

/**
 * HH:MM:SS 또는 MM:SS 등 → 초; 불가 시 null.
 * 선택 fracMs: 0~99 (0.01초) 합산
 */
function parseHhMmSsToSeconds(t, fracMs) {
  const s = String(t || "").trim();
  if (!s) return null;
  const parts = s.split(":").map((p) => p.trim());
  const nums = parts.map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : NaN;
  });
  if (nums.some((n) => Number.isNaN(n))) return null;
  let base = null;
  if (parts.length === 3) {
    const [h, m, sec] = nums;
    if (m >= 60 || sec >= 60) return null;
    base = h * 3600 + m * 60 + sec;
  } else if (parts.length === 2) {
    const [m, sec] = nums;
    if (sec >= 60) return null;
    base = m * 60 + sec;
  } else if (parts.length === 1) {
    base = nums[0];
  }
  if (base == null) return null;
  if (fracMs === undefined || fracMs === null) return base;
  return base + clampSegmentFracMs(fracMs) / 100;
}

export default function Shorts3Panel() {
  const [segments, setSegments] = useState([emptySegment()]);
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
  /** 구간 카드 선택 → 오른쪽 세부 설정 */
  const [selectedSegIndex, setSelectedSegIndex] = useState(0);
  const previewVideoRef = useRef(null);
  const previewVideoWrapRef = useRef(null);
  /** 미리보기 래퍼와 동일 너비로 타임라인 바 맞춤 */
  const [previewWrapWidthPx, setPreviewWrapWidthPx] = useState(null);
  const [previewCropOverlay, setPreviewCropOverlay] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  /** 미리보기 하단 자막용 재생 시각(원본 영상 currentTime) */
  const [previewPlayheadSec, setPreviewPlayheadSec] = useState(0);

  const [muteOriginal, setMuteOriginal] = useState(true);
  const [musicTracks, setMusicTracks] = useState([]);
  const [highlightMusicS3Key, setHighlightMusicS3Key] = useState("");
  const [bgmVolume, setBgmVolume] = useState(0.8);
  const [bgmStartTime, setBgmStartTime] = useState(0);
  const [bgmFadeOut, setBgmFadeOut] = useState(2);

  const [topText, setTopText] = useState("");
  const [topTextColor, setTopTextColor] = useState(TEXT_COLORS[0]);
  const [topTextSize, setTopTextSize] = useState(72);
  const [topTextOpacity, setTopTextOpacity] = useState(1);
  const [topTextFont, setTopTextFont] = useState(DEFAULT_TEXT_FONT);

  const [savedFiles, setSavedFiles] = useState([]);
  const [savedFilesLoading, setSavedFilesLoading] = useState(false);
  const [savedFilesError, setSavedFilesError] = useState(null);

  const [localServerOk, setLocalServerOk] = useState(null);
  const [localYtdlpUrl, setLocalYtdlpUrl] = useState("");
  const [localDownloadBusy, setLocalDownloadBusy] = useState(false);

  /** 원본 미리보기 영상만 구간 끝에서 멈춤 */
  const [playingSegmentIndex, setPlayingSegmentIndex] = useState(null);
  const [previewPlaybackPaused, setPreviewPlaybackPaused] = useState(true);

  const busy = status === "encoding";
  const uploading = uploadPhase === "uploading";

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

  useEffect(() => {
    if (!previewUrl) {
      setPlayingSegmentIndex(null);
    }
  }, [previewUrl]);

  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !previewUrl) {
      setVideoDuration(0);
      return undefined;
    }
    const onMeta = () => {
      const d = Number(v.duration);
      setVideoDuration(Number.isFinite(d) && d > 0 ? d : 0);
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    onMeta();
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (
      playingSegmentIndex != null &&
      playingSegmentIndex >= segments.length
    ) {
      setPlayingSegmentIndex(null);
    }
  }, [playingSegmentIndex, segments.length]);

  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !previewUrl) return undefined;
    const onPlay = () => setPreviewPlaybackPaused(false);
    const onPause = () => setPreviewPlaybackPaused(true);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    setPreviewPlaybackPaused(v.paused);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [previewUrl]);

  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !previewUrl || playingSegmentIndex == null) return undefined;
    const seg = segments[playingSegmentIndex];
    if (!seg) return undefined;
    const endRaw = String(seg.end ?? "").trim();
    const endSec = segmentBoundaryToSeconds(endRaw, seg.endMs);
    if (endSec == null) return undefined;

    const onTimeUpdate = () => {
      if (v.paused) return;
      if (v.currentTime >= endSec) {
        v.pause();
        setPlayingSegmentIndex(null);
      }
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [previewUrl, playingSegmentIndex, segments]);

  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !previewUrl) {
      setPreviewPlayheadSec(0);
      return undefined;
    }
    const sync = () => {
      setPreviewPlayheadSec(Number(v.currentTime) || 0);
    };
    sync();
    v.addEventListener("timeupdate", sync);
    v.addEventListener("seeked", sync);
    v.addEventListener("loadeddata", sync);
    return () => {
      v.removeEventListener("timeupdate", sync);
      v.removeEventListener("seeked", sync);
      v.removeEventListener("loadeddata", sync);
    };
  }, [previewUrl]);

  const updatePreviewCropOverlay = useCallback(() => {
    const video = previewVideoRef.current;
    const segOff = segments[selectedSegIndex]?.cropOffset ?? 0;
    if (!video) {
      setPreviewCropOverlay(null);
      return;
    }
    setPreviewCropOverlay(computePreviewCropOverlay(video, segOff));
  }, [segments, selectedSegIndex]);

  useLayoutEffect(() => {
    updatePreviewCropOverlay();
  }, [updatePreviewCropOverlay, previewUrl]);

  useLayoutEffect(() => {
    const wrap = previewVideoWrapRef.current;
    if (!wrap || !previewUrl || uploadPhase !== "done") {
      setPreviewWrapWidthPx(null);
      return undefined;
    }
    const sync = () => setPreviewWrapWidthPx(wrap.offsetWidth);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [previewUrl, uploadPhase]);

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
      const a = segmentBoundaryToSeconds(st, seg.startMs);
      const b = segmentBoundaryToSeconds(en, seg.endMs);
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
    setSegments((s) => {
      if (s.length >= MAX_SEGMENTS) return s;
      const next = [...s, emptySegment()];
      const ni = next.length - 1;
      setSelectedSegIndex(ni);
      return next;
    });
  }, []);

  const removeSegment = useCallback((idx) => {
    setPlayingSegmentIndex((cur) =>
      cur === idx ? null : cur != null && idx < cur ? cur - 1 : cur
    );
    setSelectedSegIndex((sel) => {
      if (sel === idx) return Math.max(0, idx - 1);
      if (sel > idx) return sel - 1;
      return sel;
    });
    setSegments((s) => (s.length <= 1 ? s : s.filter((_, i) => i !== idx)));
  }, []);

  const segmentPlaybackTimesValid = useCallback((seg) => {
    const st = String(seg?.start ?? "").trim();
    const en = String(seg?.end ?? "").trim();
    if (!st || !en) return false;
    const a = segmentBoundaryToSeconds(st, seg?.startMs);
    const b = segmentBoundaryToSeconds(en, seg?.endMs);
    return a != null && b != null && b > a;
  }, []);

  const toggleSegmentPreviewPlayback = useCallback(
    async (index) => {
      const v = previewVideoRef.current;
      if (!previewUrl || !v || busy || uploading) return;
      const seg = segments[index];
      if (!segmentPlaybackTimesValid(seg)) return;

      const startSec = segmentBoundaryToSeconds(
        String(seg.start).trim(),
        seg.startMs
      );

      if (playingSegmentIndex === index && !previewPlaybackPaused) {
        v.pause();
        return;
      }
      if (playingSegmentIndex === index && previewPlaybackPaused) {
        try {
          await v.play();
        } catch {
          /* autoplay / 미디어 정책 */
        }
        return;
      }

      setPlayingSegmentIndex(index);
      if (startSec != null) {
        v.currentTime = startSec;
      }
      try {
        await v.play();
      } catch {
        /* autoplay / 미디어 정책 */
      }
    },
    [
      segments,
      previewPlaybackPaused,
      playingSegmentIndex,
      previewUrl,
      busy,
      uploading,
      segmentPlaybackTimesValid,
    ]
  );

  useEffect(() => {
    setSelectedSegIndex((i) =>
      Math.min(i, Math.max(0, segments.length - 1))
    );
  }, [segments.length]);

  const selectSegment = useCallback((index) => {
    setSelectedSegIndex(index);
  }, []);

  const seekPreviewToSegmentBoundary = useCallback(
    (segIndex, field) => {
      const v = previewVideoRef.current;
      if (!v || !previewUrl) return;
      const seg = segments[segIndex];
      if (!seg) return;
      const key = field === "start" ? "start" : "end";
      const fracKey = field === "start" ? "startMs" : "endMs";
      const t = segmentBoundaryToSeconds(
        String(seg[key] ?? "").trim(),
        seg[fracKey]
      );
      if (t == null || !Number.isFinite(t)) return;
      v.currentTime = t;
    },
    [segments, previewUrl]
  );

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
        if (field === "textSize") {
          const n = Number(rawVal);
          const v = Number.isFinite(n)
            ? Math.min(200, Math.max(20, Math.round(n)))
            : 48;
          return { ...seg, textSize: v };
        }
        if (field === "textOpacity") {
          return { ...seg, textOpacity: roundOpacity01(rawVal) };
        }
        if (field === "textFont") {
          return {
            ...seg,
            textFont: String(rawVal || "").trim() || DEFAULT_TEXT_FONT,
          };
        }
        return seg;
      })
    );
  };

  const handleTimeChange = (segIndex, field, rawVal) => {
    const digits = rawVal.replace(/\D/g, "").slice(0, 9);
    let formatted = digits;
    const n = digits.length;
    if (n <= 2) {
      formatted = digits;
    } else if (n <= 4) {
      formatted = digits.slice(0, 2) + ":" + digits.slice(2);
    } else if (n === 5) {
      formatted =
        digits.slice(0, 1) + ":" + digits.slice(1, 3) + ":" + digits.slice(3, 5);
    } else {
      formatted =
        digits.slice(0, 2) + ":" + digits.slice(2, 4) + ":" + digits.slice(4);
    }
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === segIndex ? { ...seg, [field]: formatted } : seg
      )
    );
  };

  const handleFracMsChange = (segIndex, field, rawVal) => {
    const digits = rawVal.replace(/\D/g, "");
    let n = 0;
    if (digits !== "") {
      const use = digits.length > 2 ? digits.slice(-2) : digits;
      const parsed = parseInt(use, 10);
      n = Number.isFinite(parsed) ? parsed : 0;
    }
    n = clampSegmentFracMs(n);
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === segIndex ? { ...seg, [field]: n } : seg
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
    const ct = el.currentTime;
    const whole = Math.floor(ct);
    const frac = clampSegmentFracMs(Math.round((ct - whole) * 100));
    const hms = secondsToHhMmSs(whole);
    const fracField = field === "start" ? "startMs" : "endMs";
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === selectedSegIndex
          ? { ...seg, [field]: hms, [fracField]: frac }
          : seg
      )
    );
  }, [selectedSegIndex]);

  const adjustSegmentFieldTime = useCallback((segIndex, field, deltaSec) => {
    let seekSec = null;
    setSegments((prev) => {
      const seg = prev[segIndex];
      if (!seg) return prev;
      const fracField = field === "start" ? "startMs" : "endMs";
      const cur =
        parseHhMmSsToSeconds(seg[field], seg[fracField]) ??
        (String(seg[field] ?? "").trim() === "" ? 0 : null);
      if (cur == null) return prev;
      const next = Math.max(0, cur + deltaSec);
      seekSec = next;
      const whole = Math.floor(next + 1e-9);
      const frac = clampSegmentFracMs(Math.round((next - whole) * 100));
      const hms = secondsToHhMmSs(whole);
      return prev.map((s, i) =>
        i === segIndex ? { ...s, [field]: hms, [fracField]: frac } : s
      );
    });
    if (seekSec == null) return;
    setSelectedSegIndex(segIndex);
    queueMicrotask(() => {
      const v = previewVideoRef.current;
      if (v) v.currentTime = seekSec;
    });
  }, []);

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

    const validSegments = segments.filter((sg) => {
      const st = String(sg.start ?? "").trim();
      const en = String(sg.end ?? "").trim();
      if (!st || !en) return false;
      const a = segmentBoundaryToSeconds(st, sg.startMs);
      const b = segmentBoundaryToSeconds(en, sg.endMs);
      return a != null && b != null && b > a;
    });
    if (validSegments.length < 1) {
      setError(
        new Error(
          "시작·종료가 모두 입력된 유효한 구간이 최소 1개 필요합니다. 빈 구간은 건너뜁니다."
        )
      );
      return;
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
        topTextOpacity: roundOpacity01(topTextOpacity),
        topTextFont:
          String(topTextFont || "").trim() || DEFAULT_TEXT_FONT,
        segments: validSegments.map((s) => {
          const ty = Number(s.textY);
          const textY = Number.isFinite(ty)
            ? Math.min(100, Math.max(0, Math.round(ty)))
            : 85;
          return {
            start: String(s.start).trim(),
            end: String(s.end).trim(),
            startMs: clampSegmentFracMs(s.startMs ?? 0),
            endMs: clampSegmentFracMs(s.endMs ?? 0),
            cropOffset:
              typeof s.cropOffset === "number" && Number.isFinite(s.cropOffset)
                ? Math.min(50, Math.max(-50, Math.round(s.cropOffset)))
                : 0,
            text: String(s.text ?? "").trim(),
            textY,
            textColor:
              String(s.textColor ?? TEXT_COLORS[0]).trim() || TEXT_COLORS[0],
            textOpacity: roundOpacity01(s.textOpacity ?? 1),
            textFont:
              String(s.textFont || "").trim() || DEFAULT_TEXT_FONT,
            textSize: Math.min(
              200,
              Math.max(
                20,
                Math.round(Number(s.textSize)) || 48
              )
            ),
          };
        }),
        muteOriginal,
        musicOptions: {
          volume: bgmVolume,
          startTime: bgmStartTime,
          fadeOutDuration: bgmFadeOut,
        },
      };
      // Lambda 폴백: thumbnail.png 없을 때 source.mp4 기준 썸네일 구간(이 패널에서는 미설정)
      const thumbSecRaw = null;
      const thumbSec =
        thumbSecRaw != null && thumbSecRaw !== ""
          ? typeof thumbSecRaw === "number"
            ? thumbSecRaw
            : Number(thumbSecRaw)
          : NaN;
      if (Number.isFinite(thumbSec) && thumbSec >= 0) {
        payload.thumbnailTime = thumbSec;
        payload.thumbnailTextFont = DEFAULT_TEXT_FONT;
      }
      payload.thumbnailCropOffset = 0;
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
    const ct = previewPlayheadSec;
    const bottomSeg = findSegmentAtPreviewTime(ct, segments);
    const segmentBottomLine = String(bottomSeg?.text ?? "").trim();

    const previewTopPx = Math.max(8, (Number(topTextSize) || 72) * scale);
    const segBottomPx = Math.max(
      8,
      (Number(bottomSeg?.textSize) || 48) * scale
    );

    const topColorRaw = /^#[0-9A-Fa-f]{6}$/i.test(String(topTextColor || ""))
      ? topTextColor
      : TEXT_COLORS[0];
    const topOp = roundOpacity01(topTextOpacity ?? 1);
    const topColor = hexToRgba(topColorRaw, topOp);
    const topLine = String(topText || "").trim();
    const shadow = "2px 2px 2px rgba(0,0,0,0.85)";
    const topFontFamily = previewFontFamily(topTextFont);

    const segYRaw = Number(bottomSeg?.textY);
    const segYpct = Number.isFinite(segYRaw)
      ? Math.min(100, Math.max(0, segYRaw))
      : 85;
    const segColorRaw = /^#[0-9A-Fa-f]{6}$/i.test(
      String(bottomSeg?.textColor || "")
    )
      ? bottomSeg.textColor
      : TEXT_COLORS[0];
    const segColor = hexToRgba(
      segColorRaw,
      roundOpacity01(bottomSeg?.textOpacity ?? 1)
    );
    const segFontFamily = previewFontFamily(
      bottomSeg?.textFont || DEFAULT_TEXT_FONT
    );

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
          overflow: "visible",
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
              fontSize: previewTopPx,
              color: topColor,
              fontFamily: topFontFamily,
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
        {segmentBottomLine ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: `${segYpct}%`,
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              fontSize: segBottomPx,
              color: segColor,
              fontFamily: segFontFamily,
              fontWeight: 700,
              lineHeight: 1.2,
              textShadow: shadow,
              padding: "0 8px",
              boxSizing: "border-box",
              whiteSpace: "nowrap",
              overflow: "visible",
            }}
          >
            {segmentBottomLine}
          </div>
        ) : null}
      </div>
    );
  }, [
    previewCropOverlay,
    previewPlayheadSec,
    topText,
    topTextColor,
    topTextSize,
    topTextOpacity,
    topTextFont,
    segments,
  ]);

  return (
    <div className="section soft" style={{ overflow: "visible" }}>
      <div className="section-title">3. 쇼츠-하이라이트</div>
      <p className="muted" style={{ marginTop: 6 }}>
        로컬 원본 영상(mp4/mov/avi)을 업로드하고 구간(HH:MM:SS)을 지정하면
        9:16(1080×1920)으로 합성된 mp4를 만듭니다.
      </p>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          width: "100%",
          overflow: "visible",
        }}
      >
        <div style={{ width: "100%", marginTop: 16 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          로컬 다운로드
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <span
            className="muted"
            style={{
              fontSize: 13,
              whiteSpace: "nowrap",
              flex: "0 0 auto",
              maxWidth: "100%",
            }}
          >
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
          </span>
          <input
            type="url"
            placeholder="https://..."
            value={localYtdlpUrl}
            onChange={(e) => setLocalYtdlpUrl(e.target.value)}
            disabled={busy || uploading || localDownloadBusy}
            style={{
              flex: "1 1 160px",
              minWidth: 120,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "#0f141d",
              color: "var(--text, #e9edf5)",
              fontFamily: "inherit",
              fontSize: 13,
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
            style={{ flex: "0 0 auto" }}
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

      <div style={{ marginTop: 16, width: "100%" }}>
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

      <div style={{ marginTop: 14, width: "100%" }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
          원본 영상 파일
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
            style={{ flex: "0 0 auto", padding: "8px 12px" }}
          >
            파일 선택
          </button>
          <span
            className="muted"
            style={{
              fontSize: 12,
              flex: "1 1 140px",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={
              videoFile
                ? `${videoFile.name} (${Math.round(videoFile.size / 1024)} KB)`
                : ""
            }
          >
            {videoFile
              ? `${videoFile.name} (${Math.round(videoFile.size / 1024)} KB)`
              : "선택 없음 — mp4 · mov · avi"}
          </span>
          <button
            type="button"
            className="primary primary-fill"
            disabled={busy || uploading || !videoFile}
            onClick={onUploadSource}
            style={{ flex: "0 0 auto", padding: "8px 12px" }}
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

        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            width: "100%",
            background: "#ffffff",
            paddingTop: 4,
            paddingBottom: 14,
            boxSizing: "border-box",
            marginTop: 16,
          }}
        >
          <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
            원본 미리보기
          </div>
          {uploadPhase === "done" && previewUrl ? (
            <>
            <div
              ref={previewVideoWrapRef}
                style={{
                  position: "relative",
                  width: "100%",
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
                    height: "auto",
                    maxHeight: "70vh",
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
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    padding: "8px 0",
                    flexWrap: "nowrap",
                    overflowX: "auto",
                  }}
                >
                  <button
                    type="button"
                    onClick={addSegment}
                    disabled={busy || uploading}
                    style={{
                      background: "#4ade80",
                      color: "#000",
                      fontWeight: "bold",
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    + 구간 추가
                  </button>

                  <select
                    value={selectedSegIndex}
                    onChange={(e) =>
                      setSelectedSegIndex(Number(e.target.value) || 0)
                    }
                    disabled={busy || uploading}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "#1e1e1e",
                      color: "#fff",
                      border: "1px solid #444",
                      fontSize: 12,
                      width: 100,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    {segments.map((_, i) => (
                      <option key={i} value={i}>
                        구간 #{i + 1}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={() => {
                      const t = previewVideoRef.current?.currentTime ?? 0;
                      const whole = Math.floor(t);
                      const frac = clampSegmentFracMs(
                        Math.round((t - whole) * 100)
                      );
                      setSegments((prev) =>
                        prev.map((s, i) =>
                          i === selectedSegIndex
                            ? { ...s, start: secondsToHhMmSs(whole), startMs: frac }
                            : s
                        )
                      );
                    }}
                    style={{
                      background: "#1a3a2a",
                      color: "#4ade80",
                      border: "1px solid #4ade80",
                      padding: "3px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    ✂️ 시작점 설정
                  </button>

                  <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={() => {
                      const t = previewVideoRef.current?.currentTime ?? 0;
                      const whole = Math.floor(t);
                      const frac = clampSegmentFracMs(
                        Math.round((t - whole) * 100)
                      );
                      setSegments((prev) =>
                        prev.map((s, i) =>
                          i === selectedSegIndex
                            ? { ...s, end: secondsToHhMmSs(whole), endMs: frac }
                            : s
                        )
                      );
                    }}
                    style={{
                      background: "#1a2a3a",
                      color: "#60a5fa",
                      border: "1px solid #60a5fa",
                      padding: "3px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    ✂️ 종료점 설정
                  </button>

                  <span
                    style={{
                      color: "#aaa",
                      fontSize: 11,
                      marginLeft: "auto",
                    }}
                  >
                    총 {secondsToHhMmSs(segmentTotalSec)} (
                    {Math.floor(segmentTotalSec)}초)
                  </span>
                </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
              원본 업로드를 완료하면 여기에서 미리보기와 시작·종료점을 설정할 수
              있습니다.
            </p>
          )}
        </div>
        

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          height: "calc(100vh - 680px)",
          minHeight: 400,
        }}
      >
        {/* 왼쪽 컬럼 */}
        <div
          style={{
            flex: "0 0 420px",
            height: "100%",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minWidth: 0,
            paddingRight: 4,
            maxWidth: "100%",
          }}
        >
          {/* 구간 목록 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {segments.map((seg, index) => (
              <div
                key={index}
                role="presentation"
                onClick={(e) => {
                  const t = e.target;
                  if (
                    t &&
                    typeof t.closest === "function" &&
                    t.closest("button, input, select, textarea")
                  ) {
                    return;
                  }
                  selectSegment(index);
                }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "8px",
                  borderRadius: 8,
                  border:
                    selectedSegIndex === index
                      ? "2px solid #4ade80"
                      : "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.02)",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                {/* [수정1] 구간 박스 내부 가로 스크롤/슬라이더 제거 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
                    overflowX: "hidden",
                  }}
                >
                  <span
                    className="muted"
                    style={{ fontWeight: 700, flexShrink: 0 }}
                  >
                    #{index + 1}
                  </span>
                  <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekPreviewToSegmentBoundary(index, "start");
                    }}
                    style={{
                      background: "#1a3a2a",
                      border: "1px solid #4ade80",
                      color: "#4ade80",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontSize: 11,
                      cursor: "pointer",
                      flexShrink: 0,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    ▶시작
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="00:00:00"
                    value={seg.start}
                    onChange={(e) =>
                      handleTimeChange(index, "start", e.target.value)
                    }
                    disabled={busy || uploading}
                    style={{
                      padding: "4px 6px",
                      width: 62,
                      fontSize: 11,
                      boxSizing: "border-box",
                    }}
                  />
                  <span className="muted" style={{ userSelect: "none" }}>
                    .
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder=".00"
                    value={String(clampSegmentFracMs(seg.startMs ?? 0)).padStart(
                      2,
                      "0"
                    )}
                    onChange={(e) =>
                      handleFracMsChange(index, "startMs", e.target.value)
                    }
                    disabled={busy || uploading}
                    title="시작 소수 초 (0.01초 단위, 00~99)"
                    style={{
                      padding: "4px 6px",
                      width: 26,
                      fontSize: 11,
                      boxSizing: "border-box",
                    }}
                  />
                  <span className="muted" style={{ flexShrink: 0 }}>
                    ~
                  </span>
                  <button
                    type="button"
                    disabled={busy || uploading}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekPreviewToSegmentBoundary(index, "end");
                    }}
                    style={{
                      background: "#1a3a2a",
                      border: "1px solid #4ade80",
                      color: "#4ade80",
                      padding: "2px 6px",
                      borderRadius: 4,
                      fontSize: 11,
                      cursor: "pointer",
                      flexShrink: 0,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    ▶종료
                  </button>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="00:00:00"
                    value={seg.end}
                    onChange={(e) =>
                      handleTimeChange(index, "end", e.target.value)
                    }
                    disabled={busy || uploading}
                    style={{
                      padding: "4px 6px",
                      width: 62,
                      fontSize: 11,
                      boxSizing: "border-box",
                    }}
                  />
                  <span className="muted" style={{ userSelect: "none" }}>
                    .
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder=".00"
                    value={String(clampSegmentFracMs(seg.endMs ?? 0)).padStart(
                      2,
                      "0"
                    )}
                    onChange={(e) =>
                      handleFracMsChange(index, "endMs", e.target.value)
                    }
                    disabled={busy || uploading}
                    title="종료 소수 초 (0.01초 단위, 00~99)"
                    style={{
                      padding: "4px 6px",
                      width: 26,
                      fontSize: 11,
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || uploading || segments.length <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSegment(index);
                    }}
                    title="삭제"
                    style={{
                      padding: "2px 6px",
                      fontSize: 12,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    overflowX: "hidden",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="시작 -1프레임 (30fps)"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(
                          index,
                          "start",
                          -ONE_FRAME_30_FPS_SEC
                        );
                      }}
                    >
                      -1f
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="시작 -0.1초"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(index, "start", -TENTH_SEC);
                      }}
                    >
                      -0.1s
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="시작 +0.1초"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(index, "start", TENTH_SEC);
                      }}
                    >
                      +0.1s
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="시작 +1프레임 (30fps)"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(
                          index,
                          "start",
                          ONE_FRAME_30_FPS_SEC
                        );
                      }}
                    >
                      +1f
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="종료 -1프레임 (30fps)"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(
                          index,
                          "end",
                          -ONE_FRAME_30_FPS_SEC
                        );
                      }}
                    >
                      -1f
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="종료 -0.1초"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(index, "end", -TENTH_SEC);
                      }}
                    >
                      -0.1s
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="종료 +0.1초"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(index, "end", TENTH_SEC);
                      }}
                    >
                      +0.1s
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      title="종료 +1프레임 (30fps)"
                      style={{
                        ...SEGMENT_NUDGE_BTN_STYLE,
                        ...(busy || uploading
                          ? { opacity: 0.45, cursor: "not-allowed" }
                          : {}),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustSegmentFieldTime(
                          index,
                          "end",
                          ONE_FRAME_30_FPS_SEC
                        );
                      }}
                    >
                      +1f
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 구간 추가 버튼 */}
          <button
            type="button"
            onClick={addSegment}
            disabled={busy || uploading}
            style={{
              background: "#4ade80",
              color: "#000",
              fontWeight: "bold",
              padding: "6px 10px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              alignSelf: "flex-start",
              ...(busy || uploading
                ? { opacity: 0.6, cursor: "not-allowed" }
                : {}),
            }}
          >
            + 구간 추가
          </button>

          {/* 총 구간 합계 + 원본 음소거 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 6,
            }}
          >
            <span style={{ color: "#aaa", fontSize: 12, ...segmentTotalWarnStyle }}>
              총 {secondsToHhMmSs(segmentTotalSec)} ({Math.floor(segmentTotalSec)}초)
            </span>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#aaa",
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
              원본 음소거
            </label>
          </div>

          {/* 구분선 */}
          <hr style={{ borderColor: "#333", margin: "8px 0" }} />

          {/* BGM 설정 */}
          <div style={{ maxWidth: 480 }}>
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

            {/* 시작 위치 + 볼륨 (한 줄) */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <span style={{ color: "#aaa", fontSize: 11, whiteSpace: "nowrap" }}>
                시작
              </span>
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
                style={{
                  width: 50,
                  padding: "2px 4px",
                  fontSize: 11,
                  background: "#1e1e1e",
                  color: "#fff",
                  border: "1px solid #444",
                  borderRadius: 4,
                }}
              />
              <span style={{ color: "#aaa", fontSize: 11 }}>초</span>
              <span
                style={{
                  color: "#aaa",
                  fontSize: 11,
                  marginLeft: 8,
                  whiteSpace: "nowrap",
                }}
              >
                볼륨
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={bgmVolume}
                disabled={busy || uploading}
                onChange={(e) => setBgmVolume(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: "#aaa", fontSize: 11, minWidth: 30 }}>
                {Number(bgmVolume).toFixed(2)}
              </span>
            </div>

            <label className="preset-field">
              <span>끝 페이드아웃 ({bgmFadeOut.toFixed(1)}초, 0~5)</span>
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

          {/* 영상 생성 버튼 */}
          <div
            style={{
              marginTop: 8,
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

        {/* 오른쪽 컬럼 */}
        <div
          style={{
            flex: 1,
            height: "100%",
            overflowY: "auto",
            minWidth: 0,
            paddingLeft: 4,
          }}
        >
          <div className="label">
            구간 #{selectedSegIndex + 1} · 세부 설정
          </div>

          {/* 1번 구간일 때만 상단 제목 텍스트 설정 */}
          {selectedSegIndex === 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="label">상단 제목 텍스트</div>
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
                  gap: 12,
                  alignItems: "flex-end",
                  marginBottom: 10,
                }}
              >
                <label
                  className="preset-field"
                  style={{ flex: "1 1 200px", minWidth: 160 }}
                >
                  <span>폰트</span>
                  <select
                    value={normalizeFontSelectValue(topTextFont)}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      setTopTextFont(normalizeFontSelectValue(e.target.value))
                    }
                  >
                    {FONTS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="muted"
                  style={{
                    flex: "2 1 220px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 13,
                    fontWeight: 700,
                    minWidth: 160,
                  }}
                >
                  폰트 크기 (
                  {Math.round(
                    Math.min(200, Math.max(20, Number(topTextSize) || 72))
                  )}
                  px)
                  <input
                    type="range"
                    min={20}
                    max={200}
                    step={1}
                    value={Math.min(
                      200,
                      Math.max(20, Number(topTextSize) || 72)
                    )}
                    disabled={busy || uploading}
                    onChange={(e) => setTopTextSize(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <div
                  className="muted"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    flex: "1 1 200px",
                    minWidth: 0,
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
                    flex: "1 1 200px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 13,
                    fontWeight: 700,
                    minWidth: 160,
                  }}
                >
                  투명도 ({Math.round(roundOpacity01(topTextOpacity) * 100)}%)
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={roundOpacity01(topTextOpacity)}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      setTopTextOpacity(roundOpacity01(e.target.value))
                    }
                    style={{ width: "100%" }}
                  />
                </label>
              </div>
            </div>
          )}

          {segments.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              구간을 추가하면 여기에서 크롭·자막을 설정합니다.
            </p>
          ) : (
            (() => {
              const seg = segments[selectedSegIndex];
              if (!seg) {
                return (
                  <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                    구간을 선택할 수 없습니다.
                  </p>
                );
              }
              const index = selectedSegIndex;
              return (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginTop: 10,
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.02)",
                    padding: "12px 14px",
                  }}
                >
                  {/* 크롭 오프셋 */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="muted"
                      style={{ fontSize: 12, fontWeight: 700, flexShrink: 0 }}
                    >
                      크롭 오프셋
                    </span>
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
                      style={{ flex: 1, minWidth: 120 }}
                    />
                    <span
                      className="muted"
                      style={{ fontSize: 12, whiteSpace: "nowrap" }}
                    >
                      {formatCropOffsetLabel(seg.cropOffset ?? 0)}
                    </span>
                  </div>

                  {/* 구간 재생 버튼 */}
                  <button
                    type="button"
                    className="primary"
                    disabled={
                      busy ||
                      uploading ||
                      !previewUrl ||
                      uploadPhase !== "done" ||
                      !segmentPlaybackTimesValid(seg)
                    }
                    onClick={() => toggleSegmentPreviewPlayback(index)}
                    title={
                      previewUrl
                        ? "미리보기 영상으로 이 구간만 재생"
                        : "원본 업로드 후 사용"
                    }
                    style={{ alignSelf: "flex-start" }}
                  >
                    {playingSegmentIndex === index && !previewPlaybackPaused
                      ? "⏸ 일시정지"
                      : "▶ 구간 재생"}
                  </button>

                  {/* 하단 텍스트 입력 */}
                  <label className="preset-field" style={{ marginTop: 4 }}>
                    <span>하단 텍스트 (비우면 해당 구간 미표시)</span>
                    <input
                      type="text"
                      placeholder="구간별 자막"
                      value={seg.text ?? ""}
                      disabled={busy || uploading}
                      onChange={(e) =>
                        handleSegmentOverlayChange(
                          index,
                          "text",
                          e.target.value
                        )
                      }
                    />
                  </label>

                  {/* 폰트/색상/투명도/크기 */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      alignItems: "flex-end",
                      marginTop: 6,
                    }}
                  >
                    <label
                      className="preset-field"
                      style={{ flex: "1 1 180px", minWidth: 140 }}
                    >
                      <span>폰트</span>
                      <select
                        value={normalizeFontSelectValue(seg.textFont)}
                        disabled={busy || uploading}
                        onChange={(e) =>
                          handleSegmentOverlayChange(
                            index,
                            "textFont",
                            normalizeFontSelectValue(e.target.value)
                          )
                        }
                      >
                        {FONTS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label
                      className="muted"
                      style={{
                        flex: "2 1 200px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        minWidth: 140,
                      }}
                    >
                      폰트 크기 (
                      {Math.round(
                        Math.min(200, Math.max(20, Number(seg.textSize) || 48))
                      )}
                      px)
                      <input
                        type="range"
                        min={20}
                        max={200}
                        step={1}
                        value={Math.min(
                          200,
                          Math.max(20, Number(seg.textSize) || 48)
                        )}
                        disabled={busy || uploading}
                        onChange={(e) =>
                          handleSegmentOverlayChange(
                            index,
                            "textSize",
                            e.target.value
                          )
                        }
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      alignItems: "center",
                      marginTop: 6,
                    }}
                  >
                    <div
                      className="muted"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 700,
                        flex: "1 1 180px",
                        minWidth: 0,
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
                    <label
                      className="muted"
                      style={{
                        flex: "1 1 180px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        minWidth: 140,
                      }}
                    >
                      투명도 (
                      {Math.round(roundOpacity01(seg.textOpacity ?? 1) * 100)}%)
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.1}
                        value={roundOpacity01(seg.textOpacity ?? 1)}
                        disabled={busy || uploading}
                        onChange={(e) =>
                          handleSegmentOverlayChange(
                            index,
                            "textOpacity",
                            e.target.value
                          )
                        }
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>

                  {/* 텍스트 세로 위치 */}
                  <label
                    className="muted"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 700,
                      marginTop: 6,
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
                      style={{ width: "100%" }}
                    />
                    <span
                      className="muted"
                      style={{ fontWeight: 400, fontSize: 11 }}
                    >
                      0% = 최상단 · 100% = 최하단
                    </span>
                  </label>
                </div>
              );
            })()
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
