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
/** 선발 슬라이드: 기존 대비 5% 확대 후 5% 축소 */
const STARTER_SLIDE_FACE_BOX = Math.round(STARTER_FACE_BOX * 1.05 * 0.95);
/** drawTomorrowPreviewGameSlide 하단 텍스트와 동일: 800 46px Noto Sans KR */
const STARTER_DETAIL_FONT_PX = 46;
const STARTER_DETAIL_LINE_GAP = 54;
/** 선발 슬라이드 오른쪽 스탯: 본문과 동일 px, 줄간격 ~1.45배 */
const STARTER_SLIDE_STAT_FONT_PX = STARTER_DETAIL_FONT_PX;
const STARTER_SLIDE_STAT_LINE_GAP = Math.round(STARTER_DETAIL_LINE_GAP * 1.45);
/** 주구종 분할 바 (사진 아래 · 슬라이드 90% 너비 · 120px 높이) */
const STARTER_PITCH_BAR_W_FRAC = 0.9;
const STARTER_PITCH_SEGMENTED_BAR_H = 120;
const STARTER_PITCH_GAP_CONTENT_TO_BAR = 18;
const STARTER_PITCH_NAME_SPEED_PX = 31;
const STARTER_PITCH_PCT_INSIDE_PX = 23;
const STARTER_PITCH_MIN_SEG_W_FOR_TEXT = 30;
const STARTER_PITCH_AWAY_DIAG_PAD = 10;
const STARTER_PITCH_HOME_BOTTOM_PAD = 36;
const STARTER_PITCH_BAR_BG = "rgba(0,0,0,0.3)";
/** 구종 코드별 색 (팀컬러 무관, FAST/SLID/CHUP/CURV/CUTT) */
const STARTER_PITCH_TYPE_FILL = {
  FAST: "#C0392B",
  SLID: "#1A5276",
  CHUP: "#1E8449",
  CURV: "#6C3483",
  CUTT: "#D35400",
};
const STARTER_PITCH_TYPE_FALLBACK = "#2C3E50";
const STARTER_PITCH_KO_TO_CODE = {
  직구: "FAST",
  포심: "FAST",
  슬라이더: "SLID",
  체인지업: "CHUP",
  커브: "CURV",
  커터: "CUTT",
};
const STARTER_STAT_LINE_COUNT = 4;
/** 선발 슬라이드 헤더(구분선 위): 상세 대비 +6px (기존 +3에 한 번 더 +3) */
const STARTER_HEADER_FONT_PX = STARTER_DETAIL_FONT_PX + 6;
/** 헤더 로고: 세로 100px, 가로는 비율 유지(최대 폭 제한) */
const LOGO_HEADER_H = 100;
const LOGO_HEADER_MAX_W = 280;
/** 원정·홈 헤더: 흰 구분선과 헤더 한 줄(세로 중심) 사이 간격을 동일하게 맞출 때 사용 */
const STARTER_HEADER_GAP_LINE_TO_CENTER = 48;
/** 원정·홈 공통: 흰 구분선 아래 얼굴 박스 상단까지 간격 */
const STARTER_DIVIDER_TO_FACE_TOP = 56;

/** 원정 상단 흰 구분선 y (기존 대비 +3px). 원정 블록 전체 추가 하향은 STARTER_AWAY_BLOCK_SHIFT_Y */
const STARTER_AWAY_DIVIDER_Y = 157;
const STARTER_AWAY_BLOCK_SHIFT_Y = 5;

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

/** @returns {number} 사용한 로고 가로 폭(텍스트 시작 x 계산용) */
function drawShorts4StarterHeaderLogo(ctx, left, centerY, maxW, teamName, logoImg) {
  const h = LOGO_HEADER_H;
  if (!logoImg) {
    drawLogoInBox(ctx, left, centerY - h / 2, h, h, teamName, null, drawTeamBadge);
    return h;
  }
  const iw = Number(logoImg.naturalWidth || logoImg.width) || maxW;
  const ih = Number(logoImg.naturalHeight || logoImg.height) || h;
  let scale = h / ih;
  let dw = iw * scale;
  if (dw > maxW) {
    scale = maxW / iw;
    dw = iw * scale;
  }
  const dh = ih * scale;
  ctx.drawImage(logoImg, left, centerY - dh / 2, dw, dh);
  return dw;
}

