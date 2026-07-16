import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo, seoulToday } from "./api.js";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import { loadShortsBaseballDecor } from "./shortsBaseballDecor.js";
import { drawStandingsSlide, loadSvgLogo, teamKeyword } from "./shorts1IntroStandingsDraw.js";
import { drawTomorrowPreviewGameSlide } from "./shorts2TomorrowPreviewDraw.js";
import {
  drawShorts4HotPlayerSlide,
  drawShorts4IntroSlide,
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

/** VS 상대팀 투수 스탯 — 같은 브라우저에서 새로고침해도 입력값 유지 (Shorts3Panel `kbo_draft_*`와 동일 방식) */
const VS_STATS_STORAGE_KEY = "kbo_shorts4_vs_stats";
const emptyVsStats = () => ({ era: "", win: "", lose: "", ip: "", pitches: "", k: "", hits: "", hr: "", runs: "" });
function loadVsStatsFromStorage() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(VS_STATS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      focus: { ...emptyVsStats(), ...(p.focus || {}) },
      opp: { ...emptyVsStats(), ...(p.opp || {}) },
      enabled: p.enabled !== false,
    };
  } catch (e) {
    console.warn("[kbo vs stats load]", e);
    return null;
  }
}

/** 쇼츠2 `slideExportKeyShorts2`와 동일 — 영상 프리셋 duration·쇼츠2와 동일 키 체계 */
function slideExportKeyShorts4Capture(slide) {
  if (!slide?.type) return "intro";
  if (slide.type === "intro") return "intro";
  if (slide.type === "preview_game") {
    const p = Math.min(5, Math.max(1, Number(slide.page) || 1));
    return p <= 5 ? "game_preview" : "game_preview_last";
  }
  if (slide.type === "starter") {
    const st = Math.min(3, Math.max(1, Number(slide.step) || 1));
    return st === 1 ? "starter_step1" : st === 2 ? "starter_step2" : "starter_step3";
  }
  if (slide.type === "hot_player") {
    const st = Math.min(3, Math.max(1, Number(slide.step) || 1));
    return st === 1 ? "hot_player_step1" : st === 2 ? "hot_player_step2" : "hot_player_step3";
  }
  if (slide.type === "home_lineup") {
    const st = Math.min(3, Math.max(1, Number(slide.step) || 1));
    return st === 1 ? "home_lineup_step1" : st === 2 ? "home_lineup_step2" : "home_lineup_step3";
  }
  if (slide.type === "away_lineup") {
    const st = Math.min(3, Math.max(1, Number(slide.step) || 1));
    return st === 1 ? "away_lineup_step1" : st === 2 ? "away_lineup_step2" : "away_lineup_step3";
  }
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
  const [showAllGames, setShowAllGames] = useState(false);
  const [focusTeam, setFocusTeam] = useState(null);
  const savedVsStats = useMemo(() => loadVsStatsFromStorage(), []);
  const [focusVsStats, setFocusVsStats] = useState(() => savedVsStats?.focus ?? emptyVsStats());
  const [oppVsStats, setOppVsStats] = useState(() => savedVsStats?.opp ?? emptyVsStats());
  const [vsStatsEnabled, setVsStatsEnabled] = useState(() => savedVsStats?.enabled ?? true);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(
        VS_STATS_STORAGE_KEY,
        JSON.stringify({ focus: focusVsStats, opp: oppVsStats, enabled: vsStatsEnabled })
      );
    } catch (e) {
      console.warn("[kbo vs stats save]", e);
    }
  }, [focusVsStats, oppVsStats, vsStatsEnabled]);

  const resetVsStats = useCallback(() => {
    setFocusVsStats(emptyVsStats());
    setOppVsStats(emptyVsStats());
    try {
      localStorage.removeItem(VS_STATS_STORAGE_KEY);
    } catch (e) {
      console.warn("[kbo vs stats reset]", e);
    }
  }, []);
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

  // 썸네일
  const [useCustomThumb, setUseCustomThumb] = useState(false);
  const [thumbPic, setThumbPic] = useState(null);
  const [thumbOffsetX, setThumbOffsetX] = useState(0);
  const [thumbOffsetY, setThumbOffsetY] = useState(0);
  const [thumbScale, setThumbScale] = useState(1);
  const thumbFileRef = useRef(null);
  const [useCropThumbnail, setUseCropThumbnail] = useState(false);

  const fetchMatchupPreview = useCallback(async (dateStr, focusTeam = null) => {
    const d = String(dateStr || "").trim().slice(0, 10) || seoulToday();
    const body = { action: "matchup_preview", date: d };
    if (focusTeam) body.focusTeam = focusTeam;
    const res = await postKbo(body);
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
        const { games } = await fetchMatchupPreview(date, "삼성");
        if (cancelled) return;
        setTabGames(games);
        setShowAllGames(false);
        const samsungIdx = games.findIndex(
          (g) => g?.home_team?.includes("삼성") || g?.away_team?.includes("삼성")
        );
        setSelectedIdx(samsungIdx >= 0 ? samsungIdx : 0);
        setFocusTeam(
          games[samsungIdx >= 0 ? samsungIdx : 0]?.home_team?.includes("삼성")
            ? games[samsungIdx >= 0 ? samsungIdx : 0]?.home_team
            : games[samsungIdx >= 0 ? samsungIdx : 0]?.away_team ?? null
        );
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
   * 최종 19장:
   * 1 intro · 2~6 preview · 7~9 starter · 10~12 hot_player ·
   * 13~15 home_lineup · 16~18 away_lineup · 19 standings
   */
  const slides = useMemo(() => {
    if (!data || !detailGame) return [];
    const g = detailGame;
    const s = [{ type: "intro" }];
    for (let page = 1; page <= 6; page++) {
      s.push({ type: "preview_game", game: g, page });
    }
    s.push({ type: "starter", game: g, step: 1 });
    s.push({ type: "starter", game: g, step: 3 });
    for (let step = 1; step <= 3; step += 1) {
      s.push({ type: "hot_player", game: g, step });
    }
    for (let step = 1; step <= 3; step += 1) {
      s.push({ type: "home_lineup", game: g, step });
    }
    for (let step = 1; step <= 3; step += 1) {
      s.push({ type: "away_lineup", game: g, step });
    }
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
          teamKeys.add(teamKeyword(detailGame?.home_team));
          teamKeys.add(teamKeyword(detailGame?.away_team));
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
          drawShorts4IntroSlide(
            ctx, w, h, date, logosByTeamKey, detailGame,
            useCustomThumb ? thumbPic : null,
            useCustomThumb ? thumbOffsetX : 0,
            useCustomThumb ? thumbOffsetY : 0,
            useCustomThumb ? thumbScale : 1,
            useCustomThumb,
            focusTeam
          );
          return;
        }

        if (slide.type === "preview_game" && slide.game) {
          drawTomorrowPreviewGameSlide(ctx, w, h, date, slide.game, logosByTeamKey, Number(slide.page) || 1, {
            starterBoxBg: "none",
            short4ExtraStats: true,
            hideHomeAwayRecordLines: true,
            focusTeam,
          });
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
          const starterStep = Math.min(3, Math.max(1, Number(slide.step) || 3));
          drawShorts4StarterSlide(
            ctx,
            w,
            h,
            g0,
            { away: awayFinal, home: homeFinal },
            logosByTeamKey,
            starterStep,
            focusTeam,
            starterStep === 1
              ? { ...focusVsStats, enabled: vsStatsEnabled }
              : { ...oppVsStats, enabled: vsStatsEnabled }
          );
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
          const hotStep = Math.min(3, Math.max(1, Number(slide.step) || 3));
          drawShorts4HotPlayerSlide(
            ctx,
            w,
            h,
            g0,
            { home: homeFinal, away: awayFinal },
            logosByTeamKey,
            hotStep
          );
          return;
        }

        if (slide.type === "home_lineup" && slide.game) {
          const lineupStep = Math.min(3, Math.max(1, Number(slide.step) || 3));
          drawShorts4LineupSlide(ctx, w, h, slide.game, "home", logosByTeamKey, lineupStep);
          return;
        }

        if (slide.type === "away_lineup" && slide.game) {
          const lineupStep = Math.min(3, Math.max(1, Number(slide.step) || 3));
          drawShorts4LineupSlide(ctx, w, h, slide.game, "away", logosByTeamKey, lineupStep);
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
    [slides, standingsRows, date, detailGame, useCustomThumb, thumbPic, thumbOffsetX, thumbOffsetY, thumbScale, focusVsStats, oppVsStats, vsStatsEnabled, focusTeam]
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
      const { res, games } = await fetchMatchupPreview(date, "삼성");
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
  }, [date, fetchMatchupPreview, showAllGames]);

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
      if (useCropThumbnail && useCustomThumb) {
        const el = captureWrapRef.current?.querySelector(".slide-card");
        if (el && out.length > 0) {
          // 메인 캔버스에 이미 합성되어 있으므로 첫 슬라이드 캡처 결과 그대로 사용
          // out[0]은 이미 captureAllSlides 루프에서 slideIdx=0으로 캡처됨
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

  const handleThumbImageUpload = useCallback((e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const img = new window.Image();
    img.onload = () => setThumbPic(img);
    img.src = URL.createObjectURL(file);
  }, []);

  const handleThumbDownload = useCallback(() => {
    const canvas = captureWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `shorts4_thumbnail_${date || "nodate"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [date]);

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
          {(() => {
            const isSamsungGame = (g) =>
              g?.home_team?.includes("삼성") || g?.away_team?.includes("삼성");
            return tabGames.map((g, i) => {
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
                  const g0 = tabGames[i];
                  const isSamsung = g0?.home_team?.includes("삼성");
                  setFocusTeam(isSamsung ? g0?.home_team : g0?.away_team ?? null);
                }}
                disabled={rowBusy || (!showAllGames && !isSamsungGame(g))}
                style={!showAllGames && !isSamsungGame(g) ? { opacity: 0.4 } : {}}
              >
                {label}
              </button>
            );
          });
          })()}
        </div>
      ) : null}
      {!showAllGames && (
        <button
          type="button"
          style={{ marginTop: 8, fontSize: 12, color: "#aaa", background: "none", border: "1px solid #aaa", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}
          onClick={async () => {
            setScheduleBusy(true);
            try {
              const { res, games } = await fetchMatchupPreview(date, "삼성");
              setTabGames(games);
              setData(res);
              setShowAllGames(true);
              setCapturedSlides([]);
              setSlideIdx(0);
              setSelectedIdx((idx) => (games.length && idx >= games.length ? 0 : idx));
            } catch (e) {
              // 실패 시 기존 탭 유지
            } finally {
              setScheduleBusy(false);
            }
          }}
        >
          전체 경기 활성화
        </button>
      )}

      {detailGame && (
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#aaa" }}>기준팀:</span>
          {[detailGame.home_team, detailGame.away_team].filter(Boolean).map((team) => (
            <button
              key={team}
              type="button"
              className={`shorts4-tab${focusTeam === team ? " active" : ""}`}
              style={{ fontSize: 12, padding: "3px 12px" }}
              onClick={() => setFocusTeam(team)}
            >
              {team}
            </button>
          ))}
        </div>
      )}

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
              - 슬라이드7~9: 선발 투수 (1→2→3단계 점진 공개)
              <br />
              - 슬라이드10~12: 핫플레이어 (HERO→홈+HERO→전체)
              <br />
              - 슬라이드13~15: 홈 예상 라인업 (1→2→3단계)
              <br />
              - 슬라이드16~18: 원정 예상 라인업 (1→2→3단계)
              <br />- 슬라이드19: KBO 순위
            </div>

            {/* VS 투수 스탯 입력 */}
            <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>⚔️ VS 상대팀 투수 스탯</span>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={vsStatsEnabled}
                    onChange={(e) => setVsStatsEnabled(e.target.checked)}
                    style={{ flexShrink: 0 }}
                  />
                  표시
                </label>
                <button
                  type="button"
                  onClick={resetVsStats}
                  title="입력한 VS 스탯을 모두 지웁니다 (저장값 포함)"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 4,
                    border: "1px solid #1f2937",
                    background: "#374151",
                    color: "#ffffff",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    marginLeft: "auto",
                  }}
                >
                  초기화
                </button>
              </div>
              {[
                { label: "기준팀", stats: focusVsStats, setStats: setFocusVsStats },
                { label: "상대팀", stats: oppVsStats, setStats: setOppVsStats },
              ].map(({ label, stats, setStats }) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#aaa", marginBottom: 4 }}>{label}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                    {[
                      { key: "era", label: "ERA" },
                      { key: "win", label: "승" },
                      { key: "lose", label: "패" },
                      { key: "ip", label: "이닝" },
                      { key: "pitches", label: "투구수" },
                      { key: "k", label: "탈삼진" },
                      { key: "hits", label: "피안타" },
                      { key: "hr", label: "피홈런" },
                      { key: "runs", label: "실점" },
                    ].map(({ key, label: fieldLabel }) => (
                      <label key={key} style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ color: "#aaa" }}>{fieldLabel}</span>
                        <input
                          type="text"
                          value={stats[key]}
                          onChange={(e) => setStats((p) => ({ ...p, [key]: e.target.value }))}
                          style={{
                            fontSize: 11,
                            padding: "2px 4px",
                            borderRadius: 4,
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: "rgba(255,255,255,0.08)",
                            width: "100%",
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 썸네일 */}
            <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>🖼️ 썸네일</div>

              {/* 기본/생성 토글 */}
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  className={`shorts4-tab${!useCustomThumb ? " active" : ""}`}
                  onClick={() => setUseCustomThumb(false)}
                >
                  기본 썸네일
                </button>
                <button
                  type="button"
                  className={`shorts4-tab${useCustomThumb ? " active" : ""}`}
                  onClick={() => setUseCustomThumb(true)}
                >
                  생성 썸네일
                </button>
              </div>

              {/* 생성 썸네일 설정 */}
              {useCustomThumb && (
                <div style={{ display: "grid", gap: 8 }}>
                  {/* 사진 업로드 */}
                  <input
                    ref={thumbFileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleThumbImageUpload}
                  />
                  <button
                    type="button"
                    className="primary"
                    onClick={() => thumbFileRef.current?.click()}
                  >
                    선수 사진 선택
                  </button>

                  {/* 크롭 슬라이더 */}
                  <div style={{ display: "grid", gap: 4 }}>
                    <label style={{ fontSize: 12 }}>
                      X: <input type="range" min={-600} max={600} value={thumbOffsetX}
                        onChange={(e) => setThumbOffsetX(Number(e.target.value))} />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      Y: <input type="range" min={-960} max={960} value={thumbOffsetY}
                        onChange={(e) => setThumbOffsetY(Number(e.target.value))} />
                    </label>
                    <label style={{ fontSize: 12 }}>
                      크기: <input type="range" min={0.3} max={3} step={0.01} value={thumbScale}
                        onChange={(e) => setThumbScale(Number(e.target.value))} />
                    </label>
                  </div>

                  {/* PNG 다운로드 */}
                  <button
                    type="button"
                    className="primary primary-fill"
                    onClick={handleThumbDownload}
                  >
                    썸네일 PNG 다운로드
                  </button>

                  {/* 첫 슬라이드 교체 체크박스 */}
                  <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={useCropThumbnail}
                      onChange={(e) => setUseCropThumbnail(e.target.checked)}
                    />
                    슬라이드 캡처 시 첫 슬라이드를 이 썸네일로 교체
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
