import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo } from "./api.js";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import { drawStandingsSlide, loadSvgLogo, teamKeyword } from "./shorts1IntroStandingsDraw.js";
import { loadShortsBaseballDecor } from "./shortsBaseballDecor.js";
import {
  drawableShorts4Portrait,
  loadDefaultPlayerImage,
  loadPlayerImage,
  loadPlayerImageFromNaverProxy,
} from "./shorts4PlayerImage.js";
import {
  drawShorts5BattingSlide,
  drawShorts5GamesSlide,
  drawShorts5IntroSlide,
  drawShorts5PitcherSlide,
  drawShorts5RecordSlide,
  loadShorts5BattingSlideAssets,
  loadShorts5PitcherSlideAssets,
  shorts5StandingsDateLabel,
} from "./shorts5SlideDraw.js";
import "./Shorts4Panel.css";

const SHORTS_EXPORT_W = 1080;
const SHORTS_EXPORT_H = 1920;
const CAPTURE_INTER_SLIDE_DELAY_MS = 100;

/** 쇼츠4 hot_player(339~365행)와 동일: 네이버 URL → S3 → 기본 실루엣 */
async function loadShorts5MvpPortrait(mvp, teamKw, data) {
  const mvp0 = mvp && typeof mvp === "object" ? mvp : {};
  const tk =
    teamKeyword(String(teamKw || "").trim()) ||
    teamKeyword(String(data?.team_keyword || "").trim()) ||
    teamKeyword(String(data?.team_name || "").trim()) ||
    teamKeyword(String(mvp0.team || "").trim());
  const player = String(mvp0.player || "").trim();
  const url = String(mvp0.player_image_url || mvp0.image_url || "").trim();

  console.log("[shorts5] mvp portrait load", { tk, player, player_image_url: url || null });

  const [portrait, defImg] = await Promise.all([
    url ? loadPlayerImageFromNaverProxy(url) : loadPlayerImage(tk, player),
    loadDefaultPlayerImage(),
  ]);
  const finalPortrait = portrait ?? defImg;

  console.log("[shorts5] mvp portrait result", {
    tk,
    player,
    viaNaver: Boolean(url),
    loaded: Boolean(drawableShorts4Portrait(portrait)),
    default: Boolean(drawableShorts4Portrait(defImg)),
    final: Boolean(drawableShorts4Portrait(finalPortrait)),
  });

  return finalPortrait;
}

const TEAM_BUTTONS = [
  { keyword: "KT", label: "KT" },
  { keyword: "한화", label: "한화" },
  { keyword: "삼성", label: "삼성" },
  { keyword: "KIA", label: "KIA" },
  { keyword: "SSG", label: "SSG" },
  { keyword: "LG", label: "LG" },
  { keyword: "두산", label: "두산" },
  { keyword: "롯데", label: "롯데" },
  { keyword: "NC", label: "NC" },
  { keyword: "키움", label: "키움" },
];

const SLIDES = [
  { type: "intro" },
  { type: "record", step: 1 },
  { type: "record", step: 2, revealCount: 1 },
  { type: "record", step: 2, revealCount: 2 },
  { type: "record", step: 2, revealCount: 3 },
  { type: "record", step: 2, revealCount: 4 },
  { type: "record", step: 2, revealCount: 5 },
  { type: "record", step: 2, revealCount: 6 },
  { type: "batting", step: 1 },
  { type: "batting", step: 2 },
  { type: "batting", step: 3 },
  { type: "batting", step: 4 },
  { type: "pitcher", step: 1 },
  { type: "pitcher", step: 2 },
  { type: "pitcher", step: 3 },
  { type: "pitcher", step: 4 },
  { type: "games", step: 1 },
  { type: "games", step: 2 },
  { type: "games", step: 3 },
  { type: "standings" },
];

