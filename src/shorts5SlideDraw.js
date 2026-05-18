/**
 * 쇼츠5 — 팀별 주간결산 슬라이드 (쇼츠1~4 미수정)
 */
import { drawBaseballBackground } from "./shortsBaseballDecor.js";
import { loadSvgLogo, teamKeyword } from "./shorts1IntroStandingsDraw.js";
import {
  drawableShorts4Portrait,
  loadDefaultPlayerImage,
  loadPlayerImage,
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

/** 캡처 전 호출 권장 — 선수 사진·상대 로고 프리로드 */
export async function loadShorts5BattingSlideAssets(data) {
  const mvp = data?.mvp_batter;
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";
  const tk = teamKeyword(teamName);
  const player = String(mvp?.player || "").trim();
  const logosByTeamKey = {};
  if (tk) logosByTeamKey[tk] = await loadSvgLogo(tk);
  const games = Array.isArray(mvp?.games) ? mvp.games.slice(0, 6) : [];
  for (const g of games) {
    const ok = teamKeyword(g?.opponent || "");
    if (ok && !logosByTeamKey[ok]) logosByTeamKey[ok] = await loadSvgLogo(ok);
  }
  let portrait = null;
  if (player && tk) {
    portrait = (await loadPlayerImage(tk, player)) || (await loadDefaultPlayerImage());
  }
  return { portrait, logosByTeamKey };
}

function primeShorts5BattingAssets(data) {
  const key = battingAssetsCacheKey(data);
  if (__shorts5BattingAssetsCache.has(key)) return __shorts5BattingAssetsCache.get(key);
  const p = loadShorts5BattingSlideAssets(data).then((assets) => {
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

function drawBattingWeeklyStatBar(ctx, w, barTop, total) {
  const t = total && typeof total === "object" ? total : {};
  const hr = Number(t.hr) || 0;
  const h = Number(t.h) || 0;
  const rbi = Number(t.rbi) || 0;
  const avg = fmtRate3(t.avg);
  const ops = fmtRate3(t.ops);
  const labels = ["홈런", "안타", "타점", "타율", "OPS"];
  const values = [String(hr), String(h), String(rbi), avg, ops];
  const colors = ["#E53935", "#FFB300", "#43A047", "#1E88E5", "#8E24AA"];
  const barW = Math.floor(w * 0.88);
  const barLeft = Math.floor((w - barW) / 2);
  const barH = 56;
  const segW = barW / labels.length;

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.roundRect(barLeft, barTop, barW, barH, 12);
  ctx.fill();

  for (let i = 0; i < labels.length; i++) {
    const x = barLeft + segW * i;
    ctx.fillStyle = colors[i];
    ctx.fillRect(x + (i === 0 ? 0 : 1), barTop, segW - (i === 0 ? 0 : 1), barH);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 22px "${FONT_BODY}", sans-serif`;
    ctx.fillText(labels[i], x + segW / 2, barTop + barH * 0.32);
    ctx.font = `800 28px "${FONT_BODY}", sans-serif`;
    ctx.fillText(values[i], x + segW / 2, barTop + barH * 0.72);
  }
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
export async function drawShorts5BattingSlide(ctx, w, h, data, assetsIn = null) {
  const mvp = data?.mvp_batter;
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";
  const tk = teamKeyword(teamName);

  let assets = assetsIn;
  if (!assets) {
    const key = battingAssetsCacheKey(data);
    const cached = __shorts5BattingAssetsCache.get(key);
    if (cached && typeof cached.then === "function") assets = await cached;
    else if (cached) assets = cached;
    else assets = await loadShorts5BattingSlideAssets(data);
  }

  const portrait = drawableShorts4Portrait(assets?.portrait);
  const logosByTeamKey = assets?.logosByTeamKey || {};

  ctx.clearRect(0, 0, w, h);
  const [accentBg] = teamGrad(teamName);
  ctx.fillStyle = accentBg || "#131922";
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  const topDividerY = Math.round(h * 0.52);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, topDividerY, w, h - topDividerY);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 64px "${FONT_TITLE}", sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("주간 타격 MVP", w / 2, 120);
  resetShadow(ctx);

  if (!mvp?.player) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText("주간 타자 기록 없음", w / 2, h / 2);
    return;
  }

  const faceBox = 300;
  const photoCx = 80 + faceBox / 2;
  const photoTop = 200;
  if (portrait) {
    drawPortraitContain(ctx, portrait, photoCx, photoTop, faceBox, faceBox);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.roundRect(80, photoTop, faceBox, faceBox, 20);
    ctx.fill();
  }

  const textX = 80 + faceBox + 36;
  const nameY = photoTop + 70;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 72px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(mvp.player), textX, nameY);
  resetShadow(ctx);

  const teamLabel = String(mvp.team || teamName).trim();
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `600 40px "${FONT_BODY}", sans-serif`;
  ctx.fillText(teamLabel, textX, nameY + 62);

  const teamLogo = tk ? logosByTeamKey[tk] : null;
  if (teamLogo && teamLogo.width > 0) {
    const lw = 52;
    const scale = Math.min(lw / teamLogo.width, lw / teamLogo.height);
    ctx.drawImage(
      teamLogo,
      textX + ctx.measureText(teamLabel).width + 14,
      nameY + 62 - (teamLogo.height * scale) / 2,
      teamLogo.width * scale,
      teamLogo.height * scale
    );
  }

  drawBattingWeeklyStatBar(ctx, w, photoTop + faceBox + 28, mvp.total);

  const tableTitleY = topDividerY + 44;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `800 40px "${FONT_BODY}", sans-serif`;
  ctx.fillText("경기별 기록", w / 2, tableTitleY);

  drawBattingGameTable(ctx, w, h, mvp.games, logosByTeamKey, tableTitleY + 36);

  primeShorts5BattingAssets(data);
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
