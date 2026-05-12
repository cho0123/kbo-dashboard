/**
 * 쇼츠4 전용 슬라이드 캔버스 — 내일프리뷰(drawTomorrowPreviewGameSlide)와 유사한 배경·타이포.
 * 쇼츠1/2 draw 함수는 수정하지 않음.
 */
import { drawBaseballBackground } from "./shortsBaseballDecor.js";
import { teamKeyword } from "./shorts1IntroStandingsDraw.js";

function fmtTeamShort(team) {
  const t = String(team || "").trim();
  if (!t) return "—";
  return t.split(/\s+/)[0].slice(0, 6);
}

const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";

const TEAM_GRAD = {
  삼성: ["#4ab0e8", "#4ab0e8"],
  LG: ["#e85c5c", "#e85c5c"],
  KT: ["#728e98", "#728e98"],
  SSG: ["#e87a98", "#e87a98"],
  NC: ["#4a86e8", "#4a86e8"],
  두산: ["#9866e8", "#9866e8"],
  KIA: ["#e8843a", "#e8843a"],
  롯데: ["#4a70e8", "#4a70e8"],
  한화: ["#e8ac48", "#e8ac48"],
  키움: ["#d870a0", "#d870a0"],
};

function teamGrad(teamName) {
  return TEAM_GRAD[teamKeyword(teamName)] || ["#0c0f14", "#131922"];
}

function fmtKoreanLongDate(iso) {
  const s = String(iso || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || "—";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const wk = new Date(s).toLocaleDateString("ko-KR", { weekday: "short" });
  return `${y}년 ${mo}월 ${d}일 (${wk})`;
}

function shadowTextSoft(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;
}

function resetShadow(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/** 팀컬러 사선만 — 선발 슬라이드에서 야구공 레이어와 순서 분리용 */
function diagTeamColorsOnly(ctx, w, h, primaryTeam, secondaryTeam) {
  const [p] = teamGrad(primaryTeam);
  const [s] = teamGrad(secondaryTeam);
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);
  const splitY = h * 0.5;
  const tilt = h * 0.1;
  const yL = splitY - tilt;
  const yR = splitY + tilt;
  ctx.beginPath();
  ctx.moveTo(0, yL);
  ctx.lineTo(w, yR);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = s;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, yL);
  ctx.lineTo(w, yR);
  ctx.stroke();
}

function diagTeamGradient(ctx, w, h, primaryTeam, secondaryTeam) {
  const [p] = teamGrad(primaryTeam);
  const [s] = teamGrad(secondaryTeam);
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);
  const splitY = h * 0.5;
  const tilt = h * 0.1;
  const yL = splitY - tilt;
  const yR = splitY + tilt;
  ctx.beginPath();
  ctx.moveTo(0, yL);
  ctx.lineTo(w, yR);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = s;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, yL);
  ctx.lineTo(w, yR);
  ctx.stroke();
}

/**
 * 야구 이닝 아웃카운트 표기 (예: 6 → "6", 6⅓ → "6.1", 6⅔ → "6.2").
 * @param {unknown} ip 숫자(6.333… 등) 또는 문자열 "6.1", "6 1/3" 등
 * @returns {string}
 */
function formatInnings(ip) {
  if (ip == null) return "—";
  const sRaw = String(ip).trim();
  if (!sRaw) return "—";

  if (typeof ip === "string") {
    const compact = sRaw.replace(/\s+/g, "");
    const m12 = compact.match(/^(\d+)\.([12])$/);
    if (m12) return `${Number(m12[1])}.${m12[2]}`;
    const m13 = sRaw.match(/^(\d+)\s+(\d)\/3$/);
    if (m13) {
      const f = Number(m13[1]);
      const t = Number(m13[2]);
      if (t === 1) return `${f}.1`;
      if (t === 2) return `${f}.2`;
      if (t === 0) return `${f}`;
    }
    if (/^\d+$/.test(compact)) return compact;
  }

  const n = Number(ip);
  if (!Number.isFinite(n) || n < 0) return "—";
  const full = Math.floor(n + 1e-9);
  const frac = n - full;
  if (frac < 1e-6) return `${full}`;
  if (Math.abs(frac - 0.1) < 1e-5) return `${full}.1`;
  if (Math.abs(frac - 0.2) < 1e-5) return `${full}.2`;
  const outs = Math.round(frac * 3);
  const o = ((outs % 3) + 3) % 3;
  if (o === 0) return `${full}`;
  return `${full}.${o}`;
}

function shorts4MatchupBackground(ctx, w, h, homeTeam, awayTeam) {
  ctx.clearRect(0, 0, w, h);
  diagTeamGradient(ctx, w, h, homeTeam, awayTeam);
}

