/**
 * 쇼츠5 — 팀별 주간결산 슬라이드 (쇼츠1~4 미수정)
 */
import { drawBaseballBackground } from "./shortsBaseballDecor.js";
import { loadSvgLogo, teamKeyword } from "./shorts1IntroStandingsDraw.js";
import {
  drawableShorts4Portrait,
  loadDefaultPlayerImage,
  loadPlayerImage,
  loadPlayerImageFromNaverProxy,
} from "./shorts4PlayerImage.js";

const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";
const SAFE_TOP = 200;

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

const TEAM_STRONG_COLOR = {
  삼성: "#0055A4",
  LG: "#C0001C",
  KT: "#2B2B2B",
  SSG: "#CE0E2D",
  NC: "#071D49",
  두산: "#131230",
  KIA: "#EA0029",
  롯데: "#002B7F",
  한화: "#FF6600",
  키움: "#820024",
};

const TEAM_DARK_COLOR = {
  삼성: "#002D5C",
  LG: "#6B000E",
  KT: "#111111",
  SSG: "#7A0819",
  NC: "#030E25",
  두산: "#080818",
  KIA: "#7A0015",
  롯데: "#001540",
  한화: "#8B3300",
  키움: "#3D0011",
};

function getTeamStrongColor(teamName) {
  const kw = teamKeyword(teamName);
  return (kw && TEAM_STRONG_COLOR[kw]) || "#131922";
}

function getTeamDarkColor(teamName) {
  const kw = teamKeyword(teamName);
  return (kw && TEAM_DARK_COLOR[kw]) || "#0c0f14";
}

function fmtTeamShort(team) {
  const t = String(team || "").trim();
  if (!t) return "—";
  return t.split(/\s+/)[0].slice(0, 6);
}

function shadowText(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
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

function resultLabelAndColor(result) {
  if (result === "win") return { label: "승", color: "#4ade80" };
  if (result === "loss") return { label: "패", color: "#f87171" };
  return { label: "무", color: "#94a3b8" };
}

/** 순위 셀: N위(흰색) + 변동(▲/▼/-, 색상 분리) */
function parsePerGameRankParts(prevRank, rankAfter) {
  const cur = rankAfter != null ? Number(rankAfter) : null;
  const prev = prevRank != null ? Number(prevRank) : null;
  if (cur == null || !Number.isFinite(cur)) return null;
  const rankText = `${cur}위`;
  if (prev == null || !Number.isFinite(prev)) {
    return { rankText, deltaText: " -", deltaColor: "#94a3b8" };
  }
  const diff = prev - cur;
  if (diff > 0) return { rankText, deltaText: ` ▲${diff}`, deltaColor: "#4ade80" };
  if (diff < 0) return { rankText, deltaText: ` ▼${Math.abs(diff)}`, deltaColor: "#f87171" };
  return { rankText, deltaText: " -", deltaColor: "#94a3b8" };
}

function drawRecordRankCell(ctx, x, cy, parts, rankFontPx) {
  const rankPx = rankFontPx + 2;
  const deltaPx = rankFontPx;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${rankPx}px ${RECORD_FONT}`;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(parts.rankText, x, cy);
  const rankW = ctx.measureText(parts.rankText).width;
  if (parts.deltaText) {
    ctx.font = `800 ${deltaPx}px ${RECORD_FONT}`;
    ctx.fillStyle = parts.deltaColor || "#94a3b8";
    ctx.fillText(parts.deltaText, x + rankW, cy);
  }
}

function truncateTextToWidth(ctx, text, maxW) {
  let draw = String(text || "");
  if (!draw) return "";
  for (let guard = 0; guard < 80; guard += 1) {
    if (ctx.measureText(draw).width <= maxW) return draw;
    if (draw.length <= 1) return draw;
    draw = `${draw.slice(0, draw.length - 2)}…`;
  }
  return draw;
}

/** 1줄: 날짜/홈원정/상대/스코어/승패/순위 */
function recordTableRow1Layout(w) {
  const tableLeft = 64;
  const tableW = w - 128;
  const ratios = [0.17, 0.15, 0.2, 0.13, 0.15, 0.1];
  const left = [];
  const width = ratios.map((r) => tableW * r);
  let x = tableLeft;
  for (let i = 0; i < ratios.length; i++) {
    left.push(x);
    x += width[i];
  }
  return { tableLeft, tableW, left, width, dateColEnd: left[1] };
}

function drawRecordResultBadge(ctx, x, cy, result) {
  const { label, color } = resultLabelAndColor(result);
  const fontPx = 32;
  const padX = 14;
  const padY = 8;
  ctx.font = `900 ${fontPx}px ${RECORD_FONT}`;
  const tw = ctx.measureText(label).width;
  const bw = tw + padX * 2;
  const bh = fontPx + padY * 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, cy - bh / 2, bw, bh, 10);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padX, cy);
  return bw;
}

function drawRecordPitcherBadge(ctx, x, cy, label, bgColor) {
  const fontPx = 24;
  const padX = 10;
  const padY = 5;
  ctx.font = `900 ${fontPx}px ${RECORD_FONT}`;
  const tw = ctx.measureText(label).width;
  const bw = tw + padX * 2;
  const bh = fontPx + padY * 2;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(x, cy - bh / 2, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + padX, cy);
  return bw + 6;
}

function drawRecordRowLine2(ctx, line2Left, line2Right, cy, game, pitcherFontPx) {
  const fontPx = pitcherFontPx;
  const ourS = String(game?.our_starter ?? "").trim();
  const oppS = String(game?.opp_starter ?? "").trim();
  const winP = String(game?.win_pitcher ?? "").trim();
  const loseP = String(game?.lose_pitcher ?? "").trim();

  const spanW = line2Right - line2Left;
  const midX = line2Left + spanW * 0.48;
  const wlStartX = line2Left + spanW * 0.5;
  const maxRight = line2Right - 8;

  if (ourS || oppS) {
    const starterText = `${ourS || "—"} : ${oppS || "—"}`;
    ctx.textAlign = "left";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${fontPx}px ${RECORD_FONT}`;
    ctx.fillText(
      truncateTextToWidth(ctx, starterText, Math.max(80, midX - line2Left - 12)),
      line2Left + 8,
      cy
    );
  }

  if (!winP && !loseP) return;

  const result = game?.result;
  let ourPitcher = "";
  let oppPitcher = "";
  let ourBadge = null;
  let oppBadge = null;

  if (result === "win") {
    ourPitcher = winP;
    oppPitcher = loseP;
    if (ourPitcher) ourBadge = { label: "승", color: "#4ade80" };
    if (oppPitcher) oppBadge = { label: "패", color: "#f87171" };
  } else if (result === "loss") {
    ourPitcher = loseP;
    oppPitcher = winP;
    if (ourPitcher) ourBadge = { label: "패", color: "#f87171" };
    if (oppPitcher) oppBadge = { label: "승", color: "#4ade80" };
  } else {
    ourPitcher = winP;
    oppPitcher = loseP;
  }

  if (!ourPitcher && !oppPitcher) return;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let x = wlStartX;

  if (ourBadge) x += drawRecordPitcherBadge(ctx, x, cy, ourBadge.label, ourBadge.color);
  if (ourPitcher) {
    ctx.font = `600 ${fontPx}px ${RECORD_FONT}`;
    ctx.fillStyle = "#FFFFFF";
    const draw = truncateTextToWidth(ctx, ourPitcher, Math.max(24, maxRight - x - 24));
    ctx.fillText(draw, x, cy);
    x += ctx.measureText(draw).width;
  }

  if (ourPitcher && oppPitcher) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${fontPx}px ${RECORD_FONT}`;
    const gap = "  ";
    ctx.fillText(gap, x, cy);
    x += ctx.measureText(gap).width;
  }

  if (oppBadge) x += drawRecordPitcherBadge(ctx, x, cy, oppBadge.label, oppBadge.color);
  if (oppPitcher) {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${fontPx}px ${RECORD_FONT}`;
    const draw = truncateTextToWidth(ctx, oppPitcher, Math.max(24, maxRight - x));
    ctx.fillText(draw, x, cy);
  }
}

