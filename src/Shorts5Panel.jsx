import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo } from "./api.js";
import { drawStandingsSlide, loadSvgLogo, teamKeyword } from "./shorts1IntroStandingsDraw.js";
import { loadShortsBaseballDecor } from "./shortsBaseballDecor.js";
import {
  drawShorts5BattingSlide,
  drawShorts5GamesSlide,
  drawShorts5IntroSlide,
  drawShorts5PitcherSlide,
  drawShorts5RecordSlide,
  shorts5StandingsDateLabel,
} from "./shorts5SlideDraw.js";

const KBO_TEAMS = [
  { label: "삼성 라이온즈", keyword: "삼성" },
  { label: "KIA 타이거즈", keyword: "KIA" },
  { label: "LG 트윈스", keyword: "LG" },
  { label: "두산 베어스", keyword: "두산" },
  { label: "KT 위즈", keyword: "KT" },
  { label: "SSG 랜더스", keyword: "SSG" },
  { label: "롯데 자이언츠", keyword: "롯데" },
  { label: "한화 이글스", keyword: "한화" },
  { label: "NC 다이노스", keyword: "NC" },
  { label: "키움 히어로즈", keyword: "키움" },
];

const SHORTS_W = 1080;
const SHORTS_H = 1920;

function getLastWeekTuesdayKst() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const dow = now.getDay();
  const daysFromTue = (dow + 5) % 7;
  const thisTue = new Date(now);
  thisTue.setDate(now.getDate() - daysFromTue);
  const lastTue = new Date(thisTue);
  lastTue.setDate(thisTue.getDate() - 7);
  return lastTue.toLocaleDateString("sv-SE");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png");
  });
}

async function ensureCanvasFonts() {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
}

const ShortsCanvas = forwardRef(function ShortsCanvas({ slideIdx, renderSlide }, ref) {
  const canvasRef = useRef(null);
  useEffect(() => {
    renderSlide(canvasRef.current);
  }, [slideIdx, renderSlide]);
  return (
    <div className="shorts-capture-wrap">
      <div
        ref={ref}
        className="slide-card"
        style={{ margin: 0, padding: 0, display: "inline-block", lineHeight: 0 }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            margin: 0,
            padding: 0,
            borderRadius: 14,
            border: "1px solid rgba(0,0,0,0.15)",
          }}
        />
      </div>
    </div>
  );
});