function slideExportKeyShorts5Capture(slide) {
  if (!slide?.type) return "intro";
  const stepSuffix = slide.step != null ? `_s${slide.step}` : "";
  if (slide.type === "intro") return "intro";
  if (slide.type === "record") {
    if (slide.revealCount != null) return `record_data${slide.revealCount}`;
    return `record${stepSuffix}`;
  }
  if (slide.type === "batting") return `batting${stepSuffix}`;
  if (slide.type === "pitcher") return `pitcher${stepSuffix}`;
  if (slide.type === "games") return `games${stepSuffix}`;
  if (slide.type === "standings") return "standings";
  return "intro";
}

/** KBO 주차: 월~일. 이번 주 월요일(오늘이 월이면 오늘), 화~일이면 직전 월요일. */
function getMondayKst(weekOffset = 0) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const dow = now.getDay();
  const daysFromMon = (dow + 6) % 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - daysFromMon + weekOffset * 7);
  return mon.toLocaleDateString("sv-SE");
}

function getThisWeekMondayKst() {
  return getMondayKst(0);
}

function getLastWeekMondayKst() {
  return getMondayKst(-1);
}

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFontsReadyForCapture() {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
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
  if (!canvas) return Promise.resolve(null);
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
  const [teamKw, setTeamKw] = useState("삼성");
  const [weekStart, setWeekStart] = useState(() => getLastWeekMondayKst());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const captureWrapRef = useRef(null);
  const presetPickerRef = useRef(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [capturedSlides, setCapturedSlides] = useState([]);

  const slides = useMemo(() => (data ? SLIDES : []), [data]);
  const exportTag = `${teamKw}_${weekStart}`;

  const paintSlideAt = useCallback(
    async (idx, canvas) => {
      if (!canvas || !data) return;
      await ensureCanvasFonts();
      const w = SHORTS_EXPORT_W;
      const h = SHORTS_EXPORT_H;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = "360px";
      canvas.style.height = "640px";
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const slide = slides[idx];
      if (!slide) {
        ctx.fillStyle = "#f8f9fa";
        ctx.fillRect(0, 0, w, h);
        return;
      }

      const teamName = data.team_name || teamKw;
      const tk = teamKeyword(teamName);
      const logoImg = await loadSvgLogo(tk);
      const logosByTeamKey = { [tk]: logoImg };

      if (slide.type === "record" || slide.type === "games") {
        const games =
          slide.type === "games"
            ? Array.isArray(data.schedule_games)
              ? data.schedule_games
              : []
            : Array.isArray(data.games)
              ? data.games
              : [];
        for (const g of games) {
          const opp = String(g?.opponent ?? g?.opp_team_name ?? "").trim();
          const k = teamKeyword(opp);
          if (k && !logosByTeamKey[k]) logosByTeamKey[k] = await loadSvgLogo(k);
        }
      }

      if (slide.type === "standings") {
        const standings = Array.isArray(data.standings) ? data.standings : [];
        for (const r of standings) {
          const t = r?.team ?? r?.TEAM_NM ?? "";
          const k = teamKeyword(t);
          if (k && !logosByTeamKey[k]) logosByTeamKey[k] = await loadSvgLogo(k);
        }
      }

      await loadShortsBaseballDecor();

      if (slide.type === "intro") drawShorts5IntroSlide(ctx, w, h, data, logoImg);
      else if (slide.type === "record")
        drawShorts5RecordSlide(
          ctx,
          w,
          h,
          data,
          logoImg,
          logosByTeamKey,
          slide.step ?? 3,
          slide.revealCount ?? null
        );
      else if (slide.type === "batting") {
        const mvp = data?.mvp_batter;
        const [battingAssets, portrait] = await Promise.all([
          loadShorts5BattingSlideAssets(data, teamKw),
          loadShorts5MvpPortrait(mvp, teamKw, data),
        ]);
        await drawShorts5BattingSlide(
          ctx,
          w,
          h,
          data,
          { ...battingAssets, portrait },
          teamKw,
          slide.step ?? 4
        );
      }
      else if (slide.type === "pitcher") {
        const mvpPitcher = data?.mvp_starter_pitcher;
        const [pitcherAssets, portrait] = await Promise.all([
          loadShorts5PitcherSlideAssets(data),
          loadShorts5MvpPortrait(mvpPitcher, teamKw, data),
        ]);
        await drawShorts5PitcherSlide(
          ctx,
          w,
          h,
          data,
          { ...pitcherAssets, portrait },
          teamKw,
          slide.step ?? 4
        );
      }
      else if (slide.type === "games")
        drawShorts5GamesSlide(
          ctx,
          w,
          h,
          data,
          logoImg,
          logosByTeamKey,
          slide.step ?? 3
        );
      else
        drawStandingsSlide(
          ctx,
          w,
          h,
          shorts5StandingsDateLabel(data),
          data.standings,
          logosByTeamKey
        );
    },
    [data, slides, teamKw]
  );

  const renderSlideToCanvas = useCallback(
    async (canvas) => {
      await paintSlideAt(slideIdx, canvas);
    },
    [slideIdx, paintSlideAt]
  );

  const onFetch = useCallback(async (overrides) => {
    const team = String(overrides?.team ?? teamKw).trim();
    const week = String(overrides?.weekStart ?? weekStart).trim();
    setBusy(true);
    setError(null);
    try {
      const res = await postKbo({
        action: "weekly_summary",
        team,
        week_start: week,
      });
      if (res && res.ok === false) {
        throw new Error(String(res.error || res.message || "API 오류"));
      }
      setData(res);
      if (res?.mvp_batter?.player) {
        const preloadTeam = String(overrides?.team ?? teamKw).trim();
        Promise.all([
          loadShorts5BattingSlideAssets(res, preloadTeam),
          loadShorts5MvpPortrait(res.mvp_batter, preloadTeam, res),
        ]).catch(() => {});
      }
      if (res?.mvp_starter_pitcher?.player) {
        const preloadTeam = String(overrides?.team ?? teamKw).trim();
        Promise.all([
          loadShorts5PitcherSlideAssets(res),
          loadShorts5MvpPortrait(res.mvp_starter_pitcher, preloadTeam, res),
        ]).catch(() => {});
      }
      setCapturedSlides([]);
      setSlideIdx(0);
    } catch (e) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [teamKw, weekStart]);

  useEffect(() => {
    setCapturedSlides([]);
    setSlideIdx(0);
  }, [teamKw]);

  const captureAllSlides = async () => {
    if (!data || !slides.length) return;
    setCaptureBusy(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const out = [];
      for (let i = 0; i < slides.length; i++) {
        setSlideIdx(i);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await waitFontsReadyForCapture();
        const el = captureWrapRef.current;
        if (!el) throw new Error("캡처 대상이 없습니다.");
        const scale = SHORTS_EXPORT_W / Math.max(1, el.offsetWidth);
        const c = await html2canvas(el, {
          scale,
          useCORS: true,
          backgroundColor: null,
        });
        if (c.width !== SHORTS_EXPORT_W || c.height !== SHORTS_EXPORT_H) {
          console.warn("[shorts5 capture] 해상도", c.width, c.height);
        }
        const blob = await new Promise((resolve, reject) => {
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png");
        });
        out.push({ key: slideExportKeyShorts5Capture(slides[i]), blob });
        if (i < slides.length - 1) {
          await delayMs(CAPTURE_INTER_SLIDE_DELAY_MS);
        }
      }
      setCapturedSlides(out);
    } catch (e) {
      window.alert(e?.message || String(e));
    } finally {
      setCaptureBusy(false);
    }
  };

  const downloadPng = async (idx) => {
    const c = document.createElement("canvas");
    await paintSlideAt(idx, c);
    const blob = await canvasToBlob(c);
    if (!blob) return;
    downloadBlob(blob, `shorts5_${exportTag}_${String(idx + 1).padStart(2, "0")}.png`);
  };

  const downloadZip = async () => {
    if (!data || busy) return;
    const zip = new JSZip();
    for (let i = 0; i < slides.length; i++) {
      const c = document.createElement("canvas");
      await paintSlideAt(i, c);
      const blob = await canvasToBlob(c);
      if (!blob) continue;
      zip.file(`shorts5_${exportTag}_${String(i + 1).padStart(2, "0")}.png`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `shorts5_${exportTag}.zip`);
  };

  const rowBusy = busy || captureBusy;

  return (
    <div className="section soft shorts4-root">
      <div className="section-title">5. 쇼츠-주간결산</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드 · 월~일 (week_start = 월요일)</div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="primary"
          onClick={() => void captureAllSlides()}
          disabled={!data || rowBusy || !slides.length}
        >
          {captureBusy ? "캡처 중…" : "슬라이드 캡처"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {capturedSlides.length === 0 ? "미캡처" : `✅ ${capturedSlides.length}장 캡처됨`}
        </span>
      </div>

      <div className="shorts4-preset-tight">
        <ShortsPresetPicker
          ref={presetPickerRef}
          shortsType="shorts5"
          slides={capturedSlides}
          hideVideoButton
          hideCaptureStatus
        />
      </div>

      <div
        className="shorts4-video-row"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button type="button" className="primary" onClick={() => presetPickerRef.current?.openVideoExport()}>
          영상 생성
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {capturedSlides.length === 0 ? "미캡처" : `✅ ${capturedSlides.length}장 캡처됨`}
        </span>
      </div>

      <div style={{ marginTop: 10 }}>
        <input
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          disabled={rowBusy}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>

      <div className="shorts4-tabs" style={{ marginTop: 10 }} role="tablist" aria-label="팀 선택">
        {TEAM_BUTTONS.map((t) => (
          <button
            key={t.keyword}
            type="button"
            role="tab"
            aria-selected={teamKw === t.keyword}
            className={`shorts4-tab${teamKw === t.keyword ? " active" : ""}`}
            onClick={() => {
              setTeamKw(t.keyword);
              setCapturedSlides([]);
              setSlideIdx(0);
              void onFetch({ team: t.keyword });
            }}
            disabled={rowBusy}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="primary"
          onClick={() => setWeekStart(getThisWeekMondayKst())}
          disabled={rowBusy}
        >
          이번주
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => setWeekStart(getLastWeekMondayKst())}
          disabled={rowBusy}
        >
          지난주
        </button>
        <button type="button" className="primary" onClick={() => void onFetch()} disabled={rowBusy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button
          type="button"
          className="primary primary-fill"
          onClick={() => void downloadZip()}
          disabled={!data || rowBusy}
        >
          전체 ZIP 다운로드
        </button>
      </div>

      {error ? <pre className="result-error-light">{error}</pre> : null}

      {data && slides.length > 0 ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <ShortsCanvas ref={captureWrapRef} slideIdx={slideIdx} renderSlide={renderSlideToCanvas} />
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 ({slideIdx + 1}/{slides.length}) · {data.week_label || weekStart}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setSlideIdx((x) => Math.max(0, x - 1))}
                disabled={slideIdx === 0 || captureBusy}
              >
                이전
              </button>
              <button
                type="button"
                onClick={() => setSlideIdx((x) => Math.min(slides.length - 1, x + 1))}
                disabled={slideIdx >= slides.length - 1 || captureBusy}
              >
                다음
              </button>
              <button type="button" onClick={() => void downloadPng(slideIdx)} disabled={rowBusy || captureBusy}>
                현재 슬라이드 PNG 다운로드
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              - 슬라이드1: 인트로 (팀컬러 + 주간결산)
              <br />
              - 슬라이드2: 주간 경기결과 (1~6경기 순차)
              <br />
              - 슬라이드3: 타격 하이라이트
              <br />
              - 슬라이드4: 투수 하이라이트
              <br />
              - 슬라이드5: 경기 결과 목록
              <br />- 슬라이드6: KBO 순위표
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
