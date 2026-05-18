/**
 * 쇼츠5 — 팀별 주간결산 슬라이드 (쇼츠1~4 미수정)
 */
import { drawBaseballBackground } from "./shortsBaseballDecor.js";
import { teamKeyword } from "./shorts1IntroStandingsDraw.js";

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

function getTeamStrongColor(teamName) {
  const kw = teamKeyword(teamName);
  return (kw && TEAM_STRONG_COLOR[kw]) || "#131922";
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

/** 순위 셀: N위 ▲M / N위 ▼M / N위 - */
function formatPerGameRankCell(prevRank, rankAfter) {
  const cur = rankAfter != null ? Number(rankAfter) : null;
  const prev = prevRank != null ? Number(prevRank) : null;
  if (cur == null || !Number.isFinite(cur)) return { text: "", color: null };
  if (prev == null || !Number.isFinite(prev)) {
    return { text: `${cur}위 -`, color: "#94a3b8" };
  }
  const diff = prev - cur;
  if (diff > 0) return { text: `${cur}위 ▲${diff}`, color: "#4ade80" };
  if (diff < 0) return { text: `${cur}위 ▼${Math.abs(diff)}`, color: "#f87171" };
  return { text: `${cur}위 -`, color: "#94a3b8" };
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
  const ratios = [0.17, 0.1, 0.25, 0.13, 0.15, 0.1];
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
  const fontFamily = `"${FONT_TITLE}", system-ui, sans-serif`;
  ctx.font = `900 ${fontPx}px ${fontFamily}`;
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
  const fontFamily = `"${FONT_TITLE}", system-ui, sans-serif`;
  ctx.font = `900 ${fontPx}px ${fontFamily}`;
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

function drawRecordRowLine2(ctx, line2Left, line2Right, cy, game) {
  const fontFamily = `"${FONT_BODY}", system-ui, sans-serif`;
  const fontPx = 28;
  const ourS = String(game?.our_starter ?? "").trim();
  const oppS = String(game?.opp_starter ?? "").trim();
  const winP = String(game?.win_pitcher ?? "").trim();
  const loseP = String(game?.lose_pitcher ?? "").trim();

  const midX = line2Left + (line2Right - line2Left) * 0.48;
  const rightEdge = line2Right - 8;

  if (ourS || oppS) {
    const starterText = `선발 ${ourS || "—"} : ${oppS || "—"}`;
    ctx.textAlign = "left";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `600 ${fontPx}px ${fontFamily}`;
    ctx.fillText(
      truncateTextToWidth(ctx, starterText, Math.max(80, midX - line2Left - 12)),
      line2Left + 8,
      cy
    );
  }

  if (!winP && !loseP) return;

  let leftName = winP;
  let rightName = loseP;
  if (game?.result === "loss") {
    leftName = loseP || "";
    rightName = winP || "";
  } else if (game?.result === "win") {
    leftName = winP || "";
    rightName = loseP || "";
  }

  const gap = 6;
  ctx.textAlign = "left";
  ctx.font = `600 ${fontPx}px ${fontFamily}`;
  ctx.fillStyle = "#FFFFFF";

  const loseBadgeW = loseP ? 36 : 0;
  const colonW = leftName && rightName ? ctx.measureText(" : ").width : 0;
  const rightNameW = rightName ? ctx.measureText(rightName).width : 0;
  const leftNameW = leftName ? ctx.measureText(leftName).width : 0;
  const winBadgeW = winP ? 36 : 0;
  const totalW = winBadgeW + leftNameW + colonW + rightNameW + loseBadgeW + gap * 3;

  let x = rightEdge - totalW;
  if (x < midX + 8) x = midX + 8;

  if (winP) x += drawRecordPitcherBadge(ctx, x, cy, "승", "#4ade80");
  if (leftName) {
    const draw = truncateTextToWidth(ctx, leftName, Math.max(40, rightEdge - x - 80));
    ctx.fillText(draw, x, cy);
    x += ctx.measureText(draw).width;
  }
  if (leftName && rightName) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(" : ", x, cy);
    x += colonW;
    ctx.fillStyle = "#FFFFFF";
  }
  if (rightName) {
    const draw = truncateTextToWidth(ctx, rightName, Math.max(40, rightEdge - x - 50));
    ctx.fillText(draw, x, cy);
    x += ctx.measureText(draw).width;
  }
  if (loseP) drawRecordPitcherBadge(ctx, x + gap, cy, "패", "#f87171");
}

function fmtWeekRecordSummary(rec) {
  const wins = Number(rec?.wins) || 0;
  const losses = Number(rec?.losses) || 0;
  const draws = Number(rec?.draws) || 0;
  if (draws > 0) return `${wins}승 ${draws}무 ${losses}패`;
  return `${wins}승 ${losses}패`;
}


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
  const bg = getTeamStrongColor(team);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, "#0a0e14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const logoBox = 420;
  drawLogoInBox(ctx, (w - logoBox) / 2, h * 0.22, logoBox, logoBox, team, logoImg);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(data?.week_label || ""), w / 2, h * 0.58);
  resetShadow(ctx);

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 120px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText("주간결산", w / 2, h * 0.72);
  resetShadow(ctx);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `700 56px "${FONT_BODY}", sans-serif`;
  ctx.fillText(fmtTeamShort(team), w / 2, h * 0.86);
}

