import { useCallback, useEffect, useRef, useState } from "react";
import { postKbo } from "./api.js";
import {
  LAYOUT_TYPES,
  TEAM_COLORS,
  drawThumbnailByLayout,
} from "./thumbnailUtils.js";

const LAYOUT_OPTIONS = [
  { id: LAYOUT_TYPES.KBO, label: "KBO 야구" },
  { id: LAYOUT_TYPES.FULLSCREEN, label: "풀스크린" },
  { id: LAYOUT_TYPES.TOPBOTTOM, label: "상하바" },
];

/** drawThumbnail이 요구하는 폰트 키·크기·색 (문구는 빈 문자열로 그리지 않음) */
const OVERLAY_FONT = "NotoSansKR-Bold";

const DEFAULT_TOP_BAR_COLOR = "#16213e";
const DEFAULT_BOTTOM_BAR_COLOR = "#16213e";

const PREVIEW_DISPLAY_STYLE = {
  marginTop: 6,
  width: 180,
  height: 320,
  borderRadius: 10,
  display: "block",
};

const TOP_BOTTOM_BAR_SWATCHES = [
  "#1a1a2e",
  "#16213e",
  "#0f3460",
  "#1b262c",
  "#000000",
  "#074CA1",
  "#131230",
  "#EA0029",
  "#533483",
  "#2d4059",
];

function normalizeHexColorInput(raw, fallback) {
  const s = String(raw || "").trim();
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return fallback;
}

function BarColorPicker({ label, value, onChange, fallback }) {
  const normalized = normalizeHexColorInput(value, fallback);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>
        {label}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {TOP_BOTTOM_BAR_SWATCHES.map((c) => (
          <button
            key={`${label}-${c}`}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: 6,
              border:
                normalized.toUpperCase() === c.toUpperCase()
                  ? "2px solid #4ade80"
                  : "2px solid rgba(255,255,255,0.25)",
              background: c,
              cursor: "pointer",
            }}
          />
        ))}
        <input
          type="color"
          value={normalized}
          onChange={(e) => onChange(e.target.value)}
          title="색상 직접 선택"
          style={{
            width: 36,
            height: 28,
            padding: 0,
            border: "1px solid #555",
            borderRadius: 6,
            background: "transparent",
            cursor: "pointer",
          }}
        />
        <span className="muted" style={{ fontSize: 11 }}>{normalized}</span>
      </div>
    </div>
  );
}

