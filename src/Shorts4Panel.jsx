import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo, seoulToday } from "./api.js";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import { loadShortsBaseballDecor } from "./shortsBaseballDecor.js";
import { drawStandingsSlide, loadSvgLogo, teamKeyword } from "./shorts1IntroStandingsDraw.js";
import {
  drawTomorrowPreviewGameSlide,
  drawTomorrowPreviewIntroSlide,
  SHORTS2_INTRO_TEAM_KEYS,
} from "./shorts2TomorrowPreviewDraw.js";
import {
  drawShorts4HotPlayerSlide,
  drawShorts4LineupSlide,
  drawShorts4StarterSlide,
} from "./shorts4SlideDraw.js";
import {
  clearPlayerImageCache,
  loadDefaultPlayerImage,
  loadPlayerImage,
  loadPlayerImageFromNaverProxy,
} from "./shorts4PlayerImage.js";
import "./Shorts4Panel.css";

const SHORTS_EXPORT_W = 1080;
const SHORTS_EXPORT_H = 1920;
const CAPTURE_INTER_SLIDE_DELAY_MS = 100;

/** 쇼츠2 `slideExportKeyShorts2`와 동일 — 영상 프리셋 duration·쇼츠2와 동일 키 체계 */
function slideExportKeyShorts4Capture(slide) {
  if (!slide?.type) return "intro";
  if (slide.type === "intro") return "intro";
  if (slide.type === "preview_game") {
    const p = Math.min(5, Math.max(1, Number(slide.page) || 1));
    return p <= 4 ? "game_preview" : "game_preview_last";
  }
  if (slide.type === "starter") return "starter";
  if (slide.type === "hot_player") return "hot_player";
  if (slide.type === "home_lineup") return "home_lineup";
  if (slide.type === "away_lineup") return "away_lineup";
  if (slide.type === "standings") return "standings";
  return "intro";
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
  const playerPhotoFileRef = useRef(null);
  const [playerPhotoTeam, setPlayerPhotoTeam] = useState("");
  const [playerPhotoName, setPlayerPhotoName] = useState("");
  const [playerPhotoUploading, setPlayerPhotoUploading] = useState(false);
  const [playerPhotoMsg, setPlayerPhotoMsg] = useState("");
  const [playerPhotoOk, setPlayerPhotoOk] = useState(false);

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

  /**
   * 최종 11장:
   * 1 intro · 2~6 preview_game page 1~5 · 7 starter · 8 hot_player ·
   * 9 home_lineup · 10 away_lineup · 11 standings
   */
  const slides = useMemo(() => {
    if (!data || !detailGame) return [];
    const g = detailGame;
    const s = [{ type: "intro" }];
    for (let page = 1; page <= 5; page++) {
      s.push({ type: "preview_game", game: g, page });
    }
    s.push({ type: "starter", game: g });
    s.push({ type: "hot_player", game: g });
    s.push({ type: "home_lineup", game: g });
    s.push({ type: "away_lineup", game: g });
    s.push({ type: "standings" });
    return s;
  }, [data, detailGame]);

  useEffect(() => {
    setSlideIdx(0);
  }, [detailGame]);

  const paintSlideAt = useCallback(
    async (idx, canvas) => {
      if (!canvas) return;
      let slide;
      try {
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
        slide = slides[idx];
        if (!slide) {
          ctx.fillStyle = "#f8f9fa";
          ctx.fillRect(0, 0, w, h);
          return;
        }

        const standings = standingsRows;

        const teamKeys = new Set();
        if (slide.type === "intro") {
          for (const tk of SHORTS2_INTRO_TEAM_KEYS) teamKeys.add(tk);
        } else if (slide.type === "preview_game") {
          teamKeys.add(teamKeyword(slide.game?.home_team));
          teamKeys.add(teamKeyword(slide.game?.away_team));
        } else if (
          slide.type === "starter" ||
          slide.type === "hot_player" ||
          slide.type === "home_lineup" ||
          slide.type === "away_lineup"
        ) {
          teamKeys.add(teamKeyword(slide.game?.home_team));
          teamKeys.add(teamKeyword(slide.game?.away_team));
        } else if (slide.type === "standings") {
          for (const r of standings) {
            teamKeys.add(teamKeyword(r?.team ?? r?.TEAM_NM ?? r?.team_name ?? r?.name ?? ""));
          }
        }

        const logosByTeamKey = {};
        for (const tk of teamKeys) {
          if (!tk) continue;
          logosByTeamKey[tk] = await loadSvgLogo(tk);
        }

        await loadShortsBaseballDecor();

        if (slide.type === "intro") {
          drawTomorrowPreviewIntroSlide(ctx, w, h, date, logosByTeamKey, detailGame);
          return;
        }

        if (slide.type === "preview_game" && slide.game) {
          drawTomorrowPreviewGameSlide(ctx, w, h, date, slide.game, logosByTeamKey, Number(slide.page) || 1);
          return;
        }

        if (slide.type === "starter" && slide.game) {
          const g0 = slide.game;
          const hk = teamKeyword(g0?.home_team);
          const ak = teamKeyword(g0?.away_team);
          const hsName = String(g0?.home_starter || "").trim();
          const asName = String(g0?.away_starter || "").trim();
          const homeStarterUrl = String(g0?.home_starter_image_url || "").trim();
          const awayStarterUrl = String(g0?.away_starter_image_url || "").trim();
          const [awayPortrait, homePortrait, defImg] = await Promise.all([
            awayStarterUrl
              ? loadPlayerImageFromNaverProxy(awayStarterUrl)
              : loadPlayerImage(ak, asName),
            homeStarterUrl
              ? loadPlayerImageFromNaverProxy(homeStarterUrl)
              : loadPlayerImage(hk, hsName),
            loadDefaultPlayerImage(),
          ]);
          const awayFinal = awayPortrait ?? defImg;
          const homeFinal = homePortrait ?? defImg;
          drawShorts4StarterSlide(ctx, w, h, g0, { away: awayFinal, home: homeFinal }, logosByTeamKey);
          return;
        }

        if (slide.type === "hot_player" && slide.game) {
          const g0 = slide.game;
          console.log('[hot_player] home:', g0?.home_hot_player?.player, g0?.home_hot_player?.player_image_url);
          console.log('[hot_player] away:', g0?.away_hot_player?.player, g0?.away_hot_player?.player_image_url);
          const hk = teamKeyword(g0?.home_team);
          const ak = teamKeyword(g0?.away_team);
          const homeName = String(g0?.home_hot_player?.player || "").trim();
          const awayName = String(g0?.away_hot_player?.player || "").trim();
          const homeUrl = String(g0?.home_hot_player?.player_image_url || "").trim();
          const awayUrl = String(g0?.away_hot_player?.player_image_url || "").trim();
          const [homePortrait, awayPortrait, defImg] = await Promise.all([
            homeUrl ? loadPlayerImageFromNaverProxy(homeUrl) : loadPlayerImage(hk, homeName),
            awayUrl ? loadPlayerImageFromNaverProxy(awayUrl) : loadPlayerImage(ak, awayName),
            loadDefaultPlayerImage(),
          ]);
          const homeFinal = homePortrait ?? defImg;
          const awayFinal = awayPortrait ?? defImg;
          drawShorts4HotPlayerSlide(
            ctx,
            w,
            h,
            g0,
            { home: homeFinal, away: awayFinal },
            logosByTeamKey
          );
          return;
        }

        if (slide.type === "home_lineup" && slide.game) {
          drawShorts4LineupSlide(ctx, w, h, slide.game, "home");
          return;
        }

        if (slide.type === "away_lineup" && slide.game) {
          drawShorts4LineupSlide(ctx, w, h, slide.game, "away");
          return;
        }

        if (slide.type === "standings") {
          drawStandingsSlide(ctx, w, h, date, standings, logosByTeamKey);
          return;
        }
      } catch (e) {
        console.error('[paintSlideAt] error:', slide?.type, e);
      }
    },
    [slides, standingsRows, date, detailGame]
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
        out.push({ key: slideExportKeyShorts4Capture(slides[i]), blob });
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

  const uploadPlayerPhoto = useCallback(async () => {
    setPlayerPhotoMsg("");
    setPlayerPhotoOk(false);
    const team = String(playerPhotoTeam || "").trim();
    const playerName = String(playerPhotoName || "").trim();
    if (!team || !playerName) {
      setPlayerPhotoMsg("팀명과 선수명을 입력하세요.");
      return;
    }
    const file = playerPhotoFileRef.current?.files?.[0];
    if (!file) {
      setPlayerPhotoMsg("PNG 파일을 선택하세요.");
      return;
    }
    setPlayerPhotoUploading(true);
    try {
      const imageBase64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = String(fr.result || "");
          const m = /^data:image\/png;base64,(.+)$/i.exec(dataUrl);
          if (m) resolve(m[1].replace(/\s/g, ""));
          else reject(new Error("PNG 파일만 업로드할 수 있습니다."));
        };
        fr.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
        fr.readAsDataURL(file);
      });
      const res = await postKbo({
        action: "upload_player_image",
        team,
        playerName,
        imageBase64,
      });
      if (!res || res.ok === false) {
        throw new Error(String(res?.error || res?.message || "업로드 실패"));
      }
      clearPlayerImageCache();
      setPlayerPhotoOk(true);
      setPlayerPhotoMsg("✅ 업로드 완료");
      if (playerPhotoFileRef.current) playerPhotoFileRef.current.value = "";
    } catch (e) {
      setPlayerPhotoOk(false);
      setPlayerPhotoMsg(e?.message || String(e));
    } finally {
      setPlayerPhotoUploading(false);
    }
  }, [playerPhotoTeam, playerPhotoName]);

  return (
    <div className="section soft shorts4-root">
      <div className="section-title">4. 쇼츠-예상전력-비교</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드</div>

      <details className="shorts4-player-photo-mgmt" style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>선수 사진 관리</summary>
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gap: 8,
            padding: "10px 0",
            borderTop: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          <label className="muted" style={{ fontSize: 13 }}>
            팀명 (파일명과 동일하게, 예: 삼성)
            <input
              type="text"
              value={playerPhotoTeam}
              onChange={(e) => {
                setPlayerPhotoTeam(e.target.value);
                setPlayerPhotoOk(false);
                if (playerPhotoMsg === "✅ 업로드 완료") setPlayerPhotoMsg("");
              }}
              placeholder="삼성"
              disabled={playerPhotoUploading}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }}
            />
          </label>
          <label className="muted" style={{ fontSize: 13 }}>
            선수명
            <input
              type="text"
              value={playerPhotoName}
              onChange={(e) => {
                setPlayerPhotoName(e.target.value);
                setPlayerPhotoOk(false);
                if (playerPhotoMsg === "✅ 업로드 완료") setPlayerPhotoMsg("");
              }}
              placeholder="홍길동"
              disabled={playerPhotoUploading}
              style={{ width: "100%", boxSizing: "border-box", marginTop: 4 }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              ref={playerPhotoFileRef}
              type="file"
              accept="image/png"
              disabled={playerPhotoUploading}
              style={{ display: "none" }}
              onChange={() => {
                setPlayerPhotoOk(false);
                if (playerPhotoMsg === "✅ 업로드 완료") setPlayerPhotoMsg("");
              }}
            />
            <button
              type="button"
              className="primary"
              disabled={playerPhotoUploading}
              onClick={() => playerPhotoFileRef.current?.click()}
            >
              파일 선택 (PNG)
            </button>
            <button
              type="button"
              className="primary primary-fill"
              disabled={playerPhotoUploading}
              onClick={() => void uploadPlayerPhoto()}
            >
              {playerPhotoUploading ? "업로드 중…" : "S3 업로드"}
            </button>
          </div>
          {playerPhotoMsg ? (
            <div className={playerPhotoOk ? "muted" : "result-error-light"} style={{ fontSize: 13 }}>
              {playerPhotoMsg}
            </div>
          ) : null}
        </div>
      </details>

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
              - 슬라이드1: 인트로 (쇼츠2)
              <br />
              - 슬라이드2~6: 프리뷰 page 1~5 (쇼츠2)
              <br />
              - 슬라이드7: 선발 투수 (ERA·이닝·삼진)
              <br />
              - 슬라이드8: 지난경기 핫플레이어 (홈/원정 타자)
              <br />
              - 슬라이드9~10: 홈/원정 예상 라인업
              <br />- 슬라이드11: KBO 순위
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
