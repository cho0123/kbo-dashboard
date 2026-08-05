import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { postKbo } from "./api.js";
import {
  drawThumbnail,
  drawThumbnailByLayout,
  LAYOUT_TYPES,
  TEAM_COLORS,
} from "./thumbnailUtils.js";
import VideoPrep from "./VideoPrep.jsx";

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
const MAX_SEGMENTS = 20;

/** 원본 미리보기 행 고정 높이(px). 미리보기 캔버스 너비 = 높이 × 9/16 */
const PREVIEW_ROW_HEIGHT_PX = 400;
const PREVIEW_CANVAS_WIDTH_PX = Math.round((PREVIEW_ROW_HEIGHT_PX * 9) / 16);

function draftStorageKey(jobId) {
  return jobId ? `kbo_draft_${jobId}` : "";
}

/** 30fps 기준 1프레임(초) — 미세조정용 */
const ONE_FRAME_30_FPS_SEC = 1 / 30;
const TENTH_SEC = 0.1;

/** 구간 시작/종료 미세조정 버튼 (-1f / ±0.1s / +1f) */
const SEGMENT_NUDGE_BTN_STYLE = {
  background: "var(--ve-card)",
  border: "1px solid var(--ve-border)",
  color: "var(--ve-text)",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};

/** 나레이션 하단 3버튼 행 — 라이트 패널 위 가독용 (삽입 = BASE) */
const NARRATION_ROW_BTN_BASE = {
  flex: 1,
  minWidth: 0,
  padding: "8px 6px",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "inherit",
  boxSizing: "border-box",
  background: "var(--ve-card)",
  border: "1px solid var(--ve-border)",
  color: "var(--ve-text)",
  textAlign: "center",
  lineHeight: 1.25,
};

const NARRATION_ROW_BTN_TTS = {
  background: "var(--ve-accent)",
  border: "1px solid var(--ve-accent)",
  color: "var(--ve-text)",
};

const NARRATION_ROW_BTN_SEGMENT_PLAY = {
  background: "var(--ve-success)",
  border: "1px solid var(--ve-border)",
  color: "var(--ve-text)",
};

/** ElevenLabs TTS 음성 선택 */
const VOICE_OPTIONS = [
  { id: "m3gJBS8OofDJfycyA2Ip", label: "남(기본)" },
  { id: "5n5gqmaQi9Ewevrz7bOS", label: "여(차분)" },
  { id: "QPFsEL6IBxlT15xfiD6C", label: "여(발랄)" },
  { id: "iWLjl1zCuqXRkW6494ve", label: "여(아나운서)" },
  { id: "RU7aSi6lT4uQBXMLgDxK", label: "남(저음)" },
];

const DEFAULT_NARRATION_VOICE_ID = VOICE_OPTIONS[0].id;

const LOCAL_DOWNLOAD_SERVER = "http://localhost:3838";

const VIDEO_ACCEPT =
  ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo";

const EDIT_STYLE_OPTIONS = [
  { id: LAYOUT_TYPES.KBO, label: "KBO 야구" },
  { id: LAYOUT_TYPES.FULLSCREEN, label: "풀스크린" },
  { id: LAYOUT_TYPES.TOPBOTTOM, label: "상하바" },
];

const DEFAULT_TOP_BAR_COLOR = "var(--ve-panel)";
const DEFAULT_BOTTOM_BAR_COLOR = "var(--ve-panel)";

const THUMBNAIL_TEXT_Y_DEFAULTS = {
  [LAYOUT_TYPES.KBO]: { textY1: 49, textY2: 57 },
  [LAYOUT_TYPES.FULLSCREEN]: { textY1: 75, textY2: 85 },
  [LAYOUT_TYPES.TOPBOTTOM]: { textY1: 14, textY2: 90 },
};

function thumbnailTextYDefaultsForLayout(layoutId) {
  return (
    THUMBNAIL_TEXT_Y_DEFAULTS[layoutId] ??
    THUMBNAIL_TEXT_Y_DEFAULTS[LAYOUT_TYPES.KBO]
  );
}

function clampThumbnailTextYPercent(raw, fallback = 85) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function clampVideoScaleY(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.min(150, Math.max(50, Math.round(n)));
}

function clampVideoOffsetY(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function previewSourceVerticalCrop(vh, scaleY, offsetY) {
  const sy = clampVideoScaleY(scaleY);
  const oy = clampVideoOffsetY(offsetY);
  let cropH = Math.round((vh * 100) / sy);
  cropH = Math.min(vh, Math.max(1, cropH));
  let cropY = Math.round((vh - cropH) * (oy / 100));
  cropY = Math.min(vh - cropH, Math.max(0, cropY));
  return { cropH, cropY };
}

function previewSourceCropX(vw, cropW, cropOffset) {
  const off = Math.max(-50, Math.min(50, Number(cropOffset) || 0));
  const cropX =
    Math.round((vw - cropW) / 2) + Math.round((off / 100) * vw);
  return Math.max(0, Math.min(vw - cropW, cropX));
}

const TEAM_LIST = [
  { id: "삼성", name: "삼성 라이온즈" },
  { id: "KIA", name: "KIA 타이거즈" },
  { id: "LG", name: "LG 트윈스" },
  { id: "두산", name: "두산 베어스" },
  { id: "KT", name: "kt wiz" },
  { id: "SSG", name: "SSG 랜더스" },
  { id: "롯데", name: "롯데 자이언츠" },
  { id: "한화", name: "한화 이글스" },
  { id: "NC", name: "NC 다이노스" },
  { id: "키움", name: "키움 히어로즈" },
];

const TEAM_CONFIGS = {
  KIA: { bg: "#EA0029", accent: "#FFFFFF", label: "KIA 타이거즈" },
  삼성: { bg: "#0055A4", accent: "#C0C0C0", label: "삼성 라이온즈" },
  LG: { bg: "#C30452", accent: "#FFFFFF", label: "LG 트윈스" },
  두산: { bg: "#131230", accent: "#FFFFFF", label: "두산 베어스" },
  KT: { bg: "#000000", accent: "#EB1C24", label: "kt wiz" },
  SSG: { bg: "#CE0E2D", accent: "#FFD700", label: "SSG 랜더스" },
  롯데: { bg: "#041E42", accent: "#EB1C24", label: "롯데 자이언츠" },
  한화: { bg: "#FF6600", accent: "#FFFFFF", label: "한화 이글스" },
  NC: { bg: "#071D5B", accent: "#BFA141", label: "NC 다이노스" },
  키움: { bg: "#570514", accent: "#FFFFFF", label: "키움 히어로즈" },
};

const TEAM_LOGO_PATH = {
  KIA: "/logos/kia.svg",
  삼성: "/logos/samsung.svg",
  LG: "/logos/lg.svg",
  두산: "/logos/doosan.svg",
  KT: "/logos/kt.svg",
  SSG: "/logos/ssg.svg",
  롯데: "/logos/lotte.svg",
  한화: "/logos/hanwha.svg",
  NC: "/logos/nc.svg",
  키움: "/logos/kiwoom.svg",
};

const TEAM_LABELS = Object.fromEntries(
  Object.entries(TEAM_CONFIGS).map(([k, v]) => [k, v.label])
);

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
  { label: "감자꽃", value: "GamjaFlower-Regular" },
];

const DEFAULT_TEXT_FONT = "NotoSansKR-Bold.ttf";

const ensureTtf = (f) => {
  const s = String(f || "").trim();
  if (!s) return "NotoSansKR-Bold.ttf";
  return /\.(ttf|otf)$/i.test(s) ? s : s + ".ttf";
};

/** Lambda TTF 파일명 → 미리보기 CSS font-family (Google / 시스템 글꼴에 대응) */
function previewFontFamily(fontFile) {
  const f = String(fontFile || "").trim();
  if (/blackhansans/i.test(f)) return '"Black Han Sans", sans-serif';
  if (/notoserifkr/i.test(f)) return '"Noto Serif KR", "Noto Serif", serif';
  if (/gamjaflower/i.test(f)) return '"Gamja Flower", cursive';
  return '"Noto Sans KR", "Noto Sans", sans-serif';
}