/** 구분선 위 헤더: 좌측 로고(세로 100px) + 한 줄 텍스트, 세로 중앙 정렬 */
function drawShorts4StarterHeaderRow(ctx, w, centerY, padL, teamName, playerName, seasonYear, logoImg) {
  const maxLogoW = Math.min(LOGO_HEADER_MAX_W, Math.max(80, w - padL - 320));
  const logoW = drawShorts4StarterHeaderLogo(ctx, padL, centerY, maxLogoW, teamName, logoImg);
  const tn = String(teamName || "—").trim() || "—";
  const pn = String(playerName || "—").trim() || "—";
  const line = `${tn} ${pn} · ${seasonYear} 시즌`;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${STARTER_HEADER_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  const textX = padL + logoW + 16;
  shadowTextSoft(ctx);
  ctx.fillText(line, textX, centerY);
  resetShadow(ctx);
  ctx.restore();
}

function starterSlideStatLineWins(g, side) {
  const pref = side === "away" ? "away" : "home";
  const has = g?.[`${pref}_starter_season_has_result`] === true;
  const wv = Number(g?.[`${pref}_starter_season_wins`]);
  const lv = Number(g?.[`${pref}_starter_season_losses`]);
  if (has) {
    const ws = Number.isFinite(wv) ? wv : 0;
    const ls = Number.isFinite(lv) ? lv : 0;
    return `- ${ws}승 ${ls}패`;
  }
  return `- -승 -패`;
}

function starterSlideStatLinesFour(g, side) {
  const pref = side === "away" ? "away" : "home";
  const era = side === "away" ? g?.away_starter_era : g?.home_starter_era;
  const totalIp = g?.[`${pref}_starter_total_ip`];
  const k9 = g?.[`${pref}_starter_k9`];
  const l1 = starterSlideStatLineWins(g, side);
  const l2 =
    totalIp != null && String(totalIp).trim() !== ""
      ? `- 시즌 총 이닝 : ${totalIp}`
      : `- 시즌 총 이닝 : -`;
  const l3 = `- 평균자책점(ERA) : ${fmtEra(era)}`;
  const l4 =
    k9 != null && Number.isFinite(Number(k9))
      ? `- 9이닝당 삼진 : ${Number(k9).toFixed(2)}`
      : `- 9이닝당 삼진 : -`;
  return [l1, l2, l3, l4];
}

/** 선수 얼굴 세로 중심 cy 기준 오른쪽 스탯 4줄 */
function drawStarterSlideRightStatBlock(ctx, statX, cy, g, side) {
  const lines = starterSlideStatLinesFour(g, side);
  const gap = STARTER_SLIDE_STAT_LINE_GAP;
  const totalH = (lines.length - 1) * gap;
  let statY = cy - totalH / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${STARTER_SLIDE_STAT_FONT_PX}px "${FONT_BODY}", system-ui, sans-serif`;
  for (const line of lines) {
    shadowTextSoft(ctx);
    ctx.fillText(line, statX, statY);
    resetShadow(ctx);
    statY += gap;
  }
}

/** 스탯 마지막 줄 세로 중심 y (주구종 블록 위치 계산용) */
function starterStatLastLineCenterY(cy) {
  const gap = STARTER_SLIDE_STAT_LINE_GAP;
  const n = STARTER_STAT_LINE_COUNT;
  const totalH = (n - 1) * gap;
  const firstY = cy - totalH / 2;
  return firstY + (n - 1) * gap;
}

/** 스탯 블록 하단(대략) — 사진 아래 바 배치 시 max(사진, 스탯)용 */
function starterStatBlockBottomY(faceCy) {
  const lastCy = starterStatLastLineCenterY(faceCy);
  return lastCy + STARTER_SLIDE_STAT_LINE_GAP * 0.48 + STARTER_SLIDE_STAT_FONT_PX * 0.42;
}

/** diagTeamColorsOnly / diagTeamGradient 와 동일한 팀컬러 경계선의 y (주구종 바가 상단에 걸리지 않도록) */
function diagTeamSplitLineYAtX(w, h, x) {
  const splitY = h * 0.5;
  const tilt = h * 0.1;
  const yL = splitY - tilt;
  const yR = splitY + tilt;
  return yL + ((yR - yL) * x) / w;
}

function pickStarterPitchKinds(g, side) {
  const key = side === "away" ? "away_pitch_kinds" : "home_pitch_kinds";
  const arr = g?.[key];
  if (arr == null || !Array.isArray(arr) || arr.length === 0) return null;
  const rows = arr
    .filter((x) => x && typeof x === "object" && Number.isFinite(Number(x.ratio)))
    .slice(0, 4);
  return rows.length ? rows : null;
}

/** pitch row: name(KO) 또는 type/code(영문)로 구종 색 고정 */
function starterPitchKindSegmentFill(row) {
  const codeRaw = String(row?.type ?? row?.code ?? "").trim().toUpperCase();
  if (codeRaw && STARTER_PITCH_TYPE_FILL[codeRaw]) return STARTER_PITCH_TYPE_FILL[codeRaw];
  const name = String(row?.name || "").trim();
  const fromKo = STARTER_PITCH_KO_TO_CODE[name];
  if (fromKo && STARTER_PITCH_TYPE_FILL[fromKo]) return STARTER_PITCH_TYPE_FILL[fromKo];
  if (/커터/.test(name)) return STARTER_PITCH_TYPE_FILL.CUTT;
  if (/커브/.test(name)) return STARTER_PITCH_TYPE_FILL.CURV;
  if (/체인지업|체볼/i.test(name)) return STARTER_PITCH_TYPE_FILL.CHUP;
  if (/슬라이더|슬라이드/.test(name)) return STARTER_PITCH_TYPE_FILL.SLID;
  if (/직구|포심|패스트볼/i.test(name)) return STARTER_PITCH_TYPE_FILL.FAST;
  return STARTER_PITCH_TYPE_FALLBACK;
}

/** 분할 바 가로폭(구간 합)에 맞춰 정수 픽셀 너비 배분 */
function splitSegmentPixelWidths(innerW, ratios) {
  const n = ratios.length;
  const s = ratios.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(s) || s <= 0) {
    const q = Math.floor(innerW / n);
    const arr = Array(n).fill(q);
    arr[n - 1] += innerW - q * n;
    return arr;
  }
  const exact = ratios.map((r) => ((Math.max(0, r) / s) * innerW));
  const floors = exact.map((x) => Math.floor(x));
  let rem = innerW - floors.reduce((a, b) => a + b, 0);
  const order = [...exact.keys()].sort(
    (i, j) => exact[j] - Math.floor(exact[j]) - (exact[i] - Math.floor(exact[i]))
  );
  let k = 0;
  while (rem > 0) {
    floors[order[k % order.length]]++;
    rem--;
    k++;
  }
  return floors;
}

/**
 * 사진·스탯 아래 중앙 주구종 분할 바 (최대 4구간). pitchKinds null이면 그리지 않음.
 * @param {string} _teamName 호출부 호환용(미사용)
 * @param {"away"|"home"} region 원정: 사선 위로 클램프, 홈: 슬라이드 하단 여백
 */
function drawStarterPitchKindsBlock(ctx, wCanvas, hCanvas, pitchKinds, _teamName, region, faceCy) {
  if (!pitchKinds || pitchKinds.length === 0) return;

  const barW = Math.floor(wCanvas * STARTER_PITCH_BAR_W_FRAC);
  const barLeft = Math.floor((wCanvas - barW) / 2);
  if (barW < 120) return;

  const n = pitchKinds.length;
  const ratios = pitchKinds.map((row) => Math.max(0, Number(row.ratio) || 0));
  const sumR = ratios.reduce((a, b) => a + b, 0);
  if (!(sumR > 0)) return;

  const innerW = barW;
  const segWs = splitSegmentPixelWidths(innerW, ratios);

  const rPhoto = STARTER_SLIDE_FACE_BOX / 2;
  const photoBottom = faceCy + rPhoto;
  const statsBottom = starterStatBlockBottomY(faceCy);
  const contentBottom = Math.max(photoBottom, statsBottom);

  const barH = STARTER_PITCH_SEGMENTED_BAR_H;

  let barTop = contentBottom + STARTER_PITCH_GAP_CONTENT_TO_BAR;

  if (region === "away") {
    const limBottom = diagTeamSplitLineYAtX(wCanvas, hCanvas, barLeft) - STARTER_PITCH_AWAY_DIAG_PAD;
    if (barTop + barH > limBottom) {
      barTop -= barTop + barH - limBottom;
    }
  } else {
    const limBottom = hCanvas - STARTER_PITCH_HOME_BOTTOM_PAD;
    if (barTop + barH > limBottom) {
      barTop -= barTop + barH - limBottom;
    }
  }

  const segLayouts = [];
  let x = barLeft;
  for (let i = 0; i < n; i++) {
    const wSeg = segWs[i] || 0;
    const cx = x + wSeg / 2;
    segLayouts.push({ x, w: wSeg, cx });
    x += wSeg;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(barLeft, barTop, barW, barH);
  ctx.clip();

  ctx.fillStyle = STARTER_PITCH_BAR_BG;
  ctx.fillRect(barLeft, barTop, barW, barH);

  for (let i = 0; i < n; i++) {
    const { x: sx, w: sw } = segLayouts[i];
    if (sw <= 0) continue;
    ctx.fillStyle = starterPitchKindSegmentFill(pitchKinds[i]);
    ctx.fillRect(sx, barTop, sw, barH);
  }

  ctx.restore();

  for (let i = 0; i < n; i++) {
    const row = pitchKinds[i];
    const { x: sx, w: sw, cx } = segLayouts[i];
    if (sw <= 0 || sw < STARTER_PITCH_MIN_SEG_W_FOR_TEXT) continue;

    const name = String(row.name || "").trim() || "—";
    const ratio = Number(row.ratio);
    const sp = Number(row.speed);
    const pctStr = Number.isFinite(ratio)
      ? `${Math.abs(ratio - Math.round(ratio)) < 0.05 ? Math.round(ratio) : Number(ratio.toFixed(1))}%`
      : "—";
    const spdStr = Number.isFinite(sp) ? `${Math.round(sp)}` : "—";
    const nameSpeedLine = Number.isFinite(sp) ? `${name} ${spdStr}` : name;

    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, barTop, sw, barH);
    ctx.clip();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${STARTER_PITCH_NAME_SPEED_PX}px "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(nameSpeedLine, cx, barTop + barH * 0.32);
    resetShadow(ctx);
    ctx.font = `700 ${STARTER_PITCH_PCT_INSIDE_PX}px "${FONT_BODY}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    ctx.fillText(pctStr, cx, barTop + barH * 0.78);
    resetShadow(ctx);
    ctx.restore();
  }
}

