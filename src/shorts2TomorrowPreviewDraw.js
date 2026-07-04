/**
 * 쇼츠2 내일경기 프리뷰 캔버스 — App.jsx 원본과 동일 본문 (분리만).
 */
import { drawBaseballBackground } from "./shortsBaseballDecor.js";
import { teamKeyword } from "./shorts1IntroStandingsDraw.js";

const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";
const TEXT_MAIN = "#ffffff";

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

function fmtTeamShort(team) {
  const t = String(team || "").trim();
  if (!t) return "—";
  return t.split(/\s+/)[0].slice(0, 6);
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

function teamBadgeLabel(teamName) {
  const kw = teamKeyword(teamName);
  const allowed = new Set([
    "NC",
    "KIA",
    "LG",
    "삼성",
    "KT",
    "SSG",
    "두산",
    "롯데",
    "한화",
    "키움",
  ]);
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

function drawImageContain(ctx, img, x, y, boxW, boxH) {
  const iw = Number(img?.width) || boxW;
  const ih = Number(img?.height) || boxH;
  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
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

export function drawTomorrowPreviewIntroSlide(ctx, w, h, date, logosByTeamKey, firstGame) {
  ctx.save();
  const DAY_COLORS = {
    0: "#0097A7", // Sun - 틸시안 (C)
    1: "#FF4081", // Mon - 유지
    2: "#FF4081", // Tue - 유지
    3: "#E65100", // Wed - 유지
    4: "#C62828", // Thu - 딥레드 밝게 (B)
    5: "#1B5E20", // Fri - 딥그린 밝게 (A)
    6: "#1565C0", // Sat - 블루 밝게 (A)
  };
  const ONE_MIN_COLOR = {
    0: "#FFD700", // Sun - 골드
    1: "#F4FF00", // Mon - 옐로
    2: "#F4FF00", // Tue - 옐로
    3: "#F4FF00", // Wed - 옐로
    4: "#00E5FF", // Thu - 유지
    5: "#FFD700", // Fri - 유지
    6: "#FF6B00", // Sat - 유지
  };
  const KBO_COLORS = {
    0: "#FF4081", // 일 - 핑크
    1: "#00E5FF", // 월 - 시안
    2: "#00E5FF", // 화 - 시안
    3: "#00E676", // 수 - 라임그린
    4: "#FFD700", // 목 - 골드
    5: "#FF4081", // 금 - 핑크
    6: "#69FF47", // 토 - 라임
  };
  const iso = String(date || "").slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).getDay() : 0;
  ctx.fillStyle = DAY_COLORS[day] || "#002B5B";
  ctx.fillRect(0, 0, w, h);

  drawBaseballBackground(ctx);

  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = KBO_COLORS[day] || "#FF4081";
  const kboText = "KBO";
  let kboSize = 520;
  ctx.font = `italic 900 ${kboSize}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  while (ctx.measureText(kboText).width > w * 0.96 && kboSize > 380) {
    kboSize -= 10;
    ctx.font = `italic 900 ${kboSize}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  }
  ctx.fillText(kboText, w / 2, Math.round(h * 0.27) - 50);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const dateY = Math.round(h * 0.38) + 70 + 50;
  const dateStr = fmtKoreanLongDate(date);
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 110px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillStyle = ONE_MIN_COLOR[day] || "#FFFFFF";
  ctx.fillText(dateStr, w / 2, dateY);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  const proY = Math.round(h * 0.52) + 50;
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 68px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText("프로야구", w / 2, proY);

  const proDivY = proY + 52;
  const proDivW = 420;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - proDivW / 2, proDivY);
  ctx.lineTo(w / 2 + proDivW / 2, proDivY);
  ctx.stroke();
  ctx.restore();

  const titleY = proY + 140;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  ctx.font = `900 128px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText("오늘경기 미리보기", w / 2, titleY);

  ctx.fillStyle = ONE_MIN_COLOR[day] || "#FFFFFF";
  ctx.font = `800 220px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  const oneMinY = titleY + 280;
  ctx.fillText("1분컷", w / 2, oneMinY);

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  const oneMinFontPx = 220;
  const oneMinDividerY = oneMinY + oneMinFontPx / 2 + 60;
  const oneMinDivW = 600;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - oneMinDivW / 2, oneMinDividerY);
  ctx.lineTo(w / 2 + oneMinDivW / 2, oneMinDividerY);
  ctx.stroke();

  ctx.restore();
}