export default function Shorts3ThumbnailPanel({ jobId }) {
  const [layout, setLayout] = useState(LAYOUT_TYPES.KBO);
  const [team, setTeam] = useState("삼성");
  const [topBarColor, setTopBarColor] = useState(DEFAULT_TOP_BAR_COLOR);
  const [bottomBarColor, setBottomBarColor] = useState(DEFAULT_BOTTOM_BAR_COLOR);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [savedThumbUrl, setSavedThumbUrl] = useState(null);
  /** loading | ready | missing */
  const [savedThumbStatus, setSavedThumbStatus] = useState("loading");

  const canvasRef = useRef(null);

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
        console.warn("[thumbnail panel] saved preview", e);
        setSavedThumbStatus("missing");
      }
    }
  }, []);

  useEffect(() => {
    loadSavedThumbnail();
  }, [loadSavedThumbnail]);

  const tc = TEAM_COLORS[team];
  const effectiveJobId = String(jobId || "").trim();
  const previewBorderColor =
    layout === LAYOUT_TYPES.KBO
      ? tc?.accent || "#fff"
      : layout === LAYOUT_TYPES.TOPBOTTOM
        ? topBarColor
        : "#888";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      try {
        const opts = {
          team,
          text1: "",
          text2: "",
          font1: OVERLAY_FONT,
          font2: OVERLAY_FONT,
          textColor1: "#FFFFFF",
          textColor2: "#FFFFFF",
          fontSize1: 88,
          fontSize2: 52,
          canvas,
        };
        if (layout === LAYOUT_TYPES.KBO) {
          const t = TEAM_COLORS[team];
          if (!t) return;
          opts.tc = { bg: t.bg, accent: t.accent };
        }
        if (layout === LAYOUT_TYPES.TOPBOTTOM) {
          opts.topBarColor = topBarColor;
          opts.bottomBarColor = bottomBarColor;
        }
        await drawThumbnailByLayout(layout, opts);
        if (cancelled) return;
      } catch (e) {
        console.warn("[thumbnail panel]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team, layout, topBarColor, bottomBarColor]);

  const handleSavePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(null);

    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/png")
    );
    if (!blob) return;

    setUploading(true);
    try {
      const uploadRes = await postKbo({
        action: "thumbnail_upload_url",
      });
      if (uploadRes?.putUrl) {
        const overlayPut = await fetch(uploadRes.putUrl, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": "image/png" },
        });
        if (overlayPut.ok) {
          await loadSavedThumbnail();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setUploading(false);
    }

    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download =
      layout === LAYOUT_TYPES.KBO
        ? `thumbnail-${team}.png`
        : `thumbnail-${layout}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="section soft">
      <div className="section-title">🖼️ 썸네일 레이아웃</div>
      <p className="muted" style={{ marginTop: 6 }}>
        레이아웃·팀을 선택하면 프레임·로고·텍스트 슬롯이 표시됩니다. PNG로 저장해 다른 화면이나
        Lambda 오버레이에 쓸 수 있습니다.
      </p>

      <div
        style={{
          display: "flex",
          gap: 24,
          marginTop: 20,
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            flex: "1 1 280px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div>
            <div className="label">레이아웃</div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              {LAYOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLayout(opt.id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border:
                      layout === opt.id
                        ? "2px solid #4ade80"
                        : "2px solid #555",
                    background: layout === opt.id ? "#1a2e1a" : "#1e1e1e",
                    color: layout === opt.id ? "#4ade80" : "#ddd",
                    fontWeight: "bold",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {layout === LAYOUT_TYPES.KBO ? (
          <div>
            <div className="label">팀 선택</div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              {Object.keys(TEAM_COLORS).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTeam(t)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border:
                      team === t
                        ? `2px solid ${TEAM_COLORS[t].accent}`
                        : "2px solid transparent",
                    background: TEAM_COLORS[t].bg,
                    color: TEAM_COLORS[t].accent,
                    fontWeight: "bold",
                    fontSize: 13,
                    cursor: "pointer",
                    opacity: team === t ? 1 : 0.65,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          ) : null}

          {layout === LAYOUT_TYPES.TOPBOTTOM ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <BarColorPicker
                label="상단 바 색상"
                value={topBarColor}
                fallback={DEFAULT_TOP_BAR_COLOR}
                onChange={setTopBarColor}
              />
              <BarColorPicker
                label="하단 바 색상"
                value={bottomBarColor}
                fallback={DEFAULT_BOTTOM_BAR_COLOR}
                onChange={setBottomBarColor}
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleSavePng}
            disabled={uploading}
            style={{
              padding: "12px 18px",
              borderRadius: 8,
              background: uploading ? "#444" : "#4ade80",
              color: "#000",
              fontWeight: "bold",
              fontSize: 15,
              cursor: uploading ? "not-allowed" : "pointer",
              border: "none",
              alignSelf: "flex-start",
            }}
          >
            {uploading ? "S3 업로드 중..." : "PNG 저장"}
          </button>

          {error ? (
            <div className="muted" style={{ color: "#ffb347", fontSize: 13 }}>
              {error.message}
            </div>
          ) : null}
        </div>

        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div>
          <div className="label">미리보기</div>
          <canvas
            ref={canvasRef}
            width={1080}
            height={1920}
            style={{
              ...PREVIEW_DISPLAY_STYLE,
              background: "transparent",
              border: `2px solid ${previewBorderColor}`,
            }}
          />
          <div style={{ color: "#888", fontSize: 11, marginTop: 6 }}>
            1080×1920px · 텍스트 슬롯은 비어 있음
          </div>
          {effectiveJobId ? (
            <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              S3 저장 대상 jobId: {effectiveJobId.slice(0, 8)}…
            </div>
          ) : null}
          </div>
          <div>
            <div className="label">현재 저장된 썸네일</div>
            {savedThumbStatus === "loading" ? (
              <div
                className="muted"
                style={{
                  ...PREVIEW_DISPLAY_STYLE,
                  border: "2px solid #555",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                }}
              >
                불러오는 중...
              </div>
            ) : savedThumbStatus === "ready" && savedThumbUrl ? (
              <img
                src={savedThumbUrl}
                alt="S3에 저장된 썸네일"
                onError={() => setSavedThumbStatus("missing")}
                style={{
                  ...PREVIEW_DISPLAY_STYLE,
                  objectFit: "contain",
                  background: "transparent",
                  border: "2px solid #555",
                }}
              />
            ) : (
              <div
                className="muted"
                style={{
                  ...PREVIEW_DISPLAY_STYLE,
                  border: "2px solid #555",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  textAlign: "center",
                  padding: 8,
                  boxSizing: "border-box",
                }}
              >
                저장된 썸네일 없음
              </div>
            )}
            <div style={{ color: "#888", fontSize: 11, marginTop: 6 }}>
              overlay/thumbnail.png
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
