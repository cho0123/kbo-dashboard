import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo, seoulToday } from "./api.js";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import { loadShortsBaseballDecor } from "./shortsBaseballDecor.js";
import {
  drawIntroSlide,
  drawStandingsSlide,
  KBO_INTRO_TEAM_KEYS,
  loadSvgLogo,
  teamKeyword,
} from "./shorts1IntroStandingsDraw.js";
import "./Shorts4Panel.css";

const SHORTS_EXPORT_W = 1080;
const SHORTS_EXPORT_H = 1920;
const CAPTURE_INTER_SLIDE_DELAY_MS = 100;

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

async function ensureCanvasFonts() {
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

function addCalendarDayKst(isoYmd, deltaDays) {
  const s = String(isoYmd || "").slice(0, 10);
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return seoulToday();
  const t = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0);
  return new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
}

/** App.jsx ShortsCanvas와 동일 구조 */
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
        style={{
          margin: 0,
          padding: 0,
          display: "inline-block",
          lineHeight: 0,
        }}
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

export default function Shorts4Panel() {
  const [date, setDate] = useState(() => seoulToday());
  const [tabGames, setTabGames] = useState([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [slideIdx, setSlideIdx] = useState(0);
  const captureWrapRef = useRef(null);
  const presetPickerRef = useRef(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [capturedSlides, setCapturedSlides] = useState([]);

  const fetchMatchupPreview = useCallback(async (dateStr) => {
    const d = String(dateStr || "").trim().slice(0, 10) || seoulToday();
    const res = await postKbo({ action: "matchup_preview", date: d });
    if (res && res.ok === false) {
      throw new Error(String(res.error || res.message || "API가 데이터를 반환하지 않았습니다."));
    }
    const g = Array.isArray(res?.games) ? res.games.slice(0, 5) : [];
    return { res, games: g };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setScheduleBusy(true);
    setError(null);
    setData(null);
    setCapturedSlides([]);
    setSelectedIdx(0);
    setSlideIdx(0);
    (async () => {
      try {
        const { games } = await fetchMatchupPreview(date);
        if (cancelled) return;
        setTabGames(games);
      } catch (e) {
        if (!cancelled) {
          setTabGames([]);
          setError(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setScheduleBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, fetchMatchupPreview]);

  const detailGame = useMemo(() => {
    if (!data) return null;
    const g = Array.isArray(data.games) ? data.games : [];
    return g[selectedIdx] ?? g[0] ?? null;
  }, [data, selectedIdx]);

  const standingsRows = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data.standings)
      ? data.standings
      : Array.isArray(data.standing_rows)
        ? data.standing_rows
        : [];
  }, [data]);

  const slides = useMemo(() => {
    if (!data || !detailGame) return [];
    return [{ type: "intro" }, { type: "matchup", game: detailGame }, { type: "standings" }];
  }, [data, detailGame]);

  useEffect(() => {
    setSlideIdx(0);
  }, [detailGame]);

  const paintSlideAt = useCallback(
    async (idx, canvas) => {
      if (!canvas) return;
      await ensureCanvasFonts();
      const w = 1080;
      const h = 1920;
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

      await loadShortsBaseballDecor();

      if (slide.type === "intro") {
        const logosByTeamKey = {};
        for (const tk of KBO_INTRO_TEAM_KEYS) {
          logosByTeamKey[tk] = await loadSvgLogo(tk);
        }
        drawIntroSlide(ctx, w, h, date, logosByTeamKey, "오늘경기 예상라인업");
        return;
      }

      if (slide.type === "standings") {
        const logosByTeamKey = {};
        const seen = new Set();
        for (const r of standingsRows) {
          const raw = r?.team ?? r?.TEAM_NM ?? r?.team_name ?? r?.name ?? "";
          const tk = teamKeyword(raw);
          if (!tk || seen.has(tk)) continue;
          seen.add(tk);
          logosByTeamKey[tk] = await loadSvgLogo(tk);
        }
        drawStandingsSlide(ctx, w, h, date, standingsRows, logosByTeamKey);
        return;
      }

      if (slide.type === "matchup" && slide.game) {
        ctx.fillStyle = "#f8f9fa";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#1a1a2e";
        ctx.font = "bold 52px system-ui, 'Noto Sans KR', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("매치업 슬라이드 준비 중", w / 2, h / 2);
      }
    },
    [slides, standingsRows, date]
  );

  const renderSlideToCanvas = useCallback(
    async (canvas) => {
      await paintSlideAt(slideIdx, canvas);
    },
    [slideIdx, paintSlideAt]
  );

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { res, games } = await fetchMatchupPreview(date);
      setData(res);
      setTabGames(games);
      setSelectedIdx((idx) => (games.length && idx >= games.length ? 0 : idx));
      setCapturedSlides([]);
      setSlideIdx(0);
    } catch (e) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [date, fetchMatchupPreview]);

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
          console.warn("[shorts4 capture] 해상도", c.width, c.height);
        }
        const blob = await new Promise((resolve, reject) => {
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png");
        });
        out.push({ key: `shorts4_${slides[i]?.type || i}`, blob });
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
    downloadBlob(blob, `shorts4_${date}_${String(idx + 1).padStart(2, "0")}.png`);
  };

  const downloadZip = async () => {
    if (!data || busy) return;
    const zip = new JSZip();
    for (let i = 0; i < slides.length; i++) {
      const c = document.createElement("canvas");
      await paintSlideAt(i, c);
      const blob = await canvasToBlob(c);
      if (!blob) continue;
      zip.file(`shorts4_${date}_${String(i + 1).padStart(2, "0")}.png`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `shorts4_${date}.zip`);
  };

  const rowBusy = busy || scheduleBusy;

  return (
    <div className="section soft shorts4-root">
      <div className="section-title">4. 쇼츠-예상전력-비교</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드</div>

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
          disabled={!data || rowBusy || captureBusy || !slides.length}
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
          shortsType="shorts4"
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
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={rowBusy}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>

      {tabGames.length > 0 ? (
        <div className="shorts4-tabs" style={{ marginTop: 10 }} role="tablist" aria-label="경기 선택">
          {tabGames.map((g, i) => {
            const label = `${g?.home_team || "홈"} vs ${g?.away_team || "원정"}`;
            return (
              <button
                key={String(g?.game_id ?? i)}
                type="button"
                role="tab"
                aria-selected={i === selectedIdx}
                className={`shorts4-tab${i === selectedIdx ? " active" : ""}`}
                onClick={() => {
                  setSelectedIdx(i);
                  setCapturedSlides([]);
                  setSlideIdx(0);
                }}
                disabled={rowBusy}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const todayStr = new Date().toLocaleDateString("sv-SE", {
              timeZone: "Asia/Seoul",
            });
            setDate(todayStr);
          }}
          disabled={rowBusy}
        >
          오늘
        </button>
        <button type="button" className="primary" onClick={() => setDate(addCalendarDayKst(date, 1))} disabled={rowBusy}>
          내일
        </button>
        <button type="button" className="primary" onClick={() => void onGenerate()} disabled={rowBusy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button type="button" className="primary primary-fill" onClick={() => void downloadZip()} disabled={!data || rowBusy}>
          전체 ZIP 다운로드
        </button>
      </div>

      {error ? <pre className="result-error-light">{error}</pre> : null}

      {data && detailGame && slides.length > 0 ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <ShortsCanvas ref={captureWrapRef} slideIdx={slideIdx} renderSlide={renderSlideToCanvas} />
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 ({slideIdx + 1}/{slides.length})
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSlideIdx((x) => Math.max(0, x - 1))} disabled={slideIdx === 0 || captureBusy}>
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
              - 슬라이드1: 인트로
              <br />
              - 슬라이드2~N: 경기별 예상전력(순위·선발·라인업)
              <br />- 마지막: KBO 순위
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
