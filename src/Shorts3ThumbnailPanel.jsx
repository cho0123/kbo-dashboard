import { useEffect, useRef, useState } from "react";
import { postKbo } from "./api.js";
import { TEAM_COLORS, drawThumbnail } from "./thumbnailUtils.js";

/** drawThumbnail이 요구하는 폰트 키·크기·색 (문구는 빈 문자열로 그리지 않음) */
const OVERLAY_FONT = "NotoSansKR-Bold";

export default function Shorts3ThumbnailPanel({ jobId }) {
  const [team, setTeam] = useState("삼성");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);

  const tc = TEAM_COLORS[team];
  const effectiveJobId = String(jobId || "").trim();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    (async () => {
      const t = TEAM_COLORS[team];
      if (!t) return;
      try {
        await drawThumbnail({
          team,
          tc: { bg: t.bg, accent: t.accent },
          text1: "",
          text2: "",
          font1: OVERLAY_FONT,
          font2: OVERLAY_FONT,
          textColor1: "#FFFFFF",
          textColor2: "#FFFFFF",
          fontSize1: 88,
          fontSize2: 52,
          canvas,
        });
        if (cancelled) return;
      } catch (e) {
        console.warn("[thumbnail panel]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team]);

  const handleSavePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(null);

    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/png")
    );
    if (!blob) return;

    if (effectiveJobId) {
      setUploading(true);
      try {
        const uploadRes = await postKbo({
          action: "thumbnail_upload_url",
          jobId: effectiveJobId,
        });
        if (uploadRes?.putUrl) {
          await fetch(uploadRes.putUrl, {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": "image/png" },
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setUploading(false);
      }
    }

    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `thumbnail-${team}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="section soft">
      <div className="section-title">🖼️ 썸네일 레이아웃</div>
      <p className="muted" style={{ marginTop: 6 }}>
        팀을 선택하면 프레임·로고·팀명 배지만 표시됩니다. PNG로 저장해 다른 화면이나
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

        <div style={{ flex: "0 0 auto" }}>
          <div className="label">미리보기</div>
          <canvas
            ref={canvasRef}
            width={1080}
            height={1920}
            style={{
              marginTop: 6,
              width: 180,
              height: 320,
              background: "transparent",
              borderRadius: 10,
              border: `2px solid ${tc.accent}`,
              display: "block",
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
      </div>
    </div>
  );
}