function drawLogoInBox(ctx, x, y, boxW, boxH, teamName, img, drawTeamBadgeFn) {
  if (!img) {
    const r = Math.min(boxW, boxH) / 2;
    drawTeamBadgeFn(ctx, x + boxW / 2, y + boxH / 2, r, teamName);
    return;
  }
  const iw = Number(img.width) || boxW;
  const ih = Number(img.height) || boxH;
  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
}

function fmtEra(v) {
  const n = Number(v);
  if (Number.isFinite(n)) return n.toFixed(2);
  const s = String(v ?? "").trim();
  return s || "—";
}

function fmtRankBlock(rankObj) {
  if (!rankObj || typeof rankObj !== "object") return "순위 —";
  const r = Number(rankObj.rank);
  if (Number.isFinite(r) && r > 0) return `${r}위`;
  return "순위 —";
}

function fmtRecord(rec) {
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

function fmtLast5(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.join(" ");
}

const TEXT_MAIN = "#ffffff";

function teamBadgeLabel(teamName) {
  const kw = teamKeyword(teamName);
  const allowed = new Set(["NC", "KIA", "LG", "삼성", "KT", "SSG", "두산", "롯데", "한화", "키움"]);
  if (allowed.has(kw)) return kw;
  return fmtTeamShort(teamName);
}

function drawTeamBadge(ctx, cx, cy, r, teamName) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  const [c1] = teamGrad(teamName);
  ctx.fillStyle = c1 || "#00d4aa";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.fillStyle = TEXT_MAIN;
  ctx.font = `900 52px "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  const t = teamBadgeLabel(teamName);
  const tw = ctx.measureText(t).width;
  ctx.fillText(t, cx - tw / 2, cy + 14);
  resetShadow(ctx);
  ctx.restore();
}

const SAFE_TOP = 200;

/**
 * 매치업 요약 슬라이드 (쇼츠4에서 미사용 시에도 API/테스트용으로 유지)
 */
export function drawShorts4MatchupSlide(ctx, w, h, dateIso, g, logosByTeamKey) {
  const homeTeam = String(g?.home_team || "홈");
  const awayTeam = String(g?.away_team || "원정");
  shorts4MatchupBackground(ctx, w, h, homeTeam, awayTeam);

  const hk = teamKeyword(homeTeam);
  const ak = teamKeyword(awayTeam);
  const homeImg = logosByTeamKey?.[hk] || null;
  const awayImg = logosByTeamKey?.[ak] || null;

  const metaDate = fmtKoreanLongDate(g?.game_date || dateIso);
  const metaTime = String(g?.game_time || "").trim() || "—";
  const venue = String(g?.venue || "—").trim() || "—";

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 72px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(metaDate, 64, SAFE_TOP + 72);
  resetShadow(ctx);
  ctx.font = `500 46px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  shadowTextSoft(ctx);
  ctx.fillText(`${metaTime}  ·  ${venue}`, 64, SAFE_TOP + 138);
  resetShadow(ctx);

  const logoY = SAFE_TOP + 200;
  const logoBoxW = 280;
  const logoBoxH = 200;
  drawLogoInBox(ctx, 120, logoY, logoBoxW, logoBoxH, homeTeam, homeImg, drawTeamBadge);
  drawLogoInBox(ctx, w - 120 - logoBoxW, logoY, logoBoxW, logoBoxH, awayTeam, awayImg, drawTeamBadge);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `1000 120px "${FONT_TITLE}", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillStyle = "#F9FF00";
  shadowTextSoft(ctx);
  ctx.fillText("VS", w / 2, logoY + logoBoxH / 2 + 10);
  resetShadow(ctx);

  ctx.textAlign = "center";
  ctx.font = `800 52px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillStyle = "#FFFFFF";
  const nameY = logoY + logoBoxH + 56;
  ctx.fillText(homeTeam, w * 0.28, nameY);
  ctx.fillText(awayTeam, w * 0.72, nameY);

  const blockY = nameY + 100;
  const lineH = 62;
  ctx.textAlign = "center";
  ctx.font = `700 44px "${FONT_BODY}", system-ui, sans-serif`;
  const homeLines = [
    fmtRankBlock(g?.home_rank),
    `전적 ${fmtRecord(g?.home_record)}`,
    `최근5  ${fmtLast5(g?.home_last5)}`,
  ];
  const awayLines = [
    fmtRankBlock(g?.away_rank),
    `전적 ${fmtRecord(g?.away_record)}`,
    `최근5  ${fmtLast5(g?.away_last5)}`,
  ];
  for (let i = 0; i < 3; i++) {
    ctx.textAlign = "center";
    ctx.fillStyle = i === 0 ? "#FFD700" : "#FFFFFF";
    ctx.fillText(homeLines[i], w * 0.28, blockY + i * lineH);
    ctx.fillText(awayLines[i], w * 0.72, blockY + i * lineH);
  }
}