export default function Shorts5Panel() {
  const [teamKw, setTeamKw] = useState("LG");
  const [weekStart, setWeekStart] = useState(() => getLastWeekTuesdayKst());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);

  const slides = useMemo(
    () => [
      { type: "intro" },
      { type: "record" },
      { type: "batting" },
      { type: "pitcher" },
      { type: "games" },
      { type: "standings" },
    ],
    []
  );

  const onFetch = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postKbo({
        action: "weekly_summary",
        team: teamKw,
        week_start: weekStart,
      });
      if (res && res.ok === false) {
        throw new Error(String(res.error || res.message || "API 오류"));
      }
      setData(res);
      setSlideIdx(0);
    } catch (e) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [teamKw, weekStart]);

  const renderSlideToCanvas = useCallback(
    async (idx, canvas) => {
      if (!canvas || !data) return;
      await ensureCanvasFonts();
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(SHORTS_W * dpr);
      canvas.height = Math.floor(SHORTS_H * dpr);
      canvas.style.width = "360px";
      canvas.style.height = "640px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const slide = slides[idx];
      if (!slide) return;

      const teamName = data.team_name || teamKw;
      const tk = teamKeyword(teamName);
      const logoImg = await loadSvgLogo(tk);
      const logosByTeamKey = { [tk]: logoImg };

      if (slide.type === "standings") {
        const standings = Array.isArray(data.standings) ? data.standings : [];
        for (const r of standings) {
          const t = r?.team ?? r?.TEAM_NM ?? "";
          const k = teamKeyword(t);
          if (!logosByTeamKey[k]) logosByTeamKey[k] = await loadSvgLogo(k);
        }
      }

      await loadShortsBaseballDecor();

      if (slide.type === "intro") drawShorts5IntroSlide(ctx, SHORTS_W, SHORTS_H, data, logoImg);
      else if (slide.type === "record")
        drawShorts5RecordSlide(ctx, SHORTS_W, SHORTS_H, data, logoImg);
      else if (slide.type === "batting") drawShorts5BattingSlide(ctx, SHORTS_W, SHORTS_H, data);
      else if (slide.type === "pitcher") drawShorts5PitcherSlide(ctx, SHORTS_W, SHORTS_H, data);
      else if (slide.type === "games") drawShorts5GamesSlide(ctx, SHORTS_W, SHORTS_H, data);
      else
        drawStandingsSlide(
          ctx,
          SHORTS_W,
          SHORTS_H,
          shorts5StandingsDateLabel(data),
          data.standings,
          logosByTeamKey
        );
    },
    [data, slides, teamKw]
  );

  const downloadPng = async (idx) => {
    const c = document.createElement("canvas");
    await renderSlideToCanvas(idx, c);
    const blob = await canvasToBlob(c);
    if (!blob) return;
    const tag = `${teamKw}_${weekStart}`;
    downloadBlob(blob, `shorts5_${tag}_${String(idx + 1).padStart(2, "0")}.png`);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const tag = `${teamKw}_${weekStart}`;
    for (let i = 0; i < slides.length; i++) {
      const c = document.createElement("canvas");
      await renderSlideToCanvas(i, c);
      const blob = await canvasToBlob(c);
      if (!blob) continue;
      zip.file(`shorts5_${tag}_${String(i + 1).padStart(2, "0")}.png`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `shorts5_${tag}.zip`);
  };

  return (
    <div className="section soft">
      <div className="section-title">5. 쇼츠-주간결산</div>
      <div className="muted">세로 9:16 (1080×1920) · 화~월 주간 (week_start = 화요일)</div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 10,
          flexWrap: "wrap",
        }}
      >
        <label className="muted" style={{ fontWeight: 900 }}>
          팀
          <select
            value={teamKw}
            onChange={(e) => setTeamKw(e.target.value)}
            disabled={busy}
            style={{ marginLeft: 8 }}
          >
            {KBO_TEAMS.map((t) => (
              <option key={t.keyword} value={t.keyword}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="muted" style={{ fontWeight: 900 }}>
          주 시작(화)
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            disabled={busy}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button
          type="button"
          className="primary"
          onClick={() => setWeekStart(getLastWeekTuesdayKst())}
          disabled={busy}
        >
          지난주 화요일
        </button>
        <button type="button" className="primary primary-fill" onClick={() => void onFetch()} disabled={busy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button type="button" className="primary" onClick={() => void downloadZip()} disabled={!data || busy}>
          전체 ZIP 다운로드
        </button>
      </div>

      {error ? <pre className="result-error-light">{error}</pre> : null}

      {data ? (
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "minmax(0, auto) 1fr",
            gap: 14,
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <ShortsCanvas slideIdx={slideIdx} renderSlide={(c) => renderSlideToCanvas(slideIdx, c)} />
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 ({slideIdx + 1}/{slides.length}) · {data.week_label}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSlideIdx((x) => Math.max(0, x - 1))} disabled={slideIdx === 0}>
                이전
              </button>
              <button
                type="button"
                onClick={() => setSlideIdx((x) => Math.min(slides.length - 1, x + 1))}
                disabled={slideIdx >= slides.length - 1}
              >
                다음
              </button>
              <button type="button" onClick={() => void downloadPng(slideIdx)} disabled={busy}>
                현재 슬라이드 PNG
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              1 인트로 · 2 주간 성적 · 3 타격 · 4 투수 · 5 경기 결과 · 6 KBO 순위
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
