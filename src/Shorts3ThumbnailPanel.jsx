import { useCallback, useEffect, useRef, useState } from "react";
import { postKbo } from "./api.js";

const TEAM_COLORS = {
  KIA: { bg: "#EA0029", accent: "#FFFFFF", label: "KIA 타이거즈" },
  삼성: { bg: "#074CA1", accent: "#C0C0C0", label: "삼성 라이온즈" },
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

const FONTS = [
  { label: "NotoSansKR Bold", value: "NotoSansKR-Bold" },
  { label: "BlackHanSans", value: "BlackHanSans-Regular" },
  { label: "NotoSerifKR Bold", value: "NotoSerifKR-Bold" },
];

const TEXT_COLORS = [
  { label: "흰색", value: "#FFFFFF" },
  { label: "검정", value: "#000000" },
  { label: "노랑", value: "#FFD700" },
  { label: "하늘", value: "#00CFFF" },
  { label: "연두", value: "#4ade80" },
  { label: "주황", value: "#FF6600" },
  { label: "분홍", value: "#FF4ECD" },
  { label: "빨강", value: "#FF3B3B" },
  { label: "하늘2", value: "#90CAF9" },
  { label: "금색", value: "#FFC107" },
];

async function drawThumbnail({
  team,
  tc,
  text1,
  text2,
  font1,
  font2,
  textColor1,
  textColor2,
  fontSize1,
  fontSize2,
  canvas: existingCanvas,
}) {
  const W = 1080;
  const H = 1920;
  const canvas = existingCanvas || document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const TOP_BAR = 280;
  const SIDE_BAR = 40;
  const BOT_BAR = 160;
  const RADIUS = 48;

  const holeX = SIDE_BAR;
  const holeY = TOP_BAR;
  const holeW = W - SIDE_BAR * 2;
  const holeH = H - TOP_BAR - BOT_BAR;

  const innerFontFamilyMap = {
    "NotoSansKR-Bold": "'Noto Sans KR', sans-serif",
    "BlackHanSans-Regular": "'Black Han Sans', sans-serif",
    "NotoSerifKR-Bold": "'Noto Serif KR', serif",
  };
  const ff = (k) =>
    innerFontFamilyMap[k] || innerFontFamilyMap["NotoSansKR-Bold"];

  const teamLabels = {
    KIA: "KIA 타이거즈",
    삼성: "삼성 라이온즈",
    LG: "LG 트윈스",
    두산: "두산 베어스",
    KT: "kt wiz",
    SSG: "SSG 랜더스",
    롯데: "롯데 자이언츠",
    한화: "한화 이글스",
    NC: "NC 다이노스",
    키움: "키움 히어로즈",
  };

  ctx.fillStyle = tc.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(holeX, holeY);
  ctx.lineTo(holeX + holeW, holeY);
  ctx.lineTo(holeX + holeW, holeY + holeH - RADIUS);
  ctx.arcTo(
    holeX + holeW,
    holeY + holeH,
    holeX + holeW - RADIUS,
    holeY + holeH,
    RADIUS
  );
  ctx.lineTo(holeX + RADIUS, holeY + holeH);
  ctx.arcTo(holeX, holeY + holeH, holeX, holeY + holeH - RADIUS, RADIUS);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const teamLabel = teamLabels[team] || team;
  ctx.font = `bold 52px 'Noto Sans KR', sans-serif`;
  const labelW = ctx.measureText(teamLabel).width + 80;
  const labelH = 80;
  const labelX = W / 2 - labelW / 2;
  const labelY = 120;
  const labelR = labelH / 2;

  ctx.fillStyle = tc.accent;
  ctx.beginPath();
  ctx.moveTo(labelX + labelR, labelY);
  ctx.lineTo(labelX + labelW - labelR, labelY);
  ctx.arcTo(labelX + labelW, labelY, labelX + labelW, labelY + labelH, labelR);
  ctx.lineTo(labelX + labelW, labelY + labelH - labelR);
  ctx.arcTo(
    labelX + labelW,
    labelY + labelH,
    labelX + labelW - labelR,
    labelY + labelH,
    labelR
  );
  ctx.lineTo(labelX + labelR, labelY + labelH);
  ctx.arcTo(labelX, labelY + labelH, labelX, labelY + labelH - labelR, labelR);
  ctx.lineTo(labelX, labelY + labelR);
  ctx.arcTo(labelX, labelY, labelX + labelR, labelY, labelR);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = tc.bg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(teamLabel, W / 2, labelY + labelH / 2);

  const holeCenterY = TOP_BAR + holeH / 2;

  ctx.fillStyle = textColor1;
  ctx.font = `bold ${fontSize1}px ${ff(font1)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(text1 || "", W / 2, holeCenterY - fontSize1 / 2 - 30);
  ctx.shadowBlur = 0;

  const lineY = holeCenterY + 20;
  ctx.strokeStyle = tc.accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(W * 0.25, lineY);
  ctx.lineTo(W * 0.75, lineY);
  ctx.stroke();

  ctx.fillStyle = textColor2;
  ctx.font = `${fontSize2}px ${ff(font2)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 6;
  ctx.fillText(text2 || "", W / 2, lineY + fontSize2 / 2 + 30);
  ctx.shadowBlur = 0;

  try {
    const logoSrc = TEAM_LOGO_PATH[team];
    if (!logoSrc) return canvas;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = logoSrc;
    });
    const LOGO_MAX = 160;
    const nw = img.naturalWidth || img.width || 1;
    const nh = img.naturalHeight || img.height || 1;
    const scale = Math.min(LOGO_MAX / nw, LOGO_MAX / nh);
    const logoW = nw * scale;
    const logoH = nh * scale;
    const logoX = SIDE_BAR - 10;
    const logoY = H - BOT_BAR - LOGO_MAX * 0.4;
    ctx.drawImage(img, logoX, logoY, logoW, logoH);
  } catch (e) {
    console.warn("로고 로드 실패:", e);
  }

  return canvas;
}

