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

/** slide5 일정표: 날짜 20% / 홈·원정 15% / 상대 30% / 경기장 35% */
function scheduleTableLayout(w) {
  const tableLeft = 64;
  const tableW = w - 128;
  const ratios = [0.2, 0.15, 0.3, 0.35];
  const left = [];
  const width = ratios.map((r) => tableW * r);
  let x = tableLeft;
  for (let i = 0; i < ratios.length; i++) {
    left.push(x);
    x += width[i];
  }
  return { tableLeft, tableW, left, width, datePadLeft: left[0] + 24 };
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
export function drawShorts5RecordSlide(
  ctx,
  w,
  h,
  data,
  logoImg,
  logosByTeamKey = null,
  step = 3,
  revealCount = null
) {
  const reveal = Math.max(1, Math.min(3, Number(step) || 3));
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";
  const games = Array.isArray(data?.games) ? data.games.slice(0, 6) : [];

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getTeamStrongColor(teamName);
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

  if (reveal < 2) return;

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

  const drawRecordEmptyRowBands = (rowIndex) => {
    const y = firstRowY + rowIndex * rowH;
    const rowBoxTop = y - 42;
    const line1Top = rowBoxTop;
    const line2Top = rowBoxTop + line1H;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(64, line1Top, w - 128, line1H, [12, 12, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.roundRect(64, line2Top, w - 128, line2H, [0, 0, 12, 12]);
    ctx.fill();
    lastRowBottom = rowBoxTop + (rowH - 6);
  };

  if (reveal === 2) {
    if (revealCount != null) {
      const count = Math.min(revealCount, maxRows);
      // 빈 행 밴드를 count 수만큼만 그리기
      for (let i = 0; i < count; i++) drawRecordEmptyRowBands(i);
      let prevRankForDelta = weekPrevRank;
      for (let i = 0; i < count; i++) {
        const y = firstRowY + i * rowH;
        const rowBoxTop = y - 42;
        const line1H_local = 100;
        const line2H_local = 100;
        const line1Top = rowBoxTop;
        const line2Top = rowBoxTop + line1H_local;
        const line1Cy = line1Top + line1H_local / 2;
        const line2Cy = line2Top + line2H_local / 2;
        const rowDateCy = rowBoxTop + (rowH - 6) / 2;
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
      return;
    }
    for (let i = 0; i < maxRows; i++) drawRecordEmptyRowBands(i);
    return;
  }

  if (reveal < 3) return;

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

      drawRecordEmptyRowBands(i);

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
/** 타이틀~바 상단 블록 전체를 아래로 */
const MVP_UPPER_BLOCK_SHIFT_Y = 50;
const MVP_HEADER_GAP_LINE_TO_CENTER = 48;
const MVP_DIVIDER_TO_FACE_TOP = 56;
const MVP_HEADER_FONT_PX = 52;
const MVP_STAT_FONT_PX = 46;
const MVP_STAT_LINE_GAP = Math.round(54 * 1.45);
const MVP_STAT_BLOCK_SHIFT_Y = -30;
const MVP_LOGO_HEADER_H = 100;
const MVP_LOGO_HEADER_MAX_W = 280;
const MVP_TITLE_LOGO_H = 120;
const MVP_TITLE_LOGO_MAX_W = 180;
const MVP_TITLE_FONT_PX = MVP_HEADER_FONT_PX + 7;
const MVP_TITLE_PLAYER_COLOR = "#FFD700";
const MVP_TITLE_LABEL = "주간 타격 MVP";
const MVP_TITLE_LABEL_PITCHER = "오늘의 투수";
/** 사진 옆 4줄 스탯 블록 아래로 */
const MVP_PITCHER_STAT_LINES_SHIFT_Y = 20;
const PITCHER_GAME_TABLE_AT_BAR_SHIFT_Y = 0;
/** 등판기록 표만 아래로 (타이틀 Y는 유지) */
const PITCHER_GAME_TABLE_SHIFT_Y = 5;
const PITCHER_GAME_SECTION_SHIFT_Y = 80;
const PITCHER_GAME_DETAIL_TITLE_FONT_PX = 41;
const PITCHER_GAME_TABLE_VALUE_FONT_PX = 31;
const PITCHER_SEASON_RANK_TITLE_FONT_PX = 39;
const PITCHER_GAME_HEADER_BG = "rgba(0,0,0,0.3)";
const PITCHER_GAME_TABLE_HEADER_H = 36;
const PITCHER_GAME_SECTION_DIVIDER_GAP = 12;
/** 등판기록 구분 흰선 — 섹션 시작 기준 추가 위로 이동 */
const PITCHER_GAME_SECTION_DIVIDER_SHIFT_Y = 30;
/** 투수 슬라이드 하단 어두운 배경 시작 Y 추가 */
const PITCHER_SECTION_BG_SHIFT_Y = 170;
const PITCHER_SEASON_RANK_SECTION_SHIFT_Y = 10;
const PITCHER_SEASON_RANK_TITLE_OFFSET_Y = 40;
/** drawShorts5BattingSlide: tableTitleY − sectionBgY (= 44−60 − (−70)) */
const BATTING_LOWER_SECTION_TITLE_GAP_Y = 54;
const PITCHER_SEASON_RANK_TITLE_TO_BADGE_Y = 64;
const PITCHER_MVP_DATE_LINE_COLOR = "#FFE87C";
const PITCHER_SEASON_RANK_BADGE_H = 44;
const PITCHER_SEASON_RANK_BADGE_FONT_PX = 30;
const PITCHER_SEASON_RANK_BADGE_PAD_X = 18;
const PITCHER_SEASON_RANK_BADGE_GAP = 12;
const PITCHER_SEASON_RANK_BADGE_RADIUS = 22;
const PITCHER_RELIEF_TITLE_FONT_PX = 44;
/** 2줄 레이아웃용 행 높이 (이전 116 × 1.6) */
const PITCHER_RELIEF_ROW_H = 186;
const PITCHER_RELIEF_NAME_FONT_PX = 40;
const PITCHER_RELIEF_DATE_FONT_PX = 34;
const PITCHER_RELIEF_STATS_FONT_PX = 34;
const PITCHER_RELIEF_ROW_PAD_TOP = 26;
const PITCHER_RELIEF_LINE1_LINE2_GAP = 14;
const PITCHER_RELIEF_ROW_BOX_INSET = 8;
/** 주간 불펜 타이틀 → 첫 선수 행 */
const PITCHER_RELIEF_TITLE_TO_FIRST_ROW_Y = 58;
/** 불펜 선수 행 사이 추가 간격 */
const PITCHER_RELIEF_ROW_GAP_Y = 6;
const PITCHER_RELIEF_BADGE_WIN = "#22c55e";
const PITCHER_RELIEF_BADGE_HOLD = "#3b82f6";
const PITCHER_RELIEF_BADGE_SAVE = "#eab308";
const PITCHER_SEASON_RANK_BADGE_WIN = "#FFD700";
/** drawShorts5BattingSlide 하단 경기별 기록표 블록 (위로 이동 시 음수) */
const BATTING_GAME_TABLE_SHIFT_Y = -30;
/** 타이틀 행(로고+텍스트)만 위로 (흰 구분선과 겹침 방지) */
const MVP_TITLE_ROW_SHIFT_Y = -20;
/** 하단 경기별 기록 섹션 배경 fillRect 시작 Y (위로 이동 시 음수) */
const BATTING_SECTION_BG_SHIFT_Y = -40;
const MVP_BAR_W_FRAC = 0.9;
const MVP_BAR_H = 120;
const MVP_BAR_GAP = 18;
const MVP_BAR_MIN_SEG_W = 50;
const MVP_BAR_COLORS = ["#E53935", "#1E88E5", "#43A047"];
const MVP_BAR_LABELS = ["타율", "OPS", "WAR"];
const MVP_BAR_BG = "rgba(0,0,0,0.3)";
const MVP_SUMMARY_GAP = 10;
const MVP_SUMMARY_FONT_PX = 26;
const MVP_SUMMARY_BLOCK_H = MVP_SUMMARY_GAP + MVP_SUMMARY_FONT_PX + 6;
const MVP_BASE_AVG = 0.4;
const MVP_BASE_OPS = 1.2;
const MVP_BASE_WAR = 6.0;

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

function drawBattingHeaderLogo(ctx, left, centerY, maxW, teamName, logoImg, boxH = MVP_LOGO_HEADER_H) {
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

function measureBattingTitleLogoWidth(logoImg, maxW, boxH) {
  if (!logoImg || !(logoImg.width > 0)) return boxH;
  const iw = Number(logoImg.naturalWidth || logoImg.width) || maxW;
  const ih = Number(logoImg.naturalHeight || logoImg.height) || boxH;
  let scale = boxH / ih;
  let dw = iw * scale;
  if (dw > maxW) {
    scale = maxW / iw;
    dw = iw * scale;
  }
  return dw;
}

/** 팀 로고 + "주간 타격 MVP" + 선수명 — w/2 기준 가운데 정렬 */
function drawBattingMvpTitleRow(
  ctx,
  w,
  centerY,
  teamName,
  playerName,
  logoImg,
  titleLabel = MVP_TITLE_LABEL,
  showPlayerName = true
) {
  const maxLogoW = MVP_TITLE_LOGO_MAX_W;
  const gapLogoText = 16;
  const gapLabelName = 14;
  const name = String(playerName || "").trim() || "—";
  const label = titleLabel;
  const logoW = measureBattingTitleLogoWidth(logoImg, maxLogoW, MVP_TITLE_LOGO_H);

  ctx.save();
  ctx.font = `800 ${MVP_TITLE_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  const labelW = ctx.measureText(label).width;
  const nameW = showPlayerName ? ctx.measureText(name).width : 0;
  const totalW =
    logoW + gapLogoText + labelW + (showPlayerName ? gapLabelName + nameW : 0);
  const left = w / 2 - totalW / 2;

  const drawnLogoW = drawBattingHeaderLogo(
    ctx,
    left,
    centerY,
    maxLogoW,
    teamName,
    logoImg,
    MVP_TITLE_LOGO_H
  );
  const textX = left + drawnLogoW + gapLogoText;

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  shadowTextSoft(ctx);
  ctx.fillText(label, textX, centerY);
  resetShadow(ctx);

  if (showPlayerName) {
    ctx.fillStyle = MVP_TITLE_PLAYER_COLOR;
    shadowTextSoft(ctx);
    ctx.fillText(name, textX + labelW + gapLabelName, centerY);
    resetShadow(ctx);
  }
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

function pickMvpWar(mvp, total) {
  const t = total && typeof total === "object" ? total : {};
  const raw = t.war ?? t.WAR ?? t.season_war ?? mvp?.season_war;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function fmtMvpWar(v) {
  if (v == null || !Number.isFinite(Number(v))) return "-";
  return Number(v).toFixed(2);
}

/** 쇼츠4 drawHotPlayerAvgOpsWarBar와 동일 3분할 (타율 / OPS / WAR) */
function mvpAvgOpsWarBarRatios(total, mvp) {
  const avg = Number(total?.avg);
  const ops = Number(total?.ops);
  const war = pickMvpWar(mvp, total);
  const w0 = Number.isFinite(avg) && avg >= 0 ? avg / MVP_BASE_AVG : 0;
  const w1 = Number.isFinite(ops) && ops >= 0 ? ops / MVP_BASE_OPS : 0;
  const w2 = war != null && war >= 0 ? war / MVP_BASE_WAR : 0;
  const s = w0 + w1 + w2;
  return s > 0 ? [w0, w1, w2] : [1, 1, 1];
}

function drawBattingMvpAvgOpsWarBar(ctx, wCanvas, topBelowStats, total, mvp) {
  const ratios = mvpAvgOpsWarBarRatios(total, mvp);
  const barW = Math.floor(wCanvas * MVP_BAR_W_FRAC);
  const barLeft = Math.floor((wCanvas - barW) / 2);
  if (barW < 120) return topBelowStats;

  const segWs = splitMvpBarSegmentWidths(barW, ratios);
  const barTop = topBelowStats + MVP_BAR_GAP;
  const warN = pickMvpWar(mvp, total);
  const valueStrs = [fmtRate3(total?.avg), fmtRate3(total?.ops), fmtMvpWar(warN)];
  const summaryLine = `타율 ${valueStrs[0]}  OPS ${valueStrs[1]}  WAR ${valueStrs[2]}`;

  ctx.save();
  ctx.beginPath();
  ctx.rect(barLeft, barTop, barW, MVP_BAR_H);
  ctx.clip();
  ctx.fillStyle = MVP_BAR_BG;
  ctx.fillRect(barLeft, barTop, barW, MVP_BAR_H);
  let x = barLeft;
  for (let i = 0; i < 3; i++) {
    const sw = segWs[i] || 0;
    if (sw > 0) {
      ctx.fillStyle = MVP_BAR_COLORS[i];
      ctx.fillRect(x, barTop, sw, MVP_BAR_H);
    }
    x += sw;
  }
  ctx.restore();

  x = barLeft;
  for (let i = 0; i < 3; i++) {
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
function drawBattingMvpUpperBlock(ctx, w, h, teamName, mvp, portrait, logosByTeamKey, step = 4) {
  const reveal = Math.max(1, Math.min(4, Number(step) || 4));
  const faceBox = MVP_FACE_BOX;
  const rPhoto = faceBox / 2;
  const padL = 48;
  const yShift = MVP_UPPER_BLOCK_SHIFT_Y;
  const upperDividerY = MVP_UPPER_DIVIDER_Y + yShift;
  const upperHeaderCy = upperDividerY - MVP_HEADER_GAP_LINE_TO_CENTER;
  const tk = teamKeyword(teamName);
  const teamLogoImg = tk && logosByTeamKey ? logosByTeamKey[tk] : null;
  const playerName = String(mvp?.player || "").trim();
  const usePhoto = Boolean(drawableShorts4Portrait(portrait));

  drawBattingMvpTitleRow(
    ctx,
    w,
    upperHeaderCy + MVP_TITLE_ROW_SHIFT_Y,
    teamName,
    playerName,
    teamLogoImg,
    MVP_TITLE_LABEL,
    reveal >= 2
  );
  drawBattingMvpHeaderDivider(ctx, w, padL, upperDividerY);

  if (reveal < 2) {
    return upperDividerY + rPhoto + MVP_DIVIDER_TO_FACE_TOP;
  }

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
  if (reveal >= 3) {
    return drawBattingMvpAvgOpsWarBar(ctx, w, contentBottom, mvp?.total, mvp);
  }
  return contentBottom;
}

function fmtBattingSlideDate(iso) {
  const raw = String(iso ?? "").trim();
  if (!raw) return "—";
  const slice = raw.slice(5, 10).replace("-", "/");
  if (!slice || !/^\d{1,2}\/\d{1,2}$/.test(slice)) return "—";
  return slice;
}

function fmtRate3(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const s = n.toFixed(3);
  return n < 1 ? `.${s.slice(2)}` : s;
}

function battingStatCellColor(hr, h) {
  if (Number(hr) > 0) return "#FF0000";
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
  let contentBottom = tableTop;
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

  const headerFontPx = 32;
  const headerCy = tableTop + 36;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 ${headerFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  const headers = ["날짜", "상대", "타수", "안타", "홈런", "타점"];
  let oppColStartX = colLeft[1] + colW[1] / 2;
  for (let i = 0; i < headers.length; i++) {
    const hx = colLeft[i] + colW[i] / 2;
    ctx.fillText(headers[i], hx, headerCy);
    if (headers[i] === "상대") {
      const tw = ctx.measureText(headers[i]).width;
      oppColStartX = hx - tw / 2;
    }
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
    ctx.font = `600 38px "${FONT_BODY}", sans-serif`;
    ctx.fillText("경기별 타격 기록 없음", w / 2, firstRowY + rowH);
    return firstRowY + rowH;
  }

  const logoSize = 44;
  const bodyFontPx = 36;
  const statFontPx = 41;

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
    let oppTextX = oppColStartX;
    if (oppLogo && oppLogo.width > 0) {
      const scale = Math.min(logoSize / oppLogo.width, logoSize / oppLogo.height);
      const dw = oppLogo.width * scale;
      const dh = oppLogo.height * scale;
      const lx = oppColStartX;
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
    contentBottom = rowTop + boxH;
  }
  return contentBottom;
}

/** slide3: 주간 MVP 타자 (@param assets `loadShorts5BattingSlideAssets` 결과 권장) */
export async function drawShorts5BattingSlide(
  ctx,
  w,
  h,
  data,
  assetsIn = null,
  teamKwOverride = "",
  step = 4
) {
  const reveal = Math.max(1, Math.min(4, Number(step) || 4));
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
  const sectionBgY = topDividerY + BATTING_SECTION_BG_SHIFT_Y;
  if (reveal >= 2) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, sectionBgY, w, h - sectionBgY);
  }

  if (!mvp?.player) {
    if (reveal >= 1) {
      drawBattingMvpUpperBlock(ctx, w, h, teamName, mvp, portrait, logosByTeamKey, reveal);
    }
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("주간 타자 기록 없음", w / 2, h / 2);
    primeShorts5BattingAssets(data, teamKwOverride);
    return;
  }

  const avgBarBottom = drawBattingMvpUpperBlock(
    ctx,
    w,
    h,
    teamName,
    mvp,
    portrait,
    logosByTeamKey,
    reveal
  );

  if (reveal >= 3) {
    drawBattingSeasonRankSection(
      ctx,
      w,
      avgBarBottom + PITCHER_SEASON_RANK_SECTION_SHIFT_Y,
      mvp?.season?.ranks
    );
  }

  if (reveal >= 4) {
    const tableTitleY = topDividerY + 44 + BATTING_GAME_TABLE_SHIFT_Y;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `800 40px "${FONT_BODY}", sans-serif`;
    ctx.fillText("경기별 기록", w / 2, tableTitleY);

    drawBattingGameTable(
      ctx,
      w,
      h,
      mvp.games,
      logosByTeamKey,
      tableTitleY + 36
    );
  }

  primeShorts5BattingAssets(data, teamKwOverride);
}

const __shorts5PitcherAssetsCache = new Map();

function pitcherAssetsCacheKey(data) {
  const mvp = data?.mvp_starter_pitcher;
  const tk = teamKeyword(data?.team_name || data?.team_keyword || "");
  return `p|${tk}|${String(mvp?.player || "").trim()}`;
}

function resolvePitcherPortraitTeamKey(data, teamKwOverride = "") {
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
  const fromMvpTeam = String(data?.mvp_starter_pitcher?.team || "").trim();
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

export async function loadShorts5PitcherPortrait(data, teamKwOverride = "") {
  const mvp = data?.mvp_starter_pitcher;
  const tk = resolvePitcherPortraitTeamKey(data, teamKwOverride);
  const player = String(mvp?.player || mvp?.name || "").trim();
  const url = String(mvp?.player_image_url || mvp?.image_url || "").trim();

  const defImg = await loadDefaultPlayerImage();
  let loaded = null;
  if (url) {
    loaded = await loadPlayerImageFromNaverProxy(url);
  } else if (player && tk) {
    loaded = await loadPlayerImage(tk, player);
  }
  return drawableShorts4Portrait(loaded)
    ? loaded
    : drawableShorts4Portrait(defImg)
      ? defImg
      : loaded ?? defImg;
}

export async function loadShorts5PitcherSlideAssets(data) {
  const mvp = data?.mvp_starter_pitcher;
  const tk = resolvePitcherPortraitTeamKey(data);
  const logosByTeamKey = {};
  if (tk) logosByTeamKey[tk] = await loadSvgLogo(tk);
  const opp = teamKeyword(mvp?.game?.opponent || "");
  if (opp && !logosByTeamKey[opp]) logosByTeamKey[opp] = await loadSvgLogo(opp);
  return { logosByTeamKey };
}

function primeShorts5PitcherAssets(data, teamKwOverride = "") {
  const key = pitcherAssetsCacheKey(data);
  if (__shorts5PitcherAssetsCache.has(key)) return __shorts5PitcherAssetsCache.get(key);
  const p = Promise.all([
    loadShorts5PitcherSlideAssets(data),
    loadShorts5PitcherPortrait(data, teamKwOverride),
  ]).then(([logosPack, portrait]) => {
    const assets = { ...logosPack, portrait };
    __shorts5PitcherAssetsCache.set(key, assets);
    return assets;
  });
  __shorts5PitcherAssetsCache.set(key, p);
  return p;
}

function fmtPitcherEra(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toFixed(2);
}

function fmtPitcherIp(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return n % 1 === 0 ? String(n) : n.toFixed(1);
  const s = String(v).trim();
  return s || "—";
}

/** MM월DD일 vs 상대 (홈/원정) */
function fmtPitcherGameDateLine(game) {
  const g = game && typeof game === "object" ? game : {};
  const raw = String(g.game_date || "").trim();
  if (!raw) return "";
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return "";
  const mm = String(m[2]).padStart(2, "0");
  const dd = String(m[3]).padStart(2, "0");
  const opp = fmtTeamShort(g.opponent || "—");
  const homeMark = g.is_home ? "홈" : "원정";
  return `${mm}월${dd}일 vs ${opp} (${homeMark})`;
}

function fmtPitcherGameResult(result) {
  const r = String(result ?? "").trim();
  if (r === "승" || r === "패" || r === "무") return r;
  if (r === "win") return "승";
  if (r === "loss") return "패";
  if (r === "draw") return "무";
  return r || "—";
}

function pitcherIpToNumber(ip) {
  const n = Number(ip);
  if (Number.isFinite(n)) return n;
  const s = String(ip ?? "").trim();
  const m = s.match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return NaN;
  const whole = Number(m[1]);
  const frac = m[2] != null ? Number(m[2]) : 0;
  if (frac === 1) return whole + 1 / 3;
  if (frac === 2) return whole + 2 / 3;
  return whole;
}

function pitcherQsMet(ip, er) {
  const ipn = pitcherIpToNumber(ip);
  const ern = Number(er);
  return Number.isFinite(ipn) && ipn >= 6 && Number.isFinite(ern) && ern <= 3;
}

function fmtPitcherSeasonIpLabel(seasonIp) {
  const s = seasonIp != null ? String(seasonIp).trim() : "";
  return s ? s : "-";
}

function mvpPitcherGameStatLines(mvp) {
  const g = mvp?.game && typeof mvp.game === "object" ? mvp.game : {};
  const season = mvp?.season && typeof mvp.season === "object" ? mvp.season : {};
  const ip = fmtPitcherIp(g.ip);
  const er = g.er != null && g.er !== "" ? Number(g.er) : 0;
  const seasonIp = fmtPitcherSeasonIpLabel(season.ip);
  const wins = season.wins != null && season.wins !== "" ? Number(season.wins) : null;
  const losses = season.losses != null && season.losses !== "" ? Number(season.losses) : null;
  const wStr = Number.isFinite(wins) ? String(Math.round(wins)) : "-";
  const lStr = Number.isFinite(losses) ? String(Math.round(losses)) : "-";
  const eraStr = fmtPitcherEra(season.era);
  const line1 = fmtPitcherGameDateLine(g);
  const line2 = `시즌 ${wStr}승 ${lStr}패 (${eraStr})`;
  const line3 = pitcherQsMet(g.ip, er)
    ? `${ip}이닝 / 퀄스 (시즌 ${seasonIp})`
    : `${ip}이닝 (시즌 ${seasonIp})`;
  const line4 = `${er}자책점`;
  const dash = (s) => (String(s || "").trim() ? `- ${s}` : "-");
  return [
    { text: dash(line1), color: PITCHER_MVP_DATE_LINE_COLOR },
    { text: dash(line2), color: "#ffffff" },
    { text: dash(line3), color: "#ffffff" },
    { text: dash(line4), color: "#ffffff" },
  ];
}

function drawPitcherMvpStatBlock(ctx, statX, cy, mvp) {
  const lines = mvpPitcherGameStatLines(mvp);
  const gap = MVP_STAT_LINE_GAP;
  const totalH = (lines.length - 1) * gap;
  let y = cy - totalH / 2 + MVP_PITCHER_STAT_LINES_SHIFT_Y;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${MVP_STAT_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  for (const line of lines) {
    ctx.fillStyle = line.color || "#ffffff";
    shadowTextSoft(ctx);
    ctx.fillText(line.text, statX, y);
    resetShadow(ctx);
    y += gap;
  }
  const lastCenterY = cy + totalH / 2 + MVP_PITCHER_STAT_LINES_SHIFT_Y;
  return lastCenterY + MVP_STAT_FONT_PX / 2;
}

/** 상단 블록 하단 Y — 예전 컬러바 시작 위치 */
function drawPitcherMvpUpperBlock(ctx, w, h, teamName, mvp, portrait, logosByTeamKey, step = 4) {
  const reveal = Math.max(1, Math.min(4, Number(step) || 4));
  const faceBox = MVP_FACE_BOX;
  const rPhoto = faceBox / 2;
  const padL = 48;
  const yShift = MVP_UPPER_BLOCK_SHIFT_Y;
  const upperDividerY = MVP_UPPER_DIVIDER_Y + yShift;
  const upperHeaderCy = upperDividerY - MVP_HEADER_GAP_LINE_TO_CENTER;
  const tk = teamKeyword(teamName);
  const teamLogoImg = tk && logosByTeamKey ? logosByTeamKey[tk] : null;
  const playerName = String(mvp?.player || "").trim();
  const usePhoto = Boolean(drawableShorts4Portrait(portrait));
  const titleCy = upperHeaderCy + MVP_TITLE_ROW_SHIFT_Y;

  drawBattingMvpTitleRow(
    ctx,
    w,
    titleCy,
    teamName,
    playerName,
    teamLogoImg,
    MVP_TITLE_LABEL_PITCHER,
    reveal >= 2
  );

  drawBattingMvpHeaderDivider(ctx, w, padL, upperDividerY);

  if (reveal < 2) {
    return upperDividerY + rPhoto + MVP_DIVIDER_TO_FACE_TOP + MVP_BAR_GAP;
  }

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
  const upperStatBottom = drawPitcherMvpStatBlock(
    ctx,
    upperStatX,
    upperCy + MVP_STAT_BLOCK_SHIFT_Y,
    mvp
  );
  const contentBottom = battingMvpContentBottom(upperStatBottom, upperCy);
  return contentBottom + MVP_BAR_GAP;
}

function fmtPitcherGameDetailCell(v) {
  if (v == null || v === "") return "-";
  const n = Number(v);
  if (Number.isFinite(n)) return String(n);
  const s = String(v).trim();
  return s || "-";
}

function pitcherGameWalks4(g) {
  const bb = g?.bb;
  const hbp = g?.hbp;
  const bbN = bb != null && bb !== "" ? Number(bb) : null;
  const hbpN = hbp != null && hbp !== "" ? Number(hbp) : null;
  if (bbN != null && Number.isFinite(bbN) && hbpN != null && Number.isFinite(hbpN)) {
    return bbN + hbpN;
  }
  if (bbN != null && Number.isFinite(bbN)) return bbN;
  if (hbpN != null && Number.isFinite(hbpN)) return hbpN;
  return null;
}

const BATTING_SEASON_RANK_BADGE_BLUE = "rgba(37, 99, 235, 0.72)";
const BATTING_SEASON_RANK_BADGE_RED = "rgba(220, 38, 38, 0.72)";
const BATTING_SEASON_RANK_BADGE_GOLD = "rgba(202, 138, 4, 0.82)";
/** 시즌 순위 배지: 20위 이내만 표시 */
const SEASON_RANK_BADGE_MAX = 20;

function seasonRankBadgeRank(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 && x <= SEASON_RANK_BADGE_MAX ? x : null;
}

function battingSeasonRankBadgeItems(ranks) {
  const r = ranks && typeof ranks === "object" ? ranks : {};
  const n = (v) => seasonRankBadgeRank(v);
  const items = [];
  const avg = n(r.avg);
  const hit = n(r.hit);
  const hr = n(r.hr);
  const rbi = n(r.rbi);
  const ops = n(r.ops);
  const war = n(r.war);
  if (avg != null) items.push({ text: `타율 ${avg}위`, bg: BATTING_SEASON_RANK_BADGE_BLUE });
  if (hit != null) items.push({ text: `안타 ${hit}위`, bg: BATTING_SEASON_RANK_BADGE_BLUE });
  if (hr != null) items.push({ text: `홈런 ${hr}위`, bg: BATTING_SEASON_RANK_BADGE_RED });
  if (rbi != null) items.push({ text: `타점 ${rbi}위`, bg: BATTING_SEASON_RANK_BADGE_RED });
  if (ops != null) items.push({ text: `OPS ${ops}위`, bg: BATTING_SEASON_RANK_BADGE_GOLD });
  if (war != null) items.push({ text: `WAR ${war}위`, bg: BATTING_SEASON_RANK_BADGE_GOLD });
  return items;
}

function drawSeasonRankBadgeSection(ctx, w, topY, badges) {
  if (!badges.length) return topY;

  const titleY = topY + PITCHER_SEASON_RANK_TITLE_OFFSET_Y;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `800 ${PITCHER_SEASON_RANK_TITLE_FONT_PX}px "${FONT_BODY}", sans-serif`;
  ctx.fillText("시즌 순위", w / 2, titleY);

  const rowCy = titleY + PITCHER_SEASON_RANK_TITLE_TO_BADGE_Y;
  const badgeH = PITCHER_SEASON_RANK_BADGE_H;
  const padX = PITCHER_SEASON_RANK_BADGE_PAD_X;
  const gap = PITCHER_SEASON_RANK_BADGE_GAP;
  ctx.font = `700 ${PITCHER_SEASON_RANK_BADGE_FONT_PX}px "${FONT_BODY}", sans-serif`;
  const widths = badges.map((b) => ctx.measureText(b.text).width + padX * 2);
  const totalW = widths.reduce((a, x) => a + x, 0) + gap * (badges.length - 1);
  let x = (w - totalW) / 2;
  for (let i = 0; i < badges.length; i++) {
    const bw = widths[i];
    ctx.fillStyle = badges[i].bg;
    ctx.beginPath();
    ctx.roundRect(x, rowCy - badgeH / 2, bw, badgeH, PITCHER_SEASON_RANK_BADGE_RADIUS);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    shadowTextSoft(ctx);
    ctx.fillText(badges[i].text, x + bw / 2, rowCy);
    resetShadow(ctx);
    x += bw + gap;
  }
  return rowCy + badgeH / 2 + 16;
}

function drawBattingSeasonRankSection(ctx, w, topY, ranks) {
  return drawSeasonRankBadgeSection(ctx, w, topY, battingSeasonRankBadgeItems(ranks));
}

function pitcherSeasonRankBadgeItems(ranks) {
  const r = ranks && typeof ranks === "object" ? ranks : {};
  const n = (v) => seasonRankBadgeRank(v);
  const items = [];
  const win = n(r.win);
  const era = n(r.era);
  const whip = n(r.whip);
  const ip = n(r.ip);
  if (win != null) items.push({ text: `승 ${win}위`, bg: PITCHER_SEASON_RANK_BADGE_WIN });
  if (era != null) items.push({ text: `ERA ${era}위`, bg: "rgba(37, 99, 235, 0.72)" });
  if (whip != null) items.push({ text: `WHIP ${whip}위`, bg: "rgba(37, 99, 235, 0.72)" });
  if (ip != null) items.push({ text: `이닝 ${ip}위`, bg: "rgba(22, 163, 74, 0.72)" });
  return items;
}

function drawPitcherSeasonRankSection(ctx, w, topY, ranks) {
  return drawSeasonRankBadgeSection(ctx, w, topY, pitcherSeasonRankBadgeItems(ranks));
}

function drawPitcherGameDetailSection(ctx, w, topY, game, seasonRanks, includeSeasonRanks = true) {
  const g = game && typeof game === "object" ? game : {};
  console.log("[shorts5] pitcher game full:", JSON.stringify(game));
  const dateStr = fmtBattingSlideDate(g.game_date);
  const opp = fmtTeamShort(g.opponent || "—");
  const homeMark = g.is_home ? "홈" : "원정";
  const result = String(g.result || "—").trim() || "—";
  const titleY = topY + 8 + PITCHER_GAME_TABLE_AT_BAR_SHIFT_Y;

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `800 ${PITCHER_GAME_DETAIL_TITLE_FONT_PX}px "${FONT_BODY}", sans-serif`;
  ctx.fillText(`등판 기록: ${dateStr} vs ${opp} (${homeMark}) ${result}`, w / 2, titleY);

  const cols = [
    { label: "이닝", val: fmtPitcherGameDetailCell(g.ip != null ? fmtPitcherIp(g.ip) : null) },
    { label: "피안타", val: fmtPitcherGameDetailCell(g.h) },
    { label: "실점", val: fmtPitcherGameDetailCell(g.runs) },
    { label: "자책", val: fmtPitcherGameDetailCell(g.er) },
    { label: "4사구", val: fmtPitcherGameDetailCell(pitcherGameWalks4(g)) },
    { label: "삼진", val: fmtPitcherGameDetailCell(g.so) },
    { label: "피홈런", val: fmtPitcherGameDetailCell(g.hr) },
    {
      label: "투구수",
      val: fmtPitcherGameDetailCell(
        g.pitch_count != null && g.pitch_count !== "" ? g.pitch_count : g.bf
      ),
    },
  ];

  const labelY = titleY + 52 + PITCHER_GAME_TABLE_SHIFT_Y;
  const valueY = labelY + 40;
  const padX = 40;
  const innerW = w - padX * 2;
  const colW = innerW / cols.length;
  const headerTop = labelY - PITCHER_GAME_TABLE_HEADER_H / 2;
  for (let i = 0; i < cols.length; i++) {
    const colLeft = padX + colW * i;
    ctx.fillStyle = PITCHER_GAME_HEADER_BG;
    ctx.fillRect(colLeft, headerTop, colW, PITCHER_GAME_TABLE_HEADER_H);
  }
  ctx.font = `700 26px "${FONT_BODY}", sans-serif`;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < cols.length; i++) {
    const cx = padX + colW * i + colW / 2;
    shadowTextSoft(ctx);
    ctx.fillText(cols[i].label, cx, labelY);
    resetShadow(ctx);
  }
  ctx.font = `800 ${PITCHER_GAME_TABLE_VALUE_FONT_PX}px "${FONT_BODY}", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  for (let i = 0; i < cols.length; i++) {
    const cx = padX + colW * i + colW / 2;
    ctx.fillText(cols[i].val, cx, valueY);
  }
  let bottomY = valueY + 36 + PITCHER_SEASON_RANK_SECTION_SHIFT_Y;
  if (includeSeasonRanks) {
    bottomY = drawPitcherSeasonRankSection(ctx, w, bottomY, seasonRanks);
  }
  return bottomY;
}

function drawPitcherReliefSection(ctx, w, reliefTitleY, reliefList) {
  const list = Array.isArray(reliefList) ? reliefList.slice(0, 3) : [];
  const titleY = reliefTitleY;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `800 ${PITCHER_RELIEF_TITLE_FONT_PX}px "${FONT_BODY}", sans-serif`;
  ctx.fillText("주간 불펜", w / 2, titleY);

  const rowH = PITCHER_RELIEF_ROW_H;
  const padX = 56;
  const innerPad = 24;
  let y = titleY + PITCHER_RELIEF_TITLE_TO_FIRST_ROW_Y;

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const name = String(r?.player || "—").trim() || "—";
    const ip = fmtPitcherIp(r?.ip);
    const erN = Number(r?.er);
    const erStr = Number.isFinite(erN) ? erN : 0;
    const hN = Number(r?.h);
    const soN = Number(r?.so);
    const hStr = Number.isFinite(hN) ? hN : 0;
    const soStr = Number.isFinite(soN) ? soN : 0;
    const dateVs = `${fmtBattingSlideDate(r?.game_date)} vs ${fmtTeamShort(r?.opponent || "—")}`;

    const rowTop = y;
    const boxH = rowH - PITCHER_RELIEF_ROW_BOX_INSET * 2;
    const contentTop = rowTop + PITCHER_RELIEF_ROW_PAD_TOP;
    const line1Cy = contentTop + Math.round(PITCHER_RELIEF_NAME_FONT_PX * 0.52);
    const line2Y = contentTop + PITCHER_RELIEF_NAME_FONT_PX + PITCHER_RELIEF_LINE1_LINE2_GAP + 5;

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(padX, rowTop + PITCHER_RELIEF_ROW_BOX_INSET, w - padX * 2, boxH, 16);
    ctx.fill();

    // 1줄: 이름 + 승/홀/세 배지 | 우측 날짜
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${PITCHER_RELIEF_NAME_FONT_PX}px "${FONT_BODY}", sans-serif`;
    let bx = padX + innerPad;
    ctx.fillText(name, bx, line1Cy);
    bx += ctx.measureText(name).width + 10;
    if (r?.has_win) {
      bx += drawRecordPitcherBadge(ctx, bx, line1Cy, "승", PITCHER_RELIEF_BADGE_WIN);
    }
    if (r?.has_hold) {
      bx += drawRecordPitcherBadge(ctx, bx, line1Cy, "홀", PITCHER_RELIEF_BADGE_HOLD);
    }
    if (r?.has_save) {
      bx += drawRecordPitcherBadge(ctx, bx, line1Cy, "세", PITCHER_RELIEF_BADGE_SAVE);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `700 ${PITCHER_RELIEF_DATE_FONT_PX}px "${FONT_BODY}", sans-serif`;
    ctx.fillText(dateVs, w - padX - innerPad, line1Cy);

    // 2줄: 이닝 / 자책 / 피안타 / 삼진
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `600 ${PITCHER_RELIEF_STATS_FONT_PX}px "${FONT_BODY}", sans-serif`;
    ctx.fillText(
      `${ip}이닝 / 자책 ${erStr} / 피안타 ${hStr} / 삼진 ${soStr}`,
      padX + innerPad,
      line2Y
    );

    y += rowH;
    if (i < list.length - 1) y += PITCHER_RELIEF_ROW_GAP_Y;
  }
  ctx.textBaseline = "middle";
  return y;
}

/** slide4: 주간 투수 MVP + 불펜 TOP3 */
export async function drawShorts5PitcherSlide(
  ctx,
  w,
  h,
  data,
  assetsIn = null,
  teamKwOverride = "",
  step = 4
) {
  const reveal = Math.max(1, Math.min(4, Number(step) || 4));
  const mvp = data?.mvp_starter_pitcher;
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";

  let assets = assetsIn;
  if (!assets) {
    const key = pitcherAssetsCacheKey(data);
    const cached = __shorts5PitcherAssetsCache.get(key);
    if (cached && typeof cached.then === "function") assets = await cached;
    else if (cached) assets = cached;
    else {
      const [logosPack, portraitImg] = await Promise.all([
        loadShorts5PitcherSlideAssets(data),
        loadShorts5PitcherPortrait(data, teamKwOverride),
      ]);
      assets = { ...logosPack, portrait: portraitImg };
    }
  }

  let portrait = drawableShorts4Portrait(assets?.portrait);
  if (!portrait && mvp?.player) {
    portrait = drawableShorts4Portrait(
      await loadShorts5PitcherPortrait(data, teamKwOverride)
    );
  }
  const logosByTeamKey = assets?.logosByTeamKey || {};

  ctx.clearRect(0, 0, w, h);
  const [accentBg] = teamGrad(teamName);
  ctx.fillStyle = accentBg || "#131922";
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  const topDividerY = Math.round(h * 0.52);
  const sectionBgY = topDividerY + BATTING_SECTION_BG_SHIFT_Y + PITCHER_SECTION_BG_SHIFT_Y;
  if (reveal >= 2) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, sectionBgY, w, h - sectionBgY);
  }

  const padL = 48;

  if (!mvp?.player) {
    if (reveal >= 1) {
      drawPitcherMvpUpperBlock(ctx, w, h, teamName, mvp, portrait, logosByTeamKey, reveal);
    }
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("주간 투수 기록 없음", w / 2, h / 2);
    primeShorts5PitcherAssets(data, teamKwOverride);
    return;
  }

  const gameTableTopY = drawPitcherMvpUpperBlock(
    ctx,
    w,
    h,
    teamName,
    mvp,
    portrait,
    logosByTeamKey,
    reveal
  );

  if (reveal >= 3) {
    const gameSectionStartY = gameTableTopY + PITCHER_GAME_SECTION_SHIFT_Y;
    drawBattingMvpHeaderDivider(
      ctx,
      w,
      padL,
      gameSectionStartY - PITCHER_GAME_SECTION_DIVIDER_GAP - PITCHER_GAME_SECTION_DIVIDER_SHIFT_Y
    );

    if (mvp.game) {
      drawPitcherGameDetailSection(
        ctx,
        w,
        gameSectionStartY,
        mvp.game,
        mvp.season?.ranks,
        true
      );
    }
  }

  if (reveal >= 4) {
    const reliefTitleY = sectionBgY + BATTING_LOWER_SECTION_TITLE_GAP_Y;
    drawPitcherReliefSection(ctx, w, reliefTitleY, data?.relief_top_pitchers);
  }

  primeShorts5PitcherAssets(data, teamKwOverride);
}

/**
 * slide5: 이번주 경기 일정
 * @param {Record<string, HTMLImageElement | null | undefined> | null | undefined} [logosByTeamKey]
 */
export function drawShorts5GamesSlide(
  ctx,
  w,
  h,
  data,
  logoImg,
  logosByTeamKey = null,
  step = 3
) {
  const reveal = Math.max(1, Math.min(3, Number(step) || 3));
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";
  const scheduleGames = Array.isArray(data?.schedule_games)
    ? data.schedule_games.slice(0, 7)
    : [];

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getTeamStrongColor(teamName);
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
  ctx.fillText("이번주 경기일정", summaryCenterX, titleCy);
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
  const weekRangeStr = fmtWeekRangeMd(
    data?.this_week_start ?? data?.schedule_week_start,
    data?.this_week_end ?? data?.schedule_week_end
  );
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `700 ${summaryFontPx}px ${RECORD_FONT}`;
  ctx.fillText(weekRangeStr || "—", summaryCenterX, summaryCy);

  if (reveal < 2) return;

  const tableTop = summaryCy + summaryFontPx / 2 + 40;
  const headerDividerAnchorY = tableTop + 20 + 40;
  const headerLineY = headerDividerAnchorY + 12;
  const headerTextCy = tableTop + (headerLineY - tableTop) / 2;
  const line1H = 100;
  const line2H = 100;
  const rowH = line1H + line2H + 6;
  const maxRows = 7;
  const { left: colLeft, width: colW, datePadLeft } = scheduleTableLayout(w);
  const cellPad = 10;
  const oppLogoSize = 65;
  const headerFontPx = 36;
  const bodyFontPx = 38;
  const oppNameFontPx = 40;

  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.font = `700 ${headerFontPx}px ${RECORD_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("날짜", datePadLeft, headerTextCy);
  ctx.fillText("상대팀", colLeft[2] + cellPad, headerTextCy);
  ctx.fillText("경기장", colLeft[3] + cellPad, headerTextCy);
  ctx.beginPath();
  ctx.moveTo(64, headerLineY);
  ctx.lineTo(w - 64, headerLineY);
  ctx.stroke();

  const firstRowY = headerDividerAnchorY + 52 + 60 - 30;
  const emptyRowCount =
    scheduleGames.length > 0 ? Math.min(scheduleGames.length, maxRows) : maxRows;

  const drawGamesEmptyRowBands = (rowIndex) => {
    const y = firstRowY + rowIndex * rowH;
    const rowBoxTop = y - 42;
    const line1Top = rowBoxTop;
    const line2Top = rowBoxTop + line1H;
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.beginPath();
    ctx.roundRect(64, line1Top, w - 128, line1H, [12, 12, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.24)";
    ctx.beginPath();
    ctx.roundRect(64, line2Top, w - 128, line2H, [0, 0, 12, 12]);
    ctx.fill();
  };

  if (reveal === 2) {
    for (let i = 0; i < emptyRowCount; i++) drawGamesEmptyRowBands(i);
    return;
  }

  if (reveal < 3) return;

  if (!scheduleGames.length) {
    const emptyCy = firstRowY + (maxRows * rowH) / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = `700 44px ${RECORD_FONT}`;
    ctx.fillText("이번주 경기 없음", w / 2, emptyCy);
    return;
  }

  for (let i = 0; i < scheduleGames.length; i++) {
    const g = scheduleGames[i];
    const y = firstRowY + i * rowH;
    const rowBoxTop = y - 42;
    const rowBoxH = rowH - 6;
    const line1Top = rowBoxTop;
    const line2Top = rowBoxTop + line1H;
    const line1Cy = line1Top + line1H / 2;
    const line2Cy = line2Top + line2H / 2;

    drawGamesEmptyRowBands(i);

    const dateStr = fmtWeekStartMd(g.game_date) || "—";
    const timeLabel = String(g.game_time || "").trim();
    const homeMark = g.is_home ? "홈" : "원정";
    const oppFull = String(g.opponent ?? "").trim();
    const opp = fmtTeamShort(oppFull);
    const venueLabel = String(g.venue || "—").trim() || "—";
    const oppTk = teamKeyword(oppFull || opp);
    const oppLogo = oppTk && logosByTeamKey ? logosByTeamKey[oppTk] : null;

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${bodyFontPx}px ${RECORD_FONT}`;
    ctx.fillText(dateStr, datePadLeft, line1Cy);

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

    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `600 ${bodyFontPx}px ${RECORD_FONT}`;
    const venueMaxW = colLeft[3] + colW[3] - cellPad - (colLeft[3] + cellPad);
    ctx.fillText(
      truncateTextToWidth(ctx, venueLabel, Math.max(80, venueMaxW)),
      colLeft[3] + cellPad,
      line1Cy
    );

    if (timeLabel) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `600 ${bodyFontPx}px ${RECORD_FONT}`;
      ctx.fillText(timeLabel.slice(0, 5), datePadLeft, line2Cy);
    }
  }
}

/** slide6: KBO 순위표 — drawStandingsSlide 위임용 메타만 (패널에서 drawStandingsSlide 호출) */
export function shorts5StandingsDateLabel(data) {
  return String(data?.week_end || data?.week_start || "").slice(0, 10);
}
