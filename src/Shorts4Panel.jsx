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

/** 쇼츠2 `slideExportKeyShorts2`와 동일 — 영상 프리셋 duration·쇼츠2와 동일 키 체계 */
function slideExportKeyShorts4Capture(slide) {
  if (!slide?.type) return "intro";
  if (slide.type === "intro") return "intro";
  if (slide.type === "preview_game") {
    const p = Math.min(5, Math.max(1, Number(slide.page) || 1));
    return p <= 4 ? "game_preview" : "game_preview_last";
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

  // 썸네일 크롭
  const [thumbHomePic, setThumbHomePic] = useState(null);
  const [thumbAwayPic, setThumbAwayPic] = useState(null);
  const [thumbHomeOffsetX, setThumbHomeOffsetX] = useState(0);
  const [thumbHomeOffsetY, setThumbHomeOffsetY] = useState(0);
  const [thumbHomeScale, setThumbHomeScale] = useState(1);
  const [thumbAwayOffsetX, setThumbAwayOffsetX] = useState(0);
  const [thumbAwayOffsetY, setThumbAwayOffsetY] = useState(0);
  const [thumbAwayScale, setThumbAwayScale] = useState(1);
  const thumbCanvasRef = useRef(null);
  const thumbHomeFileRef = useRef(null);
  const thumbAwayFileRef = useRef(null);
  const [useCropThumbnail, setUseCropThumbnail] = useState(false);

  const fetchMatchupPreview = useCallback(async (dateStr, team, tabOnly = false) => {
    const d = String(dateStr || "").trim().slice(0, 10) || seoulToday();
    const body = { action: "matchup_preview", date: d };
    if (team) body.team = team;
    if (tabOnly) body.tabOnly = true;
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
        const { games } = await fetchMatchupPreview(date, null, true);
        if (cancelled) return;
        setTabGames(games);
        setShowAllGames(false);
        const samsungIdx = games.findIndex(
          (g) => g?.home_team?.includes("삼성") || g?.away_team?.includes("삼성")
        );
        setSelectedIdx(samsungIdx >= 0 ? samsungIdx : 0);
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
    for (let page = 1; page <= 5; page++) {
      s.push({ type: "preview_game", game: g, page });
    }
    for (let step = 1; step <= 3; step += 1) {
      s.push({ type: "starter", game: g, step });
    }
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
          drawShorts4IntroSlide(ctx, w, h, date, logosByTeamKey, detailGame);
          return;
        }

        if (slide.type === "preview_game" && slide.game) {
          drawTomorrowPreviewGameSlide(ctx, w, h, date, slide.game, logosByTeamKey, Number(slide.page) || 1, {
            starterBoxBg: "rgba(0,0,0,0.5)",
            short4ExtraStats: true,
            hideHomeAwayRecordLines: true,
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
            starterStep
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
      const { res, games } = await fetchMatchupPreview(date, showAllGames ? undefined : "삼성");
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
      if (useCropThumbnail && thumbCanvasRef.current) {
        const thumbBlob = await new Promise((resolve) =>
          thumbCanvasRef.current.toBlob(resolve, "image/png")
        );
        if (thumbBlob && out.length > 0) out[0] = { ...out[0], blob: thumbBlob };
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

  const handleThumbImageUpload = useCallback((side, e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const img = new window.Image();
    img.onload = () => {
      if (side === "home") setThumbHomePic(img);
      else setThumbAwayPic(img);
    };
    img.src = URL.createObjectURL(file);
  }, []);

  const drawThumbPreview = useCallback(() => {
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;
    const W = 1080, H = 1920;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // 홈(삼성) 사진 — 좌상 (/ 대각선 위쪽)
    if (thumbHomePic) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(W, 0);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.clip();
      const s = thumbHomeScale;
      const iw = thumbHomePic.naturalWidth * s;
      const ih = thumbHomePic.naturalHeight * s;
      ctx.drawImage(thumbHomePic, W / 2 - iw / 2 + thumbHomeOffsetX, H / 2 - ih / 2 + thumbHomeOffsetY, iw, ih);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = "#1a1a2e";
      ctx.fill();
      ctx.restore();
    }

    // 어웨이(상대) 사진 — 우하 (/ 대각선 아래쪽)
    if (thumbAwayPic) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W, 0);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.clip();
      const s = thumbAwayScale;
      const iw = thumbAwayPic.naturalWidth * s;
      const ih = thumbAwayPic.naturalHeight * s;
      ctx.drawImage(thumbAwayPic, W / 2 - iw / 2 + thumbAwayOffsetX, H / 2 - ih / 2 + thumbAwayOffsetY, iw, ih);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fillStyle = "#2d1b00";
      ctx.fill();
      ctx.restore();
    }

    // 대각선 구분선
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(W, 0);
    ctx.lineTo(0, H);
    ctx.stroke();
    ctx.restore();

    // 텍스트 오버레이
    const homeTeam = detailGame?.home_team || "";
    const awayTeam = detailGame?.away_team || "";
    const homeStarter = detailGame?.home_starter || "";
    const awayStarter = detailGame?.away_starter || "";
    const gameDate = date || "";

    ctx.save();
    ctx.font = "bold 64px 'BlackHanSans', sans-serif";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 12;
    ctx.textAlign = "left";
    ctx.fillText(homeTeam, 60, 120);
    ctx.font = "bold 44px 'BlackHanSans', sans-serif";
    ctx.fillText(homeStarter, 60, 190);
    ctx.textAlign = "right";
    ctx.font = "bold 64px 'BlackHanSans', sans-serif";
    ctx.fillText(awayTeam, W - 60, H - 100);
    ctx.font = "bold 44px 'BlackHanSans', sans-serif";
    ctx.fillText(awayStarter, W - 60, H - 40);
    ctx.textAlign = "center";
    ctx.font = "bold 36px 'BlackHanSans', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(gameDate, W / 2, H / 2);
    ctx.restore();
  }, [thumbHomePic, thumbAwayPic, thumbHomeOffsetX, thumbHomeOffsetY, thumbHomeScale,
      thumbAwayOffsetX, thumbAwayOffsetY, thumbAwayScale, detailGame, date]);

  const handleThumbDownload = useCallback(() => {
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `shorts4_thumbnail_${date || "nodate"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [date]);

  useEffect(() => {
    drawThumbPreview();
  }, [drawThumbPreview]);

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

      <details className="shorts4-player-photo-mgmt" style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>🖼️ 썸네일 크롭 도구 (9:16)</summary>
        <div style={{ marginTop: 10, display: "grid", gap: 10, padding: "10px 0", borderTop: "1px solid rgba(0,0,0,0.08)" }}>

          {/* 캔버스 미리보기 */}
          <canvas
            ref={thumbCanvasRef}
            style={{ width: "100%", maxWidth: 270, aspectRatio: "9/16", border: "1px solid #ccc", borderRadius: 6, background: "#111" }}
          />

          {/* 홈(삼성) 투수 */}
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>
            ▲ 홈(삼성) 투수 — {detailGame?.home_starter || "미정"}
          </div>
          <input ref={thumbHomeFileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => handleThumbImageUpload("home", e)} />
          <button type="button" className="primary"
            onClick={() => thumbHomeFileRef.current?.click()}>
            홈 투수 사진 선택
          </button>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: 12 }}>X: <input type="range" min={-600} max={600} value={thumbHomeOffsetX}
              onChange={(e) => setThumbHomeOffsetX(Number(e.target.value))} /></label>
            <label style={{ fontSize: 12 }}>Y: <input type="range" min={-960} max={960} value={thumbHomeOffsetY}
              onChange={(e) => setThumbHomeOffsetY(Number(e.target.value))} /></label>
            <label style={{ fontSize: 12 }}>크기: <input type="range" min={0.3} max={3} step={0.01} value={thumbHomeScale}
              onChange={(e) => setThumbHomeScale(Number(e.target.value))} /></label>
          </div>

          {/* 어웨이(상대) 투수 */}
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>
            ▼ 어웨이(상대) 투수 — {detailGame?.away_starter || "미정"}
          </div>
          <input ref={thumbAwayFileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => handleThumbImageUpload("away", e)} />
          <button type="button" className="primary"
            onClick={() => thumbAwayFileRef.current?.click()}>
            어웨이 투수 사진 선택
          </button>
          <div style={{ display: "grid", gap: 4 }}>
            <label style={{ fontSize: 12 }}>X: <input type="range" min={-600} max={600} value={thumbAwayOffsetX}
              onChange={(e) => setThumbAwayOffsetX(Number(e.target.value))} /></label>
            <label style={{ fontSize: 12 }}>Y: <input type="range" min={-960} max={960} value={thumbAwayOffsetY}
              onChange={(e) => setThumbAwayOffsetY(Number(e.target.value))} /></label>
            <label style={{ fontSize: 12 }}>크기: <input type="range" min={0.3} max={3} step={0.01} value={thumbAwayScale}
              onChange={(e) => setThumbAwayScale(Number(e.target.value))} /></label>
          </div>

          {/* 다운로드 + 첫 슬라이드 교체 */}
          <button type="button" className="primary primary-fill" style={{ marginTop: 6 }}
            onClick={handleThumbDownload}>
            썸네일 PNG 다운로드
          </button>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={useCropThumbnail}
              onChange={(e) => setUseCropThumbnail(e.target.checked)} />
            슬라이드 캡처 시 첫 슬라이드를 이 썸네일로 교체
          </label>

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
              const { res, games } = await fetchMatchupPreview(date);
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