const STARTER_FACE_BOX = Math.round(530 * 0.7);
const PORTRAIT_TEAM_BORDER_LW = 5;
const PORTRAIT_WHITE_BORDER_LW = 8;

function starterTeamStrokeColor(teamName) {
  const [c] = teamGrad(teamName);
  return c || "#ffffff";
}

/**
 * 원형 클립 사진 + 안쪽 팀컬러 링 + 바깥 흰색 링 (대비 확보)
 * @param {number} diameter 사진(클립) 직경(px)
 */
function drawStarterPortraitFramed(ctx, img, cx, cy, diameter, teamName) {
  if (!img || !img.complete || !(Number(img.naturalWidth) > 0)) return;
  const rPhoto = diameter / 2;
  const boxTop = cy - rPhoto;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rPhoto, 0, Math.PI * 2);
  ctx.clip();
  drawPortraitContain(ctx, img, cx, boxTop, diameter, diameter);
  ctx.restore();

  const rTeamMid = rPhoto + PORTRAIT_TEAM_BORDER_LW / 2;
  const rWhiteMid = rPhoto + PORTRAIT_TEAM_BORDER_LW + PORTRAIT_WHITE_BORDER_LW / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rTeamMid, 0, Math.PI * 2);
  ctx.strokeStyle = starterTeamStrokeColor(teamName);
  ctx.lineWidth = PORTRAIT_TEAM_BORDER_LW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rWhiteMid, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = PORTRAIT_WHITE_BORDER_LW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawPortraitContain(ctx, img, cx, boxTop, boxW, boxH) {
  if (!img || !img.complete || !(Number(img.naturalWidth) > 0)) return;
  const iw = Number(img.naturalWidth) || boxW;
  const ih = Number(img.naturalHeight) || boxH;
  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const x = cx - dw / 2;
  const y = boxTop + (boxH - dh) / 2;
  ctx.drawImage(img, x, y, dw, dh);
}

/**
 * @param {{ away?: HTMLImageElement | null, home?: HTMLImageElement | null } | null | undefined} portraits
 * @param {Record<string, HTMLImageElement | null | undefined> | null | undefined} logosByTeamKey 미사용(호환용)
 */