/**
 * slide2: 주간 경기결과 (쇼츠4 라인업 슬라이드 레이아웃 계열)
 * @param {Record<string, HTMLImageElement | null | undefined> | null | undefined} [logosByTeamKey] 상대팀 로고
 */
export function drawShorts5RecordSlide(ctx, w, h, data, logoImg, logosByTeamKey = null) {
  const teamName = String(data?.team_name || data?.team_keyword || "팀").trim() || "팀";
  const rec = data?.week_record || {};
  const games = Array.isArray(data?.games) ? data.games.slice(0, 6) : [];

  ctx.clearRect(0, 0, w, h);
  const [solidBg] = teamGrad(teamName);
  ctx.fillStyle = solidBg || "#131922";
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  const HEADER_Y_SHIFT = -50;
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
  const titleTextX = Math.max(LOGO_X + LOGO_BOX + 20, Math.round(w * 0.45));
  const lineStartX = LOGO_X + LOGO_BOX + 16;

  drawLogoInBox(ctx, LOGO_X, logoTop, LOGO_BOX, LOGO_BOX, teamName, logoImg);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 ${titleFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("주간 경기결과", titleTextX, titleCy);
  resetShadow(ctx);

  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(lineStartX, divY);
  ctx.lineTo(w * 0.95, divY);
  ctx.stroke();

  const tableTop = divY + 32 + 40;
  const headerDividerAnchorY = tableTop + 20 + 40;
  const headerLineY = headerDividerAnchorY + 12;
  const headerTextCy = tableTop + (headerLineY - tableTop) / 2;
  const line1H = 100;
  const line2H = 100;
  const rowH = line1H + line2H + 4;
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
  ctx.font = `700 ${headerFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText("날짜", datePadLeft, headerTextCy);
  ctx.fillText("홈/원정", colLeft[1] + cellPad, headerTextCy);
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
    ctx.font = `700 44px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillText("해당 주간 경기 없음", w / 2, emptyCy);
    lastRowBottom = firstRowY + rowH * 2;
    ctx.textAlign = "left";
  } else {
    let prevRankForDelta = weekPrevRank;
    for (let i = 0; i < maxRows; i++) {
      const y = firstRowY + i * rowH;
      const rowBoxTop = y - 42;
      const rowBoxH = rowH - 4;
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
      const rankCell = formatPerGameRankCell(prevRankForDelta, rankAfter);

      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `600 ${bodyFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
      ctx.fillText(dateStr, datePadLeft, rowDateCy);

      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.fillText(homeMark, colLeft[1] + cellPad, line1Cy);

      const oppCellX = colLeft[2] + cellPad;
      const logoOffset = drawSmallOpponentLogo(ctx, oppCellX, line1Cy, oppLogoSize, oppLogo);
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `700 ${oppNameFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
      const oppTextX = oppCellX + logoOffset;
      const oppMaxW = colLeft[2] + colW[2] - cellPad - oppTextX;
      ctx.fillText(truncateTextToWidth(ctx, opp, oppMaxW), oppTextX, line1Cy);

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `600 ${scoreFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
      ctx.fillText(score, colLeft[3] + cellPad, line1Cy);

      drawRecordResultBadge(ctx, colLeft[4] + cellPad, line1Cy, g.result);

      if (rankCell.text) {
        ctx.fillStyle = rankCell.color || "#94a3b8";
        ctx.font = `800 ${rankFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
        ctx.fillText(rankCell.text, colLeft[5] + cellPad, line1Cy);
      }

      drawRecordRowLine2(ctx, dateColEnd, w - 64, line2Cy, g);

      if (rankAfter != null) prevRankForDelta = rankAfter;
    }
  }

  const summaryY = lastRowBottom + 36;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 72px "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(fmtWeekRecordSummary(rec), w / 2, summaryY);
  resetShadow(ctx);
}

/** slide3: 타격 하이라이트 */
export function drawShorts5BattingSlide(ctx, w, h, data) {
  const b = data?.top_batter;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1a2840";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 72px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("타격 하이라이트", w / 2, 200);

  if (!b?.player) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText("주간 타자 기록 없음", w / 2, h / 2);
    return;
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 96px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(b.player), w / 2, h * 0.42);
  resetShadow(ctx);

  const hr = Number(b.hr) || 0;
  const hits = Number(b.h) || 0;
  const rbi = Number(b.rbi) || 0;
  const avg =
    b.avg != null && Number.isFinite(Number(b.avg))
      ? Number(b.avg).toFixed(3).replace(/^0/, "")
      : "—";

  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const statLine = hr > 0 ? `${hr}홈런  ${hits}안타  ${rbi}타점` : `${hits}안타  ${rbi}타점  타율 ${avg}`;
  ctx.fillText(statLine, w / 2, h * 0.58);
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
