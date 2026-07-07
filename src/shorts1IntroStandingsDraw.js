/**
 * Card8Shorts(쇼츠1) 인트로·순위 슬라이드 캔버스 드로잉 — App.jsx와 동일 구현.
 */
import { drawBaseballBackground } from "./shortsBaseballDecor.js";

const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";

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

function fmtStandingsWinRateDot(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const s = n.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}

function fmtTeamShort(team) {
  const t = String(team || "").trim();
  if (!t) return "—";
  return t.split(/\s+/)[0].slice(0, 6);
}

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

const TEAM_PASTEL_BG = {
  KT: "rgba(144,164,174,0.30)",
  LG: "rgba(255,120,120,0.30)",
  SSG: "rgba(255,150,180,0.30)",
  NC: "rgba(100,160,255,0.30)",
  삼성: "rgba(100,200,255,0.30)",
  KIA: "rgba(255,160,80,0.30)",
  두산: "rgba(180,130,255,0.30)",
  한화: "rgba(255,200,100,0.30)",
  키움: "rgba(240,140,180,0.30)",
  롯데: "rgba(100,140,255,0.30)",
};

export function teamKeyword(teamName) {
  const t = String(teamName || "");
  for (const kw of Object.keys(TEAM_GRAD)) {
    if (t.includes(kw)) return kw;
  }
  return t.split(/\s+/)[0] || "";
}

function teamGrad(teamName) {
  return TEAM_GRAD[teamKeyword(teamName)] || ["#0c0f14", "#131922"];
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

function drawImageContain(ctx, img, x, y, boxW, boxH) {
  const iw = Number(img?.width) || boxW;
  const ih = Number(img?.height) || boxH;
  const scale = Math.min(boxW / iw, boxH / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
}

const TEAM_LOGO_PATH = {
  삼성: "/logos/samsung.svg",
  LG: "/logos/lg.svg",
  KT: "/logos/kt.svg",
  SSG: "/logos/ssg.svg",
  NC: "/logos/nc.svg",
  KIA: "/logos/kia.svg",
  두산: "/logos/doosan.svg",
  롯데: "/logos/lotte.svg",
  한화: "/logos/hanwha.svg",
  키움: "/logos/kiwoom.svg",
};

function teamLogoPath(teamName) {
  return TEAM_LOGO_PATH[teamKeyword(teamName)] || null;
}

const __svgLogoCache = new Map();
export async function loadSvgLogo(teamName) {
  const path = TEAM_LOGO_PATH[String(teamName || "").trim()] || teamLogoPath(teamName);
  if (!path) return null;
  if (__svgLogoCache.has(path)) return await __svgLogoCache.get(path);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path;
  });
  __svgLogoCache.set(path, p);
  return await p;
}

/** 쇼츠1 인트로 10구단 로고 (프리로드·흩뿌리기 동일 순서) */
export const KBO_INTRO_TEAM_KEYS = ["KIA", "삼성", "LG", "두산", "KT", "SSG", "롯데", "한화", "NC", "키움"];

/** 쇼츠1 인트로 로고 배치 (1080×1920 기준, x/y=중심) */
const LOGO_LAYOUT = [
  { key: 0, x: 180, y: 480, size: 200, angle: -12 },
  { key: 1, x: 580, y: 450, size: 175, angle: 8 },
  { key: 2, x: 880, y: 500, size: 190, angle: -15 },
  { key: 3, x: 140, y: 680, size: 185, angle: 10 },
  { key: 4, x: 430, y: 640, size: 210, angle: -8 },
  { key: 5, x: 760, y: 660, size: 170, angle: 18 },
  { key: 6, x: 220, y: 920, size: 195, angle: -20 },
  { key: 7, x: 540, y: 840, size: 180, angle: 5 },
  { key: 8, x: 955, y: 800, size: 200, angle: -10 },
  { key: 9, x: 770, y: 980, size: 175, angle: 14 },
];

const STANDINGS_TEAM_STRONG_COLOR = {
  삼성: "#0055A4",
  LG: "#C00C3F",
  KT: "#2B2B2B",
  SSG: "#CE0E2D",
  NC: "#1D467D",
  두산: "#131230",
  KIA: "#EA0029",
  롯데: "#042445",
  한화: "#FF6600",
  키움: "#820024",
};