/**
 * 원정팀(상단 절반): 헤더(로고+한줄)·구분선, 사진 중심 x=w*0.25, 스탯은 사진 오른쪽 좌측 정렬
 */
function drawAwayStarterUpperLayout(ctx, w, h, g, awayTeam, as, awayImg, awayUsePhoto, logosByTeamKey) {
  const faceBox = STARTER_SLIDE_FACE_BOX;
  const rPhoto = faceBox / 2;
  const awayPhotoCx = w * 0.25;
  const padL = 48;

  const dividerY = STARTER_AWAY_DIVIDER_Y + STARTER_AWAY_BLOCK_SHIFT_Y;
  const headerCenterY = dividerY - STARTER_HEADER_GAP_LINE_TO_CENTER;
  const ak = teamKeyword(awayTeam);
  const awayLogoImg = logosByTeamKey?.[ak] ?? null;
  drawShorts4StarterHeaderRow(
    ctx,
    w,
    headerCenterY,
    padL,
    awayTeam,
    as,
    starterSeasonYearFromGame(g),
    awayLogoImg
  );
  drawShorts4StarterHeaderDivider(ctx, w, padL, dividerY);

  const awayCy = dividerY + rPhoto + STARTER_DIVIDER_TO_FACE_TOP;
  const awayBoxTop = awayCy - rPhoto;

  if (awayUsePhoto && awayImg) {
    drawPortraitContain(ctx, awayImg, awayPhotoCx, awayBoxTop, faceBox, faceBox);
  }

  const statX = awayPhotoCx + rPhoto + 28;
  drawStarterSlideRightStatBlock(ctx, statX, awayCy, g, "away");
  const awayKinds = pickStarterPitchKinds(g, "away");
  if (awayKinds) {
    drawStarterPitchKindsBlock(ctx, w, h, awayKinds, awayTeam, "away", awayCy);
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
 * 홈(하단): 흰 구분선 위 로고+한 줄 헤더. 구분선은 상단과 동일하게 +3px 아래.
 * 구분선~헤더 세로중심 간격 = STARTER_HEADER_GAP_LINE_TO_CENTER.
 * @returns {number} homeDividerY
 */
function drawHomeStarterLowerHeader(ctx, w, h, g, homeTeam, hs, logosByTeamKey) {
  const padL = 48;
  const mid = h * 0.5;
  const dividerY = mid + 92 + 2 * STARTER_HEADER_GAP_LINE_TO_CENTER + 3;
  const headerCenterY = dividerY - STARTER_HEADER_GAP_LINE_TO_CENTER;
  const hk = teamKeyword(homeTeam);
  const homeLogoImg = logosByTeamKey?.[hk] ?? null;
  drawShorts4StarterHeaderRow(
    ctx,
    w,
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

  const faceBox = STARTER_SLIDE_FACE_BOX;
  const rPhoto = faceBox / 2;

  const homeFaceCx = w * 0.35 - 100;

  const hs = String(g?.home_starter || "미정").trim() || "미정";
  const as = String(g?.away_starter || "미정").trim() || "미정";

  const vsSizePx = 90;

  const awayImg = portraits?.away && portraits.away.complete && portraits.away.naturalWidth ? portraits.away : null;
  const homeImg = portraits?.home && portraits.home.complete && portraits.home.naturalWidth ? portraits.home : null;
  const awayUsePhoto = Boolean(awayImg) && as !== "미정";
  const homeUsePhoto = Boolean(homeImg) && hs !== "미정";

  drawAwayStarterUpperLayout(ctx, w, h, g, awayTeam, as, awayImg, awayUsePhoto, logosByTeamKey || {});

  const homeDividerY = drawHomeStarterLowerHeader(ctx, w, h, g, homeTeam, hs, logosByTeamKey || {});
  const homeCy = homeDividerY + rPhoto + STARTER_DIVIDER_TO_FACE_TOP;
  const homeFaceTop = homeCy - rPhoto;

  if (homeUsePhoto) {
    drawPortraitContain(ctx, homeImg, homeFaceCx, homeFaceTop, faceBox, faceBox);
  }

  drawStarterSlideRightStatBlock(ctx, homeFaceCx + rPhoto + 28, homeCy, g, "home");
  const homeKinds = pickStarterPitchKinds(g, "home");
  if (homeKinds) {
    drawStarterPitchKindsBlock(ctx, w, h, homeKinds, homeTeam, "home", homeCy);
  }

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
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