export default function Shorts3ThumbnailPanel() {
  const [savedFiles, setSavedFiles] = useState([]);
  const [savedFilesLoading, setSavedFilesLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [thumbTime, setThumbTime] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [debouncedThumbTime, setDebouncedThumbTime] = useState(0);
  const [cropOffset, setCropOffset] = useState(0);

  const [team, setTeam] = useState("KIA");
  const [text1, setText1] = useState("");
  const [text2, setText2] = useState("");
  const [font1, setFont1] = useState("NotoSansKR-Bold");
  const [font2, setFont2] = useState("NotoSansKR-Bold");
  const [textColor1, setTextColor1] = useState("#FFFFFF");
  const [textColor2, setTextColor2] = useState("#FFFFFF");
  const [fontSize1, setFontSize1] = useState(88);
  const [fontSize2, setFontSize2] = useState(52);
  const [status, setStatus] = useState("idle");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const [videoMetaTick, setVideoMetaTick] = useState(0);

  const refreshSavedFiles = useCallback(async () => {
    setSavedFilesLoading(true);
    try {
      const res = await postKbo({ action: "highlight_list" });
      setSavedFiles(Array.isArray(res?.items) ? res.items : []);
    } catch {
      setSavedFiles([]);
    } finally {
      setSavedFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSavedFiles();
  }, [refreshSavedFiles]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedThumbTime(thumbTime), 120);
    return () => clearTimeout(t);
  }, [thumbTime]);

  const fetchPreviewUrl = async (jobId) => {
    try {
      const pr = await postKbo({ action: "highlight_preview", jobId });
      const url = pr?.previewUrl || pr?.url;
      if (url) setPreviewUrl(url);
    } catch {
      setPreviewUrl(null);
    }
  };

  useEffect(() => {
    if (!previewUrl) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let rafId = 0;
    const update = () => {
      setThumbTime(video.currentTime);
      rafId = requestAnimationFrame(update);
    };
    const onPlay = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };
    const onPause = () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    return () => {
      cancelAnimationFrame(rafId);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onPause);
    };
  }, [previewUrl]);

  useEffect(() => {
    const fontMap = {
      "NotoSansKR-Bold":
        "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&display=swap",
      "BlackHanSans-Regular":
        "https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap",
      "NotoSerifKR-Bold":
        "https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@700&display=swap",
    };
    [font1, font2].forEach((f, i) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = fontMap[f] || fontMap["BlackHanSans-Regular"];
      link.id = `thumbnail-font-${i}`;
      const existing = document.getElementById(`thumbnail-font-${i}`);
      if (existing) existing.remove();
      document.head.appendChild(link);
    });
  }, [font1, font2]);

  const tc = TEAM_COLORS[team];

  const makeFinalCanvas = useCallback(
    async (timeOverride, cropOffsetOverride) => {
      const seekTime =
        timeOverride != null && Number.isFinite(Number(timeOverride))
          ? Number(timeOverride)
          : debouncedThumbTime;

      const cropRaw =
        cropOffsetOverride !== undefined && cropOffsetOverride !== null
          ? Number(cropOffsetOverride)
          : cropOffset;
      const co = Math.min(
        50,
        Math.max(-50, Number.isFinite(cropRaw) ? cropRaw : 0)
      );

      const video = videoRef.current;
      let frameCanvas = null;
      if (video && previewUrl) {
        await new Promise((res) => {
          video.currentTime = seekTime;
          video.onseeked = () => res();
        });
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw > 0 && vh > 0) {
          frameCanvas = document.createElement("canvas");
          frameCanvas.width = 1080;
          frameCanvas.height = 1920;
          const fctx = frameCanvas.getContext("2d");
          const targetRatio = 9 / 16;
          const videoRatio = vw / vh;
          let sx = 0;
          let sy = 0;
          let sw = vw;
          let sh = vh;
          if (videoRatio > targetRatio) {
            sw = vh * targetRatio;
            const center = vw / 2;
            const offsetPx = (vw * co) / 100;
            sx = center - sw / 2 + offsetPx;
            sx = Math.max(0, Math.min(vw - sw, sx));
          } else {
            sh = vw / targetRatio;
            sy = (vh - sh) / 2;
          }
          fctx.drawImage(video, sx, sy, sw, sh, 0, 0, 1080, 1920);
        }
      }

      const overlayCanvas = await drawThumbnail({
        team,
        tc,
        text1,
        text2,
        font1,
        font2,
        textColor1,
        textColor2,
        fontSize1,
        fontSize2,
      });

      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = 1080;
      finalCanvas.height = 1920;
      const fctx2 = finalCanvas.getContext("2d");
      if (frameCanvas) fctx2.drawImage(frameCanvas, 0, 0);
      fctx2.drawImage(overlayCanvas, 0, 0);
      return finalCanvas;
    },
    [
      previewUrl,
      debouncedThumbTime,
      team,
      tc,
      text1,
      text2,
      font1,
      font2,
      textColor1,
      textColor2,
      fontSize1,
      fontSize2,
      videoMetaTick,
      cropOffset,
    ]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      try {
        const finalCanvas = await makeFinalCanvas();
        if (cancelled) return;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, 1080, 1920);
        ctx.drawImage(finalCanvas, 0, 0);
      } catch {
        if (cancelled) return;
        try {
          await drawThumbnail({
            team,
            tc,
            text1,
            text2,
            font1,
            font2,
            textColor1,
            textColor2,
            fontSize1,
            fontSize2,
            canvas,
          });
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [makeFinalCanvas, cropOffset]);

  async function handleGenerate() {
    setStatus("loading");
    setError(null);
    setDownloadUrl((prev) => {
      if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    try {
      const finalCanvas = await makeFinalCanvas(thumbTime, cropOffset);

      const blob = await new Promise((res) =>
        finalCanvas.toBlob((b) => res(b), "image/png")
      );
      if (!blob) throw new Error("PNG 생성 실패");

      if (selectedJobId) {
        setUploading(true);
        try {
          const uploadRes = await postKbo({
            action: "thumbnail_upload_url",
            jobId: selectedJobId,
          });
          if (uploadRes?.putUrl) {
            await fetch(uploadRes.putUrl, {
              method: "PUT",
              body: blob,
              headers: { "Content-Type": "image/png" },
            });
          }
        } finally {
          setUploading(false);
        }
      }

      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      setUploading(false);
    }
  }

  const loading = status === "loading";

  return (
    <div className="section soft">
      <div className="section-title">🖼️ 썸네일 생성</div>
      <p className="muted" style={{ marginTop: 6 }}>
        저장된 하이라이트 원본을 고르고, 컷 시각을 맞춘 뒤 오버레이를 합성합니다. 선택 시
        S3에 thumbnail.png로 저장됩니다.
      </p>

      <div style={{ display: "flex", gap: 24, marginTop: 20, flexWrap: "wrap" }}>
        <div
          style={{
            flex: "1 1 320px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div>
            <div className="label">저장된 영상 선택</div>
            {savedFilesLoading && (
              <div className="muted">불러오는 중...</div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginTop: 6,
              }}
            >
              {!savedFilesLoading && savedFiles.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  저장된 원본이 없습니다. 하이라이트 패널에서 먼저 업로드하세요.
                </div>
              ) : null}
              {savedFiles.map((row) => {
                const jid = row.jobId || "";
                const when = row.lastModified
                  ? new Date(row.lastModified).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                      dateStyle: "short",
                      timeStyle: "medium",
                    })
                  : "—";
                const size =
                  typeof row.size === "number"
                    ? `${Math.round(row.size / 1024)} KB`
                    : "";
                return (
                  <div
                    key={jid}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        setSelectedJobId(jid);
                        setThumbTime(0);
                        setDebouncedThumbTime(0);
                        setCropOffset(0);
                        setPreviewUrl(null);
                        await fetchPreviewUrl(jid);
                      }}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: 6,
                        textAlign: "left",
                        background:
                          selectedJobId === jid ? "#1a3a2a" : "#1e1e1e",
                        border:
                          selectedJobId === jid
                            ? "2px solid #4ade80"
                            : "2px solid #444",
                        color: selectedJobId === jid ? "#4ade80" : "#aaa",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      {jid.slice(0, 8)} · {when} · {size}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {previewUrl && (
            <div style={{ marginTop: 12 }}>
              <div className="label">썸네일 컷 선택</div>
              <video
                ref={videoRef}
                src={previewUrl}
                crossOrigin="anonymous"
                controls
                style={{ width: "100%", marginTop: 6, borderRadius: 8 }}
                onLoadedMetadata={() => setVideoMetaTick((n) => n + 1)}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const v = videoRef.current;
                    if (v) setThumbTime(v.currentTime);
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    background: "#4ade80",
                    color: "#000",
                    fontWeight: "bold",
                    fontSize: 13,
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  📸 여기를 썸네일로
                </button>
                <span style={{ color: "#4ade80", fontSize: 13 }}>
                  선택: {thumbTime.toFixed(3)}초
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <span style={{ color: "#aaa", fontSize: 12 }}>미세 조정</span>
                <button
                  type="button"
                  onClick={() => {
                    const t = Math.max(0, thumbTime - 0.1);
                    setThumbTime(t);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  -0.1
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = Math.max(0, thumbTime - 0.033);
                    setThumbTime(t);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  -1f
                </button>
                <input
                  type="number"
                  value={thumbTime.toFixed(3)}
                  step={0.001}
                  min={0}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const t = Math.max(0, Number.isFinite(raw) ? raw : 0);
                    setThumbTime(t);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  style={{
                    width: 80,
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: "#1e1e1e",
                    color: "#fff",
                    border: "1px solid #555",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const t = thumbTime + 0.033;
                    setThumbTime(t);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  +1f
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const t = thumbTime + 0.1;
                    setThumbTime(t);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    background: "#333",
                    color: "#fff",
                    border: "1px solid #555",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  +0.1
                </button>
              </div>
              <div style={{ color: "#aaa", fontSize: 12, marginTop: 4 }}>
                현재 시각: {thumbTime.toFixed(2)}초 → 썸네일 컷으로 사용됩니다
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="label">크롭 오프셋 (좌우 이동)</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 6,
                  }}
                >
                  <span style={{ color: "#aaa", fontSize: 12 }}>-50%</span>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    value={cropOffset}
                    onChange={(e) => setCropOffset(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ color: "#aaa", fontSize: 12 }}>+50%</span>
                  <span style={{ color: "#fff", fontSize: 13, minWidth: 36 }}>
                    {cropOffset > 0 ? `+${cropOffset}` : cropOffset}%
                  </span>
                </div>
              </div>
            </div>
          )}

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
                    opacity: team === t ? 1 : 0.6,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label">선택된 팀 색상</div>
            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 6,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: tc.bg,
                  border: "1px solid #444",
                }}
              />
              <span style={{ color: "#aaa", fontSize: 13 }}>배경: {tc.bg}</span>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: tc.accent,
                  border: "1px solid #444",
                }}
              />
              <span style={{ color: "#aaa", fontSize: 13 }}>
                강조: {tc.accent}
              </span>
            </div>
          </div>

          <div>
            <div className="label">텍스트 1 (상단 메인)</div>
            <input
              className="input"
              style={{ marginTop: 6, width: "100%" }}
              value={text1}
              onChange={(e) => setText1(e.target.value)}
              placeholder="예) 오늘의 하이라이트"
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 6,
              }}
            >
              <span style={{ color: "#aaa", fontSize: 12 }}>크기</span>
              <input
                type="range"
                min={30}
                max={150}
                value={fontSize1}
                onChange={(e) => setFontSize1(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: "#fff", fontSize: 13, minWidth: 28 }}>
                {fontSize1}
              </span>
            </div>
            <div
              style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}
            >
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFont1(f.value)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    border:
                      font1 === f.value
                        ? "2px solid #4ade80"
                        : "2px solid #444",
                    background: font1 === f.value ? "#1a3a2a" : "#1e1e1e",
                    color: font1 === f.value ? "#4ade80" : "#aaa",
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setTextColor1(c.value)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 5,
                    background: c.value,
                    border:
                      textColor1 === c.value
                        ? "3px solid #4ade80"
                        : "2px solid #444",
                    cursor: "pointer",
                  }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="label">텍스트 2 (하단 서브)</div>
            <input
              className="input"
              style={{ marginTop: 6, width: "100%" }}
              value={text2}
              onChange={(e) => setText2(e.target.value)}
              placeholder="예) 2026.05.04 KIA vs LG"
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 6,
              }}
            >
              <span style={{ color: "#aaa", fontSize: 12 }}>크기</span>
              <input
                type="range"
                min={20}
                max={120}
                value={fontSize2}
                onChange={(e) => setFontSize2(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: "#fff", fontSize: 13, minWidth: 28 }}>
                {fontSize2}
              </span>
            </div>
            <div
              style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}
            >
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFont2(f.value)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    border:
                      font2 === f.value
                        ? "2px solid #4ade80"
                        : "2px solid #444",
                    background: font2 === f.value ? "#1a3a2a" : "#1e1e1e",
                    color: font2 === f.value ? "#4ade80" : "#aaa",
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setTextColor2(c.value)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 5,
                    background: c.value,
                    border:
                      textColor2 === c.value
                        ? "3px solid #4ade80"
                        : "2px solid #444",
                    cursor: "pointer",
                  }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            style={{
              padding: "12px 0",
              borderRadius: 8,
              background: loading ? "#444" : "#4ade80",
              color: "#000",
              fontWeight: "bold",
              fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
              border: "none",
              marginTop: 4,
            }}
          >
            {loading
              ? uploading
                ? "⏳ S3 업로드 중..."
                : "⏳ 생성 중..."
              : "🖼️ 썸네일 생성 + S3 저장"}
          </button>

          {error && (
            <div style={{ color: "#f87171", fontSize: 13 }}>❌ {error}</div>
          )}

          {status === "done" && downloadUrl && (
            <a
              href={downloadUrl}
              download="thumbnail.png"
              style={{
                display: "block",
                textAlign: "center",
                padding: "10px 0",
                borderRadius: 8,
                background: "#2563eb",
                color: "#fff",
                fontWeight: "bold",
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              ⬇️ 다운로드
            </a>
          )}
        </div>

        <div style={{ flex: "0 0 200px" }}>
          <div className="label">미리보기 (실시간)</div>
          <canvas
            ref={canvasRef}
            width={1080}
            height={1920}
            style={{
              marginTop: 6,
              width: 180,
              height: 320,
              borderRadius: 10,
              border: `2px solid ${tc.accent}`,
              display: "block",
            }}
          />
          <div style={{ color: "#555", fontSize: 11, marginTop: 6 }}>
            실제 출력: 1080×1920px
          </div>
        </div>
      </div>
    </div>
  );
}
