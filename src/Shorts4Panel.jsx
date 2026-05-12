import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo, seoulToday } from "./api.js";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import "./Shorts4Panel.css";

const SHORTS_EXPORT_W = 1080;
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

function addCalendarDayKst(isoYmd, deltaDays) {
  const s = String(isoYmd || "").slice(0, 10);
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return seoulToday();
  const t = Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0);
  return new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10);
}

function fmtWdl(rec) {
  if (!rec || typeof rec !== "object") return "—";
  const w = Number(rec.win);
  const d = Number(rec.draw);
  const l = Number(rec.lose);
  const parts = [];
  if (Number.isFinite(w)) parts.push(`${w}승`);
  if (Number.isFinite(d) && d > 0) parts.push(`${d}무`);
  if (Number.isFinite(l)) parts.push(`${l}패`);
  return parts.length ? parts.join(" ") : "—";
}

function fmtRankLine(rankObj) {
  if (!rankObj || typeof rankObj !== "object") return "순위 —";
  const r = Number(rankObj.rank);
  if (Number.isFinite(r) && r > 0) return `${r}위`;
  return "순위 —";
}

function fmtLast5(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.join(" ");
}

function fmtEra(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return n.toFixed(2);
  return String(v);
}

function fmtNum(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return String(n);
  return String(v);
}

function sortLineup(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
}

function LineupTable({ title, rows }) {
  const sorted = sortLineup(rows);
  return (
    <div>
      <div className="hint" style={{ marginBottom: 6 }}>
        {title}
      </div>
      <table className="shorts4-lineup-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th className="pos">포</th>
            <th>타자</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">
                라인업 없음
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr key={`${row.order}-${row.player}-${i}`}>
                <td className="num">{row.order || i + 1}</td>
                <td className="pos">{row.pos || "—"}</td>
                <td>{row.player || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function MatchupDetailCard({ game }) {
  if (!game) return null;
  const hName = game.home_team || "홈";
  const aName = game.away_team || "원정";

  return (
    <div className="card">
      <div className="hint" style={{ marginBottom: 10 }}>
        {game.game_date || "—"}
        {game.game_time ? ` · ${game.game_time}` : ""}
        {game.venue ? ` · ${game.venue}` : ""}
      </div>
      <h3 style={{ marginTop: 0 }}>
        {hName} vs {aName}
      </h3>
      <div className="row two" style={{ marginBottom: 14 }}>
        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{aName}</h4>
          <div className="muted" style={{ fontSize: "0.88rem", lineHeight: 1.45 }}>
            {fmtRankLine(game.away_rank)} · 전적 {fmtWdl(game.away_record)}
            <br />
            최근 5경기: {fmtLast5(game.away_last5)}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ margin: "0 0 8px" }}>{hName}</h4>
          <div className="muted" style={{ fontSize: "0.88rem", lineHeight: 1.45 }}>
            {fmtRankLine(game.home_rank)} · 전적 {fmtWdl(game.home_record)}
            <br />
            최근 5경기: {fmtLast5(game.home_last5)}
          </div>
        </div>
      </div>

      <div className="hint" style={{ margin: "12px 0 8px" }}>
        선발 투수
      </div>
      <div className="row two">
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{game.away_starter || "미정"}</div>
          <div className="muted" style={{ fontSize: "0.88rem", lineHeight: 1.55 }}>
            ERA {fmtEra(game.away_starter_era)}
            <br />
            이닝 {fmtNum(game.away_starter_ip)} · 삼진 {fmtNum(game.away_starter_so)}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{game.home_starter || "미정"}</div>
          <div className="muted" style={{ fontSize: "0.88rem", lineHeight: 1.55 }}>
            ERA {fmtEra(game.home_starter_era)}
            <br />
            이닝 {fmtNum(game.home_starter_ip)} · 삼진 {fmtNum(game.home_starter_so)}
          </div>
        </div>
      </div>

      <div className="hint" style={{ margin: "16px 0 8px" }}>
        직전경기 라인업
      </div>
      <div className="row two">
        <LineupTable title={`${aName} (원정)`} rows={game.away_lineup} />
        <LineupTable title={`${hName} (홈)`} rows={game.home_lineup} />
      </div>
    </div>
  );
}

export default function Shorts4Panel() {
  const [date, setDate] = useState(() => seoulToday());
  const [tabGames, setTabGames] = useState([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
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
    const row = g[selectedIdx] ?? g[0] ?? null;
    return row;
  }, [data, selectedIdx]);

  const slides = useMemo(() => {
    if (!detailGame) return [];
    return [{ type: "matchup", game: detailGame }];
  }, [detailGame]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { res, games } = await fetchMatchupPreview(date);
      setData(res);
      setTabGames(games);
      setSelectedIdx((idx) => (games.length && idx >= games.length ? 0 : idx));
      setCapturedSlides([]);
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
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await waitFontsReadyForCapture();
        const el = captureWrapRef.current;
        if (!el) throw new Error("캡처 대상이 없습니다.");
        const scale = SHORTS_EXPORT_W / Math.max(1, el.offsetWidth);
        const c = await html2canvas(el, {
          scale,
          useCORS: true,
          backgroundColor: "#f8f9fa",
        });
        const blob = await new Promise((resolve, reject) => {
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png");
        });
        out.push({ key: "shorts4_matchup", blob });
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

  const html2canvasToBlob = async () => {
    const el = captureWrapRef.current;
    if (!el) return null;
    await waitFontsReadyForCapture();
    const { default: html2canvas } = await import("html2canvas");
    const scale = SHORTS_EXPORT_W / Math.max(1, el.offsetWidth);
    const c = await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: "#f8f9fa",
    });
    return new Promise((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 변환 실패"))), "image/png");
    });
  };

  const downloadZip = async () => {
    if (!data || busy) return;
    const zip = new JSZip();
    if (capturedSlides.length > 0) {
      capturedSlides.forEach((item, i) => {
        if (item.blob) {
          zip.file(`shorts4_${date}_${String(i + 1).padStart(2, "0")}.png`, item.blob);
        }
      });
    } else {
      try {
        const blob = await html2canvasToBlob();
        if (!blob) return;
        zip.file(`shorts4_${date}_01.png`, blob);
      } catch {
        return;
      }
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
          disabled={!data || rowBusy || captureBusy || !detailGame}
        >
          {captureBusy ? "캡처 중…" : "슬라이드 캡처"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {capturedSlides.length === 0 ? "미캡처" : `✅ ${capturedSlides.length}장 캡처됨`}
        </span>
      </div>

      <ShortsPresetPicker
        ref={presetPickerRef}
        shortsType="shorts4"
        slides={capturedSlides}
        hideVideoButton
        hideCaptureStatus
      />

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 8,
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

      {data && detailGame ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <div className="shorts-capture-wrap">
              <div
                ref={captureWrapRef}
                className="slide-card"
                style={{
                  margin: 0,
                  padding: 0,
                  display: "inline-block",
                  lineHeight: 0,
                  maxWidth: 360,
                }}
              >
                <div style={{ padding: 12, lineHeight: 1.4, background: "#f8f9fa" }}>
                  <MatchupDetailCard game={detailGame} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 (1/{slides.length || 1})
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              - 선택 경기 예상 전력(순위·선발·라인업) 캡처용
              <br />- 슬라이드 캡처 후 BGM 프리셋으로 영상 생성
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