/**
 * @param {Record<string, unknown> | null | undefined} drawOpts
 *  - starterBoxBg: 선발 박스 배경 (쇼츠4 등에서만 지정; 미지정 시 팀 배경 밝기 기반 기본값)
 *  - short4ExtraStats: true면 순위표 승률·팀 타율 줄 추가(쇼츠4 전용)
 *  - hideHomeAwayRecordLines: true면 홈/원정 연고지 전적 두 줄 미표시(쇼츠4 등)
 */
export function drawTomorrowPreviewGameSlide(
  ctx,
  w,
  h,
  date,
  g,
  logosByTeamKey,
  pageIndex = 5,
  drawOpts = null
) {
  const homeTeam = String(g?.home_team || "").trim();
  const awayTeam = String(g?.away_team || "").trim();
  const focusTeam = String(drawOpts?.focusTeam || "").trim();
  const isFocusAway = focusTeam && awayTeam.includes(focusTeam);
  // 기준팀 기준 좌우/상하 배치
  const leftTeam = isFocusAway ? awayTeam : homeTeam;
  const rightTeam = isFocusAway ? homeTeam : awayTeam;
  const leftImg = isFocusAway ? logosByTeamKey?.[teamKeyword(awayTeam)] : logosByTeamKey?.[teamKeyword(homeTeam)];
  const rightImg = isFocusAway ? logosByTeamKey?.[teamKeyword(homeTeam)] : logosByTeamKey?.[teamKeyword(awayTeam)];
  const leftRank = isFocusAway ? g?.away_rank : g?.home_rank;
  const rightRank = isFocusAway ? g?.home_rank : g?.away_rank;

  ctx.clearRect(0, 0, w, h);
  diagTeamGradient(ctx, w, h, leftTeam, rightTeam);
  drawBaseballBackground(ctx);

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 1000 78px "${FONT_TITLE}", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText("GAME PREVIEW", 60, 1040);
  ctx.restore();

  const dateText = fmtKoreanLongDate(date);
  const timeText = String(g?.game_time || g?.time || "").trim();
  const venueText = String(g?.venue || "").trim();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const topLine1 = `${dateText}${timeText ? `  ${timeText}` : ""}`;
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 65px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(topLine1, w / 2, 220);
  resetShadow(ctx);

  const logoSize = 220;
  const logoY = 430;
  const awayX = 270;
  const homeX = 810;

  const hk = teamKeyword(homeTeam);
  const ak = teamKeyword(awayTeam);
  const homeImg = logosByTeamKey?.[hk] || null;
  const awayImg = logosByTeamKey?.[ak] || null;

  const drawLogo = (img, x, y, teamName) => {
    if (img) drawImageContain(ctx, img, x - logoSize / 2, y - logoSize / 2, logoSize, logoSize);
    else drawTeamBadge(ctx, x, y, logoSize / 2, teamName);
  };

  drawLogo(leftImg, awayX, logoY, leftTeam);
  drawLogo(rightImg, homeX, logoY, rightTeam);

  ctx.font = `1000 90px "${FONT_TITLE}", system-ui, sans-serif`;
  ctx.fillStyle = "#FFD700";
  shadowTextSoft(ctx);
  ctx.fillText("VS", w / 2, logoY + 8);
  resetShadow(ctx);

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 54px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(leftTeam || "—", awayX, 602);
  ctx.fillText(rightTeam || "—", homeX, 602);

  const fmtRank = (r) => {
    if (!r || typeof r !== "object") return "—";
    const rank = r?.rank;
    const wins = r?.wins;
    const losses = r?.losses;
    const draws = r?.draws;
    if (!Number.isFinite(Number(rank))) return "—";
    const wv = Number.isFinite(Number(wins)) ? Number(wins) : null;
    const lv = Number.isFinite(Number(losses)) ? Number(losses) : null;
    const dv = Number.isFinite(Number(draws)) ? Number(draws) : null;
    if (wv == null || lv == null || dv == null) return `${Number(rank)}위`;
    return `${Number(rank)}위 (${wv}승 ${lv}패 ${dv}무)`;
  };
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 45px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(fmtRank(leftRank), awayX, 662);
  ctx.fillText(fmtRank(rightRank), homeX, 662);

  const seriesLen = Number(g?.series_length);
  const seriesNum = Number(g?.series_game_number);
  if (Number.isFinite(seriesLen) && seriesLen > 1 && Number.isFinite(seriesNum) && seriesNum > 0) {
    const leftWins = isFocusAway ? (g?.away_series_wins ?? 0) : (g?.home_series_wins ?? 0);
    const rightWins = isFocusAway ? (g?.home_series_wins ?? 0) : (g?.away_series_wins ?? 0);
    const seriesDraws = g?.home_series_draws ?? 0;
    const seriesLabel = `${seriesLen}연전 ${seriesNum}차전`;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 42px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillStyle = leftWins > rightWins ? "#FFD700" : "rgba(255,255,255,0.85)";
    ctx.fillText(`${leftWins}승`, awayX, 720);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `500 34px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillText(seriesLabel, w / 2, 720);
    ctx.fillStyle = rightWins > leftWins ? "#FFD700" : "rgba(255,255,255,0.85)";
    ctx.font = `700 42px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.fillText(`${rightWins}승`, homeX, 720);
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(70, 800);
  ctx.lineTo(w - 70, 800);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 40px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(venueText || "—", w - 80, 800 + 50);
  resetShadow(ctx);
  ctx.restore();

  const head = g?.head_to_head || null;
  const homeWins = Number.isFinite(Number(head?.home_wins)) ? Number(head.home_wins) : null;
  const awayWins = Number.isFinite(Number(head?.away_wins)) ? Number(head.away_wins) : null;
  const draws = Number.isFinite(Number(head?.draws)) ? Number(head.draws) : null;
  const h2hText =
    homeWins == null || awayWins == null || draws == null
      ? "시즌 상대전적 : —"
      : `시즌 상대전적 : ${homeTeam || "홈팀"}(홈팀기준) ${homeWins}승 ${draws}무 ${awayWins}패`;

  const asp = String(g?.away_starter || "").trim() || "미정";
  const hsp = String(g?.home_starter || "").trim() || "미정";
  const aEraNum = Number(g?.away_starter_era);
  const hEraNum = Number(g?.home_starter_era);
  const aEra = Number.isFinite(aEraNum) ? aEraNum.toFixed(2) : null;
  const hEra = Number.isFinite(hEraNum) ? hEraNum.toFixed(2) : null;
  const aspText = aEra ? `${asp}(${aEra})` : asp;
  const hspText = hEra ? `${hsp}(${hEra})` : hsp;
  const spText = `예상선발 : ${aspText} vs ${hspText}`;

  const fmtWdl = (rec) => {
    const wv = Number.isFinite(Number(rec?.win)) ? Number(rec.win) : 0;
    const dv = Number.isFinite(Number(rec?.draw)) ? Number(rec.draw) : 0;
    const lv = Number.isFinite(Number(rec?.lose)) ? Number(rec.lose) : 0;
    return `${wv}승 ${dv}무 ${lv}패`;
  };
  const homeLast5 = Array.isArray(g?.home_last5) ? g.home_last5.filter(Boolean).slice(0, 5) : [];
  const awayLast5 = Array.isArray(g?.away_last5) ? g.away_last5.filter(Boolean).slice(0, 5) : [];
  const homeLast5Disp = [...homeLast5].reverse();
  const awayLast5Disp = [...awayLast5].reverse();
  const homeRecText = `${homeTeam || "홈팀"}(홈경기) : ${fmtWdl(g?.home_record)}`;
  const awayRecText = `${awayTeam || "원정팀"}(원정경기) : ${fmtWdl(g?.away_record)}`;
  const homeLast5Text = `${homeTeam || "홈팀"} : ${homeLast5Disp.length ? homeLast5Disp.join("") : "—"}`;
  const awayLast5Text = `${awayTeam || "원정팀"} : ${awayLast5Disp.length ? awayLast5Disp.join("") : "—"}`;
  const last5Line = `${homeLast5Text}  |  ${awayLast5Text}`;

  const avgRgbFromHex = (hex) => {
    const h = String(hex || "").trim().replace("#", "");
    if (h.length !== 6) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    return (r + g + b) / 3;
  };
  const awayHex2 = teamGrad(awayTeam)?.[1] || "";
  const awayAvgRgb = avgRgbFromHex(awayHex2);
  const isAwayBgBright = typeof awayAvgRgb === "number" ? awayAvgRgb >= 128 : false;
  const starterBoxBgDefault = isAwayBgBright ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.15)";
  const starterBoxBg =
    typeof drawOpts?.starterBoxBg === "string" && drawOpts.starterBoxBg.trim()
      ? drawOpts.starterBoxBg.trim()
      : starterBoxBgDefault;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 46px "${FONT_BODY}", system-ui, sans-serif`;
  const x0 = 80;
  const lineGap = 95;
  let y0 = 1198;

  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  const baseFont = `800 46px "${FONT_BODY}", system-ui, sans-serif`;

  if (pageIndex >= 1) {
    const spLine = `- ${spText}`;

    const padX = 36;
    const padY = Math.round(14 * 1.5);
    const r = 26;
    const maxFontSize = 50;
    const minFontSize = 46;
    const maxTextW = w - 64 - x0;
    let spSize = maxFontSize;
    ctx.font = `900 ${spSize}px "${FONT_BODY}", system-ui, sans-serif`;
    while (spSize > minFontSize && ctx.measureText(spLine).width > maxTextW) {
      spSize -= 1;
      ctx.font = `900 ${spSize}px "${FONT_BODY}", system-ui, sans-serif`;
    }
    const tw = ctx.measureText(spLine).width;
    const boxX = x0 - padX;
    const boxY = y0 - spSize + 6 - padY;
    const boxW = tw + padX * 2;
    const boxH = spSize + padY * 2;

    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, r);
    ctx.fillStyle = starterBoxBg;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#FFE87C";
    ctx.fillText(spLine, x0, y0);
    ctx.fillStyle = "#ffffff";
  }

  if (pageIndex >= 2) {
    y0 += lineGap;
    ctx.font = baseFont;
    ctx.fillText(`- ${h2hText}`, x0, y0);
  }

  const fmtStat3 = (v) =>
    v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(3) : "—";

  const hideRecLines = drawOpts?.hideHomeAwayRecordLines === true;
  const homeLabel = homeTeam || "홈";
  const awayLabel = awayTeam || "원정";

  if (pageIndex >= 3) {
    if (!hideRecLines) {
      y0 += lineGap;
      ctx.font = baseFont;
      ctx.fillText(`- ${homeRecText}`, x0, y0);
    }
    if (drawOpts?.short4ExtraStats) {
      y0 += lineGap;
      ctx.font = baseFont;
      ctx.fillText(
        `- 승률 : ${homeLabel}(${fmtStat3(g?.home_win_rate)}) | ${awayLabel}(${fmtStat3(
          g?.away_win_rate
        )})`,
        x0,
        y0
      );
    }
  }
  if (pageIndex >= 4) {
    if (!hideRecLines) {
      y0 += lineGap;
      ctx.font = baseFont;
      ctx.fillText(`- ${awayRecText}`, x0, y0);
    }
    if (drawOpts?.short4ExtraStats) {
      y0 += lineGap;
      ctx.font = baseFont;
      ctx.fillText(
        `- 타율 : ${homeLabel}(${fmtStat3(g?.home_avg)}) | ${awayLabel}(${fmtStat3(g?.away_avg)})`,
        x0,
        y0
      );
    }
  }
  if (pageIndex >= 5) {
    y0 += lineGap;
    ctx.font = baseFont;
    ctx.fillText(`- 최근 5경기 결과`, x0, y0);
    y0 += lineGap;
    ctx.font = baseFont;
    ctx.fillText(`  ${last5Line}`, x0, y0);
  }

  resetShadow(ctx);
}

/** CardTomorrowPreviewShorts 인트로와 동일 팀 키 순서 */
export const SHORTS2_INTRO_TEAM_KEYS = [
  "KIA",
  "삼성",
  "LG",
  "두산",
  "KT",
  "SSG",
  "롯데",
  "한화",
  "NC",
  "키움",
];
