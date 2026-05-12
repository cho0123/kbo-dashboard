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
/** drawTomorrowPreviewGameSlide 하단 텍스트와 동일: 800 46px Noto Sans KR */
const STARTER_DETAIL_FONT_PX = 46;
const STARTER_DETAIL_LINE_GAP = 54;
/** 선발 슬라이드 헤더(구분선 위): 상세 텍스트보다 +3px */
const STARTER_HEADER_FONT_PX = STARTER_DETAIL_FONT_PX + 3;
const LOGO_HEADER_BOX = 60;

function starterSeasonYearFromGame(g) {
  const sy = Number(g?.season_year);
  return Number.isFinite(sy) && sy > 0 ? sy : 2026;
}

function drawShorts4StarterHeaderDivider(ctx, w, pad, dividerY) {
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, dividerY);
  ctx.lineTo(w - pad, dividerY);
  ctx.stroke();
  ctx.restore();
}

/** 구분선 위 헤더: 좌측 로고 + 한 줄 텍스트, 세로 중앙 정렬 */
function drawShorts4StarterHeaderRow(ctx, centerY, padL, teamName, playerName, seasonYear, logoImg) {
  const box = LOGO_HEADER_BOX;
  const logoLeft = padL;
  const logoTop = centerY - box / 2;
  drawLogoInBox(ctx, logoLeft, logoTop, box, box, teamName, logoImg, drawTeamBadge);
  const tn = String(teamName || "—").trim() || "—";
  const pn = String(playerName || "—").trim() || "—";
  const line = `${tn} ${pn} · ${seasonYear} 시즌`;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${STARTER_HEADER_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  const textX = padL + box + 16;
  shadowTextSoft(ctx);
  ctx.fillText(line, textX, centerY);
  resetShadow(ctx);
  ctx.restore();
}

function starterWlLineFromGame(g, side) {
  const pref = side === "away" ? "away" : "home";
  const has = g?.[`${pref}_starter_season_has_result`] === true;
  const w = Number(g?.[`${pref}_starter_season_wins`]);
  const l = Number(g?.[`${pref}_starter_season_losses`]);
  if (has) {
    const ws = Number.isFinite(w) ? w : 0;
    const ls = Number.isFinite(l) ? l : 0;
    return `${ws}승 ${ls}패`;
  }
  return "-승 -패";
}

function starterWhipLineFromGame(g, side) {
  const whip = side === "away" ? g?.away_starter_whip : g?.home_starter_whip;
  if (whip == null || !Number.isFinite(Number(whip))) return "WHIP -";
  return `WHIP ${Number(whip).toFixed(2)}`;
}

/** 원정 선발 승패 (상단 스탯 블록용, 미집계 시 "- 승 - 패") */
function awayStarterWlDisplay(g) {
  const has = g?.away_starter_season_has_result === true;
  const wv = Number(g?.away_starter_season_wins);
  const lv = Number(g?.away_starter_season_losses);
  if (has) {
    const ws = Number.isFinite(wv) ? wv : 0;
    const ls = Number.isFinite(lv) ? lv : 0;
    return `${ws}승 ${ls}패`;
  }
  return "- 승 - 패";
}

function awayStarterWhipLabel(g) {
  const whip = g?.away_starter_whip;
  if (whip == null || !Number.isFinite(Number(whip))) return "WHIP : -";
  return `WHIP : ${Number(whip).toFixed(2)}`;
}

/**
 * 원정팀(상단 절반): 헤더(로고+한줄)·구분선, 사진 중심 x=w*0.25, 스탯은 사진 오른쪽 좌측 정렬
 */
function drawAwayStarterUpperLayout(ctx, w, g, awayTeam, as, awayImg, awayUsePhoto, logosByTeamKey) {
  const rPhoto = STARTER_FACE_BOX / 2;
  const awayPhotoCx = w * 0.25;
  const padL = 48;

  const headerContentTop = 28;
  const dividerY = 154;
  const headerCenterY = (headerContentTop + dividerY) / 2;
  const ak = teamKeyword(awayTeam);
  const awayLogoImg = logosByTeamKey?.[ak] ?? null;
  drawShorts4StarterHeaderRow(
    ctx,
    headerCenterY,
    padL,
    awayTeam,
    as,
    starterSeasonYearFromGame(g),
    awayLogoImg
  );
  drawShorts4StarterHeaderDivider(ctx, w, padL, dividerY);

  const awayCy = dividerY + rPhoto + 56;
  const awayBoxTop = awayCy - rPhoto;

  if (awayUsePhoto && awayImg) {
    drawPortraitContain(ctx, awayImg, awayPhotoCx, awayBoxTop, STARTER_FACE_BOX, STARTER_FACE_BOX);
  }

  const sy = Number(g?.season_year);
  const seasonLine = `${Number.isFinite(sy) && sy > 0 ? sy : 2026} 시즌`;
  const era = g?.away_starter_era;
  const statLines = [
    seasonLine,
    awayStarterWlDisplay(g),
    `평균자책점(ERA) : ${fmtEra(era)}`,
    awayStarterWhipLabel(g),
  ];
  const statX = awayPhotoCx + rPhoto + 28;
  const totalStatH = (statLines.length - 1) * STARTER_DETAIL_LINE_GAP;
  let statY = awayCy - totalStatH / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${STARTER_DETAIL_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  for (const line of statLines) {
    shadowTextSoft(ctx);
    ctx.fillText(line, statX, statY);
    resetShadow(ctx);
    statY += STARTER_DETAIL_LINE_GAP;
  }
}

/** 사진 하단 기준 중앙 정렬, 6줄 동일 폰트·흰색 (내일프리뷰 하단과 동일 46px) */
function drawStarterPortraitStatStack(ctx, cx, cy, rPhoto, g, side, teamFull, playerName) {
  const sy = Number(g?.season_year);
  const seasonLine = `${Number.isFinite(sy) && sy > 0 ? sy : 2026} 시즌`;
  const era = side === "away" ? g?.away_starter_era : g?.home_starter_era;
  const lines = [
    String(teamFull || "—").trim() || "—",
    String(playerName || "—").trim() || "—",
    seasonLine,
    starterWlLineFromGame(g, side),
    `평균자책점 ${fmtEra(era)}`,
    starterWhipLineFromGame(g, side),
  ];
  let y = cy + rPhoto + 28;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${STARTER_DETAIL_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  for (const line of lines) {
    shadowTextSoft(ctx);
    ctx.fillText(line, cx, y);
    resetShadow(ctx);
    y += STARTER_DETAIL_LINE_GAP;
  }
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
 * 홈(하단): 흰 구분선 위 로고+한 줄 헤더. dividerY는 원래 얼굴 박스 상단(h/2+156)과 맞춤.
 * @returns {number} homeDividerY
 */
function drawHomeStarterLowerHeader(ctx, w, h, g, homeTeam, hs, logosByTeamKey) {
  const padL = 48;
  const mid = h * 0.5;
  const headerContentTop = mid + 92;
  const dividerY = mid + 156;
  const headerCenterY = (headerContentTop + dividerY) / 2;
  const hk = teamKeyword(homeTeam);
  const homeLogoImg = logosByTeamKey?.[hk] ?? null;
  drawShorts4StarterHeaderRow(
    ctx,
    headerCenterY,
    padL,
    homeTeam,
    hs,
    starterSeasonYearFromGame(g),
    homeLogoImg
  );
  drawShorts4StarterHeaderDivider(ctx, w, padL, dividerY);
  return dividerY;
}

/**
 * @param {{ away?: HTMLImageElement | null, home?: HTMLImageElement | null } | null | undefined} portraits
 * @param {Record<string, HTMLImageElement | null | undefined> | null | undefined} logosByTeamKey 팀 로고(헤더)
 */
export function drawShorts4StarterSlide(ctx, w, h, g, portraits = null, logosByTeamKey = null) {
  const homeTeam = String(g?.home_team || "홈");
  const awayTeam = String(g?.away_team || "원정");
  ctx.clearRect(0, 0, w, h);
  diagTeamColorsOnly(ctx, w, h, awayTeam, homeTeam);
  drawBaseballBackground(ctx);

  const rPhoto = STARTER_FACE_BOX / 2;

  const homeFaceCx = w * 0.35 - 100;

  const hs = String(g?.home_starter || "미정").trim() || "미정";
  const as = String(g?.away_starter || "미정").trim() || "미정";

  const vsSizePx = 180;

  const awayImg = portraits?.away && portraits.away.complete && portraits.away.naturalWidth ? portraits.away : null;
  const homeImg = portraits?.home && portraits.home.complete && portraits.home.naturalWidth ? portraits.home : null;
  const awayUsePhoto = Boolean(awayImg) && as !== "미정";
  const homeUsePhoto = Boolean(homeImg) && hs !== "미정";

  drawAwayStarterUpperLayout(ctx, w, g, awayTeam, as, awayImg, awayUsePhoto, logosByTeamKey || {});

  const homeDividerY = drawHomeStarterLowerHeader(ctx, w, h, g, homeTeam, hs, logosByTeamKey || {});
  const homeCy = homeDividerY + rPhoto + 56;
  const homeFaceTop = homeCy - rPhoto;

  if (homeUsePhoto) {
    drawPortraitContain(ctx, homeImg, homeFaceCx, homeFaceTop, STARTER_FACE_BOX, STARTER_FACE_BOX);
  }

  drawStarterPortraitStatStack(ctx, homeFaceCx, homeCy, rPhoto, g, "home", homeTeam, hs);

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
