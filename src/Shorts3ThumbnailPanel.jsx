import { useEffect, useState } from "react";

const TEAM_COLORS = {
  KIA:  { bg: "#EA0029", accent: "#FFFFFF", label: "KIA 타이거즈" },
  삼성:  { bg: "#074CA1", accent: "#C0C0C0", label: "삼성 라이온즈" },
  LG:   { bg: "#C30452", accent: "#FFFFFF", label: "LG 트윈스" },
  두산:  { bg: "#131230", accent: "#FFFFFF", label: "두산 베어스" },
  KT:   { bg: "#000000", accent: "#EB1C24", label: "kt wiz" },
  SSG:  { bg: "#CE0E2D", accent: "#FFD700", label: "SSG 랜더스" },
  롯데:  { bg: "#041E42", accent: "#EB1C24", label: "롯데 자이언츠" },
  한화:  { bg: "#FF6600", accent: "#FFFFFF", label: "한화 이글스" },
  NC:   { bg: "#071D5B", accent: "#BFA141", label: "NC 다이노스" },
  키움:  { bg: "#570514", accent: "#FFFFFF", label: "키움 히어로즈" },
};

const FONTS = [
  { label: "NotoSansKR Bold",  value: "NotoSansKR-Bold" },
  { label: "BlackHanSans",     value: "BlackHanSans-Regular" },
  { label: "NotoSerifKR Bold", value: "NotoSerifKR-Bold" },
];

const TEXT_COLORS = [
  { label: "흰색",  value: "#FFFFFF" },
  { label: "검정",  value: "#000000" },
  { label: "노랑",  value: "#FFD700" },
  { label: "하늘",  value: "#00CFFF" },
  { label: "연두",  value: "#4ade80" },
  { label: "주황",  value: "#FF6600" },
  { label: "분홍",  value: "#FF4ECD" },
  { label: "빨강",  value: "#FF3B3B" },
  { label: "하늘2", value: "#90CAF9" },
  { label: "금색",  value: "#FFC107" },
];

const fontFamilyMap = {
  "NotoSansKR-Bold":    "'Noto Sans KR', sans-serif",
  "BlackHanSans-Regular": "'Black Han Sans', sans-serif",
  "NotoSerifKR-Bold":   "'Noto Serif KR', serif",
};