function fmtWeekRecordSummary(rec) {
  const wins = Number(rec?.wins) || 0;
  const losses = Number(rec?.losses) || 0;
  const draws = Number(rec?.draws) || 0;
  if (draws > 0) return `${wins}승 ${draws}무 ${losses}패`;
  return `${wins}승 ${losses}패`;
}

function fmtWeekStartMd(weekStartIso) {
  const s = String(weekStartIso || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";
  return `${Number(m[2])}월${Number(m[3])}일`;
}

function isoAddDaysYmd(weekStartIso, deltaDays) {
  const s = String(weekStartIso || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays, 12, 0, 0);
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** week_start ~ week_end(또는 +6일) "M월D일 - M월D일" */
function fmtWeekRangeMd(weekStartIso, weekEndIso) {
  const start = fmtWeekStartMd(weekStartIso);
  if (!start) return "";
  const endIso =
    String(weekEndIso || "").slice(0, 10) || isoAddDaysYmd(weekStartIso, 6);
  const end = fmtWeekStartMd(endIso);
  return end ? `${start} - ${end}` : start;
}

/** 흰선 아래 주간 요약: "5월11일 주간  3승 3패  (3위)" */
function fmtRecordWeekSummaryLine(data) {
  const datePart = fmtWeekStartMd(data?.week_start);
  const rec = data?.week_record || {};
  const wins = Number(rec.wins) || 0;
  const losses = Number(rec.losses) || 0;
  const draws = Number(rec.draws) || 0;
  const wlPart = draws > 0 ? `${wins}승 ${draws}무 ${losses}패` : `${wins}승 ${losses}패`;
  const rank = data?.rank_change?.current_rank;
  const rankPart =
    rank != null && Number.isFinite(Number(rank)) ? `(${Number(rank)}위)` : "";
  const dateLabel = datePart ? `${datePart} 주간` : "주간";
  return [dateLabel, wlPart, rankPart].filter(Boolean).join("  ");
}

const RECORD_FONT = `"${FONT_BODY}", system-ui, sans-serif`;


function drawSmallOpponentLogo(ctx, x, cy, size, img) {
  if (!img || !(img.width > 0)) return 0;
  const iw = img.width;
  const ih = img.height;
  const scale = Math.min(size / iw, size / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const top = cy - dh / 2;
  ctx.drawImage(img, x, top, dw, dh);
  return dw + 10;
}

function drawLogoInBox(ctx, x, y, boxW, boxH, teamName, img) {
  if (img && img.width > 0) {
    const iw = img.width;
    const ih = img.height;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
    return;
  }
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.arc(x + boxW / 2, y + boxH / 2, boxW * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `900 72px "${FONT_TITLE}", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fmtTeamShort(teamName), x + boxW / 2, y + boxH / 2);
  ctx.restore();
}

function fmtRankChange(rankChange) {
  const d = rankChange?.diff;
  if (d == null || !Number.isFinite(Number(d))) return "순위 —";
  const n = Number(d);
  if (n > 0) return `▲${n}`;
  if (n < 0) return `▼${Math.abs(n)}`;
  return "—";
}

/** slide1: 인트로 */
export function drawShorts5IntroSlide(ctx, w, h, data, logoImg) {
  const team = data?.team_name || data?.team_keyword || "팀";
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getTeamStrongColor(team);
  ctx.fillRect(0, 0, w, h);

  const teamNameY = h * 0.08 + 110;
  const teamFontPx = 160;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${teamFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(team, w / 2, teamNameY);

  const logoBox = Math.round(840 * 0.8);
  const logoTop = h * 0.22;
  drawLogoInBox(ctx, (w - logoBox) / 2, logoTop, logoBox, logoBox, team, logoImg);
  const logoBottomY = logoTop + logoBox;

  const dividerLineY = logoBottomY + 20;
  const dividerLineW = w * 0.6;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - dividerLineW / 2, dividerLineY);
  ctx.lineTo(w / 2 + dividerLineW / 2, dividerLineY);
  ctx.stroke();

  const weeklyTitleY = dividerLineY + 210 - 40;
  const weeklyFontPx = 130;
  ctx.fillStyle = "#FFD700";
  ctx.font = `700 ${weeklyFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText("주간결산", w / 2, weeklyTitleY);

  const weekRangeY = weeklyTitleY + 130;
  const weekRangeStr = fmtWeekRangeMd(data?.week_start, data?.week_end);
  if (weekRangeStr) {
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `700 80px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillText(weekRangeStr, w / 2, weekRangeY);
  }

  const gamePreviewY = h * 0.93 - 50;
  ctx.font = `italic 900 62px "${FONT_TITLE}", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  shadowTextSoft(ctx);
  ctx.fillText("WEEKLY REPORT", w / 2, gamePreviewY);
  resetShadow(ctx);
}

/**
 * slide2: 주간 경기결과 (쇼츠4 라인업 슬라이드 레이아웃 계열)
 * @param {Record<string, HTMLImageElement | null | undefined> | null | undefined} [logosByTeamKey] 상대팀 로고
 */
export function drawShorts5RecordSlide(ctx, w, h, data, logoImg, logosByTeamKey = null) {
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";
  const games = Array.isArray(data?.games) ? data.games.slice(0, 6) : [];

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getTeamDarkColor(teamName);
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  const HEADER_Y_SHIFT = -50 - 120;
  const LOGO_X = 60;
  const LOGO_BOX = 300;
  const titleFontPx = 64;
  const subFontPx = Math.round(titleFontPx * 0.7);
  const legacyLogoTop = SAFE_TOP + 24 + HEADER_Y_SHIFT;
  const legacyTitleCy = legacyLogoTop + LOGO_BOX / 2;
  const legacySubtitleY = legacyTitleCy + Math.round(titleFontPx * 0.42);
  const divY = legacySubtitleY + subFontPx + 12;

  const titleCy = divY - 20 - titleFontPx / 2;
  const logoTop = titleCy - LOGO_BOX / 2;
  const logoRightX = LOGO_X + LOGO_BOX;
  const summaryCenterX = (logoRightX + w) / 2;
  const lineStartX = LOGO_X + LOGO_BOX + 16;

  drawLogoInBox(ctx, LOGO_X, logoTop, LOGO_BOX, LOGO_BOX, teamName, logoImg);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 ${titleFontPx}px ${RECORD_FONT}`;
  shadowTextSoft(ctx);
  ctx.fillText("주간 경기결과", summaryCenterX, titleCy);
  resetShadow(ctx);

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lineStartX, divY);
  ctx.lineTo(w * 0.95, divY);
  ctx.stroke();

  const summaryFontPx = 48;
  const summaryGapBelowLine = 40;
  const summaryCy = divY + summaryGapBelowLine + summaryFontPx / 2;
  const summaryLine = fmtRecordWeekSummaryLine(data);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `700 ${summaryFontPx}px ${RECORD_FONT}`;
  ctx.fillText(summaryLine, summaryCenterX, summaryCy);

  const tableTop = summaryCy + summaryFontPx / 2 + 40;
  const headerDividerAnchorY = tableTop + 20 + 40;
  const headerLineY = headerDividerAnchorY + 12;
  const headerTextCy = tableTop + (headerLineY - tableTop) / 2;
  const line1H = 100;
  const line2H = 100;
  const rowH = line1H + line2H + 6;
  const maxRows = 6;
  const { left: colLeft, width: colW, dateColEnd } = recordTableRow1Layout(w);
  const cellPad = 10;
  const datePadLeft = colLeft[0] + 24;
  const oppLogoSize = 65;
  const headerFontPx = 36;
  const bodyFontPx = 38;
  const scoreFontPx = 41;
  const oppNameFontPx = 40;
  const rankFontPx = 32;
  const weekPrevRank =
    data?.rank_change?.prev_rank != null && Number.isFinite(Number(data.rank_change.prev_rank))
      ? Number(data.rank_change.prev_rank)
      : null;

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.font = `700 ${headerFontPx}px ${RECORD_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("날짜", datePadLeft, headerTextCy);
  ctx.fillText("상대팀", colLeft[2] + cellPad, headerTextCy);
  ctx.fillText("스코어", colLeft[3] + cellPad, headerTextCy);
  ctx.fillText("승패", colLeft[4] + cellPad, headerTextCy);
  ctx.fillText("순위", colLeft[5] + cellPad, headerTextCy);
  ctx.beginPath();
  ctx.moveTo(64, headerLineY);
  ctx.lineTo(w - 64, headerLineY);
  ctx.stroke();

  const firstRowY = headerDividerAnchorY + 52 + 60 - 30;
  let lastRowBottom = headerLineY;

  if (!games.length) {
    const emptyCy = firstRowY + (maxRows * rowH) / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `700 44px ${RECORD_FONT}`;
    ctx.fillText("해당 주간 경기 없음", w / 2, emptyCy);
    lastRowBottom = firstRowY + rowH * 2;
    ctx.textAlign = "left";
  } else {
    let prevRankForDelta = weekPrevRank;
    for (let i = 0; i < maxRows; i++) {
      const y = firstRowY + i * rowH;
      const rowBoxTop = y - 42;
      const rowBoxH = rowH - 6;
      const line1Top = rowBoxTop;
      const line2Top = rowBoxTop + line1H;
      const line1Cy = line1Top + line1H / 2;
      const line2Cy = line2Top + line2H / 2;
      const rowDateCy = rowBoxTop + rowBoxH / 2;

      const line1Bg = i % 2 === 0 ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.12)";
      const line2Bg = i % 2 === 0 ? "rgba(0,0,0,0.34)" : "rgba(0,0,0,0.24)";

      ctx.fillStyle = line1Bg;
      ctx.beginPath();
      ctx.roundRect(64, line1Top, w - 128, line1H, [12, 12, 0, 0]);
      ctx.fill();

      ctx.fillStyle = line2Bg;
      ctx.beginPath();
      ctx.roundRect(64, line2Top, w - 128, line2H, [0, 0, 12, 12]);
      ctx.fill();

      lastRowBottom = rowBoxTop + rowBoxH;

      const g = games[i];
      if (!g) continue;

      const dateStr = String(g.game_date || "").slice(5).replace("-", "/") || "—";
      const homeMark = g.is_home ? "홈" : "원정";
      const oppFull = String(g.opponent ?? g.opp_team_name ?? "").trim();
      const opp = fmtTeamShort(oppFull);
      const score = `${g.team_score ?? "—"} : ${g.opp_score ?? "—"}`;
      const oppTk = teamKeyword(oppFull || opp);
      const oppLogo = oppTk && logosByTeamKey ? logosByTeamKey[oppTk] : null;
      const rankAfter =
        g.rank_after != null && Number.isFinite(Number(g.rank_after)) ? Number(g.rank_after) : null;
      const rankParts = parsePerGameRankParts(prevRankForDelta, rankAfter);

      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `600 ${bodyFontPx}px ${RECORD_FONT}`;
      ctx.fillText(dateStr, datePadLeft, rowDateCy);

      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `600 ${bodyFontPx}px ${RECORD_FONT}`;
      ctx.fillText(homeMark, colLeft[1] + cellPad, line1Cy);

      const oppCellX = colLeft[2] + cellPad;
      const logoOffset = drawSmallOpponentLogo(ctx, oppCellX, line1Cy, oppLogoSize, oppLogo);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `700 ${oppNameFontPx}px ${RECORD_FONT}`;
      const oppTextX = oppCellX + logoOffset;
      const oppMaxW = colLeft[2] + colW[2] - cellPad - oppTextX;
      ctx.fillText(truncateTextToWidth(ctx, opp, oppMaxW), oppTextX, line1Cy);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `600 ${scoreFontPx}px ${RECORD_FONT}`;
      ctx.fillText(score, colLeft[3] + cellPad, line1Cy);

      drawRecordResultBadge(ctx, colLeft[4] + cellPad, line1Cy, g.result);

      if (rankParts) {
        drawRecordRankCell(ctx, colLeft[5] + cellPad, line1Cy, rankParts, rankFontPx);
      }

      drawRecordRowLine2(ctx, dateColEnd, w - 64, line2Cy, g, bodyFontPx);

      if (rankAfter != null) prevRankForDelta = rankAfter;
    }
  }

}

const __shorts5BattingAssetsCache = new Map();

function battingAssetsCacheKey(data) {
  const mvp = data?.mvp_batter;
  const tk = teamKeyword(data?.team_name || data?.team_keyword || "");
  return `${tk}|${String(mvp?.player || "").trim()}`;
}

/** S3 `loadPlayerImage`용 팀 키 — 패널 teamKw · API team_keyword 우선 */
function resolveMvpPortraitTeamKey(data, teamKwOverride = "") {
  const fromPanel = String(teamKwOverride || "").trim();
  if (fromPanel) {
    const tk = teamKeyword(fromPanel);
    if (tk) return tk;
  }
  const fromApiKw = String(data?.team_keyword || "").trim();
  if (fromApiKw) {
    const tk = teamKeyword(fromApiKw);
    if (tk) return tk;
  }
  const fromMvpTeam = String(data?.mvp_batter?.team || "").trim();
  if (fromMvpTeam) {
    const tk = teamKeyword(fromMvpTeam);
    if (tk) return tk;
  }
  const fromTeamName = String(data?.team_name || "").trim();
  if (fromTeamName) {
    const tk = teamKeyword(fromTeamName);
    if (tk) return tk;
  }
  return "";
}

/** 쇼츠4 hot_player와 동일 — 네이버 URL 우선, S3, 기본 실루엣 */
export async function loadShorts5BattingPortrait(data, teamKwOverride = "") {
  const mvp = data?.mvp_batter;
  const tk = resolveMvpPortraitTeamKey(data, teamKwOverride);
  const player = String(mvp?.player || mvp?.name || "").trim();
  const url = String(mvp?.player_image_url || mvp?.image_url || "").trim();

  console.log("[shorts5] loadShorts5BattingPortrait", {
    tk,
    player,
    team_keyword: data?.team_keyword,
    team_name: data?.team_name,
    teamKwOverride: teamKwOverride || null,
    player_image_url: url || null,
  });

  const defImg = await loadDefaultPlayerImage();
  let loaded = null;
  if (url) {
    loaded = await loadPlayerImageFromNaverProxy(url);
  } else if (player && tk) {
    loaded = await loadPlayerImage(tk, player);
  }

  const finalImg =
    drawableShorts4Portrait(loaded) ? loaded : drawableShorts4Portrait(defImg) ? defImg : loaded ?? defImg;

  console.log("[shorts5] loadShorts5BattingPortrait result", {
    tk,
    player,
    s3Attempt: Boolean(!url && player && tk),
    loaded: Boolean(drawableShorts4Portrait(loaded)),
    default: Boolean(drawableShorts4Portrait(defImg)),
    final: Boolean(drawableShorts4Portrait(finalImg)),
  });

  return finalImg;
}

/** 캡처 전 호출 권장 — 상대 로고 프리로드 (사진은 `loadShorts5BattingPortrait`) */
export async function loadShorts5BattingSlideAssets(data, teamKwOverride = "") {
  const mvp = data?.mvp_batter;
  const tk = resolveMvpPortraitTeamKey(data, teamKwOverride);
  const logosByTeamKey = {};
  if (tk) logosByTeamKey[tk] = await loadSvgLogo(tk);
  const games = Array.isArray(mvp?.games) ? mvp.games.slice(0, 6) : [];
  for (const g of games) {
    const ok = teamKeyword(g?.opponent || "");
    if (ok && !logosByTeamKey[ok]) logosByTeamKey[ok] = await loadSvgLogo(ok);
  }
  return { logosByTeamKey };
}

function primeShorts5BattingAssets(data, teamKwOverride = "") {
  const key = battingAssetsCacheKey(data);
  if (__shorts5BattingAssetsCache.has(key)) return __shorts5BattingAssetsCache.get(key);
  const p = Promise.all([
    loadShorts5BattingSlideAssets(data),
    loadShorts5BattingPortrait(data, teamKwOverride),
  ]).then(([logosPack, portrait]) => {
    const assets = { ...logosPack, portrait };
    __shorts5BattingAssetsCache.set(key, assets);
    return assets;
  });
  __shorts5BattingAssetsCache.set(key, p);
  return p;
}

function drawPortraitContain(ctx, img, cx, boxTop, boxW, boxH) {
  const d = drawableShorts4Portrait(img);
  if (!d) return;
  const iw = Number(d.naturalWidth) || boxW;
  const ih = Number(d.naturalHeight) || boxH;
  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(d, cx - dw / 2, boxTop + (boxH - dh) / 2, dw, dh);
}

const DEFAULT_PLAYER_SRC_MARK = "default_player.png";

function isDefaultPlayerPortrait(img) {
  if (!img) return false;
  const s = String(img.currentSrc || img.src || "");
  return s.includes(DEFAULT_PLAYER_SRC_MARK);
}

function drawDefaultPortraitNameOverlay(ctx, cx, boxTop, boxW, boxH, name) {
  const text = String(name || "").trim();
  if (!text || text === "미정" || text === "—") return;
  const fontPx = Math.min(44, Math.max(22, Math.floor(boxH / 5.5)));
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - boxW / 2, boxTop, boxW, boxH);
  ctx.clip();
  ctx.fillStyle = "#555555";
  ctx.font = `800 ${fontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, boxTop + boxH / 2);
  ctx.restore();
}

/** 쇼츠4 drawHotPlayerHomeUpperBlock 계열 상수 */
const MVP_FACE_BOX = Math.round(Math.round(530 * 0.7) * 1.05 * 0.95);
const MVP_UPPER_DIVIDER_Y = 157 + 5;
const MVP_HEADER_GAP_LINE_TO_CENTER = 48;
const MVP_DIVIDER_TO_FACE_TOP = 56;
const MVP_HEADER_FONT_PX = 52;
const MVP_STAT_FONT_PX = 46;
const MVP_STAT_LINE_GAP = Math.round(54 * 1.45);
const MVP_STAT_BLOCK_SHIFT_Y = -30;
const MVP_LOGO_HEADER_H = 100;
const MVP_LOGO_HEADER_MAX_W = 280;
const MVP_BAR_W_FRAC = 0.9;
const MVP_BAR_H = 120;
const MVP_BAR_GAP = 18;
const MVP_BAR_MIN_SEG_W = 50;
const MVP_BAR_COLORS = ["#E53935", "#1E88E5"];
const MVP_BAR_LABELS = ["타율", "OPS"];
const MVP_BAR_BG = "rgba(0,0,0,0.3)";
const MVP_SUMMARY_GAP = 10;
const MVP_SUMMARY_FONT_PX = 26;
const MVP_SUMMARY_BLOCK_H = MVP_SUMMARY_GAP + MVP_SUMMARY_FONT_PX + 6;
const MVP_BASE_AVG = 0.4;
const MVP_BASE_OPS = 1.2;

function fmtMvpBatsLabel(mvp) {
  const raw = String(mvp?.bats ?? mvp?.hand ?? mvp?.bat_hand ?? "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  if (low.includes("switch") || raw.includes("스위") || low === "s") return "스위치";
  if (low.includes("left") || raw.includes("좌")) return "좌타";
  if (low.includes("right") || raw.includes("우")) return "우타";
  if (raw === "좌타" || raw === "우타" || raw === "스위치") return raw;
  return "";
}

function fmtMvpHeaderPlayerLine(mvp) {
  const name = String(mvp?.player || "").trim() || "—";
  const bats = fmtMvpBatsLabel(mvp);
  return bats ? `${name} (${bats})` : name;
}

function splitMvpBarSegmentWidths(innerW, ratios) {
  const n = ratios.length;
  const s = ratios.reduce((a, b) => a + b, 0);
  if (!(s > 0)) {
    const q = Math.floor(innerW / n);
    const arr = Array(n).fill(q);
    arr[n - 1] += innerW - q * n;
    return arr;
  }
  const exact = ratios.map((r) => (Math.max(0, r) / s) * innerW);
  const floors = exact.map((x) => Math.floor(x));
  let rem = innerW - floors.reduce((a, b) => a + b, 0);
  const order = [...exact.keys()].sort(
    (i, j) => exact[j] - Math.floor(exact[j]) - (exact[i] - Math.floor(exact[i]))
  );
  let k = 0;
  while (rem > 0) {
    floors[order[k % order.length]] += 1;
    rem -= 1;
    k += 1;
  }
  return floors;
}

function drawBattingHeaderLogo(ctx, left, centerY, maxW, teamName, logoImg) {
  const boxH = MVP_LOGO_HEADER_H;
  if (!logoImg || !(logoImg.width > 0)) {
    drawLogoInBox(ctx, left, centerY - boxH / 2, boxH, boxH, teamName, null);
    return boxH;
  }
  const iw = Number(logoImg.naturalWidth || logoImg.width) || maxW;
  const ih = Number(logoImg.naturalHeight || logoImg.height) || boxH;
  let scale = boxH / ih;
  let dw = iw * scale;
  if (dw > maxW) {
    scale = maxW / iw;
    dw = iw * scale;
  }
  const dh = ih * scale;
  ctx.drawImage(logoImg, left, centerY - dh / 2, dw, dh);
  return dw;
}

function drawBattingMvpHeaderRow(ctx, w, centerY, padL, teamName, headerLine, logoImg) {
  const maxLogoW = Math.min(MVP_LOGO_HEADER_MAX_W, Math.max(80, w - padL - 320));
  const logoW = drawBattingHeaderLogo(ctx, padL, centerY, maxLogoW, teamName, logoImg);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${MVP_HEADER_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  const textX = padL + logoW + 16;
  shadowTextSoft(ctx);
  ctx.fillText(headerLine, textX, centerY);
  resetShadow(ctx);
  ctx.restore();
}

function drawBattingMvpHeaderDivider(ctx, w, pad, dividerY) {
  ctx.save();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, dividerY);
  ctx.lineTo(w - pad, dividerY);
  ctx.stroke();
  ctx.restore();
}

function pickMvpSeasonStat(mvp, seasonKeys, flatKeys) {
  const season = mvp?.season;
  if (season && typeof season === "object") {
    for (const k of seasonKeys) {
      if (season[k] == null || season[k] === "") continue;
      const n = Number(season[k]);
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  for (const k of flatKeys) {
    if (mvp?.[k] == null || mvp?.[k] === "") continue;
    const n = Number(mvp[k]);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

function fmtMvpSeasonSuffix(n, unit) {
  return n != null && Number.isFinite(Number(n))
    ? `시즌 ${Math.round(Number(n))}${unit}`
    : `시즌 -${unit}`;
}

function mvpWeeklyStatLines(mvp) {
  const mvp0 = mvp && typeof mvp === "object" ? mvp : {};
  const t = mvp0.total && typeof mvp0.total === "object" ? mvp0.total : {};
  const hr = Number(t.hr) || 0;
  const h = Number(t.h) || 0;
  const rbi = Number(t.rbi) || 0;
  const seasonHr = pickMvpSeasonStat(
    mvp0,
    ["hr", "HR", "home_run", "season_hr"],
    ["season_hr", "seasonHr"]
  );
  const seasonH = pickMvpSeasonStat(
    mvp0,
    ["h", "H", "hits", "hit", "season_hit", "season_h"],
    ["season_hit", "seasonHit", "season_h"]
  );
  const seasonRbi = pickMvpSeasonStat(
    mvp0,
    ["rbi", "RBI", "season_rbi"],
    ["season_rbi", "seasonRbi"]
  );
  return [
    `- 주간 ${hr}홈런 (${fmtMvpSeasonSuffix(seasonHr, "홈런")})`,
    `- 주간 ${h}안타 (${fmtMvpSeasonSuffix(seasonH, "안타")})`,
    `- 주간 ${rbi}타점 (${fmtMvpSeasonSuffix(seasonRbi, "타점")})`,
  ];
}

function drawBattingMvpStatBlock(ctx, statX, cy, mvp) {
  const lines = mvpWeeklyStatLines(mvp);
  const gap = MVP_STAT_LINE_GAP;
  const totalH = (lines.length - 1) * gap;
  let y = cy - totalH / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${MVP_STAT_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  for (const line of lines) {
    shadowTextSoft(ctx);
    ctx.fillText(line, statX, y);
    resetShadow(ctx);
    y += gap;
  }
  const lastCenterY = cy + totalH / 2;
  return lastCenterY + MVP_STAT_FONT_PX / 2;
}

function mvpAvgOpsBarRatios(total) {
  const avg = Number(total?.avg);
  const ops = Number(total?.ops);
  const w0 = Number.isFinite(avg) && avg >= 0 ? avg / MVP_BASE_AVG : 0;
  const w1 = Number.isFinite(ops) && ops >= 0 ? ops / MVP_BASE_OPS : 0;
  const s = w0 + w1;
  return s > 0 ? [w0, w1] : [1, 1];
}

function drawBattingMvpAvgOpsBar(ctx, wCanvas, topBelowStats, total) {
  const ratios = mvpAvgOpsBarRatios(total);
  const barW = Math.floor(wCanvas * MVP_BAR_W_FRAC);
  const barLeft = Math.floor((wCanvas - barW) / 2);
  if (barW < 120) return topBelowStats;

  const segWs = splitMvpBarSegmentWidths(barW, ratios);
  const barTop = topBelowStats + MVP_BAR_GAP;
  const avgStr = fmtRate3(total?.avg);
  const opsStr = fmtRate3(total?.ops);
  const valueStrs = [avgStr, opsStr];
  const summaryLine = `타율 ${avgStr}  OPS ${opsStr}`;

  ctx.save();
  ctx.beginPath();
  ctx.rect(barLeft, barTop, barW, MVP_BAR_H);
  ctx.clip();
  ctx.fillStyle = MVP_BAR_BG;
  ctx.fillRect(barLeft, barTop, barW, MVP_BAR_H);
  let x = barLeft;
  for (let i = 0; i < 2; i++) {
    const sw = segWs[i] || 0;
    if (sw > 0) {
      ctx.fillStyle = MVP_BAR_COLORS[i];
      ctx.fillRect(x, barTop, sw, MVP_BAR_H);
    }
    x += sw;
  }
  ctx.restore();

  x = barLeft;
  for (let i = 0; i < 2; i++) {
    const sw = segWs[i] || 0;
    const cx = x + sw / 2;
    if (sw > 0 && sw >= MVP_BAR_MIN_SEG_W) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, barTop, sw, MVP_BAR_H);
      ctx.clip();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 31px "${FONT_BODY}", system-ui, sans-serif`;
      shadowTextSoft(ctx);
      ctx.fillText(MVP_BAR_LABELS[i], cx, barTop + MVP_BAR_H * 0.32);
      resetShadow(ctx);
      ctx.font = `700 23px "${FONT_BODY}", system-ui, sans-serif`;
      shadowTextSoft(ctx);
      ctx.fillText(valueStrs[i], cx, barTop + MVP_BAR_H * 0.78);
      resetShadow(ctx);
      ctx.restore();
    }
    x += sw;
  }

  const summaryTop = barTop + MVP_BAR_H + MVP_SUMMARY_GAP;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#ffffff";
  ctx.font = `500 ${MVP_SUMMARY_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(summaryLine, wCanvas / 2, summaryTop);
  resetShadow(ctx);
  ctx.restore();

  return barTop + MVP_BAR_H + MVP_SUMMARY_BLOCK_H;
}

function battingMvpContentBottom(statBottomY, faceCy) {
  const rPhoto = MVP_FACE_BOX / 2;
  return Math.max(faceCy + rPhoto, statBottomY);
}

/** 쇼츠4 drawHotPlayerHomeUpperBlock 동일 구조 */
function drawBattingMvpUpperBlock(ctx, w, h, teamName, mvp, portrait, logosByTeamKey) {
  const faceBox = MVP_FACE_BOX;
  const rPhoto = faceBox / 2;
  const padL = 48;
  const upperDividerY = MVP_UPPER_DIVIDER_Y;
  const upperHeaderCy = upperDividerY - MVP_HEADER_GAP_LINE_TO_CENTER;
  const tk = teamKeyword(teamName);
  const teamLogoImg = tk && logosByTeamKey ? logosByTeamKey[tk] : null;
  const playerName = String(mvp?.player || "").trim();
  const headerLine = fmtMvpHeaderPlayerLine(mvp);
  const usePhoto = Boolean(drawableShorts4Portrait(portrait));

  drawBattingMvpHeaderRow(ctx, w, upperHeaderCy, padL, teamName, headerLine, teamLogoImg);
  drawBattingMvpHeaderDivider(ctx, w, padL, upperDividerY);

  const upperPhotoCx = w * 0.25;
  const upperCy = upperDividerY + rPhoto + MVP_DIVIDER_TO_FACE_TOP;
  const upperBoxTop = upperCy - rPhoto;
  if (usePhoto) {
    drawPortraitContain(ctx, portrait, upperPhotoCx, upperBoxTop, faceBox, faceBox);
    if (isDefaultPlayerPortrait(portrait)) {
      drawDefaultPortraitNameOverlay(ctx, upperPhotoCx, upperBoxTop, faceBox, faceBox, playerName);
    }
  }

  const upperStatX = upperPhotoCx + rPhoto + 28;
  const upperStatBottom = drawBattingMvpStatBlock(
    ctx,
    upperStatX,
    upperCy + MVP_STAT_BLOCK_SHIFT_Y,
    mvp
  );
  const contentBottom = battingMvpContentBottom(upperStatBottom, upperCy);
  return drawBattingMvpAvgOpsBar(ctx, w, contentBottom, mvp?.total);
}

function fmtBattingSlideDate(iso) {
  const s = String(iso || "").slice(0, 10);
  const m = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "—";
  return `${Number(m[2])}/${Number(m[3])}`;
}

function fmtRate3(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const s = n.toFixed(3);
  return n < 1 ? `.${s.slice(2)}` : s;
}

function battingStatCellColor(hr, h) {
  if (Number(hr) > 0) return "#f87171";
  if (Number(h) > 0) return "#ffffff";
  return "#94a3b8";
}

function drawBattingGameTable(
  ctx,
  w,
  h,
  games,
  logosByTeamKey,
  tableTop
) {
  const padX = 48;
  const rowH = 118;
  const maxRows = 6;
  const list = (Array.isArray(games) ? games : []).slice(0, maxRows);
  const ratios = [0.14, 0.34, 0.13, 0.13, 0.13, 0.13];
  const colLeft = [];
  const colW = ratios.map((r) => (w - padX * 2) * r);
  let x = padX;
  for (let i = 0; i < ratios.length; i++) {
    colLeft.push(x);
    x += colW[i];
  }

  const headerCy = tableTop + 36;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 30px "${FONT_BODY}", sans-serif`;
  const headers = ["날짜", "상대", "타수", "안타", "홈런", "타점"];
  for (let i = 0; i < headers.length; i++) {
    ctx.fillText(headers[i], colLeft[i] + colW[i] / 2, headerCy);
  }

  const headerLineY = tableTop + 64;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, headerLineY);
  ctx.lineTo(w - padX, headerLineY);
  ctx.stroke();

  const firstRowY = headerLineY + 28;
  if (!list.length) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `600 36px "${FONT_BODY}", sans-serif`;
    ctx.fillText("경기별 타격 기록 없음", w / 2, firstRowY + rowH);
    return;
  }

  const logoSize = 44;
  const bodyFontPx = 34;
  const statFontPx = 36;

  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const rowTop = firstRowY + i * rowH;
    const rowCy = rowTop + (rowH - 16) / 2;
    const boxH = rowH - 16;

    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(padX, rowTop, w - padX * 2, boxH, 16);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `600 ${bodyFontPx}px "${FONT_BODY}", sans-serif`;
    ctx.fillText(fmtBattingSlideDate(g.game_date), colLeft[0] + colW[0] / 2, rowCy);

    const opp = String(g.opponent || "—").trim() || "—";
    const ok = teamKeyword(opp);
    const oppLogo = ok && logosByTeamKey ? logosByTeamKey[ok] : null;
    const oppCellCx = colLeft[1] + colW[1] / 2;
    let oppTextX = oppCellCx;
    if (oppLogo && oppLogo.width > 0) {
      const scale = Math.min(logoSize / oppLogo.width, logoSize / oppLogo.height);
      const dw = oppLogo.width * scale;
      const dh = oppLogo.height * scale;
      const lx = colLeft[1] + 20;
      ctx.drawImage(oppLogo, lx, rowCy - dh / 2, dw, dh);
      oppTextX = lx + dw + 12;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${bodyFontPx}px "${FONT_BODY}", sans-serif`;
    ctx.fillText(
      truncateTextToWidth(ctx, fmtTeamShort(opp), colLeft[1] + colW[1] - (oppTextX - colLeft[1]) - 12),
      oppTextX,
      rowCy
    );

    const stats = [
      { v: g.ab, key: "ab" },
      { v: g.h, key: "h" },
      { v: g.hr, key: "hr" },
      { v: g.rbi, key: "rbi" },
    ];
    for (let c = 0; c < stats.length; c++) {
      const col = c + 2;
      const hr = Number(g.hr) || 0;
      const hits = Number(g.h) || 0;
      ctx.textAlign = "center";
      ctx.fillStyle = battingStatCellColor(hr, hits);
      ctx.font = `800 ${statFontPx}px "${FONT_BODY}", sans-serif`;
      const val = stats[c].v;
      ctx.fillText(val != null && val !== "" ? String(val) : "0", colLeft[col] + colW[col] / 2, rowCy);
    }
  }
}

/** slide3: 주간 MVP 타자 (@param assets `loadShorts5BattingSlideAssets` 결과 권장) */
export async function drawShorts5BattingSlide(ctx, w, h, data, assetsIn = null, teamKwOverride = "") {
  const mvp = data?.mvp_batter;
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";

  let assets = assetsIn;
  if (!assets) {
    const key = battingAssetsCacheKey(data);
    const cached = __shorts5BattingAssetsCache.get(key);
    if (cached && typeof cached.then === "function") assets = await cached;
    else if (cached) assets = cached;
    else {
      const [logosPack, portraitImg] = await Promise.all([
        loadShorts5BattingSlideAssets(data),
        loadShorts5BattingPortrait(data, teamKwOverride),
      ]);
      assets = { ...logosPack, portrait: portraitImg };
    }
  }

  let portrait = drawableShorts4Portrait(assets?.portrait);
  if (!portrait && mvp?.player) {
    portrait = drawableShorts4Portrait(
      await loadShorts5BattingPortrait(data, teamKwOverride)
    );
  }
  const logosByTeamKey = assets?.logosByTeamKey || {};

  console.log("[shorts5] drawShorts5BattingSlide portrait", {
    hasAssetsPortrait: Boolean(assets?.portrait),
    drawable: Boolean(portrait),
    player: mvp?.player,
  });

  ctx.clearRect(0, 0, w, h);
  const [accentBg] = teamGrad(teamName);
  ctx.fillStyle = accentBg || "#131922";
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  const topDividerY = Math.round(h * 0.52);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, topDividerY, w, h - topDividerY);

  if (!mvp?.player) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("주간 타자 기록 없음", w / 2, h / 2);
    return;
  }

  drawBattingMvpUpperBlock(ctx, w, h, teamName, mvp, portrait, logosByTeamKey);

  const tableTitleY = topDividerY + 44;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `800 40px "${FONT_BODY}", sans-serif`;
  ctx.fillText("경기별 기록", w / 2, tableTitleY);

  drawBattingGameTable(ctx, w, h, mvp.games, logosByTeamKey, tableTitleY + 36);

  primeShorts5BattingAssets(data, teamKwOverride);
}

/** slide4: 투수 하이라이트 */
export function drawShorts5PitcherSlide(ctx, w, h, data) {
  const p = data?.top_pitcher;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#142018";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#7fd4a8";
  ctx.font = `800 72px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("투수 하이라이트", w / 2, 200);

  if (!p?.player) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText("주간 투수 기록 없음", w / 2, h / 2);
    return;
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 96px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(p.player), w / 2, h * 0.42);
  resetShadow(ctx);

  const ip = p.ip != null ? String(p.ip) : "—";
  const era = p.era != null ? Number(p.era).toFixed(2) : "—";
  const wins = Number(p.wins) || 0;
  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const statLine =
    p.era != null ? `ERA ${era}  ${ip}이닝  ${wins}승` : `${ip}이닝  ${wins}승`;
  ctx.fillText(statLine, w / 2, h * 0.58);
}

/** slide5: 경기 결과 목록 */
export function drawShorts5GamesSlide(ctx, w, h, data) {
  const games = Array.isArray(data?.games) ? data.games : [];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f141c";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 64px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("경기 결과", w / 2, 120);

  const padX = 56;
  const rowH = 130;
  const y0 = 220;
  const maxRows = 8;
  const list = games.slice(-maxRows);

  if (!list.length) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `700 44px "${FONT_BODY}", sans-serif`;
    ctx.fillText("해당 주간 경기 없음", w / 2, h / 2);
    return;
  }

  ctx.textAlign = "left";
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const y = y0 + i * rowH;
    const result = g.result === "win" ? "승" : g.result === "loss" ? "패" : "무";
    const resultColor =
      g.result === "win" ? "#4ade80" : g.result === "loss" ? "#f87171" : "#94a3b8";
    const opp = fmtTeamShort(g.opponent);
    const score = `${g.team_score ?? "—"} : ${g.opp_score ?? "—"}`;
    const dateStr = String(g.game_date || "").slice(5).replace("-", "/");
    const homeMark = g.is_home ? "홈" : "원정";

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(padX, y, w - padX * 2, rowH - 16, 20);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `600 32px "${FONT_BODY}", sans-serif`;
    ctx.fillText(`${dateStr} ${homeMark}`, padX + 24, y + 36);

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText(`${opp}  ${score}`, padX + 24, y + 88);

    ctx.textAlign = "right";
    ctx.fillStyle = resultColor;
    ctx.font = `900 52px "${FONT_TITLE}", sans-serif`;
    ctx.fillText(result, w - padX - 24, y + 72);
    ctx.textAlign = "left";
  }
}

/** slide6: KBO 순위표 — drawStandingsSlide 위임용 메타만 (패널에서 drawStandingsSlide 호출) */
export function shorts5StandingsDateLabel(data) {
  return String(data?.week_end || data?.week_start || "").slice(0, 10);
}