function getStandingsTeamStrongColor(teamName) {
  const kw = teamKeyword(teamName);
  return (kw && STANDINGS_TEAM_STRONG_COLOR[kw]) || "#1E88E5";
}

function drawStandingsSolidBackground(ctx, w, h, teamName) {
  const teamColor = teamName ? getStandingsTeamStrongColor(teamName) : "#1E88E5";
  ctx.fillStyle = teamColor || "#1E88E5";
  ctx.fillRect(0, 0, w, h);
}

export function drawIntroSlide(ctx, w, h, date, logosByTeamKey, introTitle = "프로야구 경기 결과") {
  ctx.save();
  const DAY_COLORS = {
    0: "#E74C3C",
    1: "#1B2A80",
    2: "#1B2A80",
    3: "#1E8449",
    4: "#D35400",
    5: "#6C3483",
    6: "#C0155A",
  };
  const ONE_MIN_COLOR = {
    0: "#F4FF00",
    1: "#FF9500",
    2: "#FF9500",
    3: "#FF4ECD",
    4: "#00E5FF",
    5: "#00FF94",
    6: "#FFD700",
  };
  const iso = String(date || "").slice(0, 10);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`).getDay() : 0;
  ctx.fillStyle = DAY_COLORS[day] || "#002B5B";
  ctx.fillRect(0, 0, w, h);

  drawBaseballBackground(ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#FFFFFF";
  const titleMaxW = w * 0.8;
  let topTitleSize = 44;
  for (let fs = 46; fs <= 280; fs += 2) {
    ctx.font = `900 ${fs}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
    if (ctx.measureText(introTitle).width > titleMaxW) break;
    topTitleSize = fs;
  }
  ctx.font = `900 ${topTitleSize}px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(introTitle, w / 2, h * 0.1 + 35);
  ctx.restore();

  for (const slot of LOGO_LAYOUT) {
    const tk = KBO_INTRO_TEAM_KEYS[slot.key];
    const img = logosByTeamKey?.[tk] || null;
    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.rotate((slot.angle * Math.PI) / 180);
    if (img) {
      const iw = Number(img.naturalWidth ?? img.width) || 1;
      const ih = Number(img.naturalHeight ?? img.height) || 1;
      const s = slot.size;
      let adjustedW;
      let adjustedH;
      if (iw >= ih) {
        adjustedW = s;
        adjustedH = s * (ih / iw);
      } else {
        adjustedH = s;
        adjustedW = s * (iw / ih);
      }
      ctx.drawImage(img, -adjustedW / 2, -adjustedH / 2, adjustedW, adjustedH);
    }
    ctx.restore();
  }

  const dateY = Math.round(h * 0.64);
  const dateStr = fmtKoreanLongDate(date);
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.font = `700 110px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillStyle = ONE_MIN_COLOR[day] || "#FFFFFF";
  ctx.fillText(dateStr, w / 2, dateY);
  ctx.restore();

  const divY = dateY + 100;
  const divW = 600;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w / 2 - divW / 2, divY);
  ctx.lineTo(w / 2 + divW / 2, divY);
  ctx.stroke();

  const oneMinY = divY + 180;
  ctx.fillStyle = ONE_MIN_COLOR[day] || "#FFFFFF";
  ctx.font = `800 220px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  ctx.fillText("1분컷", w / 2, oneMinY);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.restore();
}

export function drawStandingsSlide(ctx, w, h, date, standings, logosByTeamKey, teamName = "", standingsDiff = []) {
  ctx.clearRect(0, 0, w, h);
  drawStandingsSolidBackground(ctx, w, h, teamName);

  const TOP_PAD = 120;
  const TITLE_FS = 72;
  const TITLE_BASELINE = TOP_PAD + TITLE_FS;
  const DATE_BASELINE = TITLE_BASELINE + 80;
  const DIVIDER_Y = DATE_BASELINE + 20;
  const LIST_TOP = DIVIDER_Y + 20;

  const rows = Array.isArray(standings) ? standings : [];
  console.log("standings[0]:", JSON.stringify(rows[0]));
  const rawDate = rows[0]?.date ?? rows[0]?.DATE ?? rows[0]?.game_date ?? "";
  const isoPick = String(rawDate || date || "").slice(0, 10);
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(isoPick) ? fmtKoreanLongDate(isoPick) : fmtKoreanLongDate(date);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const titleText = "KBO 현재 순위";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 ${TITLE_FS}px "${FONT_BODY}", sans-serif`;
  ctx.fillText(titleText, w / 2, TITLE_BASELINE);

  ctx.fillStyle = `#F9FF00`;
  ctx.font = `700 40px "${FONT_BODY}", sans-serif`;
  ctx.fillText(dateLabel, w / 2, DATE_BASELINE);

  ctx.textAlign = "left";

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, DIVIDER_Y);
  ctx.lineTo(w - 64, DIVIDER_Y);
  ctx.stroke();

  if (!rows.length) {
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.roundRect(64, LIST_TOP + 40, w - 128, 200, 20);
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `700 52px "${FONT_BODY}", system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText("순위 데이터 없음", 88, LIST_TOP + 40 + 100);
    return;
  }

  const X0 = 64;
  const TOP_GAP = 36;
  const GRID_GAP = 20;

  const TOP_W = 952;
  const TOP_H = 220;

  const GRID_W = 460;
  const GRID_H = 223;
  const GRID_COL_GAP = GRID_GAP;
  const GRID_ROW_GAP = GRID_GAP;

  const pick = (i) => {
    const r = rows[i] || {};
    const rank = Number(r.rank ?? r.RANK ?? i + 1) || i + 1;
    const teamRaw = r.team ?? r.TEAM_NM ?? r.team_name ?? r.name ?? "—";
    const team = fmtTeamShort(teamRaw);
    const ws = r.wins ?? r.W ?? r.WIN ?? "—";
    const ls = r.losses ?? r.L ?? r.LOSE ?? "—";
    const pct = fmtStandingsWinRateDot(r.win_rate ?? r.WRA ?? r.WIN_PCT);
    const tk = teamKeyword(teamRaw);
    const logo = logosByTeamKey?.[tk] || null;
    console.log("logo check:", tk, !!logosByTeamKey?.[tk], logosByTeamKey?.[tk]);
    const winsN = Number(ws);
    const lossesN = Number(ls);
    const diffRow = standingsDiff.find((sd) => {
      const sdk = teamKeyword(sd?.team ?? "");
      return sdk && sdk === teamKeyword(teamRaw);
    });
    const diff = diffRow?.diff ?? null;
    return {
      rank,
      team,
      ws,
      ls,
      pct,
      teamRaw,
      tk,
      logo,
      winsN: Number.isFinite(winsN) ? winsN : null,
      lossesN: Number.isFinite(lossesN) ? lossesN : null,
      diff,
    };
  };

  const drawLogoInBox = (x, y, boxW, boxH, teamName, img) => {
    if (!img) {
      const r = Math.min(boxW, boxH) / 2;
      drawTeamBadge(ctx, x + boxW / 2, y + boxH / 2, r, teamName);
      return;
    }
    const iw = Number(img.width);
    const ih = Number(img.height);
    if (!Number.isFinite(iw) || !Number.isFinite(ih) || iw <= 0 || ih <= 0) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(img, x, y, boxW, boxH);
      ctx.restore();
      return;
    }
    drawImageContain(ctx, img, x, y, boxW, boxH);
  };

  const leader = pick(0);
  const gbOf = (d) => {
    if (!leader || leader.winsN == null || leader.lossesN == null) return null;
    if (!d || d.winsN == null || d.lossesN == null) return null;
    const gamesBehind = ((leader.winsN - d.winsN) + (d.lossesN - leader.lossesN)) / 2;
    if (!Number.isFinite(gamesBehind)) return null;
    const s = gamesBehind.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };

  {
    const d = pick(0);
    const x = X0;
    const y = LIST_TOP;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.strokeStyle = TEAM_PASTEL_BG?.[d.tk] || "rgba(255,255,255,0.4)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, TOP_W, TOP_H, 36);
    ctx.fill();
    ctx.stroke();

    const logoSize = 120;
    const lx = x + 28;
    const ly = y + (TOP_H - logoSize) / 2;
    drawLogoInBox(lx, ly, logoSize, logoSize, d.teamRaw, d.logo);

    const tx = lx + logoSize + 28;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const lineY = y + TOP_H / 2;
    ctx.fillStyle = "#FFD700";
    ctx.font = `800 104px "${FONT_BODY}", sans-serif`;
    ctx.letterSpacing = "-0.5px";
    const leftText = `${d.team}`;
    ctx.fillText(leftText, tx, lineY);
    const leftW = ctx.measureText(leftText).width;
    if (d.diff != null && d.diff !== 0) {
      ctx.font = `600 40px "${FONT_BODY}", sans-serif`;
      ctx.fillStyle = d.diff > 0 ? "#00DD88" : "#FF5555";
      ctx.fillText(
        d.diff > 0 ? `▲${d.diff}` : `▼${Math.abs(d.diff)}`,
        tx + leftW + 20,
        lineY - 48
      );
    }
    ctx.letterSpacing = "0px";
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = `400 52px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = "#FFD700";
    ctx.fillText(`  ${d.ws}승 ${d.ls}패 ${d.pct}`, tx + leftW, lineY);
    ctx.restore();
    ctx.restore();
  }

  if (rows.length >= 2) {
    const d = pick(1);
    const x = X0;
    const y = LIST_TOP + TOP_H + TOP_GAP;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.strokeStyle = TEAM_PASTEL_BG?.[d.tk] || "rgba(255,255,255,0.4)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, TOP_W, TOP_H, 36);
    ctx.fill();
    ctx.stroke();

    const logoSize = 120;
    const lx = x + 28;
    const ly = y + (TOP_H - logoSize) / 2;
    drawLogoInBox(lx, ly, logoSize, logoSize, d.teamRaw, d.logo);

    const tx = lx + logoSize + 28;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const gb = gbOf(d);
    const gbPart = gb != null ? `  GB ${gb}` : "";
    const lineY = y + TOP_H / 2;
    ctx.fillStyle = "#1a3a5c";
    ctx.font = `800 104px "${FONT_BODY}", sans-serif`;
    ctx.letterSpacing = "-0.5px";
    const leftText = `${d.team}`;
    ctx.fillText(leftText, tx, lineY);
    const leftW = ctx.measureText(leftText).width;
    if (d.diff != null && d.diff !== 0) {
      ctx.font = `600 40px "${FONT_BODY}", sans-serif`;
      ctx.fillStyle = d.diff > 0 ? "#00DD88" : "#FF5555";
      ctx.fillText(
        d.diff > 0 ? `▲${d.diff}` : `▼${Math.abs(d.diff)}`,
        tx + leftW + 20,
        lineY - 48
      );
    }
    ctx.letterSpacing = "0px";
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = `400 52px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = "#1a3a5c";
    ctx.fillText(`  ${d.ws}승 ${d.ls}패 ${d.pct}${gbPart}`, tx + leftW, lineY);
    ctx.restore();
    ctx.restore();
  }

  const gridStartY = LIST_TOP + TOP_H * 2 + TOP_GAP + GRID_GAP;
  for (let idx = 2; idx < Math.min(rows.length, 10); idx++) {
    const d = pick(idx);
    const j = idx - 2;
    const col = j % 2;
    const row = Math.floor(j / 2);
    const x = X0 + col * (GRID_W + GRID_COL_GAP);
    const y = gridStartY + row * (GRID_H + GRID_ROW_GAP);

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, GRID_W, GRID_H, 28);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `900 60px "${FONT_TITLE}", system-ui, sans-serif`;
    ctx.fillStyle = "#FFF5E0";
    ctx.fillText(String(d.rank), x + 24, y + 24);
    if (d.diff != null && d.diff !== 0) {
      ctx.font = `700 39px "${FONT_BODY}", sans-serif`;
      ctx.fillStyle = d.diff > 0 ? "#00DD88" : "#FF5555";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(
        d.diff > 0 ? `▲${d.diff}` : `▼${Math.abs(d.diff)}`,
        x + 24,
        y + 86
      );
    }

    const logoSize = GRID_H * 0.6;
    const lx = x + (GRID_W - logoSize) / 2;
    const ly = y + (GRID_H - logoSize) / 2;
    if (d.logo) {
      drawLogoInBox(lx, ly, logoSize, logoSize, d.teamRaw, d.logo);
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `800 48px "${FONT_BODY}", sans-serif`;
      ctx.fillStyle = "#FFF5E0";
      ctx.fillText(d.team, x + GRID_W / 2, y + GRID_H / 2);
    }

    const gb = gbOf(d);
    if (gb != null) {
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.font = `700 40px "${FONT_BODY}", sans-serif`;
      ctx.fillStyle = "#F9FF00";
      ctx.fillText(`GB ${gb}`, x + GRID_W - 16, y + GRID_H - 16);
    }
    ctx.restore();
  }
}