export default function Shorts3ThumbnailPanel() {
  const [team, setTeam]           = useState("KIA");
  const [text1, setText1]         = useState("");
  const [text2, setText2]         = useState("");
  const [font1, setFont1]         = useState("BlackHanSans-Regular");
  const [font2, setFont2]         = useState("BlackHanSans-Regular");
  const [textColor1, setTextColor1] = useState("#FFFFFF");
  const [textColor2, setTextColor2] = useState("#FFFFFF");
  const [fontSize1, setFontSize1] = useState(88);
  const [fontSize2, setFontSize2] = useState(52);
  const [status, setStatus]       = useState("idle");
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError]         = useState(null);

  useEffect(() => {
    const fontMap = {
      "NotoSansKR-Bold":   "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&display=swap",
      "BlackHanSans-Regular": "https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap",
      "NotoSerifKR-Bold":  "https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@700&display=swap",
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

  async function handleGenerate() {
    setStatus("loading");
    setError(null);
    setDownloadUrl(null);
    try {
      const response = await fetch("/api/video-encode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "thumbnail",
          team,
          bgColor: tc.bg,
          accentColor: tc.accent,
          text1,
          text2,
          font1: font1 || "BlackHanSans-Regular",
          font2: font2 || "BlackHanSans-Regular",
          textColor1,
          textColor2,
          fontSize1,
          fontSize2,
        }),
      });
      const res = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(res.error || res.message || `HTTP ${response.status}`);
      }
      if (res.downloadUrl) {
        setDownloadUrl(res.downloadUrl);
        setStatus("done");
      } else {
        throw new Error(res.message || "알 수 없는 오류");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <div className="section soft">
      <div className="section-title">🖼️ 썸네일 생성</div>
      <p className="muted" style={{ marginTop: 6 }}>
        팀을 선택하면 배경색이 자동 적용됩니다. 텍스트 2개를 입력하고 생성하세요.
      </p>

      <div style={{ display: "flex", gap: 24, marginTop: 20, flexWrap: "wrap" }}>

        {/* ── 왼쪽: 설정 ── */}
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 팀 선택 */}
          <div>
            <div className="label">팀 선택</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {Object.keys(TEAM_COLORS).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTeam(t)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: team === t ? `2px solid ${TEAM_COLORS[t].accent}` : "2px solid transparent",
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

          {/* 배경색 미리보기 */}
          <div>
            <div className="label">선택된 팀 색상</div>
            <div style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "center" }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: tc.bg, border: "1px solid #444" }} />
              <span style={{ color: "#aaa", fontSize: 13 }}>배경: {tc.bg}</span>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: tc.accent, border: "1px solid #444" }} />
              <span style={{ color: "#aaa", fontSize: 13 }}>강조: {tc.accent}</span>
            </div>
          </div>

          {/* 텍스트 1 */}
          <div>
            <div className="label">텍스트 1 (상단 메인)</div>
            <input
              className="input"
              style={{ marginTop: 6, width: "100%" }}
              value={text1}
              onChange={(e) => setText1(e.target.value)}
              placeholder="예) 오늘의 하이라이트"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <span style={{ color: "#aaa", fontSize: 12 }}>크기</span>
              <input
                type="range"
                min={30}
                max={150}
                value={fontSize1}
                onChange={(e) => setFontSize1(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: "#fff", fontSize: 13, minWidth: 28 }}>{fontSize1}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFont1(f.value)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    border: font1 === f.value ? "2px solid #4ade80" : "2px solid #444",
                    background: font1 === f.value ? "#1a3a2a" : "#1e1e1e",
                    color: font1 === f.value ? "#4ade80" : "#aaa",
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
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
                    border: textColor1 === c.value ? "3px solid #4ade80" : "2px solid #444",
                    cursor: "pointer",
                  }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* 텍스트 2 */}
          <div>
            <div className="label">텍스트 2 (하단 서브)</div>
            <input
              className="input"
              style={{ marginTop: 6, width: "100%" }}
              value={text2}
              onChange={(e) => setText2(e.target.value)}
              placeholder="예) 2026.05.04 KIA vs LG"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <span style={{ color: "#aaa", fontSize: 12 }}>크기</span>
              <input
                type="range"
                min={20}
                max={120}
                value={fontSize2}
                onChange={(e) => setFontSize2(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: "#fff", fontSize: 13, minWidth: 28 }}>{fontSize2}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {FONTS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFont2(f.value)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    border: font2 === f.value ? "2px solid #4ade80" : "2px solid #444",
                    background: font2 === f.value ? "#1a3a2a" : "#1e1e1e",
                    color: font2 === f.value ? "#4ade80" : "#aaa",
                    cursor: "pointer",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
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
                    border: textColor2 === c.value ? "3px solid #4ade80" : "2px solid #444",
                    cursor: "pointer",
                  }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* 생성 버튼 */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={status === "loading"}
            style={{
              padding: "12px 0",
              borderRadius: 8,
              background: status === "loading" ? "#444" : "#4ade80",
              color: "#000",
              fontWeight: "bold",
              fontSize: 15,
              cursor: status === "loading" ? "not-allowed" : "pointer",
              border: "none",
              marginTop: 4,
            }}
          >
            {status === "loading" ? "⏳ 생성 중..." : "🖼️ 썸네일 생성"}
          </button>

          {error && (
            <div style={{ color: "#f87171", fontSize: 13 }}>❌ {error}</div>
          )}

          {status === "done" && downloadUrl && (
            <a
              href={downloadUrl}
              download="thumbnail.jpg"
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

        {/* ── 오른쪽: 미리보기 ── */}
        <div style={{ flex: "0 0 200px" }}>
          <div className="label">미리보기 (축소)</div>
          <div
            style={{
              marginTop: 6,
              width: 180,
              height: 320,
              borderRadius: 10,
              background: tc.bg,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: 16,
              boxSizing: "border-box",
              border: `3px solid ${tc.accent}`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* 팀명 뱃지 */}
            <div style={{
              position: "absolute",
              top: 12,
              background: tc.accent,
              color: tc.bg,
              fontWeight: "bold",
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 20,
            }}>
              {tc.label}
            </div>

            {/* 텍스트1 */}
            <div style={{
              color: textColor1,
              fontSize: fontSize1 * 0.18,
              fontFamily: fontFamilyMap[font1] || "'Black Han Sans', sans-serif",
              fontWeight: "bold",
              textAlign: "center",
              wordBreak: "keep-all",
              marginTop: 20,
              textShadow: "1px 1px 4px rgba(0,0,0,0.8)",
            }}>
              {text1 || "텍스트 1"}
            </div>

            {/* 구분선 */}
            <div style={{ width: "60%", height: 2, background: tc.accent, borderRadius: 2 }} />

            {/* 텍스트2 */}
            <div style={{
              color: textColor2,
              fontSize: fontSize2 * 0.18,
              fontFamily: fontFamilyMap[font2] || "'Black Han Sans', sans-serif",
              textAlign: "center",
              wordBreak: "keep-all",
              textShadow: "1px 1px 4px rgba(0,0,0,0.8)",
            }}>
              {text2 || "텍스트 2"}
            </div>
          </div>
          <div style={{ color: "#555", fontSize: 11, marginTop: 6 }}>
            실제 출력: 1080×1920px
          </div>
        </div>

      </div>
    </div>
  );
}