function newSegmentId() {
  try {
    return globalThis.crypto?.randomUUID?.() || `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeFontSelectValue(v) {
  const s = String(v ?? "").trim();
  return FONTS.some((f) => f.value === s) ? s : DEFAULT_TEXT_FONT;
}

const TIMELINE_SEGMENT_COLORS = [
  "var(--ve-success)",
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
  const normalized = normalizeHexColorInput(value, TEXT_COLORS[0]);
  const [hexInput, setHexInput] = useState(normalized);

  useEffect(() => {
    setHexInput(normalized);
  }, [normalized]);

  const handleHexInputChange = (e) => {
    const raw = e.target.value;
    setHexInput(raw);
    const s = raw.trim();
    if (/^#[0-9A-Fa-f]{6}$/i.test(s)) {
      onChange(s.toLowerCase());
    }
  };

  const handleHexInputBlur = () => {
    setHexInput(normalized);
  };

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
      <input
        type="color"
        value={normalized}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title="색상 직접 선택"
        style={{
          width: 36,
          height: 28,
          padding: 0,
          border: "1px solid var(--ve-border)",
          borderRadius: 6,
          background: "transparent",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          flexShrink: 0,
        }}
      />
      <input
        type="text"
        value={hexInput}
        disabled={disabled}
        placeholder="#ffffff"
        spellCheck={false}
        onChange={handleHexInputChange}
        onBlur={handleHexInputBlur}
        title="색상 코드 (#RRGGBB)"
        style={{
          width: 76,
          padding: "4px 6px",
          fontSize: 12,
          fontFamily: "monospace",
          boxSizing: "border-box",
          background: "var(--ve-panel)",
          color: "var(--ve-text)",
          border: "1px solid var(--ve-border)",
          borderRadius: 6,
          opacity: disabled ? 0.55 : 1,
          flexShrink: 0,
        }}
      />
    </div>
  );
}

function normalizeHexColorInput(raw, fallback) {
  const s = String(raw || "").trim();
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return fallback;
}

function isImageSegment(seg) {
  return seg?.type === "image";
}

function clampImageDurationSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.min(10, Math.max(0.5, Math.round(n * 10) / 10));
}

function imageSegmentIsValid(seg) {
  if (!isImageSegment(seg)) return false;
  if (seg.imageLocalFile) return true;
  return Boolean(String(seg.imageS3Key || "").trim());
}

async function uploadHighlightImageViaKbo(jobId, file) {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId가 없습니다.");
  if (!file) throw new Error("이미지 파일이 없습니다.");

  const prep = await postKbo({
    action: "highlight_image_upload_url",
    jobId: id,
    contentType: file.type || "image/jpeg",
    filename: file.name || "image.jpg",
  });
  const putUrl = prep?.putUrl;
  const s3Key = prep?.s3Key;
  if (!putUrl || !s3Key) {
    throw new Error("highlight_image_upload_url 응답 오류");
  }
  const putRes = await fetch(putUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "image/jpeg" },
  });
  if (!putRes.ok) {
    throw new Error(`S3 이미지 업로드 실패 HTTP ${putRes.status}`);
  }
  return { ok: true, s3Key, url: prep.url || putUrl };
}

async function uploadHighlightImage(jobId, file) {
  const id = String(jobId || "").trim();
  if (!id) throw new Error("jobId가 없습니다.");
  if (!file) throw new Error("이미지 파일이 없습니다.");

  const fd = new FormData();
  fd.append("image", file);
  fd.append("jobId", id);
  const res = await fetch(`${LOCAL_DOWNLOAD_SERVER}/upload-image`, {
    method: "POST",
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.ok) {
    return data;
  }
  if (res.status === 404) {
    return uploadHighlightImageViaKbo(id, file);
  }
  throw new Error(data?.error || `이미지 업로드 실패 HTTP ${res.status}`);
}

/** 전체 재생 미리보기용 이미지 URL (blob 미리보기 또는 로컬 파일) */
function resolveImageSegmentPreviewUrl(seg) {
  const preview = String(seg?.imagePreviewUrl || "").trim();
  if (preview) return { url: preview, revoke: false };
  if (seg?.imageLocalFile instanceof Blob) {
    return { url: URL.createObjectURL(seg.imageLocalFile), revoke: true };
  }
  return { url: "", revoke: false };
}

function emptySegment() {
  return {
    id: newSegmentId(),
    start: "",
    end: "",
    startMs: 0,
    endMs: 0,
    cropOffset: 0,
    text: "",
    textShadow: false,
    textY: 85,
    textColor: TEXT_COLORS[0],
    textOpacity: 1,
    textSize: 48,
    textFont: DEFAULT_TEXT_FONT,
    text2: "",
    textShadow2: false,
    textY2: 85,
    textColor2: TEXT_COLORS[0],
    textOpacity2: 1,
    textSize2: 48,
    textFont2: DEFAULT_TEXT_FONT,
    narration: "",
    narrationDuration: null,
    narrationAudioUrl: null,
  };
}

function emptyImageSegment() {
  return {
    id: newSegmentId(),
    type: "image",
    imageS3Key: "",
    imageLocalFile: null,
    imagePreviewUrl: "",
    duration: 3,
    cropOffset: 0,
    text: "",
    text2: "",
    textY: 85,
    textY2: 75,
    textColor: TEXT_COLORS[0],
    textColor2: TEXT_COLORS[0],
    textSize: 88,
    textSize2: 60,
    textFont: DEFAULT_TEXT_FONT,
    textFont2: DEFAULT_TEXT_FONT,
    textShadow: true,
    textShadow2: true,
    textOpacity: 1,
    textOpacity2: 1,
    narration: "",
    narrationDuration: null,
    narrationAudioUrl: null,
  };
}

function normalizeCoverBoxForPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const clampP = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : d;
  };
  return {
    enabled: Boolean(src.enabled),
    x: clampP(src.x, 0),
    y: clampP(src.y, 50),
    width: clampP(src.width, 100),
    height: clampP(src.height, 10),
  };
}

/** 썸네일 구간 패널 초기값 (endMs 10 = 0.1초, Lambda 최소 구간) */
const INITIAL_THUMBNAIL_SEGMENT = {
  start: "00:00:00",
  end: "00:00:00",
  startMs: 0,
  endMs: 10,
  text1: "",
  text2: "",
  showLine: false,
  cropOffset: 0,
  font1: ensureTtf("NotoSansKR-Bold"),
  font2: ensureTtf("NotoSansKR-Bold"),
  textColor1: "#FFFFFF",
  textColor2: "#FFFFFF",
  fontSize1: 88,
  fontSize2: 52,
  textY1: 49,
  textY2: 57,
  keepText1: false,
  keepText2: false,
  narration: "",
  narrationDuration: null,
  narrationAudioUrl: null,
};

/** HH:MM:SS + startMs/endMs(0~99) → 초; 실패 시 null */
function segmentBoundaryToSeconds(hmsRaw, fracMs) {
  return parseHhMmSsToSeconds(hmsRaw, fracMs);
}

/** 구간(또는 썸네일) 시작~끝 길이(초); 경계가 유효하지 않으면 null */
function segmentDurationSpanSeconds(seg) {
  const st = String(seg?.start ?? "").trim();
  const en = String(seg?.end ?? "").trim();
  const a = segmentBoundaryToSeconds(st, seg?.startMs);
  const b = segmentBoundaryToSeconds(en, seg?.endMs);
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  if (b <= a) return null;
  return b - a;
}

/** 미리듣기 후 표시용 한 줄; narrationDuration 없으면 null */
function narrationLengthLineModel(narrationDurationSec, seg) {
  if (narrationDurationSec == null) return null;
  const nd = Number(narrationDurationSec);
  if (!Number.isFinite(nd) || nd < 0) return null;
  const span = segmentDurationSpanSeconds(seg);
  const narrStr = `${nd.toFixed(1)}초`;
  const segStr = span != null ? `${span.toFixed(1)}초` : null;
  const text =
    segStr != null
      ? `나레이션: ${narrStr} | 구간: ${segStr}`
      : `나레이션: ${narrStr}`;
  const warn = span != null && nd > span;
  return { text, warn };
}

function formatCropOffsetLabel(offset) {
  const n = Math.round(Number(offset) || 0);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

/** 전체 재생 타임라인에서 구간 길이(초); 유효하지 않으면 null */
function playAllSegmentDurationSec(seg) {
  if (isImageSegment(seg)) {
    if (!imageSegmentIsValid(seg)) return null;
    return clampImageDurationSec(seg.duration);
  }
  return segmentDurationSpanSeconds(seg);
}

/**
 * 미리보기 currentTime(초)이 [start, end]에 들어가는 첫 구간; 없으면 null
 * @param {boolean} playAllTimeline true면 전체 재생 가상 타임라인(영상=end-start, 이미지=duration)
 */
function findSegmentAtPreviewTime(ct, segments, playAllTimeline = false) {
  if (!Array.isArray(segments)) return null;
  const t = Number(ct);
  if (!Number.isFinite(t)) return null;
  if (playAllTimeline) {
    let cursor = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const dur = playAllSegmentDurationSec(seg);
      if (dur == null || dur <= 0) continue;
      if (t >= cursor && t < cursor + dur) return seg;
      cursor += dur;
    }
    return null;
  }
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
 * video.offsetWidth / offsetHeight 기준 세로형 크롭 비율(1080:1640) 박스(오버레이 좌표, px).
 * cropWidth = displayHeight * 1080/1640,
 * cropX = (displayWidth - cropWidth)/2 + displayWidth * offset/100 (클램프)
 */
function computePreviewCropOverlay(videoEl, cropOffsetPct) {
  if (!videoEl) return null;
  const dispW = videoEl.offsetWidth;
  const dispH = videoEl.offsetHeight;
  if (dispW < 2 || dispH < 2) return null;

  const pct = Math.min(50, Math.max(-50, Number(cropOffsetPct) || 0));
  let cropW = dispH * (1080 / 1640);
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

/** Whisper 구간 목록 표시용 (MM:SS) */
function formatTimestampSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return "0:00";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function mapApiSegmentToPanelSegment(seg) {
  const st = Number(seg?.start ?? 0);
  const en = Number(seg?.end ?? 0);
  const startSec = Number.isFinite(st) ? Math.max(0, st) : 0;
  const endSec = Number.isFinite(en) ? Math.max(0, en) : 0;
  const startWhole = Math.floor(startSec + 1e-9);
  const endWhole = Math.floor(endSec + 1e-9);
  const startMs = clampSegmentFracMs(
    Math.round((startSec - startWhole) * 100)
  );
  const endMs = clampSegmentFracMs(Math.round((endSec - endWhole) * 100));
  return {
    ...emptySegment(),
    start: secondsToHhMmSs(startWhole),
    startMs,
    end: secondsToHhMmSs(endWhole),
    endMs,
    text: String(seg?.text || "").slice(0, 20) || "",
  };
}

function copyTimestampLine(text) {
  const s = String(text ?? "");
  if (!s || !navigator.clipboard?.writeText) return;
  void navigator.clipboard.writeText(s);
}

const accordionHeaderStyle = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--ve-border)",
  background: "var(--ve-panel)",
  cursor: "pointer",
  fontWeight: 500,
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: 14,
  color: "inherit",
};

const accordionBodyStyle = {
  marginTop: 10,
  paddingLeft: 2,
  paddingRight: 2,
};

export default function Shorts3Panel({
  pendingSegments,
  onPendingSegmentsUsed,
  onJobIdChange,
}) {
  const [segments, setSegments] = useState([emptySegment()]);
  const segmentsRef = useRef(segments);
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
  const [panelOpen, setPanelOpen] = useState({
    download: false,
    videoPrep: false,
    upload: false,
    saved: true,
    whisper: false,
  });
  const togglePanel = (key) =>
    setPanelOpen((v) => ({ ...v, [key]: !v[key] }));
  // 1~4단계(소스 준비) 아코디언을 오버레이 드로어로 분리 — 편집기 하단 공간 확보. 기본 닫힘.
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  // 편집 단축키 도움말 오버레이 (드로어와 동일 패턴). 기본 닫힘.
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  // 미리보기 영상 표시 영역(400px) 접기 — FHD 등 낮은 화면에서 편집기 세로 공간 확보. 기본 펼침.
  const [previewCollapsed, setPreviewCollapsed] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem("kbo_ui_preview_collapsed") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem("kbo_ui_preview_collapsed", previewCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [previewCollapsed]);
  const [whisperData, setWhisperData] = useState(null);
  const [selectedTimestamps, setSelectedTimestamps] = useState({});
  const [previewUrl, setPreviewUrl] = useState(null);
  /** 구간 카드 선택 → 오른쪽 세부 설정 */
  const [selectedSegIndex, setSelectedSegIndex] = useState(0);
  const [narrationBusy, setNarrationBusy] = useState(false);
  const narrationAudioRef = useRef(null);
  /** 구간 미리보기 재생 시 나레이션(미리듣기 저장 URL) */
  const segmentPreviewNarrationAudioRef = useRef(null);
  const segmentNarrationStartTimeoutRef = useRef(null);
  /** 구간 미리보기 전 `video.muted` (미저장 시 undefined) */
  const savedVideoMutedForSegmentPreviewRef = useRef(undefined);
  const [thumbnailSegment, setThumbnailSegment] = useState(() => ({
    ...INITIAL_THUMBNAIL_SEGMENT,
  }));
  const [thumbnailEnabled, setThumbnailEnabled] = useState(true);
  const [thumbnailSelected, setThumbnailSelected] = useState(true);
  const thumbnailSegmentRef = useRef(thumbnailSegment);
  const previewVideoRef = useRef(null);
  const previewVideoWrapRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const previewRafIdRef = useRef(null);
  const teamLogoImgRef = useRef({});
  /** 미리보기 래퍼와 동일 너비로 타임라인 바 맞춤 */

  useEffect(() => {
    if (!Array.isArray(pendingSegments) || pendingSegments.length < 1) return;
    const newSegs = pendingSegments.map((seg) => {
      const st = Number(seg?.start ?? 0);
      const en = Number(seg?.end ?? 0);
      const startSec = Number.isFinite(st) ? Math.max(0, st) : 0;
      const endSec = Number.isFinite(en) ? Math.max(0, en) : 0;
      const startWhole = Math.floor(startSec + 1e-9);
      const endWhole = Math.floor(endSec + 1e-9);
      const startMs = clampSegmentFracMs(
        Math.round((startSec - startWhole) * 100)
      );
      const endMs = clampSegmentFracMs(Math.round((endSec - endWhole) * 100));
      return {
        ...emptySegment(),
        start: secondsToHhMmSs(startWhole),
        startMs,
        end: secondsToHhMmSs(endWhole),
        endMs,
        text: String(seg?.text || "").slice(0, 20) || "",
      };
    });
    setSegments((prev) => [...prev, ...newSegs]);
    onPendingSegmentsUsed?.();
  }, [pendingSegments, onPendingSegmentsUsed]);

  useEffect(() => {
    thumbnailSegmentRef.current = thumbnailSegment;
  }, [thumbnailSegment]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    if (uploadPhase !== "done") return;
    setPanelOpen((v) => ({ ...v, upload: false, saved: true }));
  }, [uploadPhase]);

  const [previewWrapWidthPx, setPreviewWrapWidthPx] = useState(null);
  const [previewCropOverlay, setPreviewCropOverlay] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [layout, setLayout] = useState(LAYOUT_TYPES.KBO);
  const [videoScaleY, setVideoScaleY] = useState(100);
  const [videoOffsetY, setVideoOffsetY] = useState(50);
  const [savedThumbUrl, setSavedThumbUrl] = useState(null);
  /** loading | ready | missing */
  const [savedThumbStatus, setSavedThumbStatus] = useState("loading");

  const loadSavedThumbnail = useCallback(async () => {
    setSavedThumbStatus("loading");
    setSavedThumbUrl(null);
    try {
      const res = await postKbo({ action: "thumbnail_preview_url" });
      const dataUri = res?.previewBase64
        ? String(res.previewBase64).trim()
        : "";
      if (!dataUri) {
        setSavedThumbStatus("missing");
        return;
      }
      setSavedThumbUrl(dataUri);
      setSavedThumbStatus("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("저장된 썸네일 없음")) {
        setSavedThumbStatus("missing");
      } else {
        console.warn("[Shorts3Panel] saved thumbnail preview", e);
        setSavedThumbStatus("missing");
      }
    }
  }, []);

  useEffect(() => {
    loadSavedThumbnail();
  }, [loadSavedThumbnail]);

  const [topBarColor, setTopBarColor] = useState(DEFAULT_TOP_BAR_COLOR);
  const [bottomBarColor, setBottomBarColor] = useState(DEFAULT_BOTTOM_BAR_COLOR);
  const [selectedTeam, setSelectedTeam] = useState("삼성");
  const [teamColor, setTeamColor] = useState(
    TEAM_CONFIGS["삼성"]?.bg || "#0055A4"
  );
  /** 미리보기 하단 자막용 재생 시각(원본 영상 currentTime) */
  const [previewPlayheadSec, setPreviewPlayheadSec] = useState(0);

  const [muteOriginal, setMuteOriginal] = useState(true);
  const [musicTracks, setMusicTracks] = useState([]);
  const [highlightMusicS3Key, setHighlightMusicS3Key] = useState("");
  const [coverBox, setCoverBox] = useState({
    enabled: false,
    x: 0,
    y: 50,
    width: 100,
    height: 10,
  });
  const [bgmVolume, setBgmVolume] = useState(0.8);
  const [bgmStartTime, setBgmStartTime] = useState(0);
  const [bgmFadeOut, setBgmFadeOut] = useState(2);

  const [narrationVoiceId, setNarrationVoiceId] = useState(DEFAULT_NARRATION_VOICE_ID);
  const [narrationSpeed, setNarrationSpeed] = useState(1.0);
  const [narrationStability, setNarrationStability] = useState(0.5);
  const [narrationStyle, setNarrationStyle] = useState(0.3);

  const [topText, setTopText] = useState("");
  const [topTextColor, setTopTextColor] = useState(TEXT_COLORS[0]);
  const [topTextSize, setTopTextSize] = useState(72);
  const [topTextOpacity, setTopTextOpacity] = useState(1);
  const [topTextFont, setTopTextFont] = useState(DEFAULT_TEXT_FONT);
  const [topTextShadow, setTopTextShadow] = useState(false);

  const [savedFiles, setSavedFiles] = useState([]);
  const [savedFilesLoading, setSavedFilesLoading] = useState(false);
  const [savedFilesError, setSavedFilesError] = useState(null);

  const [localServerOk, setLocalServerOk] = useState(null);
  const [localYtdlpUrl, setLocalYtdlpUrl] = useState("");
  const [localDownloadBusy, setLocalDownloadBusy] = useState(false);

  useEffect(() => {
    onJobIdChange?.(jobId || "");
  }, [jobId, onJobIdChange]);

  /** 불러오기 직후 잘못된 키로 덮어쓰기 방지 */
  const restoringDraftRef = useRef(false);
  const [draftSaveGeneration, setDraftSaveGeneration] = useState(0);

  useEffect(() => {
    if (!jobId || typeof localStorage === "undefined") return;
    if (restoringDraftRef.current) return;
    try {
      const payload = {
        segments,
        thumbnailSegment,
        topText,
        topTextColor,
        topTextSize,
        topTextFont,
        topTextShadow,
        topTextOpacity,
        muteOriginal,
        bgmVolume,
        bgmStartTime,
        bgmFadeOut,
        highlightMusicS3Key,
        selectedTeam,
        narrationVoiceId,
        narrationSpeed,
        narrationStability,
        narrationStyle,
        coverBox,
      };
      localStorage.setItem(draftStorageKey(jobId), JSON.stringify(payload));
    } catch (e) {
      console.warn("[kbo draft save]", e);
    }
  }, [
    jobId,
    segments,
    thumbnailSegment,
    topText,
    topTextColor,
    topTextSize,
    topTextFont,
    topTextShadow,
    topTextOpacity,
    muteOriginal,
    bgmVolume,
    bgmStartTime,
    bgmFadeOut,
    highlightMusicS3Key,
    selectedTeam,
    narrationVoiceId,
    narrationSpeed,
    narrationStability,
    narrationStyle,
    coverBox,
    draftSaveGeneration,
  ]);

  /** 원본 미리보기 영상만 구간 끝에서 멈춤 */
  const playingSegmentIndexRef = useRef(null);
  const [playingSegmentIndex, setPlayingSegmentIndex] = useState(null);
  useEffect(() => {
    playingSegmentIndexRef.current = playingSegmentIndex;
  }, [playingSegmentIndex]);
  const [previewPlaybackPaused, setPreviewPlaybackPaused] = useState(true);

  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllActiveImageUrl, setPlayAllActiveImageUrl] = useState(null);
  const [playAllVirtualSec, setPlayAllVirtualSec] = useState(0);
  const playAllRef = useRef(false);
  const playAllImageRafRef = useRef(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const monitorRef = useRef(false);

  const thumbnailOverlayCanvasRef = useRef(null);

  const showRightImageSegmentPreview = useMemo(() => {
    if (thumbnailSelected) return false;
    const seg = segments[selectedSegIndex];
    if (!seg || !isImageSegment(seg)) return false;
    return Boolean(String(seg.imagePreviewUrl || "").trim());
  }, [segments, selectedSegIndex, thumbnailSelected]);

  const rightImageSegmentPreviewUrl = useMemo(() => {
    if (!showRightImageSegmentPreview) return "";
    return String(segments[selectedSegIndex]?.imagePreviewUrl || "").trim();
  }, [showRightImageSegmentPreview, segments, selectedSegIndex]);

  const selectedImageCropOffset = (() => {
    const raw = segments[selectedSegIndex]?.cropOffset;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  })();

  const rightImagePreviewObjectPosition = (() => {
    if (!showRightImageSegmentPreview) return "50% center";
    const clamped = Math.min(50, Math.max(-50, selectedImageCropOffset));
    return `${50 + clamped * 0.5}% center`;
  })();

  const busy = status === "encoding";
  const uploading = uploadPhase === "uploading";

  const renderPreviewFrame = useCallback(() => {
    const video = previewVideoRef.current;
    const canvas = previewCanvasRef.current;
    if (!canvas || !video) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      requestAnimationFrame(renderPreviewFrame);
      return;
    }

    const W = 160;
    const H = 284;
    canvas.width = W;
    canvas.height = H;
    const cw = W;
    const ch = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { cropH: srcCropH, cropY: srcCropY } = previewSourceVerticalCrop(
      vh,
      videoScaleY,
      videoOffsetY
    );

    const previewTextYFromPercent = (pct, kboHole) => {
      const p = Math.min(100, Math.max(0, Number(pct)));
      if (kboHole) {
        const topBar = Math.round(ch * (280 / 1920));
        const botBar = Math.round(ch * (160 / 1920));
        const holeH = ch - topBar - botBar;
        return topBar + (holeH * p) / 100;
      }
      return ch * (p / 100);
    };

    const drawPreviewBottomTexts = (selectedSeg, { kboHole = false } = {}) => {
      const t1 = String(selectedSeg?.text ?? "").trim();
      const t2 = String(selectedSeg?.text2 ?? "").trim();
      const fs1 = Math.max(
        8,
        Math.round(((Number(selectedSeg?.textSize) || 48) * ch) / 1920)
      );
      const fs2 = Math.max(
        8,
        Math.round(((Number(selectedSeg?.textSize2) || 48) * ch) / 1920)
      );
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (t1) {
        const textYPos = previewTextYFromPercent(
          Number(selectedSeg.textY ?? 85),
          kboHole
        );
        ctx.font = `bold ${fs1}px sans-serif`;
        ctx.fillStyle = hexToRgba(
          /^#[0-9A-Fa-f]{6}$/i.test(String(selectedSeg.textColor || "").trim())
            ? selectedSeg.textColor
            : TEXT_COLORS[0],
          roundOpacity01(selectedSeg.textOpacity ?? 1)
        );
        ctx.fillText(t1, cw / 2, textYPos);
      }
      if (t2) {
        const textY2Pos = previewTextYFromPercent(
          Number(selectedSeg.textY2 ?? 85),
          kboHole
        );
        ctx.font = `bold ${fs2}px sans-serif`;
        ctx.fillStyle = hexToRgba(
          /^#[0-9A-Fa-f]{6}$/i.test(String(selectedSeg.textColor2 || "").trim())
            ? selectedSeg.textColor2
            : TEXT_COLORS[0],
          roundOpacity01(selectedSeg.textOpacity2 ?? 1)
        );
        ctx.fillText(t2, cw / 2, textY2Pos);
      }
    };

    const drawThumbnailOverlayPreview = () => {
      const overlayCanvas = thumbnailOverlayCanvasRef.current;
      if (overlayCanvas) {
        ctx.drawImage(overlayCanvas, 0, 0, W, H);
      }
    };

    const drawPreviewThumbnailTexts = () => {
      const thumb = thumbnailSegmentRef.current;
      const yDef = thumbnailTextYDefaultsForLayout(layout);
      const kboHole = layout === LAYOUT_TYPES.KBO;
      drawPreviewBottomTexts(
        {
          text: thumb?.text1 ?? "",
          text2: thumb?.text2 ?? "",
          textColor: thumb?.textColor1,
          textColor2: thumb?.textColor2,
          textSize: thumb?.fontSize1,
          textSize2: thumb?.fontSize2,
          textY: clampThumbnailTextYPercent(thumb?.textY1, yDef.textY1),
          textY2: clampThumbnailTextYPercent(thumb?.textY2, yDef.textY2),
        },
        { kboHole }
      );
    };

    if (layout === LAYOUT_TYPES.FULLSCREEN) {
      let srcCropW = Math.round((srcCropH * 1080) / 1920);
      if (srcCropW > vw) srcCropW = vw;
      if (thumbnailSelected) {
        const clampedSrcCropX = previewSourceCropX(
          vw,
          srcCropW,
          thumbnailSegmentRef.current?.cropOffset
        );
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(
          video,
          clampedSrcCropX,
          srcCropY,
          srcCropW,
          srcCropH,
          0,
          0,
          W,
          H
        );
        drawPreviewThumbnailTexts();
        return;
      }
      const selectedSeg = segments[selectedSegIndex];
      const clampedSrcCropX = previewSourceCropX(
        vw,
        srcCropW,
        selectedSeg?.cropOffset
      );
      const skipVideoHoleDraw =
        isImageSegment(selectedSeg) &&
        Boolean(String(selectedSeg?.imagePreviewUrl || "").trim());
      ctx.clearRect(0, 0, W, H);
      if (!skipVideoHoleDraw) {
        ctx.drawImage(
          video,
          clampedSrcCropX,
          srcCropY,
          srcCropW,
          srcCropH,
          0,
          0,
          W,
          H
        );
      }
      drawPreviewBottomTexts(selectedSeg);
      return;
    }

    if (layout === LAYOUT_TYPES.TOPBOTTOM) {
      const topBarH = Math.round((H * 400) / 1920);
      const botBarH = Math.round((H * 400) / 1920);
      const midH = H - topBarH - botBarH;
      let cropW = Math.round((srcCropH * 1080) / 1120);
      if (cropW > vw) cropW = vw;
      if (thumbnailSelected) {
        const clampedCropX = previewSourceCropX(
          vw,
          cropW,
          thumbnailSegmentRef.current?.cropOffset
        );
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = topBarColor;
        ctx.fillRect(0, 0, W, topBarH);
        ctx.fillStyle = bottomBarColor;
        ctx.fillRect(0, H - botBarH, W, botBarH);
        ctx.drawImage(
          video,
          clampedCropX,
          srcCropY,
          cropW,
          srcCropH,
          0,
          topBarH,
          W,
          midH
        );
        drawPreviewThumbnailTexts();
        return;
      }
      const selectedSeg = segments[selectedSegIndex];
      const clampedCropX = previewSourceCropX(
        vw,
        cropW,
        selectedSeg?.cropOffset
      );
      const skipVideoHoleDraw =
        isImageSegment(selectedSeg) &&
        Boolean(String(selectedSeg?.imagePreviewUrl || "").trim());
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = topBarColor;
      ctx.fillRect(0, 0, W, topBarH);
      ctx.fillStyle = bottomBarColor;
      ctx.fillRect(0, H - botBarH, W, botBarH);
      if (!skipVideoHoleDraw) {
        ctx.drawImage(
          video,
          clampedCropX,
          srcCropY,
          cropW,
          srcCropH,
          0,
          topBarH,
          W,
          midH
        );
      }
      drawPreviewBottomTexts(selectedSeg);
      return;
    }

    const tc = TEAM_CONFIGS[selectedTeam] || TEAM_CONFIGS["삼성"];
    const bg = tc?.bg || teamColor || "#0055A4";
    const accent = tc?.accent || "#ffffff";

    const TOP_BAR = Math.round(H * (280 / 1920));
    const BOT_BAR = Math.round(H * (160 / 1920));
    const SIDE_BAR = Math.round(W * (40 / 1080));

    const srcCropW = Math.round((srcCropH * 1080) / 1640);

    // 썸네일 선택 시: 영상 프레임 먼저 그리고 썸네일 오버레이 덮기
    if (thumbnailSelected) {
      const clampedSrcCropX = previewSourceCropX(
        vw,
        srcCropW,
        thumbnailSegmentRef.current?.cropOffset
      );
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(
        video,
        clampedSrcCropX,
        srcCropY,
        srcCropW,
        srcCropH,
        0,
        TOP_BAR,
        W,
        H - TOP_BAR
      );
      drawThumbnailOverlayPreview();
      // 3) 커버박스 (일반 구간 미리보기와 동일 hole 기준)
      if (coverBox?.enabled) {
        const holeX = SIDE_BAR;
        const holeY = TOP_BAR;
        const holeW = W - 2 * SIDE_BAR;
        const holeH = H - TOP_BAR - BOT_BAR;
        const xp = Math.min(100, Math.max(0, Number(coverBox.x) || 0)) / 100;
        const yp = Math.min(100, Math.max(0, Number(coverBox.y) || 0)) / 100;
        const wp = Math.min(100, Math.max(0, Number(coverBox.width) || 0)) / 100;
        const hp = Math.min(100, Math.max(0, Number(coverBox.height) || 0)) / 100;
        if (wp > 0 && hp > 0) {
          ctx.fillStyle = bg;
          ctx.fillRect(
            holeX + xp * holeW,
            holeY + yp * holeH,
            wp * holeW,
            hp * holeH
          );
        }
      }
      drawPreviewThumbnailTexts();
      return;
    }

    const selectedSeg = segments[selectedSegIndex];
    const clampedSrcCropX = previewSourceCropX(
      vw,
      srcCropW,
      selectedSeg?.cropOffset
    );

    const skipVideoHoleDraw =
      isImageSegment(selectedSeg) &&
      Boolean(String(selectedSeg?.imagePreviewUrl || "").trim());
    ctx.clearRect(0, 0, W, H);
    if (skipVideoHoleDraw) {
      ctx.clearRect(0, 0, W, H);
    }
    if (!skipVideoHoleDraw) {
      ctx.drawImage(
        video,
        clampedSrcCropX,
        srcCropY,
        srcCropW,
        srcCropH,
        0,
        TOP_BAR,
        W,
        H - TOP_BAR
      );
    }

    // 2) 팀컬러 상단바
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, TOP_BAR);

    // 3) 하단바
    ctx.fillStyle = bg;
    ctx.fillRect(0, H - BOT_BAR, W, BOT_BAR);

    // 4) 좌우 사이드바 (팀 테두리)
    if (layout === LAYOUT_TYPES.KBO) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, TOP_BAR, SIDE_BAR, H - TOP_BAR - BOT_BAR);
      ctx.fillRect(W - SIDE_BAR, TOP_BAR, SIDE_BAR, H - TOP_BAR - BOT_BAR);
    }

    // 4b) 커버박스 (팀컬러, hole = 좌우 사이드 제외·상하단 제외 영역 기준 %)
    const cbRaw = coverBox;
    if (cbRaw?.enabled) {
      const holeX = SIDE_BAR;
      const holeY = TOP_BAR;
      const holeW = W - 2 * SIDE_BAR;
      const holeH = H - TOP_BAR - BOT_BAR;
      const xp = Math.min(100, Math.max(0, Number(cbRaw.x) || 0)) / 100;
      const yp = Math.min(100, Math.max(0, Number(cbRaw.y) || 0)) / 100;
      const wp = Math.min(100, Math.max(0, Number(cbRaw.width) || 0)) / 100;
      const hp = Math.min(100, Math.max(0, Number(cbRaw.height) || 0)) / 100;
      if (wp > 0 && hp > 0) {
        ctx.fillStyle = bg;
        ctx.fillRect(
          holeX + xp * holeW,
          holeY + yp * holeH,
          wp * holeW,
          hp * holeH
        );
      }
    }

    // 5) 팀명 배지 (상단 캡슐형)
    if (layout === LAYOUT_TYPES.KBO) {
      const teamLabel = TEAM_LABELS[selectedTeam] || selectedTeam;
      ctx.save();
      ctx.font = `bold ${Math.round(W * 0.1)}px "Noto Sans KR", system-ui, sans-serif`;
      const labelW =
        ctx.measureText(teamLabel).width + Math.round(W * 0.3);
      const labelH = Math.round(W * 0.15);
      const labelX = W / 2 - labelW / 2;
      const labelY = Math.round(H * 0.04);
      const labelR = labelH / 2;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, labelW, labelH, labelR);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(teamLabel, W / 2, labelY + labelH / 2);
      ctx.restore();
    }

    // 6) 팀 로고 (하단 좌측) — 캐시 로드
    if (layout === LAYOUT_TYPES.KBO) {
      const logoSrc = TEAM_LOGO_PATH[selectedTeam];
      if (logoSrc) {
        const existing = teamLogoImgRef.current[selectedTeam];
        if (existing == null) {
          const img = new Image();
          img.onload = () => {
            teamLogoImgRef.current[selectedTeam] = img;
          };
          img.onerror = () => {
            teamLogoImgRef.current[selectedTeam] = false;
          };
          img.src = logoSrc;
          teamLogoImgRef.current[selectedTeam] = false;
        } else if (existing && existing !== false) {
          const img = existing;
          const LOGO_MAX = Math.round(W * (160 / 1080));
          const nw = img.naturalWidth || img.width || 1;
          const nh = img.naturalHeight || img.height || 1;
          const scale = Math.min(LOGO_MAX / nw, LOGO_MAX / nh);
          const logoW = nw * scale;
          const logoH = nh * scale;
          const logoX = SIDE_BAR - Math.round(W * 0.009);
          const logoY = H - BOT_BAR - LOGO_MAX * 0.4;
          ctx.drawImage(img, logoX, logoY, logoW, logoH);
        }
      }
    }

    // 하단 텍스트 (선택된 구간 · 텍스트 1 / 2)
    const t1 = String(selectedSeg?.text ?? "").trim();
    const t2 = String(selectedSeg?.text2 ?? "").trim();
    const fs1 = Math.max(
      8,
      Math.round(((Number(selectedSeg?.textSize) || 48) * ch) / 1920)
    );
    const fs2 = Math.max(
      8,
      Math.round(((Number(selectedSeg?.textSize2) || 48) * ch) / 1920)
    );
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (t1) {
      const textYPos = ch * (Number(selectedSeg.textY ?? 85) / 100);
      ctx.font = `bold ${fs1}px sans-serif`;
      ctx.fillStyle = hexToRgba(
        /^#[0-9A-Fa-f]{6}$/i.test(String(selectedSeg.textColor || "").trim())
          ? selectedSeg.textColor
          : TEXT_COLORS[0],
        roundOpacity01(selectedSeg.textOpacity ?? 1)
      );
      ctx.fillText(t1, cw / 2, textYPos);
    }
    if (t2) {
      const textY2Pos = ch * (Number(selectedSeg.textY2 ?? 85) / 100);
      ctx.font = `bold ${fs2}px sans-serif`;
      ctx.fillStyle = hexToRgba(
        /^#[0-9A-Fa-f]{6}$/i.test(String(selectedSeg.textColor2 || "").trim())
          ? selectedSeg.textColor2
          : TEXT_COLORS[0],
        roundOpacity01(selectedSeg.textOpacity2 ?? 1)
      );
      ctx.fillText(t2, cw / 2, textY2Pos);
    }
  }, [
    segments,
    selectedSegIndex,
    selectedTeam,
    teamColor,
    thumbnailSelected,
    thumbnailSegment,
    coverBox,
    layout,
    topBarColor,
    bottomBarColor,
    videoScaleY,
    videoOffsetY,
  ]);

  useEffect(() => {
    renderPreviewFrame();
  }, [selectedSegIndex, thumbnailSelected, renderPreviewFrame]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    if (thumbnailSelected) {
      const sec = segmentBoundaryToSeconds(
        thumbnailSegment.start,
        thumbnailSegment.startMs
      );
      if (Number.isFinite(sec)) video.currentTime = sec;
    } else {
      const seg = segments[selectedSegIndex];
      if (!seg) return;
      const sec = segmentBoundaryToSeconds(seg.start, seg.startMs);
      if (Number.isFinite(sec)) video.currentTime = sec;
    }
  }, [selectedSegIndex, thumbnailSelected]);

  useEffect(() => {
    const thumbStart = segmentBoundaryToSeconds(
      thumbnailSegment.start,
      thumbnailSegment.startMs
    );
    const thumbEnd = segmentBoundaryToSeconds(
      thumbnailSegment.end,
      thumbnailSegment.endMs
    );
    const valid =
      String(thumbnailSegment.end || "").trim() !== "" &&
      Number.isFinite(thumbStart) &&
      Number.isFinite(thumbEnd) &&
      thumbEnd > thumbStart;
    if (!thumbnailSelected || !valid) {
      thumbnailOverlayCanvasRef.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const opts = {
          team: selectedTeam,
          text1: "",
          text2: "",
          font1: "NotoSansKR-Bold",
          font2: "NotoSansKR-Bold",
          textColor1: "#FFFFFF",
          textColor2: "#FFFFFF",
          fontSize1: 88,
          fontSize2: 52,
        };
        if (layout === LAYOUT_TYPES.KBO) {
          const t = TEAM_COLORS[selectedTeam];
          if (!t) return;
          opts.tc = { bg: t.bg, accent: t.accent };
        }
        if (layout === LAYOUT_TYPES.TOPBOTTOM) {
          opts.topBarColor = topBarColor;
          opts.bottomBarColor = bottomBarColor;
        }
        const overlayCanvas = await drawThumbnailByLayout(layout, opts);
        if (cancelled) return;
        thumbnailOverlayCanvasRef.current = overlayCanvas;
        renderPreviewFrame();
      } catch (e) {
        console.warn("[thumbnail preview]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    thumbnailSelected,
    thumbnailSegment,
    thumbnailSegment.textY1,
    thumbnailSegment.textY2,
    selectedTeam,
    layout,
    topBarColor,
    bottomBarColor,
    renderPreviewFrame,
  ]);

  const stopPreviewLoop = useCallback(() => {
    if (previewRafIdRef.current) {
      cancelAnimationFrame(previewRafIdRef.current);
      previewRafIdRef.current = null;
    }
  }, []);

  const startPreviewLoop = useCallback(() => {
    stopPreviewLoop();
    const step = () => {
      renderPreviewFrame();
      previewRafIdRef.current = requestAnimationFrame(step);
    };
    previewRafIdRef.current = requestAnimationFrame(step);
  }, [renderPreviewFrame, stopPreviewLoop]);

  useEffect(() => stopPreviewLoop, [stopPreviewLoop]);

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

  /** 구간 미리보기: 원본 음소거, 0.5초 후 저장된 나레이션 URL 재생, 끝에서 정리 */
  useEffect(() => {
    const v = previewVideoRef.current;
    const stopNarrationOnly = () => {
      if (segmentNarrationStartTimeoutRef.current != null) {
        clearTimeout(segmentNarrationStartTimeoutRef.current);
        segmentNarrationStartTimeoutRef.current = null;
      }
      const na = segmentPreviewNarrationAudioRef.current;
      if (na) {
        try {
          na.pause();
        } catch {
          /* ignore */
        }
        try {
          na.src = "";
        } catch {
          /* ignore */
        }
        segmentPreviewNarrationAudioRef.current = null;
      }
    };

    const restoreVideoMute = () => {
      if (v && savedVideoMutedForSegmentPreviewRef.current !== undefined) {
        v.muted = savedVideoMutedForSegmentPreviewRef.current;
        savedVideoMutedForSegmentPreviewRef.current = undefined;
      }
    };

    if (!v || !previewUrl || playingSegmentIndex == null) {
      stopNarrationOnly();
      restoreVideoMute();
      return undefined;
    }

    const idx = playingSegmentIndex;
    const seg = segmentsRef.current[idx];
    if (!seg) {
      stopNarrationOnly();
      restoreVideoMute();
      return undefined;
    }
    const st = String(seg.start ?? "").trim();
    const en = String(seg.end ?? "").trim();
    const startSec = segmentBoundaryToSeconds(st, seg.startMs);
    const endSec = segmentBoundaryToSeconds(en, seg.endMs);
    if (
      startSec == null ||
      endSec == null ||
      !Number.isFinite(endSec) ||
      endSec <= startSec
    ) {
      stopNarrationOnly();
      restoreVideoMute();
      return undefined;
    }

    if (savedVideoMutedForSegmentPreviewRef.current === undefined) {
      savedVideoMutedForSegmentPreviewRef.current = v.muted;
    }
    v.muted = true;

    const narrUrl = String(seg.narrationAudioUrl ?? "").trim();
    segmentNarrationStartTimeoutRef.current = setTimeout(() => {
      segmentNarrationStartTimeoutRef.current = null;
      if (playingSegmentIndexRef.current !== idx) return;
      if (!narrUrl) return;
      const audio = new Audio(narrUrl);
      segmentPreviewNarrationAudioRef.current = audio;
      audio.play().catch(() => {});
    }, 500);

    const onTimeUpdate = () => {
      if (v.paused) return;
      if (v.currentTime >= endSec) {
        v.pause();
        stopNarrationOnly();
        restoreVideoMute();
        setPlayingSegmentIndex(null);
      }
    };

    const onPause = () => {
      try {
        segmentPreviewNarrationAudioRef.current?.pause();
      } catch {
        /* ignore */
      }
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("pause", onPause);
      stopNarrationOnly();
    };
  }, [previewUrl, playingSegmentIndex]);

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
      if (isImageSegment(seg)) {
        if (imageSegmentIsValid(seg)) {
          sum += clampImageDurationSec(seg.duration);
        }
        continue;
      }
      const st = String(seg.start || "").trim();
      const en = String(seg.end || "").trim();
      if (!st || !en) continue;
      const a = segmentBoundaryToSeconds(st, seg.startMs);
      const b = segmentBoundaryToSeconds(en, seg.endMs);
      if (a == null || b == null) continue;
      if (b <= a) continue;
      sum += b - a;
    }
    const thumbStart = segmentBoundaryToSeconds(
      String(thumbnailSegment.start ?? "").trim(),
      thumbnailSegment.startMs
    );
    const thumbEnd = segmentBoundaryToSeconds(
      String(thumbnailSegment.end ?? "").trim(),
      thumbnailSegment.endMs
    );
    if (
      thumbStart != null &&
      thumbEnd != null &&
      Number.isFinite(thumbStart) &&
      Number.isFinite(thumbEnd) &&
      thumbEnd > thumbStart
    ) {
      sum += thumbEnd - thumbStart;
    }
    return sum;
  }, [segments, thumbnailSegment]);

  const segmentTotalWarnStyle = useMemo(() => {
    if (segmentTotalSec > 300) return { color: "var(--ve-danger)" };
    if (segmentTotalSec > 60) return { color: "var(--ve-warning)" };
    return {};
  }, [segmentTotalSec]);

  const thumbnailTimingValid = useMemo(() => {
    const thumbStart = segmentBoundaryToSeconds(
      String(thumbnailSegment.start ?? "").trim(),
      thumbnailSegment.startMs
    );
    const thumbEnd = segmentBoundaryToSeconds(
      String(thumbnailSegment.end ?? "").trim(),
      thumbnailSegment.endMs
    );
    return (
      String(thumbnailSegment.end || "").trim() !== "" &&
      thumbStart != null &&
      thumbEnd != null &&
      Number.isFinite(thumbStart) &&
      Number.isFinite(thumbEnd) &&
      thumbEnd > thumbStart
    );
  }, [thumbnailSegment]);

  const addSegment = useCallback(() => {
    setSegments((s) => {
      if (s.length >= MAX_SEGMENTS) {
        return s;
      }
      const next = [...s, emptySegment()];
      const ni = next.length - 1;
      setThumbnailSelected(false);
      setSelectedSegIndex(ni);
      return next;
    });
  }, []);

  const insertSegmentAfter = useCallback((index) => {
    setPlayingSegmentIndex((cur) => {
      if (cur == null) return cur;
      if (cur > index) return cur + 1;
      return cur;
    });
    setSegments((s) => {
      if (s.length >= MAX_SEGMENTS) return s;
      const i = Number(index);
      if (!Number.isFinite(i) || i < 0 || i >= s.length) return s;
      const next = [
        ...s.slice(0, i + 1),
        emptySegment(),
        ...s.slice(i + 1),
      ];
      setThumbnailSelected(false);
      setSelectedSegIndex(i + 1);
      return next;
    });
  }, []);

  const addImageSegment = useCallback(() => {
    setSegments((s) => {
      if (s.length >= MAX_SEGMENTS) {
        return s;
      }
      const next = [...s, emptyImageSegment()];
      const ni = next.length - 1;
      setThumbnailSelected(false);
      setSelectedSegIndex(ni);
      return next;
    });
  }, []);

  const insertImageSegmentAfter = useCallback((index) => {
    setPlayingSegmentIndex((cur) => {
      if (cur == null) return cur;
      if (cur > index) return cur + 1;
      return cur;
    });
    setSegments((s) => {
      if (s.length >= MAX_SEGMENTS) return s;
      const i = Number(index);
      if (!Number.isFinite(i) || i < 0 || i >= s.length) return s;
      const next = [
        ...s.slice(0, i + 1),
        emptyImageSegment(),
        ...s.slice(i + 1),
      ];
      setThumbnailSelected(false);
      setSelectedSegIndex(i + 1);
      return next;
    });
  }, []);

  /** 썸네일 카드: 첫 본편 구간(index 0) 앞에 빈 구간 삽입 후 선택 */
  const insertSegmentBeforeFirst = useCallback(() => {
    setPlayingSegmentIndex((cur) => {
      if (cur == null) return cur;
      return cur + 1;
    });
    setSegments((s) => {
      if (s.length >= MAX_SEGMENTS) return s;
      const next = [emptySegment(), ...s];
      setThumbnailSelected(false);
      setSelectedSegIndex(0);
      return next;
    });
  }, []);

  const appendWhisperSegmentsToEditor = useCallback((apiSegs) => {
    const mapped = apiSegs.map((seg) => mapApiSegmentToPanelSegment(seg));
    setSegments((prev) => {
      if (mapped.length === 0) {
        return prev;
      }
      const filtered = prev.filter((s) => {
        if (isImageSegment(s)) {
          const isEmpty =
            !imageSegmentIsValid(s) &&
            (!s.text || s.text.trim() === "") &&
            (!s.text2 || s.text2.trim() === "");
          return !isEmpty;
        }
        const isEmpty =
          (!s.start || s.start === "00:00:00") &&
          (!s.end || s.end === "00:00:00") &&
          (!s.text || s.text.trim() === "");
        return !isEmpty;
      });
      const room = MAX_SEGMENTS - filtered.length;
      if (room <= 0) {
        return prev;
      }
      const toAdd = mapped.slice(0, room);
      const next = [...filtered, ...toAdd];
      setSelectedSegIndex(next.length - 1);
      return next;
    });
    setSelectedTimestamps({});
  }, []);

  const deleteSelectedSegment = useCallback(() => {
    const idx = selectedSegIndex;
    setPlayingSegmentIndex((cur) =>
      cur === idx ? null : cur != null && idx < cur ? cur - 1 : cur
    );
    setSelectedSegIndex(() => Math.max(0, idx - 1));
    setSegments((s) => {
      if (s.length <= 1) {
        return s;
      }
      const filtered = s.filter((_, i) => i !== idx);
      const next =
        filtered.length === 0 ? [emptySegment()] : filtered;
      return next;
    });
  }, [selectedSegIndex]);

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
      if (!previewUrl || !v || busy || uploading || isMonitoring) return;
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
        const na = segmentPreviewNarrationAudioRef.current;
        if (na && startSec != null && v.currentTime >= startSec + 0.5) {
          const off = v.currentTime - startSec - 0.5;
          const dur = Number(na.duration);
          if (Number.isFinite(dur) && dur > 0 && off < dur) {
            na.currentTime = Math.max(0, off);
            na.play().catch(() => {});
          }
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
      isMonitoring,
      segmentPlaybackTimesValid,
    ]
  );

  useEffect(() => {
    setSelectedSegIndex((i) =>
      Math.min(i, Math.max(0, segments.length - 1))
    );
  }, [segments.length]);

  const selectSegment = useCallback((index) => {
    setThumbnailSelected(false);
    setSelectedSegIndex(index);
  }, []);

  const seekPreviewToSegmentBoundary = useCallback(
    (segIndex, field) => {
      const v = previewVideoRef.current;
      if (!v || !previewUrl) return;
      const seg = segments[segIndex];
      if (!seg) return;

      // ▶시작/▶종료 클릭 시: 해당 구간 선택 + 크롭 즉시 반영
      setSelectedSegIndex(segIndex);
      setPreviewCropOverlay(
        computePreviewCropOverlay(v, seg?.cropOffset ?? 0)
      );

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

  const segmentBoundarySeconds = useCallback((seg, field) => {
    const key = field === "start" ? "start" : "end";
    const fracKey = field === "start" ? "startMs" : "endMs";
    const t = segmentBoundaryToSeconds(
      String(seg?.[key] ?? "").trim(),
      seg?.[fracKey]
    );
    return t == null || !Number.isFinite(t) ? null : Number(t);
  }, []);

  const playAllSegments = useCallback(async () => {
    const video = previewVideoRef.current;
    if (!video || isPlayingAll || isMonitoring) return;

    const savedMuteForPlayAll = video.muted;
    setIsPlayingAll(true);
    setPlayAllActiveImageUrl(null);
    setPlayAllVirtualSec(0);
    playAllRef.current = true;
    video.muted = false;

    const playRange = (startSec, endSec, virtualBase, onVirtualProgress) =>
      new Promise((res) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          video.removeEventListener("timeupdate", check);
          res();
        };
        const check = () => {
          if (!playAllRef.current) return finish();
          const elapsed = Number(video.currentTime) - startSec;
          if (Number.isFinite(elapsed) && elapsed >= 0) {
            onVirtualProgress?.(virtualBase + elapsed);
          }
          if (video.currentTime >= endSec) return finish();
        };
        video.addEventListener("timeupdate", check);
        setPlayAllActiveImageUrl(null);
        video.play().catch(() => {});
      });

    const onVirtualProgress = (v) => {
      if (Number.isFinite(v)) setPlayAllVirtualSec(v);
    };

    const playImageCut = (seg, index, virtualBase) =>
      new Promise((res) => {
        const dur = playAllSegmentDurationSec(seg);
        const { url, revoke } = resolveImageSegmentPreviewUrl(seg);
        if (dur == null || dur <= 0 || !url) {
          res();
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (playAllImageRafRef.current != null) {
            cancelAnimationFrame(playAllImageRafRef.current);
            playAllImageRafRef.current = null;
          }
          setPlayAllActiveImageUrl(null);
          if (revoke) {
            try {
              URL.revokeObjectURL(url);
            } catch {
              /* ignore */
            }
          }
          res();
        };
        try {
          video.pause();
        } catch {
          /* ignore */
        }
        setThumbnailSelected(false);
        setSelectedSegIndex(index);
        setPreviewCropOverlay(
          computePreviewCropOverlay(video, seg.cropOffset ?? 0)
        );
        setPlayAllActiveImageUrl(url);
        onVirtualProgress(virtualBase);
        const t0 = performance.now();
        const startTick = () => {
          const tick = () => {
            if (!playAllRef.current) return finish();
            const elapsed = (performance.now() - t0) / 1000;
            onVirtualProgress(virtualBase + elapsed);
            if (elapsed >= dur) return finish();
            playAllImageRafRef.current = requestAnimationFrame(tick);
          };
          playAllImageRafRef.current = requestAnimationFrame(tick);
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(startTick);
        });
      });

    try {
      let virtualCursor = 0;

      const thumbStart = segmentBoundarySeconds(thumbnailSegment, "start");
      if (thumbStart != null && Number.isFinite(thumbStart)) {
        let thumbEnd = segmentBoundarySeconds(thumbnailSegment, "end");
        if (
          thumbEnd == null ||
          !Number.isFinite(thumbEnd) ||
          thumbEnd <= thumbStart
        ) {
          thumbEnd = thumbStart + 0.1;
        }
        const thumbDur = thumbEnd - thumbStart;
        setThumbnailSelected(true);
        setPreviewCropOverlay(
          computePreviewCropOverlay(
            video,
            thumbnailSegment.cropOffset ?? 0
          )
        );
        video.currentTime = thumbStart;
        await playRange(thumbStart, thumbEnd, virtualCursor, onVirtualProgress);
        virtualCursor += thumbDur;
        await new Promise((res) => setTimeout(res, 100));
      }

      for (let i = 0; i < segments.length; i++) {
        if (!playAllRef.current) break;
        const seg = segments[i];
        if (!seg) continue;

        if (isImageSegment(seg)) {
          await playImageCut(seg, i, virtualCursor);
          const dur = playAllSegmentDurationSec(seg);
          if (dur != null && dur > 0) virtualCursor += dur;
          await new Promise((res) => setTimeout(res, 100));
          continue;
        }

        const startSec = segmentBoundarySeconds(seg, "start");
        const endSec = segmentBoundarySeconds(seg, "end");
        if (
          startSec == null ||
          endSec == null ||
          !Number.isFinite(startSec) ||
          !Number.isFinite(endSec) ||
          endSec <= startSec
        ) {
          continue;
        }

        setThumbnailSelected(false);
        setSelectedSegIndex(i);
        setPreviewCropOverlay(computePreviewCropOverlay(video, seg.cropOffset ?? 0));
        video.currentTime = startSec;

        await playRange(startSec, endSec, virtualCursor, onVirtualProgress);
        virtualCursor += endSec - startSec;

        await new Promise((res) => setTimeout(res, 100));
      }
    } finally {
      if (playAllImageRafRef.current != null) {
        cancelAnimationFrame(playAllImageRafRef.current);
        playAllImageRafRef.current = null;
      }
      playAllRef.current = false;
      setPlayAllActiveImageUrl(null);
      setPlayAllVirtualSec(0);
      setIsPlayingAll(false);
      video.muted = savedMuteForPlayAll;
    }
  }, [segments, isPlayingAll, isMonitoring, segmentBoundarySeconds, thumbnailSegment]);

  const runFullMonitor = useCallback(async () => {
    const video = previewVideoRef.current;
    if (!video || !previewUrl || busy || uploading || isMonitoring || isPlayingAll)
      return;

    monitorRef.current = true;
    setIsMonitoring(true);
    const savedMute = video.muted;
    video.muted = true;

    const playRangeMonitor = (startSec, endSec, narrUrl) =>
      new Promise((resolve) => {
        video.muted = true;
        let narrTimeout = null;
        let narrAudio = null;
        let done = false;
        const cleanupNarration = () => {
          if (narrTimeout != null) {
            clearTimeout(narrTimeout);
            narrTimeout = null;
          }
          if (narrAudio) {
            try {
              narrAudio.pause();
            } catch {
              /* ignore */
            }
            try {
              narrAudio.src = "";
            } catch {
              /* ignore */
            }
            narrAudio = null;
          }
        };
        const finish = () => {
          if (done) return;
          done = true;
          cleanupNarration();
          video.removeEventListener("timeupdate", check);
          video.removeEventListener("pause", onPauseWhileMonitor);
          try {
            video.pause();
          } catch {
            /* ignore */
          }
          resolve();
        };
        const check = () => {
          if (!monitorRef.current) return finish();
          if (video.currentTime >= endSec) return finish();
        };
        const onPauseWhileMonitor = () => {
          if (done) return;
          if (!monitorRef.current) finish();
        };
        video.addEventListener("timeupdate", check);
        video.addEventListener("pause", onPauseWhileMonitor);
        narrTimeout = setTimeout(() => {
          narrTimeout = null;
          if (!monitorRef.current || done) return;
          const u = String(narrUrl ?? "").trim();
          if (!u) return;
          narrAudio = new Audio(u);
          narrAudio.play().catch(() => {});
        }, 500);
        video.muted = true;
        video.play().catch(() => {});
      });

    try {
      const thumb = thumbnailSegmentRef.current;
      const ts = segmentBoundarySeconds(thumb, "start");
      let te = segmentBoundarySeconds(thumb, "end");
      if (ts != null && Number.isFinite(ts)) {
        if (te == null || !Number.isFinite(te) || te <= ts) {
          te = ts + 0.1;
        }
        setThumbnailSelected(true);
        setPlayingSegmentIndex(null);
        setPreviewCropOverlay(
          computePreviewCropOverlay(video, thumb.cropOffset ?? 0)
        );
        video.currentTime = ts;
        await playRangeMonitor(ts, te, thumb.narrationAudioUrl);
      }
      await new Promise((r) => setTimeout(r, 80));
      if (!monitorRef.current) return;

      const segs = segmentsRef.current;
      for (let i = 0; i < segs.length; i++) {
        if (!monitorRef.current) break;
        const seg = segs[i];
        const ss = segmentBoundarySeconds(seg, "start");
        const es = segmentBoundarySeconds(seg, "end");
        if (
          ss == null ||
          es == null ||
          !Number.isFinite(ss) ||
          !Number.isFinite(es) ||
          es <= ss
        ) {
          continue;
        }
        setThumbnailSelected(false);
        setSelectedSegIndex(i);
        setPreviewCropOverlay(
          computePreviewCropOverlay(video, seg?.cropOffset ?? 0)
        );
        video.currentTime = ss;
        await playRangeMonitor(ss, es, seg?.narrationAudioUrl);
        await new Promise((r) => setTimeout(r, 80));
      }
    } finally {
      monitorRef.current = false;
      setIsMonitoring(false);
      video.muted = savedMute;
    }
  }, [
    previewUrl,
    busy,
    uploading,
    isMonitoring,
    isPlayingAll,
    segmentBoundarySeconds,
  ]);

  /** 썸네일 구간(thumbnailSegment.start ~ end)만 미리보기 재생 */
  const playThumbnailSegmentPreview = useCallback(async () => {
    const video = previewVideoRef.current;
    if (!video || !previewUrl || busy || uploading || isPlayingAll || isMonitoring)
      return;
    const thumb = thumbnailSegmentRef.current;
    const startSec = segmentBoundarySeconds(thumb, "start");
    let endSec = segmentBoundarySeconds(thumb, "end");
    if (startSec == null || !Number.isFinite(startSec)) return;
    if (
      endSec == null ||
      !Number.isFinite(endSec) ||
      endSec <= startSec
    ) {
      endSec = startSec + 0.1;
    }
    const narrUrl = String(thumb.narrationAudioUrl ?? "").trim();
    const prevMuted = video.muted;
    video.muted = true;
    let narrTimeout = null;
    let narrAudio = null;
    setThumbnailSelected(true);
    setPlayingSegmentIndex(null);
    setPreviewCropOverlay(
      computePreviewCropOverlay(video, thumb.cropOffset ?? 0)
    );
    video.currentTime = startSec;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (narrTimeout != null) {
          clearTimeout(narrTimeout);
          narrTimeout = null;
        }
        if (narrAudio) {
          try {
            narrAudio.pause();
          } catch {
            /* ignore */
          }
          try {
            narrAudio.src = "";
          } catch {
            /* ignore */
          }
          narrAudio = null;
        }
        try {
          video.pause();
        } catch {
          /* ignore */
        }
        video.removeEventListener("timeupdate", check);
        video.muted = prevMuted;
        resolve();
      };
      const check = () => {
        if (video.currentTime >= endSec) finish();
      };
      video.addEventListener("timeupdate", check);
      narrTimeout = setTimeout(() => {
        narrTimeout = null;
        if (done || !narrUrl) return;
        narrAudio = new Audio(narrUrl);
        narrAudio.play().catch(() => {});
      }, 500);
      video.play().catch(() => {});
    });
  }, [
    previewUrl,
    busy,
    uploading,
    isPlayingAll,
    isMonitoring,
    segmentBoundarySeconds,
  ]);

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
    setSegments((prev) => {
      const next = prev.map((seg, i) => {
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
        if (field === "textShadow") {
          return { ...seg, textShadow: Boolean(rawVal) };
        }
        if (field === "textY2") {
          const n = Number(rawVal);
          const v = Number.isFinite(n)
            ? Math.min(100, Math.max(0, Math.round(n)))
            : 85;
          return { ...seg, textY2: v };
        }
        if (field === "textColor2") {
          return { ...seg, textColor2: String(rawVal || TEXT_COLORS[0]) };
        }
        if (field === "text2") {
          return { ...seg, text2: rawVal };
        }
        if (field === "textSize2") {
          const n = Number(rawVal);
          const v = Number.isFinite(n)
            ? Math.min(200, Math.max(20, Math.round(n)))
            : 48;
          return { ...seg, textSize2: v };
        }
        if (field === "textOpacity2") {
          return { ...seg, textOpacity2: roundOpacity01(rawVal) };
        }
        if (field === "textFont2") {
          return {
            ...seg,
            textFont2: String(rawVal || "").trim() || DEFAULT_TEXT_FONT,
          };
        }
        if (field === "textShadow2") {
          return { ...seg, textShadow2: Boolean(rawVal) };
        }
        return seg;
      });
      return next;
    });
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

  const handleThumbnailTimeChange = (field, rawVal) => {
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
    setThumbnailSegment((prev) => ({ ...prev, [field]: formatted }));
  };

  const handleThumbnailFracMsChange = (field, rawVal) => {
    const digits = rawVal.replace(/\D/g, "");
    let n = 0;
    if (digits !== "") {
      const use = digits.length > 2 ? digits.slice(-2) : digits;
      const parsed = parseInt(use, 10);
      n = Number.isFinite(parsed) ? parsed : 0;
    }
    n = clampSegmentFracMs(n);
    setThumbnailSegment((prev) => ({ ...prev, [field]: n }));
  };

  const handleThumbnailTextYChange = (field, rawVal) => {
    const n = Number(rawVal);
    if (!Number.isFinite(n)) return;
    const v = Math.min(100, Math.max(0, Math.round(n)));
    setThumbnailSegment((prev) => ({ ...prev, [field]: v }));
  };

  const seekPreviewToThumbnailBoundary = useCallback(
    (field) => {
      const v = previewVideoRef.current;
      if (!v || !previewUrl) return;
      setThumbnailSelected(true);
      const key = field === "start" ? "start" : "end";
      const fracKey = field === "start" ? "startMs" : "endMs";
      const t = segmentBoundaryToSeconds(
        String(thumbnailSegmentRef.current?.[key] ?? "").trim(),
        thumbnailSegmentRef.current?.[fracKey]
      );
      if (t == null || !Number.isFinite(t)) return;
      v.currentTime = t;
    },
    [previewUrl]
  );

  const adjustThumbnailFieldTime = useCallback((field, deltaSec) => {
    let seekSec = null;
    setThumbnailSegment((prev) => {
      const fracField = field === "start" ? "startMs" : "endMs";
      const cur =
        parseHhMmSsToSeconds(prev[field], prev[fracField]) ??
        (String(prev[field] ?? "").trim() === "" ? 0 : null);
      if (cur == null) return prev;
      const next = Math.max(0, cur + deltaSec);
      seekSec = next;
      const whole = Math.floor(next + 1e-9);
      const frac = clampSegmentFracMs(Math.round((next - whole) * 100));
      const hms = secondsToHhMmSs(whole);
      return { ...prev, [field]: hms, [fracField]: frac };
    });
    if (seekSec == null) return;
    setThumbnailSelected(true);
    queueMicrotask(() => {
      const v = previewVideoRef.current;
      if (v) v.currentTime = seekSec;
    });
  }, []);

  const onVideoFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setVideoFile(f);
    setJobId(null);
    setUploadPhase("idle");
    setUploadProgress(0);
    setPreviewUrl(null);
    setError(null);
    setWhisperData(null);
    setSelectedTimestamps({});
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
    setWhisperData(null);
    setSelectedTimestamps({});
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

  // 편집 단축키 — 새 로직 없이 기존 핸들러만 호출. 패널 언마운트 시 cleanup으로 리스너 제거.
  useEffect(() => {
    const onKeyDown = (e) => {
      // 가드 2: 소스 준비 드로어 열림 → 무시
      if (sourceDrawerOpen || shortcutsHelpOpen) return;
      // 가드 1: 입력 요소 포커스 → 무시 (나레이션·자막 입력 보호)
      const t = e.target;
      const tag = t && t.tagName ? t.tagName.toUpperCase() : "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (t && t.isContentEditable)
      ) {
        return;
      }
      // OS/브라우저 단축키(Ctrl/Meta/Alt)는 건드리지 않음 (Shift는 허용)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 가드 5: 선택 구간이 없으면 아무 것도 하지 않음
      const seg = segments[selectedSegIndex];
      if (!seg) return;
      const v = previewVideoRef.current;

      switch (e.code) {
        case "Space":
          e.preventDefault(); // 가드 4: 처리한 경우만 기본 동작(스크롤) 차단
          toggleSegmentPreviewPlayback(selectedSegIndex);
          break;
        case "ArrowUp":
          if (selectedSegIndex > 0) {
            e.preventDefault();
            selectSegment(selectedSegIndex - 1);
          }
          break;
        case "ArrowDown":
          if (selectedSegIndex < segments.length - 1) {
            e.preventDefault();
            selectSegment(selectedSegIndex + 1);
          }
          break;
        case "ArrowLeft":
          if (v) {
            e.preventDefault();
            v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 1 : 1 / 30));
          }
          break;
        case "ArrowRight":
          if (v) {
            e.preventDefault();
            v.currentTime = v.currentTime + (e.shiftKey ? 1 : 1 / 30);
          }
          break;
        case "KeyI":
          e.preventDefault();
          applyVideoTimeToSegment("start");
          break;
        case "KeyO":
          e.preventDefault();
          applyVideoTimeToSegment("end");
          break;
        case "Delete":
          e.preventDefault();
          if (
            window.confirm(
              `선택한 구간 #${selectedSegIndex + 1}을(를) 삭제할까요?`
            )
          ) {
            deleteSelectedSegment();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    sourceDrawerOpen,
    shortcutsHelpOpen,
    segments,
    selectedSegIndex,
    toggleSegmentPreviewPlayback,
    selectSegment,
    applyVideoTimeToSegment,
    deleteSelectedSegment,
  ]);

  const adjustSegmentFieldTime = useCallback((segIndex, field, deltaSec) => {
    let seekSec = null;
    setSegments((prev) => {
      const seg = prev[segIndex];
      if (!seg) {
        return prev;
      }
      const fracField = field === "start" ? "startMs" : "endMs";
      const cur =
        parseHhMmSsToSeconds(seg[field], seg[fracField]) ??
        (String(seg[field] ?? "").trim() === "" ? 0 : null);
      if (cur == null) {
        return prev;
      }
      const nextSec = Math.max(0, cur + deltaSec);
      seekSec = nextSec;
      const whole = Math.floor(nextSec + 1e-9);
      const frac = clampSegmentFracMs(Math.round((nextSec - whole) * 100));
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

  const onResetDraft = useCallback(() => {
    if (!jobId || typeof localStorage === "undefined") return;
    if (
      !window.confirm(
        "이 작업의 임시저장을 삭제하고 편집 내용을 처음 상태로 되돌립니다. 계속할까요?"
      )
    ) {
      return;
    }
    try {
      localStorage.removeItem(draftStorageKey(jobId));
    } catch (e) {
      console.warn("[kbo draft remove]", e);
    }
    restoringDraftRef.current = true;
    setSegments(() => [emptySegment()]);
    setThumbnailSegment({ ...INITIAL_THUMBNAIL_SEGMENT });
    setTopText("");
    setTopTextColor(TEXT_COLORS[0]);
    setTopTextSize(72);
    setTopTextOpacity(1);
    setTopTextFont(DEFAULT_TEXT_FONT);
    setTopTextShadow(false);
    setMuteOriginal(true);
    setBgmVolume(0.8);
    setBgmStartTime(0);
    setBgmFadeOut(2);
    setHighlightMusicS3Key("");
    setCoverBox({
      enabled: false,
      x: 50,
      y: 50,
      width: 20,
      height: 10,
    });
    setSelectedTeam("삼성");
    setTeamColor(TEAM_CONFIGS["삼성"]?.bg || "#0055A4");
    setSelectedSegIndex(0);
    setThumbnailSelected(false);
    setMessage("임시저장을 초기화했습니다.");
    setTimeout(() => {
      restoringDraftRef.current = false;
      setDraftSaveGeneration((g) => g + 1);
    }, 0);
  }, [jobId]);

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
    restoringDraftRef.current = true;
    let restored = false;
    try {
      const raw =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(draftStorageKey(id))
          : null;
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.segments) && d.segments.length > 0) {
          setSegments(d.segments);
        }
        if (d.thumbnailSegment && typeof d.thumbnailSegment === "object") {
          setThumbnailSegment((prev) => ({ ...prev, ...d.thumbnailSegment }));
        }
        if (typeof d.topText === "string") setTopText(d.topText);
        if (typeof d.topTextColor === "string") setTopTextColor(d.topTextColor);
        if (d.topTextSize != null && Number.isFinite(Number(d.topTextSize))) {
          setTopTextSize(Number(d.topTextSize));
        }
        if (typeof d.topTextFont === "string") setTopTextFont(d.topTextFont);
        if (typeof d.topTextShadow === "boolean") {
          setTopTextShadow(d.topTextShadow);
        }
        if (d.topTextOpacity != null && Number.isFinite(Number(d.topTextOpacity))) {
          setTopTextOpacity(Number(d.topTextOpacity));
        }
        if (typeof d.muteOriginal === "boolean") setMuteOriginal(d.muteOriginal);
        if (d.bgmVolume != null && Number.isFinite(Number(d.bgmVolume))) {
          setBgmVolume(Number(d.bgmVolume));
        }
        if (d.bgmStartTime != null && Number.isFinite(Number(d.bgmStartTime))) {
          setBgmStartTime(Number(d.bgmStartTime));
        }
        if (d.bgmFadeOut != null && Number.isFinite(Number(d.bgmFadeOut))) {
          setBgmFadeOut(Number(d.bgmFadeOut));
        }
        if (typeof d.highlightMusicS3Key === "string") {
          setHighlightMusicS3Key(d.highlightMusicS3Key);
        }
        if (typeof d.selectedTeam === "string" && TEAM_CONFIGS[d.selectedTeam]) {
          setSelectedTeam(d.selectedTeam);
          setTeamColor(TEAM_CONFIGS[d.selectedTeam]?.bg || "#4ade80");
        }
        if (d.narrationSpeed != null && Number.isFinite(Number(d.narrationSpeed))) {
          setNarrationSpeed(
            Math.min(1.2, Math.max(0.7, Number(d.narrationSpeed)))
          );
        }
        if (
          d.narrationStability != null &&
          Number.isFinite(Number(d.narrationStability))
        ) {
          setNarrationStability(
            Math.min(1, Math.max(0, Number(d.narrationStability)))
          );
        }
        if (d.narrationStyle != null && Number.isFinite(Number(d.narrationStyle))) {
          setNarrationStyle(Math.min(1, Math.max(0, Number(d.narrationStyle))));
        }
        const draftVoice = String(d.narrationVoiceId || "").trim();
        if (VOICE_OPTIONS.some((o) => o.id === draftVoice)) {
          setNarrationVoiceId(draftVoice);
        }
        if (d.coverBox && typeof d.coverBox === "object") {
          const clampP = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n)
              ? Math.min(100, Math.max(0, Math.round(n)))
              : fallback;
          };
          setCoverBox({
            enabled: Boolean(d.coverBox.enabled),
            x: clampP(d.coverBox.x, 0),
            y: clampP(d.coverBox.y, 50),
            width: clampP(d.coverBox.width, 100),
            height: clampP(d.coverBox.height, 10),
          });
        }
        restored = true;
      }
    } catch (e) {
      console.warn("[kbo draft restore]", e);
    }

    setJobId(id);
    setUploadPhase("done");
    setVideoFile(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
    setDownloadUrl(null);
    setStatus("idle");
    setProgress(0);
    setWhisperData(null);
    setSelectedTimestamps({});
    await fetchPreviewUrl(id);
    setMessage(
      restored
        ? "이전 작업 내용을 불러왔습니다"
        : "저장된 원본을 불러왔습니다. 구간을 입력한 뒤 영상 생성을 누르세요."
    );
    setPanelOpen((v) => ({ ...v, whisper: true }));
    setTimeout(() => {
      restoringDraftRef.current = false;
      setDraftSaveGeneration((g) => g + 1);
    }, 0);
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
      setWhisperData(null);
      setSelectedTimestamps({});
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
      if (isImageSegment(sg)) {
        return imageSegmentIsValid(sg);
      }
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

      const stripFontForOverlay = (f) =>
        String(f || "")
          .trim()
          .replace(/\.(ttf|otf)$/i, "") || "NotoSansKR-Bold";

      let thumbStart = segmentBoundaryToSeconds(
        thumbnailSegment.start,
        thumbnailSegment.startMs
      );
      let thumbEnd = segmentBoundaryToSeconds(
        thumbnailSegment.end,
        thumbnailSegment.endMs
      );
      const thumbValid =
        String(thumbnailSegment.end || "").trim() !== "" &&
        Number.isFinite(thumbStart) &&
        Number.isFinite(thumbEnd) &&
        thumbEnd > thumbStart;

      if (thumbValid && layout === LAYOUT_TYPES.KBO) {
        const tcOverlay = TEAM_CONFIGS[selectedTeam] || TEAM_CONFIGS["삼성"];
        const overlayCanvas = await drawThumbnail({
          team: selectedTeam,
          tc: { bg: tcOverlay.bg, accent: tcOverlay.accent },
          text1: String(thumbnailSegment.text1 || "").trim(),
          text2: String(thumbnailSegment.text2 || "").trim(),
          font1: stripFontForOverlay(thumbnailSegment.font1),
          font2: stripFontForOverlay(thumbnailSegment.font2),
          textColor1:
            String(thumbnailSegment.textColor1 || "#FFFFFF").trim() ||
            "#FFFFFF",
          textColor2:
            String(thumbnailSegment.textColor2 || "#FFFFFF").trim() ||
            "#FFFFFF",
          fontSize1: Math.min(
            200,
            Math.max(20, Math.round(Number(thumbnailSegment.fontSize1)) || 88)
          ),
          fontSize2: Math.min(
            200,
            Math.max(20, Math.round(Number(thumbnailSegment.fontSize2)) || 52)
          ),
          textY1: clampThumbnailTextYPercent(thumbnailSegment.textY1, 49),
          textY2: clampThumbnailTextYPercent(thumbnailSegment.textY2, 57),
          showLine: Boolean(thumbnailSegment.showLine),
        });

        const overlayBlob = await new Promise((resolve, reject) => {
          overlayCanvas.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("오버레이 PNG toBlob 실패")),
            "image/png"
          );
        });

        const overlayUp = await postKbo({
          action: "overlay_upload_url",
          jobId,
        });
        if (!overlayUp?.putUrl) {
          throw new Error("overlay_upload_url 응답 오류");
        }
        const overlayPut = await fetch(overlayUp.putUrl, {
          method: "PUT",
          body: overlayBlob,
          headers: { "Content-Type": "image/png" },
        });
        if (!overlayPut.ok) {
          throw new Error(`오버레이 S3 업로드 실패 HTTP ${overlayPut.status}`);
        }
      }

      if (thumbValid) {
        const thumbNarr = String(thumbnailSegment.narration ?? "").trim();
        if (thumbNarr) {
          await postKbo({
            action: "elevenlabs_tts",
            jobId,
            segIndex: 0,
            text: thumbNarr,
            voiceId: narrationVoiceId,
            speed: narrationSpeed,
            stability: narrationStability,
            style: narrationStyle,
          });
        }
      }
      const resolvedSegments = [];
      for (const s of validSegments) {
        if (isImageSegment(s) && s.imageLocalFile) {
          setMessage("이미지 업로드 중…");
          const up = await uploadHighlightImage(jobId, s.imageLocalFile);
          resolvedSegments.push({
            ...s,
            imageS3Key: up.s3Key,
          });
        } else {
          resolvedSegments.push(s);
        }
      }

      for (let vi = 0; vi < resolvedSegments.length; vi++) {
        const narrText = String(resolvedSegments[vi]?.narration ?? "").trim();
        if (!narrText) continue;
        const segIndexForS3 = thumbValid ? vi + 1 : vi;
        await postKbo({
          action: "elevenlabs_tts",
          jobId,
          segIndex: segIndexForS3,
          text: narrText,
          voiceId: narrationVoiceId,
          speed: narrationSpeed,
          stability: narrationStability,
          style: narrationStyle,
        });
      }

      const payload = {
        action: "highlight_video_create",
        jobId,
        layout,
        videoScaleY: clampVideoScaleY(videoScaleY),
        videoOffsetY: clampVideoOffsetY(videoOffsetY),
        team: selectedTeam,
        topText: topText.trim(),
        topTextColor,
        topTextSize: sizeClamp,
        topTextOpacity: roundOpacity01(topTextOpacity),
        topTextFont:
          String(topTextFont || "").trim() || DEFAULT_TEXT_FONT,
        topTextShadow: Boolean(topTextShadow),
        segments: resolvedSegments.map((s) => {
          const ty = Number(s.textY);
          const textY = Number.isFinite(ty)
            ? Math.min(100, Math.max(0, Math.round(ty)))
            : 85;
          const ty2 = Number(s.textY2);
          const textY2 = Number.isFinite(ty2)
            ? Math.min(100, Math.max(0, Math.round(ty2)))
            : 85;
          const overlayCommon = {
            text: String(s.text ?? "").trim(),
            text2: String(s.text2 ?? "").trim(),
            textShadow: Boolean(s.textShadow),
            textShadow2: Boolean(s.textShadow2),
            textY,
            textY2,
            textColor:
              String(s.textColor ?? TEXT_COLORS[0]).trim() || TEXT_COLORS[0],
            textColor2:
              String(s.textColor2 ?? TEXT_COLORS[0]).trim() || TEXT_COLORS[0],
            textOpacity: roundOpacity01(s.textOpacity ?? 1),
            textOpacity2: roundOpacity01(s.textOpacity2 ?? 1),
            textFont: ensureTtf(
              String(s.textFont || "").trim() || DEFAULT_TEXT_FONT
            ),
            textFont2: ensureTtf(
              String(s.textFont2 || "").trim() || DEFAULT_TEXT_FONT
            ),
            textSize: Math.min(
              200,
              Math.max(20, Math.round(Number(s.textSize)) || 48)
            ),
            textSize2: Math.min(
              200,
              Math.max(20, Math.round(Number(s.textSize2)) || 48)
            ),
            narration: String(s.narration ?? "").trim(),
          };
          if (isImageSegment(s)) {
            return {
              type: "image",
              imageS3Key: String(s.imageS3Key || "").trim(),
              duration: clampImageDurationSec(s.duration),
              cropOffset:
                typeof s.cropOffset === "number" &&
                Number.isFinite(s.cropOffset)
                  ? Math.min(50, Math.max(-50, Math.round(s.cropOffset)))
                  : 0,
              ...overlayCommon,
            };
          }
          return {
            start: String(s.start).trim(),
            end: String(s.end).trim(),
            startMs: clampSegmentFracMs(s.startMs ?? 0),
            endMs: clampSegmentFracMs(s.endMs ?? 0),
            cropOffset:
              typeof s.cropOffset === "number" && Number.isFinite(s.cropOffset)
                ? Math.min(50, Math.max(-50, Math.round(s.cropOffset)))
                : 0,
            ...overlayCommon,
          };
        }),
        coverBox: normalizeCoverBoxForPayload(coverBox),
        muteOriginal,
        musicOptions: {
          volume: bgmVolume,
          startTime: Math.max(0, Number(bgmStartTime) || 0),
          fadeOutDuration: bgmFadeOut,
        },
      };
      thumbStart = segmentBoundaryToSeconds(
        thumbnailSegment.start,
        thumbnailSegment.startMs
      );
      thumbEnd = segmentBoundaryToSeconds(
        thumbnailSegment.end,
        thumbnailSegment.endMs
      );
      if (
        String(thumbnailSegment.end || "").trim() !== "" &&
        Number.isFinite(thumbStart) &&
        Number.isFinite(thumbEnd) &&
        thumbEnd > thumbStart
      ) {
        const thumbSegPayload = {
          _thumbnailClip: true,
          start: thumbnailSegment.start,
          startMs: thumbnailSegment.startMs,
          end: thumbnailSegment.end,
          endMs: thumbnailSegment.endMs,
          cropOffset: thumbnailSegment.cropOffset ?? 0,
          text: thumbnailSegment.text1 || "",
          textFont: ensureTtf(thumbnailSegment.font1 || ""),
          textColor: thumbnailSegment.textColor1 || "#ffffff",
          textSize: thumbnailSegment.fontSize1 || 88,
          textOpacity: 1,
          textShadow: false,
          textY: clampThumbnailTextYPercent(thumbnailSegment.textY1, 85),
          text2: thumbnailSegment.text2 || "",
          textFont2: ensureTtf(thumbnailSegment.font2 || ""),
          textColor2: thumbnailSegment.textColor2 || "#ffffff",
          textSize2: thumbnailSegment.fontSize2 || 52,
          textOpacity2: 1,
          textShadow2: false,
          textY2: clampThumbnailTextYPercent(thumbnailSegment.textY2, 85),
          narration: String(thumbnailSegment.narration ?? "").trim(),
        };
        payload.segments = [thumbSegPayload, ...payload.segments];
      }
      if (thumbnailSegment.keepText1) {
        const g1 = String(thumbnailSegment.text1 || "").trim();
        if (g1) {
          payload.globalText1 = g1;
          payload.globalText1Y = clampThumbnailTextYPercent(
            thumbnailSegment.textY1,
            49
          );
          payload.globalText1Color =
            String(thumbnailSegment.textColor1 || "#FFFFFF").trim() ||
            "#FFFFFF";
          payload.globalText1Size = Math.min(
            200,
            Math.max(20, Math.round(Number(thumbnailSegment.fontSize1)) || 88)
          );
          payload.globalText1Font = ensureTtf(thumbnailSegment.font1 || "");
        }
      }
      if (thumbnailSegment.keepText2) {
        const g2 = String(thumbnailSegment.text2 || "").trim();
        if (g2) {
          payload.globalText2 = g2;
          payload.globalText2Y = clampThumbnailTextYPercent(
            thumbnailSegment.textY2,
            57
          );
          payload.globalText2Color =
            String(thumbnailSegment.textColor2 || "#FFFFFF").trim() ||
            "#FFFFFF";
          payload.globalText2Size = Math.min(
            200,
            Math.max(20, Math.round(Number(thumbnailSegment.fontSize2)) || 52)
          );
          payload.globalText2Font = ensureTtf(thumbnailSegment.font2 || "");
        }
      }
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
      if (layout === LAYOUT_TYPES.TOPBOTTOM) {
        payload.topBarColor = normalizeHexColorInput(
          topBarColor,
          DEFAULT_TOP_BAR_COLOR
        );
        payload.bottomBarColor = normalizeHexColorInput(
          bottomBarColor,
          DEFAULT_BOTTOM_BAR_COLOR
        );
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
    const ct = isPlayingAll ? playAllVirtualSec : previewPlayheadSec;
    const bottomSeg = findSegmentAtPreviewTime(ct, segments, isPlayingAll);
    const segmentBottomLine = String(bottomSeg?.text ?? "").trim();
    const segmentBottomLine2 = String(bottomSeg?.text2 ?? "").trim();

    const segBottomPx = Math.max(
      8,
      (Number(bottomSeg?.textSize) || 48) * scale
    );
    const segBottomPx2 = Math.max(
      8,
      (Number(bottomSeg?.textSize2) || 48) * scale
    );

    const shadow = "1px 1px 3px rgba(0,0,0,0.6)";

    const segYRaw = Number(bottomSeg?.textY);
    const segYpct = Number.isFinite(segYRaw)
      ? Math.min(100, Math.max(0, segYRaw))
      : 85;
    const segY2Raw = Number(bottomSeg?.textY2);
    const segY2pct = Number.isFinite(segY2Raw)
      ? Math.min(100, Math.max(0, segY2Raw))
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
    const segColor2Raw = /^#[0-9A-Fa-f]{6}$/i.test(
      String(bottomSeg?.textColor2 || "")
    )
      ? bottomSeg.textColor2
      : TEXT_COLORS[0];
    const segColor2 = hexToRgba(
      segColor2Raw,
      roundOpacity01(bottomSeg?.textOpacity2 ?? 1)
    );
    const segFontFamily2 = previewFontFamily(
      bottomSeg?.textFont2 || DEFAULT_TEXT_FONT
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
              fontWeight: 500,
              lineHeight: 1.2,
              textShadow: bottomSeg?.textShadow ? shadow : "none",
              padding: "0 8px",
              boxSizing: "border-box",
              whiteSpace: "nowrap",
              overflow: "visible",
            }}
          >
            {segmentBottomLine}
          </div>
        ) : null}
        {segmentBottomLine2 ? (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: `${segY2pct}%`,
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              fontSize: segBottomPx2,
              color: segColor2,
              fontFamily: segFontFamily2,
              fontWeight: 500,
              lineHeight: 1.2,
              textShadow: bottomSeg?.textShadow2 ? shadow : "none",
              padding: "0 8px",
              boxSizing: "border-box",
              whiteSpace: "nowrap",
              overflow: "visible",
            }}
          >
            {segmentBottomLine2}
          </div>
        ) : null}
      </div>
    );
  }, [
    previewCropOverlay,
    previewPlayheadSec,
    playAllVirtualSec,
    isPlayingAll,
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
          // 편집기를 뷰포트에 가두어 좌/우 컬럼의 내부 스크롤이 동작하게 함.
          // offset은 컨테이너 위 고정 크롬(topbar·shell 패딩·타이틀·인트로) 근사치 — 편집기/드로어 내용과 무관.
          height: "calc(100vh - 300px)",
        }}
      >
        {/* 소스 준비 툴바 — 1~4단계는 아래 오버레이 드로어로 이동 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            marginBottom: 4,
          }}
        >
          <button
            type="button"
            onClick={() => setSourceDrawerOpen((o) => !o)}
            aria-expanded={sourceDrawerOpen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "var(--ve-card)",
              color: "var(--ve-text)",
              fontWeight: 500,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            📁 소스 준비 (다운로드·업로드·불러오기·음성분석)
            <span aria-hidden style={{ opacity: 0.7 }}>
              {sourceDrawerOpen ? "▲" : "▼"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShortcutsHelpOpen((o) => !o)}
            aria-expanded={shortcutsHelpOpen}
            title="편집 단축키 보기"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid rgba(0,0,0,0.15)",
              background: "var(--ve-card)",
              color: "var(--ve-text)",
              fontWeight: 500,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ⌨ 단축키
          </button>
        </div>
        {/* 단축키 도움말 오버레이 (드로어와 동일 패턴, 목록만) */}
        <div
          onClick={() => setShortcutsHelpOpen(false)}
          style={{
            display: shortcutsHelpOpen ? "block" : "none",
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(420px, 92vw)",
              background: "var(--ve-card)",
              color: "var(--ve-text)",
              borderRadius: 12,
              border: "1px solid var(--ve-border)",
              padding: 20,
              boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 16 }}>⌨ 편집 단축키</div>
              <button
                type="button"
                onClick={() => setShortcutsHelpOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--ve-text-sub)",
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              {[
                ["Space", "선택 구간 재생 / 정지"],
                ["↑ / ↓", "이전 / 다음 구간 선택"],
                ["← / →", "재생위치 1프레임 이동 (±1/30초)"],
                ["Shift + ← / →", "재생위치 1초 이동"],
                ["I", "현재 위치를 구간 시작으로"],
                ["O", "현재 위치를 구간 종료로"],
                ["Delete", "선택 구간 삭제 (확인 후)"],
              ].map(([k, desc]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontWeight: 500,
                      color: "var(--ve-accent)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {k}
                  </span>
                  <span style={{ color: "var(--ve-text-sub)", textAlign: "right" }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--ve-text-sub)" }}>
              입력창에 포커스가 있거나 소스 준비 창이 열려 있으면 단축키는 동작하지 않습니다.
            </div>
          </div>
        </div>
        {/* 오버레이 드로어: 닫혀도 언마운트하지 않음(display:none) — VideoPrep/업로드 상태 보존 */}
        <div
          onClick={() => setSourceDrawerOpen(false)}
          style={{
            display: sourceDrawerOpen ? "block" : "none",
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: "min(460px, 92vw)",
              // 본문은 원래 아코디언이 놓였던 .section soft 배경(#f0f0f0)과 동일하게 —
              // color 미지정: 원래 상속색(#1a1a2e)이 그대로 나오도록.
              background: "var(--ve-panel)",
              borderRight: "1px solid rgba(0,0,0,0.12)",
              boxShadow: "2px 0 16px rgba(0,0,0,0.4)",
              overflowY: "auto",
              padding: "16px 18px 24px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                background: "var(--ve-card)",
                padding: "8px 12px",
                borderRadius: 8,
              }}
            >
              <span style={{ fontWeight: 500, fontSize: 16, color: "var(--ve-text)" }}>
                소스 준비
              </span>
              <button
                type="button"
                onClick={() => setSourceDrawerOpen(false)}
                aria-label="닫기"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--ve-text)",
                  fontSize: 16,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
        <div style={{ width: "100%", marginTop: 16 }}>
          <button
            type="button"
            className="muted"
            onClick={() => togglePanel("download")}
            style={accordionHeaderStyle}
            aria-expanded={panelOpen.download}
          >
            <span>1단계: 로컬 다운로드</span>
            <span aria-hidden style={{ opacity: 0.65, fontSize: 12 }}>
              {panelOpen.download ? "▼" : "▶"}
            </span>
          </button>
          {panelOpen.download ? (
            <div style={accordionBodyStyle}>
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
                      <strong style={{ color: "var(--ve-warning)" }}>
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
                    border: "1px solid var(--ve-border)",
                    background: "var(--ve-panel)",
                    color: "var(--ve-text)",
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
          ) : null}
        </div>

        <div style={{ width: "100%", marginTop: 16 }}>
          <button
            type="button"
            className="muted"
            onClick={() => togglePanel("videoPrep")}
            style={accordionHeaderStyle}
            aria-expanded={panelOpen.videoPrep}
          >
            <span>1-1단계: 영상 준비 (클립 자르기/합치기)</span>
            <span aria-hidden style={{ opacity: 0.65, fontSize: 12 }}>
              {panelOpen.videoPrep ? "▼" : "▶"}
            </span>
          </button>
          {panelOpen.videoPrep ? (
            <div style={accordionBodyStyle}>
              <VideoPrep
                onJobReady={(readyJobId) => {
                  const id = String(readyJobId || "").trim();
                  if (id) void onLoadSavedJob(id);
                }}
              />
            </div>
          ) : null}
        </div>

        <div style={{ width: "100%", marginTop: 16 }}>
          <button
            type="button"
            className="muted"
            onClick={() => togglePanel("upload")}
            style={accordionHeaderStyle}
            aria-expanded={panelOpen.upload}
          >
            <span>2단계: S3 업로드</span>
            <span aria-hidden style={{ opacity: 0.65, fontSize: 12 }}>
              {panelOpen.upload ? "▼" : "▶"}
            </span>
          </button>
          {panelOpen.upload ? (
            <div style={accordionBodyStyle}>
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
                  <div
                    className="muted"
                    style={{ fontWeight: 500, marginBottom: 6 }}
                  >
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
                  <span className="muted" style={{ fontWeight: 500 }}>
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
          ) : null}
        </div>

        <div style={{ width: "100%", marginTop: 16 }}>
          <button
            type="button"
            className="muted"
            onClick={() => togglePanel("saved")}
            style={accordionHeaderStyle}
            aria-expanded={panelOpen.saved}
          >
            <span>3단계: 저장된 파일 불러오기</span>
            <span aria-hidden style={{ opacity: 0.65, fontSize: 12 }}>
              {panelOpen.saved ? "▼" : "▶"}
            </span>
          </button>
          {panelOpen.saved ? (
            <div style={accordionBodyStyle}>
              {savedFilesLoading ? (
                <div className="muted" style={{ fontSize: 14 }}>
                  목록 불러오는 중…
                </div>
              ) : savedFilesError ? (
                <div className="muted" style={{ fontSize: 13, color: "var(--ve-warning)" }}>
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
                          border: "1px solid var(--ve-border)",
                          background: "var(--ve-panel)",
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{shortName}</span>
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
                              color: "var(--ve-danger)",
                              fontWeight: 500,
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
          ) : null}
        </div>

        <div style={{ width: "100%", marginTop: 16 }}>
          <button
            type="button"
            className="muted"
            onClick={() => togglePanel("whisper")}
            style={accordionHeaderStyle}
            aria-expanded={panelOpen.whisper}
          >
            <span>4단계 · AI 음성분석</span>
            <span aria-hidden style={{ opacity: 0.65, fontSize: 12 }}>
              {panelOpen.whisper ? "▼" : "▶"}
            </span>
          </button>
          {panelOpen.whisper ? (
            <div style={accordionBodyStyle}>
              {String(jobId || "").trim() ? (
                <button
                  type="button"
                  style={{
                    background: "var(--ve-accent)",
                    color: "var(--ve-text)",
                    border: "none",
                    padding: "6px 14px",
                    borderRadius: 6,
                    cursor:
                      busy || uploading || whisperData?.loading
                        ? "not-allowed"
                        : "pointer",
                    fontSize: 13,
                    opacity:
                      busy || uploading || whisperData?.loading ? 0.65 : 1,
                  }}
                  disabled={busy || uploading || whisperData?.loading}
                  onClick={async () => {
                    const id = String(jobId || "").trim();
                    if (!id) return;
                    setWhisperData({
                      loading: true,
                      segments: [],
                      text: "",
                      error: null,
                    });
                    setSelectedTimestamps({});
                    try {
                      const res = await postKbo({
                        action: "whisper_analyze",
                        jobId: id,
                      });
                      setWhisperData({
                        loading: false,
                        segments: Array.isArray(res?.segments)
                          ? res.segments
                          : [],
                        text: String(res?.text || ""),
                        error: null,
                      });
                    } catch (e) {
                      setWhisperData({
                        loading: false,
                        segments: [],
                        text: "",
                        error:
                          e instanceof Error ? e.message : String(e),
                      });
                    }
                  }}
                >
                  {whisperData?.loading
                    ? "⏳ 음성 분석 중…"
                    : "▶ 음성 분석"}
                </button>
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>
                  원본이 S3에 업로드되거나 저장된 job을 불러온 뒤 음성 분석을
                  실행할 수 있습니다.
                </div>
              )}

              {whisperData?.error ? (
                <pre
                  className="result-error-light"
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    color: "var(--ve-danger)",
                  }}
                >
                  {whisperData.error}
                </pre>
              ) : null}

              {Array.isArray(whisperData?.segments) &&
              whisperData.segments.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div
                    className="muted"
                    style={{ fontSize: 12, marginBottom: 6 }}
                  >
                    구간 타임스탬프 (클릭 시 복사)
                  </div>
                  {(() => {
                    const wsegs = whisperData.segments;
                    const selectedCount = wsegs.reduce((acc, _s, i) => {
                      return acc + (selectedTimestamps[String(i)] ? 1 : 0);
                    }, 0);
                    if (selectedCount < 1) return null;
                    return (
                      <button
                        type="button"
                        style={{
                          marginBottom: 8,
                          background: "var(--ve-card)",
                          color: "var(--ve-text)",
                          border: "1px solid var(--ve-border)",
                          padding: "6px 12px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                        onClick={() => {
                          const picked = wsegs.filter(
                            (_seg, i) => selectedTimestamps[String(i)]
                          );
                          appendWhisperSegmentsToEditor(picked);
                        }}
                      >
                        ✂️ 선택한 구간으로 편집 ({selectedCount}개)
                      </button>
                    );
                  })()}
                  <ul
                    style={{
                      maxHeight: 300,
                      overflowY: "auto",
                      marginTop: 8,
                      background: "var(--ve-panel)",
                      padding: 8,
                      borderRadius: 6,
                    }}
                  >
                    {whisperData.segments.map((seg, si) => {
                      const start = seg?.start ?? 0;
                      const end = seg?.end ?? 0;
                      const line = `[${formatTimestampSec(start)} – ${formatTimestampSec(end)}] ${String(seg?.text || "").trim()}`;
                      return (
                        <li key={si}>
                          <label
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              alignItems: "flex-start",
                              gap: 8,
                              padding: "6px 8px",
                              background: "var(--ve-panel)",
                              borderRadius: 4,
                              cursor: "pointer",
                              marginBottom: 4,
                              width: "100%",
                              boxSizing: "border-box",
                              userSelect: "none",
                            }}
                          >
                            <input
                              type="checkbox"
                              style={{
                                flexShrink: 0,
                                width: 16,
                                height: 16,
                                marginTop: 2,
                              }}
                              checked={
                                selectedTimestamps[String(si)] || false
                              }
                              onChange={(e) =>
                                setSelectedTimestamps((prev) => ({
                                  ...prev,
                                  [String(si)]: e.target.checked,
                                }))
                              }
                            />
                            <span
                              style={{
                                color: "var(--ve-text)",
                                fontSize: 12,
                                flex: 1,
                                wordBreak: "break-word",
                                lineHeight: 1.5,
                              }}
                              onClick={() => copyTimestampLine(line)}
                            >
                              {line}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
          </div>
        </div>
        {/* /오버레이 드로어 끝 */}

        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            width: "100%",
            background: "var(--ve-card)",
            paddingTop: 4,
            paddingBottom: 14,
            boxSizing: "border-box",
            marginTop: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div className="muted" style={{ fontWeight: 500 }}>
              원본 미리보기
            </div>
            <button
              type="button"
              onClick={() => setPreviewCollapsed((c) => !c)}
              aria-expanded={!previewCollapsed}
              title={previewCollapsed ? "미리보기 영상 영역 펼치기" : "미리보기 영상 영역 접기(편집기 공간 확보)"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 8,
                border: "1px solid rgba(0,0,0,0.15)",
                background: "var(--ve-card)",
                color: "var(--ve-text)",
                fontWeight: 500,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {previewCollapsed ? "🔼 미리보기 펼치기" : "🔽 미리보기 접기"}
            </button>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {EDIT_STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setLayout(opt.id);
                    setVideoScaleY(100);
                    setVideoOffsetY(50);
                    const yDef = thumbnailTextYDefaultsForLayout(opt.id);
                    setThumbnailSegment((prev) => ({
                      ...prev,
                      textY1: yDef.textY1,
                      textY2: yDef.textY2,
                    }));
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border:
                      layout === opt.id
                        ? "2px solid var(--ve-accent)"
                        : "2px solid var(--ve-border)",
                    background: layout === opt.id ? "var(--ve-success)" : "var(--ve-panel)",
                    color: layout === opt.id ? "var(--ve-accent)" : "var(--ve-border)",
                    fontWeight: 500,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              ))}
              </div>
              {savedThumbStatus === "loading" ? (
                <span
                  className="muted"
                  style={{ fontSize: 12, minHeight: 80, lineHeight: "80px" }}
                >
                  불러오는 중...
                </span>
              ) : savedThumbStatus === "ready" && savedThumbUrl ? (
                <img
                  src={savedThumbUrl}
                  alt="저장된 썸네일"
                  onError={() => setSavedThumbStatus("missing")}
                  style={{
                    height: 80,
                    width: "auto",
                    borderRadius: 6,
                    border: "2px solid var(--ve-border)",
                    objectFit: "contain",
                    display: "block",
                    flexShrink: 0,
                  }}
                />
              ) : null}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  minWidth: 140,
                  flex: "1 1 140px",
                  maxWidth: 200,
                }}
              >
                <span className="muted">세로 크기: {videoScaleY}%</span>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={1}
                  value={videoScaleY}
                  disabled={busy || uploading}
                  onChange={(e) =>
                    setVideoScaleY(clampVideoScaleY(e.target.value))
                  }
                  style={{ width: "100%" }}
                />
              </label>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  minWidth: 140,
                  flex: "1 1 140px",
                  maxWidth: 200,
                }}
              >
                <span className="muted">세로 위치: {videoOffsetY}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={videoOffsetY}
                  disabled={busy || uploading}
                  onChange={(e) =>
                    setVideoOffsetY(clampVideoOffsetY(e.target.value))
                  }
                  style={{ width: "100%" }}
                />
              </label>
            </div>
          </div>
          {uploadPhase === "done" && previewUrl ? (
            <>
            <div
              ref={previewVideoWrapRef}
                style={{
                  // 접기: display만 토글(언마운트 X) — video ref·canvas 컨텍스트 유지
                  display: previewCollapsed ? "none" : "block",
                  position: "relative",
                  width: "100%",
                  borderRadius: 8,
                  overflow: "hidden",
                  // 미리보기 매트: 영상/캔버스와 UI 사이 완충대 (액센트·상태색 금지)
                  background: "var(--ve-matte)",
                  padding: 14,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "stretch",
                    width: "100%",
                    height: PREVIEW_ROW_HEIGHT_PX,
                    minHeight: PREVIEW_ROW_HEIGHT_PX,
                    boxSizing: "border-box",
                  }}
                >
                  {/* 원본 영상 — 같은 높이(400px), 나머지 너비 flex */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: PREVIEW_ROW_HEIGHT_PX,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "relative",
                        height: PREVIEW_ROW_HEIGHT_PX,
                        maxWidth: "100%",
                      }}
                    >
                      <video
                        ref={previewVideoRef}
                        src={previewUrl}
                        controls
                        playsInline
                        onPlay={() => startPreviewLoop()}
                        onPause={() => stopPreviewLoop()}
                        onEnded={() => stopPreviewLoop()}
                        onSeeked={() => renderPreviewFrame()}
                        style={{
                          position: "relative",
                          zIndex: 0,
                          height: PREVIEW_ROW_HEIGHT_PX,
                          width: "auto",
                          maxWidth: "100%",
                          display: "block",
                          visibility: playAllActiveImageUrl ? "hidden" : "visible",
                          objectFit: "contain",
                          background: "var(--ve-matte)",
                        }}
                      />
                      {playAllActiveImageUrl ? (
                        <img
                          src={playAllActiveImageUrl}
                          alt=""
                          style={{
                            position: "absolute",
                            left: "50%",
                            top: 0,
                            transform: "translateX(-50%)",
                            zIndex: 1,
                            height: PREVIEW_ROW_HEIGHT_PX,
                            width: "auto",
                            maxWidth: "100%",
                            display: "block",
                            objectFit: "contain",
                            background: "var(--ve-matte)",
                            pointerEvents: "none",
                          }}
                        />
                      ) : null}
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
                  </div>

                  {/* 미리보기 Canvas: 9:16 고정 (width = height × 9/16) */}
                  <div
                    style={{
                      position: "relative",
                      flexShrink: 0,
                      width: PREVIEW_CANVAS_WIDTH_PX,
                      height: PREVIEW_ROW_HEIGHT_PX,
                      boxSizing: "border-box",
                      overflow: "hidden",
                      borderRadius: 6,
                    }}
                  >
                    {showRightImageSegmentPreview ? (
                      <img
                        key={`right-img-${selectedSegIndex}-${selectedImageCropOffset}`}
                        src={rightImageSegmentPreviewUrl}
                        alt=""
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          zIndex: 1,
                          width: "100%",
                          height: "100%",
                          display: "block",
                          objectFit: "cover",
                          objectPosition: rightImagePreviewObjectPosition,
                          background: "var(--ve-matte)",
                          pointerEvents: "none",
                        }}
                      />
                    ) : null}
                    <canvas
                      ref={previewCanvasRef}
                      width={160}
                      height={284}
                      style={{
                        width: PREVIEW_CANVAS_WIDTH_PX,
                        height: PREVIEW_ROW_HEIGHT_PX,
                        borderRadius: 6,
                        background: showRightImageSegmentPreview
                          ? "transparent"
                          : thumbnailSelected
                            ? "transparent"
                            : "var(--ve-matte)",
                        display: "block",
                        position: "relative",
                        zIndex: showRightImageSegmentPreview ? 2 : 0,
                      }}
                    />
                  </div>
                </div>
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
                      background: "var(--ve-panel)",
                      color: "var(--ve-text)",
                      fontWeight: 500,
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
                  <button
                    type="button"
                    onClick={addImageSegment}
                    disabled={
                      busy ||
                      uploading ||
                      segments.length >= MAX_SEGMENTS
                    }
                    title={
                      segments.length >= MAX_SEGMENTS
                        ? `구간은 최대 ${MAX_SEGMENTS}개까지`
                        : "이미지 컷 구간 추가"
                    }
                    style={{
                      background: "var(--ve-accent)",
                      color: "var(--ve-text)",
                      fontWeight: 500,
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "none",
                      cursor:
                        busy ||
                        uploading ||
                        segments.length >= MAX_SEGMENTS
                          ? "not-allowed"
                          : "pointer",
                      fontSize: 12,
                      ...(busy ||
                      uploading ||
                      segments.length >= MAX_SEGMENTS
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    + 이미지컷
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (isPlayingAll) {
                        playAllRef.current = false;
                        if (playAllImageRafRef.current != null) {
                          cancelAnimationFrame(playAllImageRafRef.current);
                          playAllImageRafRef.current = null;
                        }
                        setPlayAllActiveImageUrl(null);
                        setPlayAllVirtualSec(0);
                        previewVideoRef.current?.pause();
                        setIsPlayingAll(false);
                      } else {
                        playAllSegments();
                      }
                    }}
                    disabled={
                      busy ||
                      uploading ||
                      uploadPhase !== "done" ||
                      !previewUrl ||
                      isMonitoring
                    }
                    style={{
                      background: isPlayingAll ? "var(--ve-danger)" : "var(--ve-accent)",
                      color: "var(--ve-text)",
                      border: "none",
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: "pointer",
                      ...(busy || uploading || isMonitoring
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    {isPlayingAll ? "⏹ 중지" : "▶ 전체 재생"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (isMonitoring) {
                        monitorRef.current = false;
                        previewVideoRef.current?.pause();
                        setIsMonitoring(false);
                      } else {
                        runFullMonitor();
                      }
                    }}
                    disabled={
                      busy ||
                      uploading ||
                      uploadPhase !== "done" ||
                      !previewUrl ||
                      isPlayingAll
                    }
                    style={{
                      background: isMonitoring ? "var(--ve-warning)" : "var(--ve-success)",
                      color: "var(--ve-text)",
                      border: "none",
                      padding: "3px 10px",
                      borderRadius: 6,
                      fontSize: 12,
                      cursor: "pointer",
                      ...(busy || uploading || isPlayingAll
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    {isMonitoring ? "⏹ 모니터 중지" : "🎙 전체 모니터"}
                  </button>

                  <select
                    value={thumbnailSelected ? -1 : selectedSegIndex}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (v === -1) {
                        setThumbnailSelected(true);
                      } else {
                        setThumbnailSelected(false);
                        setSelectedSegIndex(Number.isFinite(v) ? v : 0);
                      }
                    }}
                    disabled={busy || uploading}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "var(--ve-panel)",
                      color: "var(--ve-text)",
                      border: "1px solid var(--ve-border)",
                      fontSize: 12,
                      width: 100,
                      ...(busy || uploading
                        ? { opacity: 0.6, cursor: "not-allowed" }
                        : {}),
                    }}
                  >
                    <option value={-1}>썸네일</option>
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
                      if (thumbnailSelected) {
                        setThumbnailSegment((v) => ({
                          ...v,
                          start: secondsToHhMmSs(whole),
                          startMs: frac,
                        }));
                      } else {
                        setSegments((prev) =>
                          prev.map((s, i) =>
                            i === selectedSegIndex
                              ? {
                                  ...s,
                                  start: secondsToHhMmSs(whole),
                                  startMs: frac,
                                }
                              : s
                          )
                        );
                      }
                    }}
                    style={{
                      background: "var(--ve-success)",
                      color: "var(--ve-text)",
                      border: "1px solid var(--ve-border)",
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
                      if (thumbnailSelected) {
                        setThumbnailSegment((v) => ({
                          ...v,
                          end: secondsToHhMmSs(whole),
                          endMs: frac,
                        }));
                      } else {
                        setSegments((prev) =>
                          prev.map((s, i) =>
                            i === selectedSegIndex
                              ? {
                                  ...s,
                                  end: secondsToHhMmSs(whole),
                                  endMs: frac,
                                }
                              : s
                          )
                        );
                      }
                    }}
                    style={{
                      background: "var(--ve-card)",
                      color: "var(--ve-accent)",
                      border: "1px solid var(--ve-accent)",
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

                  <button
                    type="button"
                    disabled={
                      busy ||
                      uploading ||
                      segments.length <= 1 ||
                      thumbnailSelected
                    }
                    onClick={deleteSelectedSegment}
                    title={
                      segments.length <= 1
                        ? "구간은 최소 1개 필요합니다"
                        : "현재 선택 구간 삭제"
                    }
                    style={{
                      background: "var(--ve-panel)",
                      color: "var(--ve-danger)",
                      border: "1px solid rgba(248, 113, 113, 0.55)",
                      padding: "3px 8px",
                      borderRadius: 6,
                      cursor:
                        busy || uploading || segments.length <= 1
                          ? "not-allowed"
                          : "pointer",
                      fontSize: 12,
                      ...(busy || uploading || segments.length <= 1
                        ? { opacity: 0.55 }
                        : {}),
                    }}
                  >
                    🗑 구간 삭제
                  </button>

                  <span
                    style={{
                      color: "var(--ve-text-sub)",
                      fontSize: 12,
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
          // 매직넘버(calc(100vh-680px)) 제거 → 컨테이너의 남는 공간을 채우고,
          // min-height:0으로 내용보다 작아질 수 있게 해 좌/우 컬럼의 overflowY 스크롤이 동작.
          flex: "1 1 0",
          minHeight: 0,
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
            {/* 썸네일 특수 구간 */}
            <div
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
                setThumbnailSelected(true);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "8px",
                borderRadius: 8,
                border: thumbnailSelected
                  ? "2px solid rgba(96,165,250,1)"
                  : "1px solid var(--ve-border)",
                background: "var(--ve-panel)",
                cursor: "pointer",
                overflow: "hidden",
              }}
            >
              {/* 1행: 시간 입력 / 2행: 미세조정 버튼 (일반 구간과 동일 구조) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "16px 44px 58px 6px 30px 8px 44px 58px 6px 30px 18px",
                  columnGap: 4,
                  rowGap: 6,
                  alignItems: "center",
                  overflowX: "hidden",
                }}
              >
                {/* 1행 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (thumbnailEnabled) {
                      setThumbnailSegment((prev) => ({
                        ...prev,
                        end: "",
                        endMs: 0,
                      }));
                    } else {
                      setThumbnailSegment((prev) => ({
                        ...prev,
                        end: "00:00:00",
                        endMs: 10,
                      }));
                    }
                    setThumbnailEnabled((prev) => !prev);
                  }}
                  style={{
                    gridColumn: 1,
                    gridRow: 1,
                    justifySelf: "start",
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: "none",
                    cursor: "pointer",
                    background: thumbnailEnabled ? "var(--ve-success)" : "var(--ve-danger)",
                    color: "var(--ve-text)",
                    fontSize: 13,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {thumbnailEnabled ? "O" : "X"}
                </button>

                <button
                  type="button"
                  disabled={busy || uploading}
                  onClick={(e) => {
                    e.stopPropagation();
                    seekPreviewToThumbnailBoundary("start");
                  }}
                  style={{
                    gridColumn: 2,
                    gridRow: 1,
                    background: "var(--ve-success)",
                    border: "1px solid var(--ve-border)",
                    color: "var(--ve-text)",
                    padding: "2px 4px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
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
                  value={thumbnailSegment.start}
                  onChange={(e) => handleThumbnailTimeChange("start", e.target.value)}
                  disabled={busy || uploading || !thumbnailEnabled}
                  style={{
                    gridColumn: 3,
                    gridRow: 1,
                    padding: "4px 6px",
                    width: 58,
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
                <span
                  className="muted"
                  style={{
                    gridColumn: 4,
                    gridRow: 1,
                    userSelect: "none",
                    margin: "0 2px",
                    justifySelf: "center",
                  }}
                >
                  .
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder=".00"
                  value={String(clampSegmentFracMs(thumbnailSegment.startMs ?? 0)).padStart(
                    2,
                    "0"
                  )}
                  onChange={(e) => handleThumbnailFracMsChange("startMs", e.target.value)}
                  disabled={busy || uploading || !thumbnailEnabled}
                  title="시작 소수 초 (0.01초 단위, 00~99)"
                  style={{
                    gridColumn: 5,
                    gridRow: 1,
                    padding: "4px 6px",
                    width: 30,
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
                <span
                  className="muted"
                  style={{
                    gridColumn: 6,
                    gridRow: 1,
                    justifySelf: "center",
                    margin: "0 3px",
                  }}
                >
                  ~
                </span>

                <button
                  type="button"
                  disabled={busy || uploading}
                  onClick={(e) => {
                    e.stopPropagation();
                    seekPreviewToThumbnailBoundary("end");
                  }}
                  style={{
                    gridColumn: 7,
                    gridRow: 1,
                    background: "var(--ve-success)",
                    border: "1px solid var(--ve-border)",
                    color: "var(--ve-text)",
                    padding: "2px 4px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
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
                  value={thumbnailSegment.end}
                  onChange={(e) => handleThumbnailTimeChange("end", e.target.value)}
                  disabled={busy || uploading || !thumbnailEnabled}
                  style={{
                    gridColumn: 8,
                    gridRow: 1,
                    padding: "4px 6px",
                    width: 58,
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
                <span
                  className="muted"
                  style={{
                    gridColumn: 9,
                    gridRow: 1,
                    userSelect: "none",
                    margin: "0 2px",
                    justifySelf: "center",
                  }}
                >
                  .
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder=".00"
                  value={String(clampSegmentFracMs(thumbnailSegment.endMs ?? 0)).padStart(
                    2,
                    "0"
                  )}
                  onChange={(e) => handleThumbnailFracMsChange("endMs", e.target.value)}
                  disabled={busy || uploading || !thumbnailEnabled}
                  title="종료 소수 초 (0.01초 단위, 00~99)"
                  style={{
                    gridColumn: 10,
                    gridRow: 1,
                    padding: "4px 6px",
                    width: 30,
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />

                <span
                  className="muted"
                  style={{
                    gridColumn: 11,
                    gridRow: 1,
                    fontSize: 12,
                    lineHeight: 1,
                    justifySelf: "end",
                    color: "var(--ve-accent)",
                    fontWeight: 500,
                  }}
                  title="썸네일 배지"
                >
                  썸
                </span>

                {/* 2행: 시작/종료 미세조정 */}
                <div
                  style={{
                    gridColumn: "2 / span 4",
                    gridRow: 2,
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                    paddingLeft: 0,
                  }}
                >
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
                      adjustThumbnailFieldTime("start", -ONE_FRAME_30_FPS_SEC);
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
                      adjustThumbnailFieldTime("start", -TENTH_SEC);
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
                      adjustThumbnailFieldTime("start", TENTH_SEC);
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
                      adjustThumbnailFieldTime("start", ONE_FRAME_30_FPS_SEC);
                    }}
                  >
                    +1f
                  </button>
                </div>

                <div
                  style={{
                    gridColumn: "7 / span 4",
                    gridRow: 2,
                    display: "flex",
                    gap: 4,
                    alignItems: "center",
                  }}
                >
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
                      adjustThumbnailFieldTime("end", -ONE_FRAME_30_FPS_SEC);
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
                      adjustThumbnailFieldTime("end", -TENTH_SEC);
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
                      adjustThumbnailFieldTime("end", TENTH_SEC);
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
                      adjustThumbnailFieldTime("end", ONE_FRAME_30_FPS_SEC);
                    }}
                  >
                    +1f
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginTop: 4,
                }}
              >
                <textarea
                  rows={1}
                  placeholder="나레이션 텍스트"
                  value={thumbnailSegment.narration ?? ""}
                  disabled={busy || uploading || narrationBusy}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setThumbnailSegment((v) => ({
                      ...v,
                      narration: e.target.value,
                    }))
                  }
                  style={{
                    width: "100%",
                    minHeight: 28,
                    maxHeight: 40,
                    resize: "none",
                    boxSizing: "border-box",
                    fontFamily: "inherit",
                    fontSize: 12,
                    padding: "4px 6px",
                    borderRadius: 4,
                    border: "1px solid var(--ve-border)",
                    background: "var(--ve-panel)",
                    color: "var(--ve-border)",
                  }}
                />
                {(() => {
                  const m = narrationLengthLineModel(
                    thumbnailSegment.narrationDuration,
                    thumbnailSegment
                  );
                  if (!m) return null;
                  return (
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.35,
                        userSelect: "none",
                      }}
                    >
                      <span
                        style={{ color: m.warn ? "var(--ve-warning)" : "var(--ve-text-sub)" }}
                      >
                        {m.text}
                      </span>
                    </div>
                  );
                })()}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "stretch",
                    gap: 6,
                    flexWrap: "nowrap",
                  }}
                >
                  <button
                    type="button"
                    disabled={
                      busy ||
                      uploading ||
                      narrationBusy ||
                      !jobId ||
                      !String(thumbnailSegment.narration ?? "").trim()
                    }
                    title={
                      !jobId
                        ? "원본 업로드 완료 후 사용"
                        : !String(thumbnailSegment.narration ?? "").trim()
                          ? "나레이션을 입력하세요"
                          : "ElevenLabs TTS 미리듣기 (썸네일 구간)"
                    }
                    onClick={async (e) => {
                      e.stopPropagation();
                      const narrText = String(
                        thumbnailSegment.narration ?? ""
                      ).trim();
                      if (!narrText || !jobId) return;
                      const prevA = narrationAudioRef.current;
                      if (prevA) {
                        try {
                          prevA.pause();
                        } catch {
                          /* ignore */
                        }
                        prevA.src = "";
                        narrationAudioRef.current = null;
                      }
                      setNarrationBusy(true);
                      setError(null);
                      try {
                        const json = await postKbo({
                          action: "elevenlabs_tts",
                          jobId,
                          segIndex: 0,
                          text: narrText,
                          voiceId: narrationVoiceId,
                          speed: narrationSpeed,
                          stability: narrationStability,
                          style: narrationStyle,
                        });
                        const url = json?.presignedUrl;
                        if (!url || typeof url !== "string") {
                          throw new Error("미리듣기 URL을 받지 못했습니다.");
                        }
                        setThumbnailSegment((prev) => ({
                          ...prev,
                          narrationAudioUrl: url,
                        }));
                        const audio = new Audio(url);
                        audio.onloadedmetadata = () => {
                          const d = audio.duration;
                          if (!Number.isFinite(d) || d < 0) return;
                          setThumbnailSegment((prev) => ({
                            ...prev,
                            narrationDuration: d,
                          }));
                        };
                        narrationAudioRef.current = audio;
                        await audio.play();
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : String(err)
                        );
                      } finally {
                        setNarrationBusy(false);
                      }
                    }}
                    style={{
                      ...NARRATION_ROW_BTN_BASE,
                      ...NARRATION_ROW_BTN_TTS,
                      cursor:
                        busy ||
                        uploading ||
                        narrationBusy ||
                        !jobId ||
                        !String(thumbnailSegment.narration ?? "").trim()
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        busy ||
                        uploading ||
                        narrationBusy ||
                        !jobId ||
                        !String(thumbnailSegment.narration ?? "").trim()
                          ? 0.5
                          : 1,
                    }}
                  >
                    ▶ 미리듣기
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      uploading ||
                      !previewUrl ||
                      isPlayingAll ||
                      isMonitoring ||
                      String(thumbnailSegment.end || "").trim() === ""
                    }
                    title={
                      String(thumbnailSegment.end || "").trim() === ""
                        ? "종료 시각을 설정하세요"
                        : "썸네일 시작~종료 구간만 재생"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      playThumbnailSegmentPreview();
                    }}
                    style={{
                      ...NARRATION_ROW_BTN_BASE,
                      ...NARRATION_ROW_BTN_SEGMENT_PLAY,
                      cursor:
                        busy ||
                        uploading ||
                        !previewUrl ||
                        isPlayingAll ||
                        isMonitoring ||
                        String(thumbnailSegment.end || "").trim() === ""
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        busy ||
                        uploading ||
                        !previewUrl ||
                        isPlayingAll ||
                        isMonitoring ||
                        String(thumbnailSegment.end || "").trim() === ""
                          ? 0.5
                          : 1,
                    }}
                  >
                    ▶ 구간 재생
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      uploading ||
                      isMonitoring ||
                      isPlayingAll ||
                      segments.length >= MAX_SEGMENTS
                    }
                    title={
                      segments.length >= MAX_SEGMENTS
                        ? `구간은 최대 ${MAX_SEGMENTS}개까지`
                        : "첫 본편 구간 앞에 빈 구간 삽입"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      insertSegmentBeforeFirst();
                    }}
                    style={{
                      ...NARRATION_ROW_BTN_BASE,
                      cursor:
                        busy ||
                        uploading ||
                        isMonitoring ||
                        isPlayingAll ||
                        segments.length >= MAX_SEGMENTS
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        busy ||
                        uploading ||
                        isMonitoring ||
                        isPlayingAll ||
                        segments.length >= MAX_SEGMENTS
                          ? 0.5
                          : 1,
                    }}
                  >
                    + 구간 삽입
                  </button>
                </div>
              </div>
            </div>

            {segments.map((seg, index) => (
              <div
                key={seg?.id || index}
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
                      ? "2px solid var(--ve-accent)"
                      : "1px solid var(--ve-border)",
                  background:
                    selectedSegIndex === index
                      ? "var(--ve-card)"
                      : "var(--ve-panel)",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                {/* 요약 행 (항상 표시) — 클릭 시 selectSegment는 카드 outer onClick이 처리 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 40,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: 12,
                      color: selectedSegIndex === index ? "var(--ve-accent)" : "var(--ve-text-sub)",
                    }}
                  >
                    #{index + 1}
                  </span>
                  <span style={{ fontSize: 12 }}>
                    {isImageSegment(seg) ? "🖼️" : "🎬"}
                  </span>
                  <span
                    className="muted"
                    style={{ fontSize: 12, whiteSpace: "nowrap" }}
                  >
                    {isImageSegment(seg)
                      ? "이미지"
                      : `${String(seg.start || "—")}~${String(seg.end || "—")}`}
                  </span>
                  {(() => {
                    const dur = playAllSegmentDurationSec(seg);
                    return dur != null ? (
                      <span
                        className="muted"
                        style={{ fontSize: 12, whiteSpace: "nowrap", opacity: 0.75 }}
                      >
                        {dur.toFixed(1)}초
                      </span>
                    ) : null;
                  })()}
                  {String(seg.text || "").trim() ? (
                    <span
                      className="muted"
                      title={String(seg.text)}
                      style={{
                        fontSize: 12,
                        opacity: 0.7,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {String(seg.text).split("\n")[0]}
                    </span>
                  ) : (
                    <span style={{ flex: 1, minWidth: 0 }} />
                  )}
                  <button
                    type="button"
                    title="이 구간만 재생/일시정지"
                    disabled={
                      busy ||
                      uploading ||
                      !previewUrl ||
                      uploadPhase !== "done" ||
                      isPlayingAll ||
                      isMonitoring ||
                      !segmentPlaybackTimesValid(seg)
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSegmentPreviewPlayback(index);
                    }}
                    style={{
                      flexShrink: 0,
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--ve-border)",
                      background: "var(--ve-card)",
                      color: "var(--ve-text)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {playingSegmentIndex === index && !previewPlaybackPaused
                      ? "⏸"
                      : "▶"}
                  </button>
                  <button
                    type="button"
                    title={
                      selectedSegIndex === index
                        ? "이 구간 삭제"
                        : "먼저 선택 후 삭제"
                    }
                    disabled={
                      busy ||
                      uploading ||
                      isPlayingAll ||
                      isMonitoring ||
                      segments.length <= 1
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedSegIndex === index) {
                        deleteSelectedSegment();
                      } else {
                        selectSegment(index);
                      }
                    }}
                    style={{
                      flexShrink: 0,
                      padding: "3px 8px",
                      borderRadius: 6,
                      border: "1px solid rgba(248,113,113,0.4)",
                      background: "rgba(248,113,113,0.12)",
                      color: "var(--ve-danger)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    🗑
                  </button>
                </div>
                {/* 본문 — 선택 구간만 펼침(display 토글만, 언마운트 X → 입력/포커스/스크롤 유지) */}
                <div
                  style={{
                    display: selectedSegIndex === index ? "block" : "none",
                  }}
                >
                {isImageSegment(seg) ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        className="muted"
                        style={{
                          fontWeight: 500,
                          fontSize: 12,
                          userSelect: "none",
                        }}
                      >
                        #{index + 1} 🖼️ 이미지
                      </span>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "4px 10px",
                          borderRadius: 6,
                          background: "var(--ve-card)",
                          border: "1px solid var(--ve-accent)",
                          color: "var(--ve-accent)",
                          fontSize: 12,
                          cursor:
                            busy || uploading ? "not-allowed" : "pointer",
                          opacity: busy || uploading ? 0.55 : 1,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="file"
                          accept="image/*"
                          disabled={busy || uploading}
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setSegments((prev) =>
                              prev.map((s, i) => {
                                if (i !== index) return s;
                                if (s.imagePreviewUrl) {
                                  try {
                                    URL.revokeObjectURL(s.imagePreviewUrl);
                                  } catch {
                                    /* ignore */
                                  }
                                }
                                return {
                                  ...s,
                                  imageLocalFile: file,
                                  imagePreviewUrl: URL.createObjectURL(file),
                                  imageS3Key: "",
                                };
                              })
                            );
                            e.target.value = "";
                          }}
                        />
                        이미지 선택
                      </label>
                      <label
                        className="muted"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 12,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        표시(초)
                        <input
                          type="number"
                          min={0.5}
                          max={10}
                          step={0.1}
                          disabled={busy || uploading}
                          value={clampImageDurationSec(seg.duration)}
                          onChange={(e) => {
                            setSegments((prev) =>
                              prev.map((s, i) =>
                                i === index
                                  ? {
                                      ...s,
                                      duration: clampImageDurationSec(
                                        e.target.value
                                      ),
                                    }
                                  : s
                              )
                            );
                          }}
                          style={{
                            width: 52,
                            padding: "4px 6px",
                            fontSize: 12,
                            boxSizing: "border-box",
                          }}
                        />
                      </label>
                    </div>
                    {seg.imagePreviewUrl ? (
                      <img
                        src={seg.imagePreviewUrl}
                        alt=""
                        style={{
                          height: 100,
                          width: "auto",
                          maxWidth: "100%",
                          objectFit: "contain",
                          borderRadius: 6,
                          border: "1px solid var(--ve-border)",
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                <>
                {/* 1행: # + 시간 입력 / 2행: 미세조정 */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "32px 44px 58px 6px 30px 8px 44px 58px 6px 30px",
                    columnGap: 4,
                    rowGap: 6,
                    alignItems: "center",
                    overflowX: "hidden",
                  }}
                >
                  <span
                    className="muted"
                    style={{
                      gridColumn: 1,
                      gridRow: 1,
                      fontWeight: 500,
                      fontSize: 12,
                      userSelect: "none",
                      justifySelf: "start",
                    }}
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
                      gridColumn: 2,
                      gridRow: 1,
                      background: "var(--ve-success)",
                      border: "1px solid var(--ve-border)",
                      color: "var(--ve-text)",
                      padding: "2px 4px",
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: "pointer",
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
                      gridColumn: 3,
                      gridRow: 1,
                      padding: "4px 6px",
                      width: 58,
                      fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />
                  <span
                    className="muted"
                    style={{
                      gridColumn: 4,
                      gridRow: 1,
                      userSelect: "none",
                      margin: "0 2px",
                      justifySelf: "center",
                    }}
                  >
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
                      gridColumn: 5,
                      gridRow: 1,
                      padding: "4px 6px",
                      width: 30,
                      fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />
                  <span
                    className="muted"
                    style={{
                      gridColumn: 6,
                      gridRow: 1,
                      justifySelf: "center",
                      margin: "0 3px",
                    }}
                  >
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
                      gridColumn: 7,
                      gridRow: 1,
                      background: "var(--ve-success)",
                      border: "1px solid var(--ve-border)",
                      color: "var(--ve-text)",
                      padding: "2px 4px",
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: "pointer",
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
                      gridColumn: 8,
                      gridRow: 1,
                      padding: "4px 6px",
                      width: 58,
                      fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />
                  <span
                    className="muted"
                    style={{
                      gridColumn: 9,
                      gridRow: 1,
                      userSelect: "none",
                      margin: "0 2px",
                      justifySelf: "center",
                    }}
                  >
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
                      gridColumn: 10,
                      gridRow: 1,
                      padding: "4px 6px",
                      width: 30,
                      fontSize: 12,
                      boxSizing: "border-box",
                    }}
                  />

                  {/* 2행: 시작/종료 미세조정 */}
                  <div
                    style={{
                      gridColumn: "2 / span 4",
                      gridRow: 2,
                      display: "flex",
                      gap: 4,
                      alignItems: "center",
                      paddingLeft: 0,
                    }}
                  >
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

                  <div
                    style={{
                      gridColumn: "7 / span 4",
                      gridRow: 2,
                      display: "flex",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
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
                </>
                )}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    marginTop: 4,
                  }}
                >
                  <textarea
                    rows={1}
                    placeholder="나레이션 텍스트"
                    value={seg.narration ?? ""}
                    disabled={busy || uploading || narrationBusy}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setSegments((prev) =>
                        prev.map((s, i) =>
                          i === index
                            ? { ...s, narration: e.target.value }
                            : s
                        )
                      )
                    }
                    style={{
                      width: "100%",
                      minHeight: 28,
                      maxHeight: 40,
                      resize: "none",
                      boxSizing: "border-box",
                      fontFamily: "inherit",
                      fontSize: 12,
                      padding: "4px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--ve-border)",
                      background: "var(--ve-panel)",
                      color: "var(--ve-border)",
                    }}
                  />
                  {(() => {
                    const m = narrationLengthLineModel(
                      seg.narrationDuration,
                      seg
                    );
                    if (!m) return null;
                    return (
                      <div
                        style={{
                          fontSize: 12,
                          lineHeight: 1.35,
                          userSelect: "none",
                        }}
                      >
                        <span
                          style={{ color: m.warn ? "var(--ve-warning)" : "var(--ve-text-sub)" }}
                        >
                          {m.text}
                        </span>
                      </div>
                    );
                  })()}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "stretch",
                      gap: 6,
                      flexWrap: "nowrap",
                    }}
                  >
                    <button
                      type="button"
                      disabled={
                        busy ||
                        uploading ||
                        narrationBusy ||
                        !jobId ||
                        !String(seg.narration ?? "").trim()
                      }
                      title={
                        !jobId
                          ? "원본 업로드 완료 후 사용"
                          : !String(seg.narration ?? "").trim()
                            ? "나레이션을 입력하세요"
                            : "ElevenLabs TTS 미리듣기"
                      }
                      onClick={async (e) => {
                        e.stopPropagation();
                        const narrText = String(seg.narration ?? "").trim();
                        if (!narrText || !jobId) return;
                        const prevA = narrationAudioRef.current;
                        if (prevA) {
                          try {
                            prevA.pause();
                          } catch {
                            /* ignore */
                          }
                          prevA.src = "";
                          narrationAudioRef.current = null;
                        }
                        setNarrationBusy(true);
                        setError(null);
                        try {
                          const segIdxTts = thumbnailTimingValid
                            ? index + 1
                            : index;
                          const json = await postKbo({
                            action: "elevenlabs_tts",
                            jobId,
                            segIndex: segIdxTts,
                            text: narrText,
                            voiceId: narrationVoiceId,
                            speed: narrationSpeed,
                            stability: narrationStability,
                            style: narrationStyle,
                          });
                          const url = json?.presignedUrl;
                          if (!url || typeof url !== "string") {
                            throw new Error("미리듣기 URL을 받지 못했습니다.");
                          }
                          setSegments((prev) =>
                            prev.map((s, i) =>
                              i === index ? { ...s, narrationAudioUrl: url } : s
                            )
                          );
                          const audio = new Audio(url);
                          audio.onloadedmetadata = () => {
                            const d = audio.duration;
                            if (!Number.isFinite(d) || d < 0) return;
                            setSegments((prev) =>
                              prev.map((s, i) =>
                                i === index ? { ...s, narrationDuration: d } : s
                              )
                            );
                          };
                          narrationAudioRef.current = audio;
                          await audio.play();
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : String(err)
                          );
                        } finally {
                          setNarrationBusy(false);
                        }
                      }}
                      style={{
                        ...NARRATION_ROW_BTN_BASE,
                        ...NARRATION_ROW_BTN_TTS,
                        cursor:
                          busy ||
                          uploading ||
                          narrationBusy ||
                          !jobId ||
                          !String(seg.narration ?? "").trim()
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          busy ||
                          uploading ||
                          narrationBusy ||
                          !jobId ||
                          !String(seg.narration ?? "").trim()
                            ? 0.5
                            : 1,
                      }}
                    >
                      ▶ 미리듣기
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        uploading ||
                        !previewUrl ||
                        uploadPhase !== "done" ||
                        isPlayingAll ||
                        isMonitoring ||
                        !segmentPlaybackTimesValid(seg)
                      }
                      title={
                        previewUrl
                          ? "미리보기 영상으로 이 구간만 재생"
                          : "원본 업로드 후 사용"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSegmentPreviewPlayback(index);
                      }}
                      style={{
                        ...NARRATION_ROW_BTN_BASE,
                        ...NARRATION_ROW_BTN_SEGMENT_PLAY,
                        cursor:
                          busy ||
                          uploading ||
                          !previewUrl ||
                          uploadPhase !== "done" ||
                          isPlayingAll ||
                          isMonitoring ||
                          !segmentPlaybackTimesValid(seg)
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          busy ||
                          uploading ||
                          !previewUrl ||
                          uploadPhase !== "done" ||
                          isPlayingAll ||
                          isMonitoring ||
                          !segmentPlaybackTimesValid(seg)
                            ? 0.5
                            : 1,
                      }}
                    >
                      {playingSegmentIndex === index && !previewPlaybackPaused
                        ? "⏸ 일시정지"
                        : "▶ 구간 재생"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        uploading ||
                        isPlayingAll ||
                        isMonitoring ||
                        segments.length >= MAX_SEGMENTS
                      }
                      title={
                        segments.length >= MAX_SEGMENTS
                          ? `구간은 최대 ${MAX_SEGMENTS}개까지`
                          : "이 구간 다음에 빈 구간 삽입"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        insertSegmentAfter(index);
                      }}
                      style={{
                        ...NARRATION_ROW_BTN_BASE,
                        cursor:
                          busy ||
                          uploading ||
                          isPlayingAll ||
                          isMonitoring ||
                          segments.length >= MAX_SEGMENTS
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          busy ||
                          uploading ||
                          isPlayingAll ||
                          isMonitoring ||
                          segments.length >= MAX_SEGMENTS
                            ? 0.5
                            : 1,
                      }}
                    >
                      + 구간 삽입
                    </button>
                  </div>
                </div>
                </div>{/* /본문 래퍼 */}
              </div>
            ))}
            <button
              type="button"
              disabled={!jobId || busy || uploading}
              title={
                !jobId
                  ? "저장된 원본을 불러온 뒤 사용할 수 있습니다"
                  : "localStorage 임시저장 삭제 및 편집 초기화"
              }
              onClick={onResetDraft}
              style={{
                alignSelf: "flex-start",
                marginTop: 4,
                background: "var(--ve-panel)",
                color: "var(--ve-danger)",
                border: "1px solid rgba(248, 113, 113, 0.45)",
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 12,
                cursor:
                  !jobId || busy || uploading ? "not-allowed" : "pointer",
                opacity: !jobId || busy || uploading ? 0.55 : 1,
              }}
            >
              임시저장 초기화
            </button>
          </div>

          {/* 구간 추가 버튼 */}
          {/*
            팀 선택/구간 추가는 상단 sticky 컨트롤바로 이동됨
          */}

          {/* 총 구간 합계 + 원본 음소거 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 16,
              marginTop: 6,
            }}
          >
            <span style={{ color: "var(--ve-text-sub)", fontSize: 12, ...segmentTotalWarnStyle }}>
              총 {secondsToHhMmSs(segmentTotalSec)} ({Math.floor(segmentTotalSec)}초)
            </span>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--ve-text-sub)",
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
              원본 음소거
            </label>
          </div>

          {/* 구분선 */}
          <hr style={{ borderColor: "var(--ve-card)", margin: "8px 0" }} />

          {/* 커버박스 (전체 공통) */}
          <div style={{ maxWidth: 480, marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 8,
                marginBottom: 8,
                width: "fit-content",
              }}
            >
              <span
                className="muted"
                style={{ fontWeight: 500, whiteSpace: "nowrap" }}
              >
                커버박스
              </span>
              <input
                type="checkbox"
                checked={coverBox.enabled}
                onChange={(e) =>
                  setCoverBox((v) => ({ ...v, enabled: e.target.checked }))
                }
              />
            </div>
            <p
              className="muted"
              style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.45 }}
            >
              모든 구간에 동일하게 적용됩니다. 색상은 팀 컬러를 사용합니다. 위치·크기는
              중앙 영역(홀) 기준 %입니다.
            </p>
            {(() => {
              const covOn = Boolean(coverBox.enabled);
              const num = (k, fallback) => {
                const n = Number(coverBox[k]);
                return Number.isFinite(n)
                  ? Math.min(100, Math.max(0, Math.round(n)))
                  : fallback;
              };
              const xv = num("x", 0);
              const yv = num("y", 50);
              const wv = num("width", 100);
              const hv = num("height", 10);
              const patchCover = (key, rawVal) => {
                setCoverBox((prev) => {
                  if (key === "enabled") {
                    return { ...prev, enabled: Boolean(rawVal) };
                  }
                  const n = Number(rawVal);
                  const v = Number.isFinite(n)
                    ? Math.min(100, Math.max(0, Math.round(n)))
                    : prev[key];
                  return { ...prev, [key]: v };
                });
              };
              const sliderRow = (label, key, val) => (
                <label
                  className="muted"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    minWidth: 0,
                  }}
                >
                  {label}: {val}%
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={val}
                      disabled={busy || uploading || !covOn}
                      onChange={(e) => patchCover(key, e.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={val}
                      disabled={busy || uploading || !covOn}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        patchCover(
                          key,
                          Math.min(100, Math.max(0, Math.round(n)))
                        );
                      }}
                      style={{
                        width: 52,
                        padding: "2px 4px",
                        fontSize: 12,
                        boxSizing: "border-box",
                        background: "var(--ve-panel)",
                        color: "var(--ve-text)",
                        border: "1px solid var(--ve-border)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </label>
              );
              return (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  {sliderRow("X", "x", xv)}
                  {sliderRow("Y", "y", yv)}
                  {sliderRow("너비", "width", wv)}
                  {sliderRow("높이", "height", hv)}
                </div>
              );
            })()}
          </div>

          {/* 나레이션 공통 (TTS) */}
          <div style={{ maxWidth: 480, marginBottom: 10 }}>
            <div className="muted" style={{ fontWeight: 500, marginBottom: 10 }}>
              나레이션 설정
            </div>
            <label className="preset-field">
              <span>음성 선택</span>
              <select
                value={narrationVoiceId}
                disabled={busy || uploading}
                onChange={(e) => setNarrationVoiceId(e.target.value)}
              >
                {VOICE_OPTIONS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="preset-field">
              <span>속도 ({narrationSpeed.toFixed(2)})</span>
              <input
                type="range"
                min={0.7}
                max={1.2}
                step={0.05}
                value={narrationSpeed}
                disabled={busy || uploading}
                onChange={(e) =>
                  setNarrationSpeed(Number(e.target.value) || 1.0)
                }
              />
            </label>
            <label className="preset-field">
              <span>
                안정성 (낮을수록 다양 / 높을수록 일관된 톤) (
                {narrationStability.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={narrationStability}
                disabled={busy || uploading}
                onChange={(e) =>
                  setNarrationStability(Number(e.target.value) || 0)
                }
              />
            </label>
            <label className="preset-field">
              <span>
                스타일 (높을수록 더 극적인 표현) ({narrationStyle.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={narrationStyle}
                disabled={busy || uploading}
                onChange={(e) =>
                  setNarrationStyle(Number(e.target.value) || 0)
                }
              />
            </label>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              미리듣기·영상 생성 시 ElevenLabs TTS에 공통 적용됩니다.
            </p>
          </div>

          {/* BGM 설정 */}
          <div style={{ maxWidth: 480 }}>
            <div className="muted" style={{ fontWeight: 500, marginBottom: 10 }}>
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
              <span style={{ color: "var(--ve-text-sub)", fontSize: 12, whiteSpace: "nowrap" }}>
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
                  fontSize: 12,
                  background: "var(--ve-panel)",
                  color: "var(--ve-text)",
                  border: "1px solid var(--ve-border)",
                  borderRadius: 4,
                }}
              />
              <span style={{ color: "var(--ve-text-sub)", fontSize: 12 }}>초</span>
              <span
                style={{
                  color: "var(--ve-text-sub)",
                  fontSize: 12,
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
              <span style={{ color: "var(--ve-text-sub)", fontSize: 12, minWidth: 30 }}>
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
                  color: "var(--ve-success)",
                  fontWeight: 500,
                  background: "var(--ve-success)",
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
                  color: "var(--ve-success)",
                  fontWeight: 500,
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
            minWidth: 0,
            paddingLeft: 4,
            overflowX: "hidden",
            overflowY: "auto",
          }}
        >
          <div className="label">
            {thumbnailSelected
              ? "썸네일 · 세부 설정"
              : `구간 #${selectedSegIndex + 1} · 세부 설정`}
          </div>
          {thumbnailSelected ? (
            <p
              className="muted"
              style={{
                fontSize: 12,
                marginTop: 6,
                marginBottom: 12,
                lineHeight: 1.45,
              }}
            >
              썸네일로 사용하려면 종료점을 시작점+최소 0.1초로 설정하세요
            </p>
          ) : null}

          {thumbnailSelected ? (
            <div style={{ marginBottom: 12 }}>
              {/* 크롭 오프셋 (썸네일 전용) */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <span
                  className="muted"
                  style={{ fontSize: 12, fontWeight: 500, flexShrink: 0 }}
                >
                  크롭 오프셋
                </span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={thumbnailSegment.cropOffset ?? 0}
                  disabled={busy || uploading}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const v = Number.isFinite(n)
                      ? Math.min(50, Math.max(-50, Math.round(n)))
                      : 0;
                    setThumbnailSegment((cur) => ({ ...cur, cropOffset: v }));
                    const vid = previewVideoRef.current;
                    if (vid) setPreviewCropOverlay(computePreviewCropOverlay(vid, v));
                  }}
                  style={{ flex: 1, minWidth: 140 }}
                />
                <span
                  className="muted"
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {formatCropOffsetLabel(thumbnailSegment.cropOffset ?? 0)}
                </span>
              </div>

              <div className="label">텍스트 1</div>
              <label className="preset-field" style={{ marginBottom: 10 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>텍스트 1 (비우면 미표시)</span>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: busy || uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(thumbnailSegment.keepText1)}
                      disabled={busy || uploading}
                      onChange={(e) =>
                        setThumbnailSegment((v) => ({
                          ...v,
                          keepText1: e.target.checked,
                        }))
                      }
                    />
                    전체유지
                  </label>
                </span>
                <input
                  type="text"
                  value={thumbnailSegment.text1}
                  disabled={busy || uploading}
                  onChange={(e) =>
                    setThumbnailSegment((v) => ({ ...v, text1: e.target.value }))
                  }
                />
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <label className="preset-field" style={{ flex: "1 1 200px", minWidth: 160 }}>
                  <span>폰트</span>
                  <select
                    value={thumbnailSegment.font1}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      setThumbnailSegment((v) => ({ ...v, font1: e.target.value }))
                    }
                  >
                    <option value="NotoSansKR-Bold">NotoSansKR Bold</option>
                    <option value="BlackHanSans-Regular">BlackHanSans</option>
                    <option value="NotoSerifKR-Bold">NotoSerifKR Bold</option>
                    <option value="GamjaFlower-Regular">감자꽃</option>
                  </select>
                </label>
                <label className="muted" style={{ flex: "2 1 220px", minWidth: 160, fontSize: 13, fontWeight: 500 }}>
                  크기 ({Math.round(Math.min(200, Math.max(20, Number(thumbnailSegment.fontSize1) || 88)))}px)
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <input
                      type="range"
                      min={20}
                      max={200}
                      step={1}
                      value={Math.min(200, Math.max(20, Number(thumbnailSegment.fontSize1) || 88))}
                      disabled={busy || uploading}
                      onChange={(e) =>
                        setThumbnailSegment((v) => ({
                          ...v,
                          fontSize1: Number(e.target.value),
                        }))
                      }
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number"
                      min={20}
                      max={200}
                      step={1}
                      value={Math.min(200, Math.max(20, Number(thumbnailSegment.fontSize1) || 88))}
                      disabled={busy || uploading}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        const v = Math.min(200, Math.max(20, Math.round(n)));
                        setThumbnailSegment((cur) => ({ ...cur, fontSize1: v }));
                      }}
                      style={{
                        width: 52,
                        padding: "2px 4px",
                        fontSize: 12,
                        boxSizing: "border-box",
                        background: "var(--ve-panel)",
                        color: "var(--ve-text)",
                        border: "1px solid var(--ve-border)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </label>
                <div
                  className="muted"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    flex: "1 1 200px",
                    minWidth: 160,
                  }}
                >
                  폰트 색상
                  <TextColorPalette
                    value={thumbnailSegment.textColor1}
                    disabled={busy || uploading}
                    onChange={(c) =>
                      setThumbnailSegment((v) => ({ ...v, textColor1: c }))
                    }
                  />
                </div>
              </div>


              <label
                className="muted"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  marginTop: 6,
                  marginBottom: 10,
                }}
              >
                세로 위치 (텍스트 1): {thumbnailSegment.textY1 ?? 49}%
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={thumbnailSegment.textY1 ?? 49}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      handleThumbnailTextYChange("textY1", e.target.value)
                    }
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={thumbnailSegment.textY1 ?? 49}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      handleThumbnailTextYChange("textY1", e.target.value)
                    }
                    style={{
                      width: 52,
                      padding: "2px 4px",
                      fontSize: 12,
                      boxSizing: "border-box",
                      background: "var(--ve-panel)",
                      color: "var(--ve-text)",
                      border: "1px solid var(--ve-border)",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span
                  className="muted"
                  style={{ fontWeight: 400, fontSize: 12 }}
                >
                  0% = 최상단 · 100% = 최하단
                </span>
              </label>

              <div className="label">텍스트 2</div>
              <label className="preset-field" style={{ marginBottom: 10 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>텍스트 2 (비우면 미표시)</span>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: busy || uploading ? "not-allowed" : "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(thumbnailSegment.keepText2)}
                      disabled={busy || uploading}
                      onChange={(e) =>
                        setThumbnailSegment((v) => ({
                          ...v,
                          keepText2: e.target.checked,
                        }))
                      }
                    />
                    전체유지
                  </label>
                </span>
                <input
                  type="text"
                  value={thumbnailSegment.text2}
                  disabled={busy || uploading}
                  onChange={(e) =>
                    setThumbnailSegment((v) => ({ ...v, text2: e.target.value }))
                  }
                />
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <label className="preset-field" style={{ flex: "1 1 200px", minWidth: 160 }}>
                  <span>폰트</span>
                  <select
                    value={thumbnailSegment.font2}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      setThumbnailSegment((v) => ({ ...v, font2: e.target.value }))
                    }
                  >
                    <option value="NotoSansKR-Bold">NotoSansKR Bold</option>
                    <option value="BlackHanSans-Regular">BlackHanSans</option>
                    <option value="NotoSerifKR-Bold">NotoSerifKR Bold</option>
                    <option value="GamjaFlower-Regular">감자꽃</option>
                  </select>
                </label>
                <label className="muted" style={{ flex: "2 1 220px", minWidth: 160, fontSize: 13, fontWeight: 500 }}>
                  크기 ({Math.round(Math.min(200, Math.max(20, Number(thumbnailSegment.fontSize2) || 52)))}px)
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <input
                      type="range"
                      min={20}
                      max={200}
                      step={1}
                      value={Math.min(200, Math.max(20, Number(thumbnailSegment.fontSize2) || 52))}
                      disabled={busy || uploading}
                      onChange={(e) =>
                        setThumbnailSegment((v) => ({
                          ...v,
                          fontSize2: Number(e.target.value),
                        }))
                      }
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <input
                      type="number"
                      min={20}
                      max={200}
                      step={1}
                      value={Math.min(200, Math.max(20, Number(thumbnailSegment.fontSize2) || 52))}
                      disabled={busy || uploading}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        const v = Math.min(200, Math.max(20, Math.round(n)));
                        setThumbnailSegment((cur) => ({ ...cur, fontSize2: v }));
                      }}
                      style={{
                        width: 52,
                        padding: "2px 4px",
                        fontSize: 12,
                        boxSizing: "border-box",
                        background: "var(--ve-panel)",
                        color: "var(--ve-text)",
                        border: "1px solid var(--ve-border)",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </label>
                <div
                  className="muted"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    flex: "1 1 200px",
                    minWidth: 160,
                  }}
                >
                  폰트 색상
                  <TextColorPalette
                    value={thumbnailSegment.textColor2}
                    disabled={busy || uploading}
                    onChange={(c) =>
                      setThumbnailSegment((v) => ({ ...v, textColor2: c }))
                    }
                  />
                </div>
              </div>
              <label
                className="muted"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  marginTop: 6,
                  marginBottom: 10,
                }}
              >
                세로 위치 (텍스트 2): {thumbnailSegment.textY2 ?? 57}%
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={thumbnailSegment.textY2 ?? 57}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      handleThumbnailTextYChange("textY2", e.target.value)
                    }
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={thumbnailSegment.textY2 ?? 57}
                    disabled={busy || uploading}
                    onChange={(e) =>
                      handleThumbnailTextYChange("textY2", e.target.value)
                    }
                    style={{
                      width: 52,
                      padding: "2px 4px",
                      fontSize: 12,
                      boxSizing: "border-box",
                      background: "var(--ve-panel)",
                      color: "var(--ve-text)",
                      border: "1px solid var(--ve-border)",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <span
                  className="muted"
                  style={{ fontWeight: 400, fontSize: 12 }}
                >
                  0% = 최상단 · 100% = 최하단
                </span>
              </label>

            </div>
          ) : null}

          {!thumbnailSelected && segments.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              구간을 추가하면 여기에서 크롭·자막을 설정합니다.
            </p>
          ) : !thumbnailSelected ? (
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
                    border: "1px solid var(--ve-border)",
                    background: "var(--ve-panel)",
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
                      style={{ fontSize: 12, fontWeight: 500, flexShrink: 0 }}
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
                      onInput={(e) =>
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

                  <div className="label" style={{ marginTop: 8 }}>
                    텍스트 1
                  </div>
                  <label className="preset-field" style={{ marginTop: 4 }}>
                    <span>텍스트 1 (비우면 미표시)</span>
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
                        fontWeight: 500,
                        minWidth: 140,
                      }}
                    >
                      폰트 크기 (
                      {Math.round(
                        Math.min(200, Math.max(20, Number(seg.textSize) || 48))
                      )}
                      px)
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
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
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <input
                          type="number"
                          min={20}
                          max={200}
                          step={1}
                          value={Math.min(
                            200,
                            Math.max(20, Number(seg.textSize) || 48)
                          )}
                          disabled={busy || uploading}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            const v = Math.min(200, Math.max(20, Math.round(n)));
                            handleSegmentOverlayChange(index, "textSize", v);
                          }}
                          style={{
                            width: 52,
                            padding: "2px 4px",
                            fontSize: 12,
                            boxSizing: "border-box",
                            background: "var(--ve-panel)",
                            color: "var(--ve-text)",
                            border: "1px solid var(--ve-border)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
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
                        fontWeight: 500,
                        flex: "1 1 180px",
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center" }}>
                        폰트 색상
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 12,
                            color: "var(--ve-text-sub)",
                            cursor: "pointer",
                            marginLeft: 8,
                            whiteSpace: "nowrap",
                            fontWeight: 500,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={seg.textShadow || false}
                            disabled={busy || uploading}
                            onChange={(e) =>
                              handleSegmentOverlayChange(
                                index,
                                "textShadow",
                                e.target.checked
                              )
                            }
                          />
                          그림자
                        </label>
                      </div>
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
                        fontWeight: 500,
                        minWidth: 140,
                      }}
                    >
                      투명도 (
                      {Math.round(roundOpacity01(seg.textOpacity ?? 1) * 100)}
                      %)
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(
                            roundOpacity01(seg.textOpacity ?? 1) * 100
                          )}
                          disabled={busy || uploading}
                          onChange={(e) =>
                            handleSegmentOverlayChange(
                              index,
                              "textOpacity",
                              Number(e.target.value) / 100
                            )
                          }
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(
                            roundOpacity01(seg.textOpacity ?? 1) * 100
                          )}
                          disabled={busy || uploading}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            const pct = Math.min(100, Math.max(0, Math.round(n)));
                            handleSegmentOverlayChange(
                              index,
                              "textOpacity",
                              pct / 100
                            );
                          }}
                          style={{
                            width: 52,
                            padding: "2px 4px",
                            fontSize: 12,
                            boxSizing: "border-box",
                            background: "var(--ve-panel)",
                            color: "var(--ve-text)",
                            border: "1px solid var(--ve-border)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
                    </label>
                  </div>
                  <label
                    className="muted"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      marginTop: 6,
                    }}
                  >
                    세로 위치 (텍스트 1): {seg.textY ?? 85}%
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
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
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={seg.textY ?? 85}
                        disabled={busy || uploading}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const v = Math.min(100, Math.max(0, Math.round(n)));
                          handleSegmentOverlayChange(index, "textY", v);
                        }}
                        style={{
                          width: 52,
                          padding: "2px 4px",
                          fontSize: 12,
                          boxSizing: "border-box",
                          background: "var(--ve-panel)",
                          color: "var(--ve-text)",
                          border: "1px solid var(--ve-border)",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <span
                      className="muted"
                      style={{ fontWeight: 400, fontSize: 12 }}
                    >
                      0% = 최상단 · 100% = 최하단
                    </span>
                  </label>

                  <div className="label" style={{ marginTop: 14 }}>
                    텍스트 2
                  </div>
                  <label className="preset-field" style={{ marginTop: 4 }}>
                    <span>텍스트 2 (비우면 미표시)</span>
                    <input
                      type="text"
                      placeholder="추가 자막"
                      value={seg.text2 ?? ""}
                      disabled={busy || uploading}
                      onChange={(e) =>
                        handleSegmentOverlayChange(
                          index,
                          "text2",
                          e.target.value
                        )
                      }
                    />
                  </label>
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
                        value={normalizeFontSelectValue(seg.textFont2)}
                        disabled={busy || uploading}
                        onChange={(e) =>
                          handleSegmentOverlayChange(
                            index,
                            "textFont2",
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
                        fontWeight: 500,
                        minWidth: 140,
                      }}
                    >
                      폰트 크기 (
                      {Math.round(
                        Math.min(
                          200,
                          Math.max(20, Number(seg.textSize2) || 48)
                        )
                      )}
                      px)
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <input
                          type="range"
                          min={20}
                          max={200}
                          step={1}
                          value={Math.min(
                            200,
                            Math.max(20, Number(seg.textSize2) || 48)
                          )}
                          disabled={busy || uploading}
                          onChange={(e) =>
                            handleSegmentOverlayChange(
                              index,
                              "textSize2",
                              e.target.value
                            )
                          }
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <input
                          type="number"
                          min={20}
                          max={200}
                          step={1}
                          value={Math.min(
                            200,
                            Math.max(20, Number(seg.textSize2) || 48)
                          )}
                          disabled={busy || uploading}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            const v = Math.min(200, Math.max(20, Math.round(n)));
                            handleSegmentOverlayChange(index, "textSize2", v);
                          }}
                          style={{
                            width: 52,
                            padding: "2px 4px",
                            fontSize: 12,
                            boxSizing: "border-box",
                            background: "var(--ve-panel)",
                            color: "var(--ve-text)",
                            border: "1px solid var(--ve-border)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
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
                        fontWeight: 500,
                        flex: "1 1 180px",
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center" }}>
                        폰트 색상
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            fontSize: 12,
                            color: "var(--ve-text-sub)",
                            cursor: "pointer",
                            marginLeft: 8,
                            whiteSpace: "nowrap",
                            fontWeight: 500,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={seg.textShadow2 || false}
                            disabled={busy || uploading}
                            onChange={(e) =>
                              handleSegmentOverlayChange(
                                index,
                                "textShadow2",
                                e.target.checked
                              )
                            }
                          />
                          그림자
                        </label>
                      </div>
                      <TextColorPalette
                        value={seg.textColor2}
                        disabled={busy || uploading}
                        onChange={(c) =>
                          handleSegmentOverlayChange(index, "textColor2", c)
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
                        fontWeight: 500,
                        minWidth: 140,
                      }}
                    >
                      투명도 (
                      {Math.round(
                        roundOpacity01(seg.textOpacity2 ?? 1) * 100
                      )}
                      %)
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(
                            roundOpacity01(seg.textOpacity2 ?? 1) * 100
                          )}
                          disabled={busy || uploading}
                          onChange={(e) =>
                            handleSegmentOverlayChange(
                              index,
                              "textOpacity2",
                              Number(e.target.value) / 100
                            )
                          }
                          style={{ flex: 1, minWidth: 0 }}
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={Math.round(
                            roundOpacity01(seg.textOpacity2 ?? 1) * 100
                          )}
                          disabled={busy || uploading}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            const pct = Math.min(100, Math.max(0, Math.round(n)));
                            handleSegmentOverlayChange(
                              index,
                              "textOpacity2",
                              pct / 100
                            );
                          }}
                          style={{
                            width: 52,
                            padding: "2px 4px",
                            fontSize: 12,
                            boxSizing: "border-box",
                            background: "var(--ve-panel)",
                            color: "var(--ve-text)",
                            border: "1px solid var(--ve-border)",
                            borderRadius: 4,
                          }}
                        />
                      </div>
                    </label>
                  </div>
                  <label
                    className="muted"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      marginTop: 6,
                    }}
                  >
                    세로 위치 (텍스트 2): {seg.textY2 ?? 85}%
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={seg.textY2 ?? 85}
                        disabled={busy || uploading}
                        onChange={(e) =>
                          handleSegmentOverlayChange(
                            index,
                            "textY2",
                            e.target.value
                          )
                        }
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={seg.textY2 ?? 85}
                        disabled={busy || uploading}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const v = Math.min(100, Math.max(0, Math.round(n)));
                          handleSegmentOverlayChange(index, "textY2", v);
                        }}
                        style={{
                          width: 52,
                          padding: "2px 4px",
                          fontSize: 12,
                          boxSizing: "border-box",
                          background: "var(--ve-panel)",
                          color: "var(--ve-text)",
                          border: "1px solid var(--ve-border)",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                    <span
                      className="muted"
                      style={{ fontWeight: 400, fontSize: 12 }}
                    >
                      0% = 최상단 · 100% = 최하단
                    </span>
                  </label>
                </div>
              );
            })()
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}