export function drawShorts4StarterSlide(ctx, w, h, g, portraits = null, logosByTeamKey = null) {
  void logosByTeamKey;
  const homeTeam = String(g?.home_team || "홈");
  const awayTeam = String(g?.away_team || "원정");
  ctx.clearRect(0, 0, w, h);
  diagTeamColorsOnly(ctx, w, h, awayTeam, homeTeam);
  drawBaseballBackground(ctx);

  const frameOuter = PORTRAIT_TEAM_BORDER_LW + PORTRAIT_WHITE_BORDER_LW;

  const awayFaceCx = w * 0.65 + 100;
  const homeFaceCx = w * 0.35 - 100;
  const awayFaceTop = 56;
  const homeFaceTop = h / 2 + 156;
  const awayCy = awayFaceTop + STARTER_FACE_BOX / 2 + 100;
  const homeCy = homeFaceTop + STARTER_FACE_BOX / 2 - 100;

  const hs = String(g?.home_starter || "미정").trim() || "미정";
  const as = String(g?.away_starter || "미정").trim() || "미정";
  const hip = g?.home_starter_ip;
  const hso = g?.home_starter_so;
  const aip = g?.away_starter_ip;
  const aso = g?.away_starter_so;
  const hipInn = formatInnings(hip);
  const aipInn = formatInnings(aip);
  const hipLabel = hipInn === "—" ? "—" : `${hipInn}이닝`;
  const aipLabel = aipInn === "—" ? "—" : `${aipInn}이닝`;
  const hsoStr = Number.isFinite(Number(hso)) ? String(hso) : "—";
  const asoStr = Number.isFinite(Number(aso)) ? String(aso) : "—";
  const homeStats = `ERA ${fmtEra(g?.home_starter_era)}  ·  이닝 ${hipLabel}  ·  삼진 ${hsoStr}`;
  const awayStats = `ERA ${fmtEra(g?.away_starter_era)}  ·  이닝 ${aipLabel}  ·  삼진 ${asoStr}`;

  const vsSizePx = 180;
  const nameSizePx = 86;
  const statSizePx = 72;

  const awayImg = portraits?.away && portraits.away.complete && portraits.away.naturalWidth ? portraits.away : null;
  const homeImg = portraits?.home && portraits.home.complete && portraits.home.naturalWidth ? portraits.home : null;
  const awayUsePhoto = Boolean(awayImg) && as !== "미정";
  const homeUsePhoto = Boolean(homeImg) && hs !== "미정";

  if (awayUsePhoto) {
    drawStarterPortraitFramed(ctx, awayImg, awayFaceCx, awayCy, STARTER_FACE_BOX, awayTeam);
  }
  if (homeUsePhoto) {
    drawStarterPortraitFramed(ctx, homeImg, homeFaceCx, homeCy, STARTER_FACE_BOX, homeTeam);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";

  const rPhoto = STARTER_FACE_BOX / 2;

  if (awayUsePhoto) {
    const awayNameY = awayCy + rPhoto + frameOuter + 22;
    const awayStatY = awayNameY + 50;
    ctx.font = `700 ${nameSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(as, w / 2, awayNameY);
    resetShadow(ctx);
    ctx.font = `800 ${statSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(awayStats, w / 2, awayStatY);
    resetShadow(ctx);
  } else {
    const awayNameY = awayFaceTop + STARTER_FACE_BOX + frameOuter + 28;
    const awayStatY = awayNameY + 52;
    ctx.font = `700 ${nameSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(as, w / 2, awayNameY);
    resetShadow(ctx);
    ctx.font = `800 ${statSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(awayStats, w / 2, awayStatY);
    resetShadow(ctx);
  }

  if (homeUsePhoto) {
    const homeNameY = homeCy + rPhoto + frameOuter + 22;
    const homeStatY = homeNameY + 50;
    ctx.font = `700 ${nameSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(hs, w / 2, homeNameY);
    resetShadow(ctx);
    ctx.font = `800 ${statSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(homeStats, w / 2, homeStatY);
    resetShadow(ctx);
  } else {
    const homeNameY = homeFaceTop + STARTER_FACE_BOX + frameOuter + 28;
    const homeStatY = homeNameY + 52;
    ctx.font = `700 ${nameSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(hs, w / 2, homeNameY);
    resetShadow(ctx);
    ctx.font = `800 ${statSizePx}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(homeStats, w / 2, homeStatY);
    resetShadow(ctx);
  }

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.font = `1000 ${vsSizePx}px "${FONT_TITLE}", system-ui, sans-serif`;
  ctx.fillStyle = "#FFD700";
  shadowTextSoft(ctx);
  ctx.fillText("VS", w / 2, h / 2);
  resetShadow(ctx);
  ctx.restore();
}

function sortLineupRows(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
}

/**
 * 예상 라인업 테이블 (타순·포지션·선수명)
 * @param {"home"|"away"} side
 */
export function drawShorts4LineupSlide(ctx, w, h, g, side) {
  const isHome = side === "home";
  const homeTeam = String(g?.home_team || "홈");
  const awayTeam = String(g?.away_team || "원정");
  const teamName = isHome ? homeTeam : awayTeam;
  const rowsRaw = isHome ? g?.home_lineup : g?.away_lineup;
  const opp = isHome ? awayTeam : homeTeam;

  shorts4MatchupBackground(ctx, w, h, teamName, opp);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 64px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(`${teamName} 예상 라인업`, w / 2, SAFE_TOP + 88);
  resetShadow(ctx);

  const rows = sortLineupRows(rowsRaw).slice(0, 9);
  const tableTop = SAFE_TOP + 160;
  const rowH = 118;
  const colX = [88, 200, 320];

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.font = `700 38px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("타순", colX[0], tableTop);
  ctx.fillText("포지션", colX[1], tableTop);
  ctx.fillText("선수", colX[2], tableTop);
  ctx.beginPath();
  ctx.moveTo(64, tableTop + 12);
  ctx.lineTo(w - 64, tableTop + 12);
  ctx.stroke();

  for (let i = 0; i < 9; i++) {
    const y = tableTop + 56 + i * rowH;
    const r = rows[i] || { order: i + 1, pos: "—", player: "—" };
    const ord = Number.isFinite(Number(r.order)) && Number(r.order) > 0 ? String(r.order) : String(i + 1);
    ctx.fillStyle = i % 2 === 0 ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.roundRect(64, y - 42, w - 128, rowH - 10, 12);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `800 44px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillText(ord, colX[0], y);
    ctx.font = `600 40px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillStyle = "#F9FF00";
    ctx.fillText(String(r.pos || "—").slice(0, 4), colX[1], y);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 40px "${FONT_BODY}", system-ui, sans-serif`;
    const pname = String(r.player || "—").slice(0, 18);
    ctx.fillText(pname, colX[2], y);
  }
}
