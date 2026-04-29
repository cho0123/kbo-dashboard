import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postKbo, seoulToday } from "./api.js";
import JSZip from "jszip";

/** 라벨은 정식 구단명, value는 Firestore home/away 팀 필드와 부분 일치시키는 키워드 */
const KBO_TEAMS = [
  { label: "삼성 라이온즈", keyword: "삼성" },
  { label: "KIA 타이거즈", keyword: "KIA" },
  { label: "LG 트윈스", keyword: "LG" },
  { label: "두산 베어스", keyword: "두산" },
  { label: "KT 위즈", keyword: "KT" },
  { label: "SSG 랜더스", keyword: "SSG" },
  { label: "롯데 자이언츠", keyword: "롯데" },
  { label: "한화 이글스", keyword: "한화" },
  { label: "NC 다이노스", keyword: "NC" },
  { label: "키움 히어로즈", keyword: "키움" },
];

const KBO_TEAM_NAMES = [
  "KIA 타이거즈",
  "LG 트윈스",
  "SSG 랜더스",
  "삼성 라이온즈",
  "KT 위즈",
  "NC 다이노스",
  "한화 이글스",
  "두산 베어스",
  "키움 히어로즈",
  "롯데 자이언츠",
];

function MarkdownView({ text }) {
  const value = (text || "").trim();
  if (!value) return <div className="md">—</div>;

  const countCols = (node) => {
    // Try to find first <tr> and count its cells
    const queue = [node];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur) continue;
      if (Array.isArray(cur)) {
        for (const x of cur) queue.push(x);
        continue;
      }
      if (cur?.type === "tr") {
        const kids = Array.isArray(cur.props?.children)
          ? cur.props.children
          : [cur.props?.children].filter(Boolean);
        const cells = kids.filter((c) => c && (c.type === "td" || c.type === "th"));
        return cells.length || 0;
      }
      const children = cur?.props?.children;
      if (children) queue.push(children);
    }
    return 0;
  };

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table({ node, ...props }) {
            const cols = countCols(props.children);
            const cls =
              cols === 2
                ? "md-table md-table-2"
                : cols >= 8
                  ? "md-table md-table-detail"
                  : "md-table";
            return <table className={cls} {...props} />;
          },
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function useAnalyzer() {
  const [busy, setBusy] = useState(null);
  const runWith = async (action, payload, slot, setOut) => {
    const id = `${action}_${slot}`;
    setBusy(id);
    try {
      const res = await postKbo({ action, ...payload });
      setOut({
        text: res.text ?? "",
        summary: res.contextSummary ?? null,
        uiData: res.uiData ?? null,
        error: null,
      });
    } catch (e) {
      setOut({
        text: "",
        summary: null,
        uiData: null,
        error: e?.message || String(e),
      });
    } finally {
      setBusy((b) => (b === id ? null : b));
    }
  };
  return { busy, runWith };
}

function ResultBlock({ title, text, pending, error }) {
  return (
    <div className="result">
      <div className="result-head">
        <span>
          {pending ? "생성 중…" : error ? "오류" : title ? title : "결과"}
        </span>
      </div>
      {error ? (
        <pre className="mono result-error">{error}</pre>
      ) : (
        <MarkdownView text={text} />
      )}
    </div>
  );
}

function SimpleStatsTable({ headers, rows }) {
  const cols = Array.isArray(headers) ? headers : [];
  const rs = Array.isArray(rows) ? rows : [];
  if (!cols.length || !rs.length) return null;
  const normalized = cols.map((c) =>
    typeof c === "string" ? { key: c, label: c } : c
  );
  return (
    <table className="pv-table" style={{ marginTop: 10 }}>
      <thead>
        <tr>
          {normalized.map((c) => (
            <th
              key={c.key}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                color: "#1a1a2e",
                background: "rgba(0, 0, 0, 0.04)",
                fontWeight: 900,
                width: "auto",
                whiteSpace: "nowrap",
              }}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rs.map((r, idx) => (
          <tr key={idx}>
            {normalized.map((c) => (
              <td
                key={c.key}
                style={{
                  padding: "8px 10px",
                  borderTop: "1px solid rgba(0, 0, 0, 0.08)",
                  color: "#1a1a2e",
                }}
              >
                {r[c.key] ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function extractMvpTitle(md) {
  const text = String(md || "");
  const m = text.match(/^\s*#{1,3}\s*(.+?)\s*$/m);
  if (m?.[1]) return m[1].trim();
  return "오늘의 MVP";
}

function extractFirstHeading(md) {
  const text = String(md || "");
  const m = text.match(/^\s*#{1,3}\s*(.+?)\s*$/m);
  if (!m?.[1]) return null;
  return m[1].trim();
}

function removeFirstHeading(md) {
  const text = String(md || "");
  // remove first markdown heading line only
  return text.replace(/^\s*#{1,3}\s*.+?\s*(\r?\n)+/m, "");
}

function extractKoreanBattingLine(md) {
  const text = String(md || "");
  const m = text.match(
    /(\d+)\s*타수[\s/]*(\d+)\s*안타[\s/]*(\d+)\s*홈런[\s/]*(\d+)\s*타점/
  );
  if (!m) return null;
  return {
    ab: Number(m[1]),
    h: Number(m[2]),
    hr: Number(m[3]),
    rbi: Number(m[4]),
  };
}

function nameWithTeam(name, team) {
  const n = String(name || "").trim();
  const t = String(team || "").trim();
  if (!t || t === "—") return n || "—";
  return `${n || "—"} (${t})`;
}

function teamAbbr(team) {
  const t = String(team || "").trim();
  if (!t || t === "—") return "";
  // "SSG 랜더스" -> "SSG"
  const first = t.split(/\s+/)[0];
  if (first) return first.slice(0, 6);
  return t.slice(0, 6);
}

function formatSeasonAvgDot(avgRaw) {
  if (avgRaw == null || avgRaw === "") return "";
  if (typeof avgRaw === "number") {
    if (!Number.isFinite(avgRaw)) return "";
    // 0.333 -> ".333"
    if (avgRaw >= 0 && avgRaw <= 1.5) return avgRaw.toFixed(3).replace(/^0/, "");
    // already percent-like / unexpected → just show trimmed
    return String(avgRaw);
  }
  const s = String(avgRaw).trim();
  if (!s) return "";
  // ".333" or "0.333"
  if (/^\.\d{3,4}$/.test(s)) return s.slice(0, 5);
  if (/^0\.\d{3,4}$/.test(s)) return s.replace(/^0/, "").slice(0, 5);
  const n = Number(s);
  if (Number.isFinite(n) && n >= 0 && n <= 1.5) return n.toFixed(3).replace(/^0/, "");
  return s;
}

function formatInnings(ip) {
  if (!ip && ip !== 0) return "";
  const n = typeof ip === "number" ? ip : Number(ip);
  if (!Number.isFinite(n)) return "";
  const full = Math.floor(n);
  const frac = n - full;
  if (frac < 0.1) return `${full}이닝`;
  if (frac < 0.5) return `${full}.1이닝`;
  return `${full}.2이닝`;
}

function formatEraMaybe(eraRaw) {
  if (eraRaw == null || eraRaw === "") return "-";
  const n = typeof eraRaw === "number" ? eraRaw : Number(eraRaw);
  // 비정상적으로 큰 ERA는 표시하지 않음 (데이터 오염/타입 문제 방지)
  if (!Number.isFinite(n) || n < 0 || n > 20) return "-";
  return n.toFixed(2);
}

function inningsToNumber(ipRaw) {
  if (ipRaw == null) return 0;
  const s = String(ipRaw).trim();
  if (!s) return 0;
  // common baseball notation: 5.1 = 5 + 1/3, 5.2 = 5 + 2/3
  const m = s.match(/^(\d+)(?:\.(\d))?$/);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const full = Number(m[1]);
  const frac = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(full)) return 0;
  if (frac === 1) return full + 1 / 3;
  if (frac === 2) return full + 2 / 3;
  return full;
}

function calcEra(ipRaw, erRaw) {
  const ip = inningsToNumber(ipRaw);
  const er = Number(erRaw);
  if (!Number.isFinite(ip) || ip <= 0 || !Number.isFinite(er) || er < 0) return null;
  return (er * 9) / ip;
}

function pickBattingOrder(row) {
  const v =
    row?.batting_order ??
    row?.battingOrder ??
    row?.batting_order_no ??
    row?.batting_order_num ??
    row?.batting_order_number ??
    row?.batting_order_idx ??
    row?.order ??
    row?.batting_order ??
    row?.lineup_order ??
    row?.lineupOrder ??
    row?.타순;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

function fmtKstTimestamp(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const s = d.toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul",
    hour12: false,
  });
  return String(s).replace("T", " ").slice(0, 16);
}

function fmtTeamShort(team) {
  const t = String(team || "").trim();
  if (!t) return "—";
  return t.split(/\s+/)[0].slice(0, 6);
}

function fmtGameLine(g) {
  const away = fmtTeamShort(g?.away_team);
  const home = fmtTeamShort(g?.home_team);
  const as = g?.away_score;
  const hs = g?.home_score;
  if (as == null || hs == null) return `${away} vs ${home}`;
  return `${away} ${as} vs ${hs} ${home}`;
}

const TEXT_MAIN = "#ffffff";

function shadowTextSoft(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 3;
}

// 선명한 파스텔 팀 컬러 (Card8Shorts 배경용)
const TEAM_GRAD = {
  삼성: ["#4fc3f7", "#4fc3f7"], // 네온 스카이블루
  LG: ["#ff5252", "#ff5252"], // 네온 레드
  KT: ["#90a4ae", "#90a4ae"], // 밝은 블루그레이
  SSG: ["#ff4081", "#ff4081"], // 네온 핫핑크
  NC: ["#448aff", "#448aff"], // 네온 블루
  두산: ["#7c4dff", "#7c4dff"], // 네온 퍼플
  KIA: ["#ff6d00", "#ff6d00"], // 네온 오렌지
  롯데: ["#2979ff", "#2979ff"], // 네온 로얄블루
  한화: ["#ffab40", "#ffab40"], // 네온 오렌지옐로우
  키움: ["#f06292", "#f06292"], // 네온 핑크
};

const TEAM_CODE = {
  삼성: "SS",
  LG: "LG",
  KT: "KT",
  SSG: "SK",
  NC: "NC",
  두산: "OB",
  KIA: "HT",
  롯데: "LT",
  한화: "HH",
  키움: "WO",
};

function teamKeyword(teamName) {
  const t = String(teamName || "");
  for (const kw of Object.keys(TEAM_GRAD)) {
    if (t.includes(kw)) return kw;
  }
  // fall back to first token (LG 트윈스 -> LG)
  return t.split(/\s+/)[0] || "";
}

function teamGrad(teamName) {
  return TEAM_GRAD[teamKeyword(teamName)] || ["#0c0f14", "#131922"];
}

function teamCode(teamName) {
  return TEAM_CODE[teamKeyword(teamName)] || "";
}

function shadowText(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
}

function resetShadow(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function shadowTextStrong(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 8;
}

function shadowTextHeavy(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
}

const __fontsReady =
  typeof document !== "undefined" && document.fonts?.ready
    ? document.fonts.ready
    : Promise.resolve();

async function ensureCanvasFonts() {
  try {
    await __fontsReady;
  } catch {
    // ignore
  }
}

const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";

/** Card8Shorts 마지막 슬라이드(순위) — canvas 논리 좌표(px). JSX 미사용, ctx.font만 사용 */
const STANDINGS_CANVAS = {
  topPad: 80,
  bottomPad: 80,
  titleFs: 64,
  titleWeight: 900,
  dateFs: 28,
  dateOpacity: 0.9,
  dateGapBelowTitle: 34,
  dividerOffsetBelowDate: 14,
  gapBelowDivider: 52,
  rankLine: {
    1: { fs: 58, weight: 900, color: "#FFD700" },
    2: { fs: 48, weight: 700, color: "#FFFFFF" },
    3: { fs: 42, weight: 700, color: "#FFFFFF" },
    rest: { fs: 34, weight: 500, color: "#CCCCCC" },
  },
};

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

function fmtKoreanDotDate(iso) {
  const s = String(iso || "").slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || "—";
  const wk = new Date(s).toLocaleDateString("ko-KR", { weekday: "short" });
  return `${m[1]}.${m[2]}.${m[3]} (${wk})`;
}

function fmtStandingsWinRateDot(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const s = n.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}

/** 순위 슬라이드 한 줄 — STANDINGS_CANVAS.rankLine 기준으로 ctx.font 강제 */
function drawStandingsLineUnified(ctx, x, cy, rank, team, ws, ls, pct, fontBody) {
  const rk = Math.trunc(Number(rank));
  const safeRank = Number.isFinite(Number(rank)) && rk >= 1 ? rk : 1;
  const tier =
    safeRank === 1
      ? STANDINGS_CANVAS.rankLine[1]
      : safeRank === 2
        ? STANDINGS_CANVAS.rankLine[2]
        : safeRank === 3
          ? STANDINGS_CANVAS.rankLine[3]
          : STANDINGS_CANVAS.rankLine.rest;
  const { fs, weight, color } = tier;
  const line = `${safeRank}위  ${team}  ${ws}승 ${ls}패  ${pct}`;
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.font = `${weight} ${fs}px "${fontBody}", sans-serif`;
  ctx.fillText(line, x, cy);
  ctx.restore();
}

function measureFitFontSize(
  ctx,
  text,
  maxWidth,
  startSize,
  minSize,
  fontWeight,
  fontFamily,
  letterSpacing
) {
  const prevSpacing = ctx.letterSpacing;
  if (letterSpacing != null) ctx.letterSpacing = letterSpacing;
  try {
    for (let fs = startSize; fs >= minSize; fs--) {
      ctx.font = `${fontWeight} ${fs}px "${fontFamily}", system-ui, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return fs;
    }
    return minSize;
  } finally {
    ctx.letterSpacing = prevSpacing;
  }
}

function teamBadgeLabel(teamName) {
  // Requested: NC, KIA, LG, 삼성, KT, SSG, 두산, 롯데, 한화, 키움
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
  // fallback to shortened team name
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
async function loadSvgLogo(teamName) {
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

const __pngImageCache = new Map();
async function loadPngImage(path) {
  const p = String(path || "").trim();
  if (!p) return null;
  if (__pngImageCache.has(p)) return await __pngImageCache.get(p);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = p;
  });
  __pngImageCache.set(p, promise);
  return await promise;
}

let __baseballDecorImg = null;
function drawBaseballBackground(ctx) {
  const baseballImg = __baseballDecorImg;
  if (!baseballImg) return;
  ctx.save();
  ctx.globalAlpha = 0.2;
  const size = 700;
  const centerX = 900;
  const centerY = 1400;
  ctx.drawImage(
    baseballImg,
    centerX - size / 2,
    centerY - size / 2,
    size,
    size
  );
  ctx.restore();
}

function drawTeamLogoOrBadge(ctx, x, y, size, teamName, img) {
  if (img) {
    ctx.drawImage(img, x, y, size, size);
    return;
  }
  drawTeamBadge(ctx, x + size / 2, y + size / 2, size / 2, teamName);
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

  // base: primary (winner/기준팀) 65%
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);

  // Order requirement: background → baseball → diagonal split → contents
  drawBaseballBackground(ctx);

  // secondary: bottom-right 35% (사선 분할)
  ctx.beginPath();
  ctx.moveTo(0, h * 0.45);
  ctx.lineTo(w, h * 0.75);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  // loser: same hue, lighter via opacity
  ctx.fillStyle = hexToRgba(s, 0.6);
  ctx.fill();

  // boundary line (white 5px)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.45);
  ctx.lineTo(w, h * 0.75);
  ctx.stroke();
}

function hexToRgba(hex, a) {
  const h = String(hex || "").trim().replace("#", "");
  if (h.length !== 6) return `rgba(0,0,0,${a})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function winLoseVerticalGradient(ctx, w, h, winTeam, loseTeam) {
  // 유지용 이름이지만, 실제 동작은 "사선 분할" 배경으로 변경합니다.
  diagTeamGradient(ctx, w, h, winTeam, loseTeam);
}

/** 순위 슬라이드 — 게임 슬라이드와 동일 사선 각도, 고정 네이비 2색 */
function diagSplitStandingsBackground(ctx, w, h) {
  ctx.fillStyle = "#0d1b2a";
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.45);
  ctx.lineTo(w, h * 0.75);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = "#1a2f45";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.45);
  ctx.lineTo(w, h * 0.75);
  ctx.stroke();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function drawSlideBase(ctx, w, h, title, homeTeam = "", awayTeam = "") {
  ctx.clearRect(0, 0, w, h);
  // pastel + diagonal split background
  diagTeamGradient(ctx, w, h, homeTeam, awayTeam);

  // NOTE: slide-specific headers should respect safe zone (y: 200~1720).
  // Keep base free of top UI chrome.
  if (title) {
    ctx.fillStyle = "rgba(255,255,255,0.0)";
  }
}

/** 첫 슬라이드 요일별 포인트 컬러만 (텍스트용, getDay: 0=일…6=토) */
function summarySlidePointColor(dateStr) {
  const s = String(dateStr || "").trim().slice(0, 10);
  const d = new Date(s);
  const dow = Number.isNaN(d.getTime()) ? 0 : d.getDay();
  if (dow === 1 || dow === 2) return "#FF85C1";
  if (dow === 3) return "#B39DFF";
  if (dow === 4) return "#70C8FF";
  if (dow === 5) return "#FFE566";
  if (dow === 6) return "#FF80C0";
  return "#5DFFC4";
}

function drawSummarySlide(ctx, w, h, date, games, logosByTeamKey, dailyHeadline) {
  // Summary slide: 고정 야구장 그린 + 요일별 포인트(텍스트만)
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "#4CAF50";
  ctx.fillRect(0, 0, w, h);

  // Grass texture: diagonal mow lines
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 2;
  const spacing = 120;
  for (let x = -h; x <= w + h; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.06)";
  for (let x = -h + spacing / 2; x <= w + h; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.stroke();
  }
  ctx.restore();

  const SAFE_TOP = 200;
  const SAFE_BOTTOM = 1720;

  // Infield diamond pattern line
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 6;
  const dcx = w * 0.5;
  const dcy = SAFE_TOP + 520;
  const d = 260;
  ctx.beginPath();
  ctx.moveTo(dcx, dcy - d);
  ctx.lineTo(dcx + d, dcy);
  ctx.lineTo(dcx, dcy + d);
  ctx.lineTo(dcx - d, dcy);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  // decor (behind contents)
  drawBaseballBackground(ctx);

  const point = summarySlidePointColor(date);

  // Title: "⚾ KBO 2026.04.28 (화)" — 날짜는 포인트 컬러
  const titleLeft = "⚾ KBO ";
  const titleRight = fmtKoreanDotDate(date);
  const titleBaseline = SAFE_TOP + 80;
  ctx.font = `900 78px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(titleLeft, 64, titleBaseline);
  const leftW = ctx.measureText(titleLeft).width;
  ctx.fillStyle = point;
  ctx.fillText(titleRight, 64 + leftW, titleBaseline);
  resetShadow(ctx);

  // 서브타이틀 (포인트 컬러)
  const subBaseline = titleBaseline + 78;
  ctx.fillStyle = point;
  ctx.font = `700 34px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("오늘의 경기 결과", 64, subBaseline);
  resetShadow(ctx);

  // Claude 헤드라인: 900, 자동 축소, 그림자, letter-spacing
  const headline =
    String(dailyHeadline || "").trim() || "오늘의 경기 한줄 요약";
  const headlineBaseline = subBaseline + 52;
  const maxTextW = w - 128;
  ctx.save();
  ctx.fillStyle = point;
  ctx.letterSpacing = "-1px";
  const headlineFs = measureFitFontSize(
    ctx,
    headline,
    maxTextW,
    62,
    18,
    900,
    FONT_BODY,
    "-1px"
  );
  ctx.font = `900 ${headlineFs}px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.fillText(headline, 64, headlineBaseline);
  ctx.restore();
  resetShadow(ctx);

  if (!games?.length) {
    return;
  }

  const cardW = 952;
  const cardH = 248;
  const x = 64;
  let y = Math.max(SAFE_TOP + 200, headlineBaseline + headlineFs + 36);

  const drawLogoInBox = (x, y, boxW, boxH, teamName, img) => {
    if (!img) {
      // fallback: badge centered in the box
      const r = Math.min(boxW, boxH) / 2;
      drawTeamBadge(ctx, x + boxW / 2, y + boxH / 2, r, teamName);
      return;
    }
    const iw = Number(img.width) || boxW;
    const ih = Number(img.height) || boxH;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
  };

  for (const g of games) {
    // brighter cards + 1px border
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.strokeStyle = "rgba(255,255,255,1.0)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 24);
    ctx.fill();
    ctx.stroke();

    // Wider logo box (keep original aspect ratio, but give more horizontal space)
    const logoBoxW = 260;
    const logoBoxH = 180;
    const ly = y + (cardH - logoBoxH) / 2;
    const hk = teamKeyword(g.home_team);
    const ak = teamKeyword(g.away_team);
    drawLogoInBox(x + 18, ly, logoBoxW, logoBoxH, g.home_team, logosByTeamKey?.[hk] || null);
    drawLogoInBox(
      x + cardW - 18 - logoBoxW,
      ly,
      logoBoxW,
      logoBoxH,
      g.away_team,
      logosByTeamKey?.[ak] || null
    );

    // Score: make VS bigger and yellow
    const scoreFont = `1000 72px "${FONT_TITLE}", system-ui, sans-serif`;
    const vsFont = `1000 88px "${FONT_TITLE}", system-ui, sans-serif`;
    shadowTextSoft(ctx);
    const hsText = String(g.home_score ?? "—");
    const asText = String(g.away_score ?? "—");
    const vsText = "VS";
    const pad = "  ";
    ctx.font = scoreFont;
    const w1 = ctx.measureText(hsText + pad).width;
    const w3 = ctx.measureText(pad + asText).width;
    ctx.font = vsFont;
    const w2 = ctx.measureText(vsText).width;
    const totalW = w1 + w2 + w3;
    const startX = x + (cardW - totalW) / 2;
    const yy = y + Math.round(cardH * 0.62);

    ctx.fillStyle = "#ffffff";
    ctx.font = scoreFont;
    ctx.fillText(hsText + pad, startX, yy);
    ctx.fillStyle = point;
    ctx.font = vsFont;
    ctx.fillText(vsText, startX + w1, yy + 6);
    ctx.fillStyle = "#ffffff";
    ctx.font = scoreFont;
    ctx.fillText(pad + asText, startX + w1 + w2, yy);
    resetShadow(ctx);

    y += cardH + 22;
    if (y > SAFE_BOTTOM - 120) break;
  }

  // "오늘 N경기" 텍스트 제거
}

function drawGameSlide(ctx, w, h, date, g, index, total, logosByTeamKey) {
  // Winner-based vertical gradient background:
  // top 70% winner (strong), bottom 30% loser (alpha 0.4)
  const as = Number(g?.away_score);
  const hs = Number(g?.home_score);
  const awayWin = Number.isFinite(as) && Number.isFinite(hs) && as > hs;
  const homeWin = Number.isFinite(as) && Number.isFinite(hs) && hs > as;
  const winTeam = awayWin ? g.away_team : homeWin ? g.home_team : g.home_team;
  const loseTeam = awayWin ? g.home_team : homeWin ? g.away_team : g.away_team;

  ctx.clearRect(0, 0, w, h);
  winLoseVerticalGradient(ctx, w, h, winTeam, loseTeam);

  const SAFE_TOP = 200;
  const SAFE_BOTTOM = 1720;

  // Date header (safe zone)
  ctx.fillStyle = TEXT_MAIN;
  // 날짜/제목: Noto Sans KR 900
  ctx.font = `900 80px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(fmtKoreanLongDate(date), 64, SAFE_TOP + 80);
  resetShadow(ctx);
  ctx.fillStyle = TEXT_MAIN;
  // 서브텍스트: Noto Sans KR 500
  ctx.font = `500 50px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("KBO 경기 결과", 64, SAFE_TOP + 80 + 68);
  resetShadow(ctx);

  // Place logos below date header, within safe zone
  const badgeY = SAFE_TOP + 210;
  const hk = teamKeyword(g.home_team);
  const ak = teamKeyword(g.away_team);

  // Logo box: 1.5x bigger (280x210), preserve original ratio
  const logoBoxW = 280;
  const logoBoxH = 210;
  const leftCenterX = 170;
  const rightCenterX = w - 170;
  const logoBoxY = badgeY;
  const homeImg = logosByTeamKey?.[hk] || null;
  const awayImg = logosByTeamKey?.[ak] || null;

  if (homeImg)
    drawImageContain(ctx, homeImg, leftCenterX - logoBoxW / 2, logoBoxY, logoBoxW, logoBoxH);
  else drawTeamBadge(ctx, leftCenterX, logoBoxY + logoBoxH / 2, logoBoxH / 2, g.home_team);

  if (awayImg)
    drawImageContain(ctx, awayImg, rightCenterX - logoBoxW / 2, logoBoxY, logoBoxW, logoBoxH);
  else drawTeamBadge(ctx, rightCenterX, logoBoxY + logoBoxH / 2, logoBoxH / 2, g.away_team);

  // Score: winner score highlighted, loser white
  const hsNum = Number(g?.home_score);
  const asNum = Number(g?.away_score);
  const awayWinScore = Number.isFinite(asNum) && Number.isFinite(hsNum) && asNum > hsNum;
  const homeWinScore = Number.isFinite(asNum) && Number.isFinite(hsNum) && hsNum > asNum;
  const winIsHome = homeWinScore || (!awayWinScore && !homeWinScore);

  const hsText = String(g.home_score ?? "—");
  const asText = String(g.away_score ?? "—");
  const sep = "  -  ";

  ctx.font = `1000 200px "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  const wHs = ctx.measureText(hsText).width;
  const wSep = ctx.measureText(sep).width;
  const wAs = ctx.measureText(asText).width;
  const totalW = wHs + wSep + wAs;
  const baseX = (w - totalW) / 2;
  const yy = Math.round((SAFE_TOP + SAFE_BOTTOM) / 2);

  ctx.fillStyle = winIsHome ? "#ffeb3b" : "#ffffff";
  ctx.fillText(hsText, baseX, yy);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(sep, baseX + wHs, yy);
  ctx.fillStyle = winIsHome ? "#ffffff" : "#ffeb3b";
  ctx.fillText(asText, baseX + wHs + wSep, yy);
  resetShadow(ctx);

  const m = g.mvp_batter;
  // Winner pitcher / MVP (no background box; text only)
  const boxX = 64;
  const boxY = SAFE_BOTTOM - 380;

  // Bottom summary (simple): ⭐ + pitcher/batter names (no stats)
  const cleanName = (s) =>
    String(s || "—")
      .replace(/\(추정\)/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18);

  const pitcherName = cleanName(g.winning_pitcher);
  const batterName = cleanName(m?.name);

  resetShadow(ctx); // no shadow
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const labelColor = "#00d4aa";
  const valueColor = "#ffffff";

  const drawCenteredLabelValue = (y, label, value, labelFont, valueFont) => {
    const gap = "  ";
    ctx.font = labelFont;
    const wL = ctx.measureText(label + gap).width;
    ctx.font = valueFont;
    const wV = ctx.measureText(value).width;
    const totalW = wL + wV;
    const startX = (w - totalW) / 2;

    ctx.font = labelFont;
    ctx.fillStyle = labelColor;
    ctx.fillText(label + gap, startX, y);
    ctx.font = valueFont;
    ctx.fillStyle = valueColor;
    ctx.fillText(value, startX + wL, y);
  };

  const emojiFont = `900 100px "${FONT_TITLE}", system-ui, sans-serif`; // Black Han Sans
  const labelFont = `900 60px "${FONT_TITLE}", system-ui, sans-serif`;
  const nameFont = `900 80px "${FONT_TITLE}", system-ui, sans-serif`;

  const baseY = SAFE_BOTTOM - 170;
  const lineGap = 110;

  // ⭐ (big, centered)
  ctx.font = emojiFont;
  ctx.fillStyle = "#ffffff";
  const star = "⭐";
  const hw = ctx.measureText(star).width;
  ctx.fillText(star, (w - hw) / 2, baseY - lineGap * 2);

  // pitcher / batter lines (names only)
  drawCenteredLabelValue(baseY - lineGap, "투수", pitcherName || "—", labelFont, nameFont);
  drawCenteredLabelValue(baseY, "타자", batterName || "—", labelFont, nameFont);

  // 하단 인덱스 텍스트 제거
}

function drawStandingsSlide(ctx, w, h, date, standings) {
  ctx.clearRect(0, 0, w, h);
  diagSplitStandingsBackground(ctx, w, h);

  const TOP_PAD = STANDINGS_CANVAS.topPad;
  const BOTTOM_PAD = STANDINGS_CANVAS.bottomPad;
  const TITLE_FS = STANDINGS_CANVAS.titleFs;
  const TITLE_BASELINE = TOP_PAD + TITLE_FS;
  const DATE_GAP_BELOW_TITLE = STANDINGS_CANVAS.dateGapBelowTitle;
  const DATE_FS = STANDINGS_CANVAS.dateFs;
  const DATE_BASELINE = TITLE_BASELINE + DATE_GAP_BELOW_TITLE;
  const DIVIDER_Y = DATE_BASELINE + STANDINGS_CANVAS.dividerOffsetBelowDate;
  const LIST_TOP = DIVIDER_Y + STANDINGS_CANVAS.gapBelowDivider;
  const LIST_BOTTOM = h - BOTTOM_PAD;
  const ROW_PITCH = (LIST_BOTTOM - LIST_TOP) / 10;

  const rows = Array.isArray(standings) ? standings : [];
  const rawDate =
    rows[0]?.date ?? rows[0]?.DATE ?? rows[0]?.game_date ?? "";
  const isoPick = String(rawDate || date || "").slice(0, 10);
  const dateLabel =
    /^\d{4}-\d{2}-\d{2}$/.test(isoPick) ? fmtKoreanLongDate(isoPick) : fmtKoreanLongDate(date);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.font = `${STANDINGS_CANVAS.titleWeight} ${TITLE_FS}px "${FONT_BODY}", sans-serif`;
  ctx.fillText("KBO 현재 순위", 64, TITLE_BASELINE);

  ctx.fillStyle = `rgba(255,255,255,${STANDINGS_CANVAS.dateOpacity})`;
  ctx.font = `700 ${DATE_FS}px "${FONT_BODY}", sans-serif`;
  ctx.fillText(dateLabel, 64, DATE_BASELINE);

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

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const r = rows[i] || {};
    const rankRaw = r.rank ?? r.RANK ?? r.순위 ?? i + 1;
    const rank = Number(rankRaw) || i + 1;
    const team = fmtTeamShort(
      r.team ?? r.TEAM_NM ?? r.team_name ?? r.name ?? r.id ?? r.팀 ?? "—"
    );
    const wn = r.wins ?? r.W ?? r.WIN;
    const ln = r.losses ?? r.L ?? r.LOSE;
    const ws = wn != null && String(wn).trim() !== "" ? String(wn) : "—";
    const ls = ln != null && String(ln).trim() !== "" ? String(ln) : "—";
    const pct = fmtStandingsWinRateDot(r.win_rate ?? r.WRA ?? r.WIN_PCT);

    const rowCenterY = LIST_TOP + i * ROW_PITCH + ROW_PITCH / 2;
    drawStandingsLineUnified(ctx, 64, rowCenterY, rank, team, ws, ls, pct, FONT_BODY);
  }
}

function Card8Shorts({ defaultDate }) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);

  const slides = useMemo(() => {
    const games = Array.isArray(data?.games) ? data.games : [];
    const s = [];
    s.push({ type: "summary" });
    for (const g of games) s.push({ type: "game", game: g });
    s.push({ type: "standings" });
    return s;
  }, [data]);

  const renderSlideToCanvas = async (idx, canvas) => {
    if (!canvas) return;
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

    const games = Array.isArray(data?.games) ? data.games : [];
    const standings = Array.isArray(data?.standings) ? data.standings : [];
    const slide = slides[idx];
    if (!slide) return;
    // Preload local SVG logos (same-origin) for this slide
    const teamKeys = new Set();
    if (slide.type === "summary") {
      for (const gg of games) {
        teamKeys.add(teamKeyword(gg?.home_team));
        teamKeys.add(teamKeyword(gg?.away_team));
      }
    } else if (slide.type === "game") {
      teamKeys.add(teamKeyword(slide.game?.home_team));
      teamKeys.add(teamKeyword(slide.game?.away_team));
    }
    const logosByTeamKey = {};
    for (const tk of teamKeys) {
      // Use the keyword to resolve path
      const img = await loadSvgLogo(tk);
      logosByTeamKey[tk] = img;
    }

    __baseballDecorImg = await loadPngImage("/baseball.png");

    if (slide.type === "summary")
      drawSummarySlide(ctx, w, h, date, games, logosByTeamKey, data?.headline);
    else if (slide.type === "game")
      drawGameSlide(
        ctx,
        w,
        h,
        date,
        slide.game,
        idx,
        Math.max(1, games.length),
        logosByTeamKey
      );
    else drawStandingsSlide(ctx, w, h, date, standings);
  };

  const onGenerate = async (nextDate) => {
    setBusy(true);
    setError(null);
    try {
      const d = nextDate || date;
      if (nextDate) setDate(nextDate);
      const [res, hl] = await Promise.all([
        postKbo({ action: "shorts_slides_data", date: d }),
        postKbo({ action: "daily_headline", date: d }).catch(() => ({
          headline: "",
        })),
      ]);
      setData({
        ...res,
        headline: hl?.headline != null ? String(hl.headline) : "",
      });
      setSlideIdx(0);
    } catch (e) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  const downloadPng = async (idx) => {
    const c = document.createElement("canvas");
    await renderSlideToCanvas(idx, c);
    const blob = await canvasToBlob(c);
    if (!blob) return;
    downloadBlob(blob, `shorts_${date}_${String(idx + 1).padStart(2, "0")}.png`);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    for (let i = 0; i < slides.length; i++) {
      const c = document.createElement("canvas");
      await renderSlideToCanvas(i, c);
      const blob = await canvasToBlob(c);
      if (!blob) continue;
      zip.file(
        `shorts_${date}_${String(i + 1).padStart(2, "0")}.png`,
        blob
      );
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `shorts_${date}.zip`);
  };

  return (
    <div className="section soft">
      <div className="section-title">8. 쇼츠 슬라이드 생성</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드</div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="primary" onClick={() => onGenerate()} disabled={busy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button type="button" className="primary primary-fill" onClick={downloadZip} disabled={!data || busy}>
          전체 ZIP 다운로드
        </button>
      </div>

      {error ? <pre className="result-error-light">{error}</pre> : null}

      {data ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <ShortsCanvas
              slideIdx={slideIdx}
              renderSlide={(canvas) => renderSlideToCanvas(slideIdx, canvas)}
            />
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 ({slideIdx + 1}/{slides.length})
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSlideIdx((x) => Math.max(0, x - 1))} disabled={slideIdx === 0}>
                이전
              </button>
              <button
                type="button"
                onClick={() => setSlideIdx((x) => Math.min(slides.length - 1, x + 1))}
                disabled={slideIdx >= slides.length - 1}
              >
                다음
              </button>
              <button type="button" onClick={() => downloadPng(slideIdx)} disabled={busy}>
                현재 슬라이드 PNG 다운로드
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              - 슬라이드1: 전체 결과 요약<br />
              - 슬라이드2~N: 경기별 상세(구장/승패투수/안타 최다 MVP)<br />
              - 마지막: KBO 순위(`standings`)
            </div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                width: "100%",
              }}
            >
              <button
                type="button"
                className="shorts-verify-link shorts-verify-link--naver"
                onClick={() =>
                  window.open(
                    `https://m.sports.naver.com/kbaseball/schedule/index?date=${String(date).replace(/-/g, "")}`,
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                🔍 네이버 야구에서 검증
              </button>
              <button
                type="button"
                className="shorts-verify-link shorts-verify-link--naver"
                onClick={() =>
                  window.open(
                    "https://m.sports.naver.com/kbaseball/record/kbo?seasonCode=2026&tab=teamRank",
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                📊 네이버 팀순위
              </button>
              <button
                type="button"
                className="shorts-verify-link shorts-verify-link--kbo"
                onClick={() =>
                  window.open("https://www.koreabaseball.com", "_blank", "noopener,noreferrer")
                }
              >
                ⚾ KBO 공식 홈페이지
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShortsCanvas({ slideIdx, renderSlide }) {
  const [ref, setRef] = useState(null);
  useEffect(() => {
    renderSlide(ref);
  }, [slideIdx, ref, renderSlide]);
  return (
    <div>
      <canvas
        ref={setRef}
        style={{ borderRadius: 14, border: "1px solid rgba(0,0,0,0.15)" }}
      />
    </div>
  );
}

/** API score "NC 5 : 8 삼성" → 표시용 "NC 5 vs 8 삼성" */
function mvpGameHeadline(g) {
  const score = String(g?.score || "").trim();
  if (score) return score.replace(/\s*:\s*/, " vs ");
  return String(g?.matchup || "").trim() || "—";
}

function SummaryCards({ batterRows }) {
  const rows = Array.isArray(batterRows) ? batterRows : [];
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((acc, r) => acc + (Number(r?.[k]) || 0), 0);
  const games = rows.length;
  const ab = sum("ab");
  const h = sum("h");
  const hr = sum("hr");
  const rbi = sum("rbi");
  const runs = sum("runs");
  const avg = ab > 0 ? h / ab : 0;
  const avgDot = formatSeasonAvgDot(avg);

  const cards = [
    { label: "경기수", value: `${games}` },
    { label: "타수", value: `${ab}` },
    { label: "안타", value: `${h}` },
    { label: "타율", value: avgDot || ".000", highlight: true },
    { label: "홈런", value: `${hr}` },
    { label: "타점", value: `${rbi}` },
    { label: "득점", value: `${runs}` },
  ];

  return (
    <div className="stat-cards" aria-label="전체 요약">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`stat-card ${c.highlight ? "highlight" : ""}`}
        >
          <div className="stat-v">{c.value}</div>
          <div className="stat-k">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const today = useMemo(() => seoulToday(), []);
  const { busy, runWith } = useAnalyzer();

  const [lastMeta, setLastMeta] = useState({ data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await postKbo({ action: "last_updated" });
        if (cancelled) return;
        setLastMeta({ data: res?.meta ?? null, error: null });
      } catch (e) {
        if (cancelled) return;
        setLastMeta({ data: null, error: e?.message || String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [tab, setTab] = useState("analysis");
  const [activeKey, setActiveKey] = useState(null);

  /* --- Analysis --- */
  const [mvpDate, setMvpDate] = useState(today);
  const [mvpOut, setMvpOut] = useState({
    text: "",
    summary: null,
    error: null,
  });
  const [mvpAuto, setMvpAuto] = useState({
    data: null,
    aiText: "",
    error: null,
  });
  const [mvpAutoBusy, setMvpAutoBusy] = useState(false);

  const [grBusy, setGrBusy] = useState(false);
  const [grOut, setGrOut] = useState({ date: today, games: [], error: null });
  const [grOpen, setGrOpen] = useState({});
  const [grBox, setGrBox] = useState({});

  const [teamKw, setTeamKw] = useState("LG");
  const [teamDays, setTeamDays] = useState("7");
  const [teamOut, setTeamOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const [pvP, setPvP] = useState("");
  const [pvB, setPvB] = useState("");
  const [pvTab, setPvTab] = useState("this"); // this | prev | both
  const [pvBusy, setPvBusy] = useState(false);
  const [pvStats, setPvStats] = useState({
    data: null,
    error: null,
  });
  const [pitcherTeam, setPitcherTeam] = useState("");
  const [batterTeam, setBatterTeam] = useState("");
  const [pitcherList, setPitcherList] = useState([]);
  const [batterList, setBatterList] = useState([]);
  const [pvPlayersBusy, setPvPlayersBusy] = useState(false);
  const [pvAiBusy, setPvAiBusy] = useState(false);
  const [pvAiOut, setPvAiOut] = useState({ text: "", error: null });
  const [pvGamesOpen, setPvGamesOpen] = useState(false);

  const loadPitchers = async (team) => {
    setPitcherTeam(team);
    setPvP("");
    setPitcherList([]);
    if (batterTeam === team) {
      setBatterTeam("");
      setBatterList([]);
      setPvB("");
    }
    if (!team) return;
    setPvPlayersBusy(true);
    try {
      const res = await postKbo({
        action: "get_players",
        team,
        type: "pitcher",
        year: pvTab === "prev" ? 2025 : 2026,
      });
      setPitcherList(Array.isArray(res?.players) ? res.players : []);
    } catch {
      setPitcherList([]);
    } finally {
      setPvPlayersBusy(false);
    }
  };

  const loadBatters = async (team) => {
    setBatterTeam(team);
    setPvB("");
    setBatterList([]);
    if (!team) return;
    setPvPlayersBusy(true);
    try {
      const res = await postKbo({
        action: "get_players",
        team,
        type: "batter",
        year: pvTab === "prev" ? 2025 : 2026,
      });
      setBatterList(Array.isArray(res?.players) ? res.players : []);
    } catch {
      setBatterList([]);
    } finally {
      setPvPlayersBusy(false);
    }
  };

  const [prPlayer, setPrPlayer] = useState("");
  const [prTeam, setPrTeam] = useState("");
  const [prPlayerSel, setPrPlayerSel] = useState("");
  const [prPlayerOptions, setPrPlayerOptions] = useState([]); // { value, name, label }
  const [prPlayersBusy, setPrPlayersBusy] = useState(false);
  const [prStart, setPrStart] = useState("2026-03-01");
  const [prEnd, setPrEnd] = useState("2026-03-31");
  const [prOut, setPrOut] = useState({
    text: "",
    summary: null,
    uiData: null,
    error: null,
  });

  const [spa, setSpa] = useState("");
  const [spb, setSpb] = useState("");
  const [spATeam, setSpATeam] = useState("");
  const [spBTeam, setSpBTeam] = useState("");
  const [spAList, setSpAList] = useState([]);
  const [spBList, setSpBList] = useState([]);
  const [spPlayersBusy, setSpPlayersBusy] = useState(false);
  const [spOut, setSpOut] = useState({
    text: "",
    summary: null,
    uiData: null,
    error: null,
  });

  const loadPrPlayers = async (team) => {
    setPrTeam(team);
    setPrPlayer("");
    setPrPlayerSel("");
    setPrPlayerOptions([]);
    if (!team) return;
    setPrPlayersBusy(true);
    try {
      const [pit, bat] = await Promise.all([
        postKbo({ action: "get_players", team, type: "pitcher", year: 2026 }),
        postKbo({ action: "get_players", team, type: "batter", year: 2026 }),
      ]);
      const pitNames = Array.isArray(pit?.players) ? pit.players : [];
      const batNames = Array.isArray(bat?.players) ? bat.players : [];
      const opts = [];
      for (const n of pitNames) {
        if (!n) continue;
        opts.push({ value: `${n}__pitcher`, name: n, label: `${n} (투수)` });
      }
      for (const n of batNames) {
        if (!n) continue;
        opts.push({ value: `${n}__batter`, name: n, label: `${n} (타자)` });
      }
      opts.sort((a, b) => String(a.label).localeCompare(String(b.label), "ko"));
      setPrPlayerOptions(opts);
    } catch {
      setPrPlayerOptions([]);
    } finally {
      setPrPlayersBusy(false);
    }
  };

  const loadSpA = async (team) => {
    setSpATeam(team);
    setSpa("");
    setSpAList([]);
    if (spBTeam === team) {
      setSpBTeam("");
      setSpb("");
      setSpBList([]);
    }
    if (!team) return;
    setSpPlayersBusy(true);
    try {
      const res = await postKbo({
        action: "get_players",
        team,
        type: "pitcher",
        year: 2026,
      });
      setSpAList(Array.isArray(res?.players) ? res.players : []);
    } catch {
      setSpAList([]);
    } finally {
      setSpPlayersBusy(false);
    }
  };

  const loadSpB = async (team) => {
    setSpBTeam(team);
    setSpb("");
    setSpBList([]);
    if (!team) return;
    setSpPlayersBusy(true);
    try {
      const res = await postKbo({
        action: "get_players",
        team,
        type: "pitcher",
        year: 2026,
      });
      setSpBList(Array.isArray(res?.players) ? res.players : []);
    } catch {
      setSpBList([]);
    } finally {
      setSpPlayersBusy(false);
    }
  };

  /* Predict */
  const [suPit, setSuPit] = useState("");
  const [suOpp, setSuOpp] = useState("");
  const [suPitcherTeam, setSuPitcherTeam] = useState("");
  const [suOppTeam, setSuOppTeam] = useState("");
  const [suPitcherList, setSuPitcherList] = useState([]);
  const [suPlayersBusy, setSuPlayersBusy] = useState(false);
  const [suOut, setSuOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const [pta, setPta] = useState("LG");
  const [ptb, setPtb] = useState("KT");
  const [ptaTeam, setPtaTeam] = useState("");
  const [ptbTeam, setPtbTeam] = useState("");
  const [predOut, setPredOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const teamKeywordFromFullName = (teamFull) =>
    String(teamFull || "").trim().split(/\s+/)[0] || "";

  const loadSuPitchers = async (team) => {
    setSuPitcherTeam(team);
    setSuPit("");
    setSuPitcherList([]);
    if (suOppTeam === team) {
      setSuOppTeam("");
      setSuOpp("");
    }
    if (!team) return;
    setSuPlayersBusy(true);
    try {
      const res = await postKbo({
        action: "get_players",
        team,
        type: "pitcher",
        year: 2026,
      });
      setSuPitcherList(Array.isArray(res?.players) ? res.players : []);
    } catch {
      setSuPitcherList([]);
    } finally {
      setSuPlayersBusy(false);
    }
  };

  /* Shorts */
  const [shDate, setShDate] = useState(today);
  const [hlOut, setHlOut] = useState({
    text: "",
    summary: null,
    error: null,
  });
  const [wkOut, setWkOut] = useState({
    text: "",
    summary: null,
    error: null,
  });
  const [worstOut, setWorstOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const pending = (key) => busy === key;

  const fmtKoreanDate = (iso) => {
    const s = String(iso || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "—";
    const [y, m, d] = s.split("-").map((x) => Number(x));
    return `${y}년 ${m}월 ${d}일`;
  };

  const setToToday = () => setMvpDate(today);
  const setToYesterday = () => {
    const parts = String(today).slice(0, 10).split("-").map(Number);
    if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) return;
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    dt.setUTCDate(dt.getUTCDate() - 1);
    setMvpDate(dt.toISOString().slice(0, 10));
  };

  const fetchGameResults = async () => {
    setActiveKey("game_results");
    setGrBusy(true);
    setGrOut({ date: mvpDate, games: [], error: null });
    setGrOpen({});
    setGrBox({});
    try {
      const res = await postKbo({ action: "game_results", date: mvpDate });
      setGrOut({
        date: res?.date || mvpDate,
        games: Array.isArray(res?.games) ? res.games : [],
        error: null,
      });
    } catch (e) {
      setGrOut({ date: mvpDate, games: [], error: e?.message || String(e) });
    } finally {
      setGrBusy(false);
    }
  };

  const toggleGame = async (gameId) => {
    const gid = String(gameId || "").trim();
    if (!gid) return;
    const nextOpen = !grOpen[gid];
    setGrOpen((m) => ({ ...m, [gid]: nextOpen }));
    if (!nextOpen) return;
    if (grBox[gid]?.data || grBox[gid]?.busy) return;
    setGrBox((m) => ({ ...m, [gid]: { busy: true, error: null, data: null } }));
    try {
      console.log("BOXSCORE_REQUEST gameId:", gid);
      const res = await postKbo({ action: "game_boxscore", game_id: gid });
      console.log("BOXSCORE_RESPONSE:", res);

      const batters_by_side =
        res?.batters_by_side && typeof res.batters_by_side === "object"
          ? res.batters_by_side
          : {
              away: Array.isArray(res?.awayBatters) ? res.awayBatters : [],
              home: Array.isArray(res?.homeBatters) ? res.homeBatters : [],
            };
      const pitchers_by_side =
        res?.pitchers_by_side && typeof res.pitchers_by_side === "object"
          ? res.pitchers_by_side
          : {
              away: Array.isArray(res?.awayPitchers) ? res.awayPitchers : [],
              home: Array.isArray(res?.homePitchers) ? res.homePitchers : [],
            };

      setGrBox((m) => ({
        ...m,
        [gid]: {
          busy: false,
          error: null,
          data: {
            batters: Array.isArray(res?.batters) ? res.batters : [],
            pitchers: Array.isArray(res?.pitchers) ? res.pitchers : [],
            // 렌더링은 아래 두 키를 우선 사용
            batters_by_side,
            pitchers_by_side,
            // 디버깅/호환용 키도 함께 유지
            awayBatters: Array.isArray(res?.awayBatters) ? res.awayBatters : [],
            homeBatters: Array.isArray(res?.homeBatters) ? res.homeBatters : [],
            awayPitchers: Array.isArray(res?.awayPitchers) ? res.awayPitchers : [],
            homePitchers: Array.isArray(res?.homePitchers) ? res.homePitchers : [],
          },
        },
      }));
    } catch (e) {
      setGrBox((m) => ({
        ...m,
        [gid]: { busy: false, error: e?.message || String(e), data: null },
      }));
    }
  };

  return (
    <div className="app-shell shell-wide">
      <div className="topbar">
        <div className="topbar-row">
          <span className="topbar-k">마지막 업데이트:</span>{" "}
          <span className="topbar-v">
            {lastMeta.error ? "—" : fmtKstTimestamp(lastMeta.data?.timestamp)}
          </span>
        </div>
        <div className="topbar-row">
          {(() => {
            const crawled = lastMeta.data?.crawled_date || "—";
            const games = Array.isArray(lastMeta.data?.games)
              ? lastMeta.data.games
              : [];
            const n = Number.isFinite(Number(lastMeta.data?.games_count))
              ? Number(lastMeta.data.games_count)
              : games.length;
            if (!games.length) {
              return (
                <span className="topbar-v">
                  경기일: {crawled} | 오늘 등록된 경기 없음
                </span>
              );
            }
            const line = games.map(fmtGameLine).join("  |  ");
            return (
              <span className="topbar-v">
                경기일: {crawled} | {line} ({n}경기)
              </span>
            );
          })()}
        </div>
      </div>
      <div className="layout">
        <aside className="sidebar">
          <div className="side-head">
            <div className="side-brand">KBO Dashboard</div>
            <div className="side-sub">좌측에서 실행 → 우측에서 결과 확인</div>
          </div>

          <nav className="side-tabs" aria-label="기능 분류">
            <button
              type="button"
              className={`side-tab ${tab === "analysis" ? "active" : ""}`}
              onClick={() => {
                setTab("analysis");
                setActiveKey(null);
              }}
            >
              분석 (1–5)
            </button>
            <button
              type="button"
              className={`side-tab ${tab === "predict" ? "active" : ""}`}
              onClick={() => {
                setTab("predict");
                setActiveKey(null);
              }}
            >
              예측 (6–7)
            </button>
            <button
              type="button"
              className={`side-tab ${tab === "shorts" ? "active" : ""}`}
              onClick={() => {
                setTab("shorts");
                setActiveKey(null);
              }}
            >
              쇼츠 (8–10)
            </button>
          </nav>

          {tab === "analysis" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">1. 경기 결과 조회</div>
                <label>날짜</label>
                <input
                  type="date"
                  value={mvpDate}
                  onChange={(e) => setMvpDate(e.target.value)}
                />
                <div className="date-actions-row">
                  <button
                    type="button"
                    className="primary primary-sm"
                    onClick={setToToday}
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    className="primary primary-sm"
                    onClick={setToYesterday}
                  >
                    어제
                  </button>
                  <button
                    type="button"
                    className="primary primary-fill"
                    disabled={grBusy}
                    onClick={fetchGameResults}
                  >
                    경기 결과 조회
                  </button>
                </div>
              </div>

              <div className="side-group">
                <div className="side-group-title">2. 팀별 주간 트렌드</div>
                <label>팀</label>
                <select
                  value={teamKw}
                  onChange={(e) => setTeamKw(e.target.value)}
                >
                  {KBO_TEAMS.map(({ label, keyword }) => (
                    <option key={keyword} value={keyword}>
                      {label}
                    </option>
                  ))}
                </select>
                <label>일수</label>
                <input
                  value={teamDays}
                  onChange={(e) => setTeamDays(e.target.value)}
                  placeholder="7"
                />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("team_week_2")}
                  onClick={() => {
                    setActiveKey("team_week");
                    runWith(
                      "team_week",
                      { teamKeyword: teamKw, days: Number(teamDays) || 7 },
                      "2",
                      setTeamOut
                    );
                  }}
                >
                  트렌드 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">3. 투수 vs 타자</div>
                <div className="grid-2">
                  <div>
                    <label>투수팀</label>
                    <select
                      value={pitcherTeam}
                      onChange={(e) => loadPitchers(e.target.value)}
                    >
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>투수</label>
                    <select
                      value={pvP}
                      onChange={(e) => setPvP(e.target.value)}
                      disabled={!pitcherTeam || pvPlayersBusy}
                    >
                      <option value="">
                        {pvPlayersBusy ? "불러오는 중…" : "투수 선택"}
                      </option>
                      {pitcherList.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div>
                    <label>타자팀</label>
                    <select
                      value={batterTeam}
                      onChange={(e) => loadBatters(e.target.value)}
                    >
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.filter((t) => t !== pitcherTeam).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>타자</label>
                    <select
                      value={pvB}
                      onChange={(e) => setPvB(e.target.value)}
                      disabled={!batterTeam || pvPlayersBusy}
                    >
                      <option value="">
                        {pvPlayersBusy ? "불러오는 중…" : "타자 선택"}
                      </option>
                      {batterList.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={pvBusy}
                  onClick={async () => {
                    setActiveKey("pv");
                    setPvBusy(true);
                    setPvAiOut({ text: "", error: null });
                    setPvGamesOpen(false);
                    try {
                      const res = await postKbo({
                        action: "pv_batter_stats",
                        pitcher: pvP,
                        batter: pvB,
                      });
                      setPvStats({ data: res, error: null });
                    } catch (e) {
                      setPvStats({
                        data: null,
                        error: e?.message || String(e),
                      });
                    } finally {
                      setPvBusy(false);
                    }
                  }}
                >
                  상대전적 통계 보기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">4. 기간별 선수 성적</div>
                <div className="grid-2">
                  <div>
                    <label>팀</label>
                    <select value={prTeam} onChange={(e) => loadPrPlayers(e.target.value)}>
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>선수</label>
                    <select
                      value={prPlayerSel}
                      onChange={(e) => {
                        const v = String(e.target.value || "");
                        setPrPlayerSel(v);
                        const name = v.split("__")[0] || "";
                        setPrPlayer(name);
                      }}
                      disabled={!prTeam || prPlayersBusy}
                    >
                      <option value="">
                        {prPlayersBusy ? "불러오는 중…" : "선수 선택"}
                      </option>
                      {prPlayerOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label>시작일</label>
                <input
                  type="date"
                  value={prStart}
                  onChange={(e) => setPrStart(e.target.value)}
                />
                <label>종료일</label>
                <input
                  type="date"
                  value={prEnd}
                  onChange={(e) => setPrEnd(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("player_range_4")}
                  onClick={() => {
                    setActiveKey("player_range");
                    runWith(
                      "player_range",
                      { player: prPlayer, start: prStart, end: prEnd },
                      "4",
                      setPrOut
                    );
                  }}
                >
                  기간 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">5. 선발 투수 비교</div>
                <div className="grid-2">
                  <div>
                    <label>투수 A 팀</label>
                    <select value={spATeam} onChange={(e) => loadSpA(e.target.value)}>
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>투수 A</label>
                    <select
                      value={spa}
                      onChange={(e) => setSpa(e.target.value)}
                      disabled={!spATeam || spPlayersBusy}
                    >
                      <option value="">
                        {spPlayersBusy ? "불러오는 중…" : "투수 선택"}
                      </option>
                      {spAList.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid-2">
                  <div>
                    <label>투수 B 팀</label>
                    <select value={spBTeam} onChange={(e) => loadSpB(e.target.value)}>
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.filter((t) => t !== spATeam).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>투수 B</label>
                    <select
                      value={spb}
                      onChange={(e) => setSpb(e.target.value)}
                      disabled={!spBTeam || spPlayersBusy}
                    >
                      <option value="">
                        {spPlayersBusy ? "불러오는 중…" : "투수 선택"}
                      </option>
                      {spBList.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("sp_compare_5")}
                  onClick={() => {
                    setActiveKey("sp_compare");
                    runWith(
                      "sp_compare",
                      { pitcherA: spa, pitcherB: spb },
                      "5",
                      setSpOut
                    );
                  }}
                >
                  비교 분석 실행
                </button>
              </div>
            </div>
          )}

          {tab === "predict" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">6. 선발 vs 상대 타선</div>
                <div className="grid-2">
                  <div>
                    <label>투수팀</label>
                    <select
                      value={suPitcherTeam}
                      onChange={(e) => loadSuPitchers(e.target.value)}
                    >
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>투수</label>
                    <select
                      value={suPit}
                      onChange={(e) => setSuPit(e.target.value)}
                      disabled={!suPitcherTeam || suPlayersBusy}
                    >
                      <option value="">
                        {suPlayersBusy ? "불러오는 중…" : "투수 선택"}
                      </option>
                      {suPitcherList.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label>상대팀</label>
                <select
                  value={suOppTeam}
                  onChange={(e) => {
                    const team = e.target.value;
                    setSuOppTeam(team);
                    setSuOpp(teamKeywordFromFullName(team));
                  }}
                  disabled={!suPitcherTeam}
                >
                  <option value="">팀 선택</option>
                  {KBO_TEAM_NAMES.filter((t) => t !== suPitcherTeam).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("sp_matchup_6")}
                  onClick={() => {
                    setActiveKey("sp_matchup");
                    runWith(
                      "sp_matchup",
                      { teamPitcher: suPit, opponentTeamKeyword: suOpp },
                      "6",
                      setSuOut
                    );
                  }}
                >
                  매칭업 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">7. 최근 5경기 폼 예측</div>
                <div className="grid-2">
                  <div>
                    <label>팀 A</label>
                    <select
                      value={ptaTeam}
                      onChange={(e) => {
                        const team = e.target.value;
                        setPtaTeam(team);
                        setPta(teamKeywordFromFullName(team));
                        if (ptbTeam === team) {
                          setPtbTeam("");
                          setPtb("");
                        }
                      }}
                    >
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>팀 B</label>
                    <select
                      value={ptbTeam}
                      onChange={(e) => {
                        const team = e.target.value;
                        setPtbTeam(team);
                        setPtb(teamKeywordFromFullName(team));
                      }}
                      disabled={!ptaTeam}
                    >
                      <option value="">팀 선택</option>
                      {KBO_TEAM_NAMES.filter((t) => t !== ptaTeam).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("predict_form_7")}
                  onClick={() => {
                    setActiveKey("predict_form");
                    runWith(
                      "predict_form",
                      { teamA: pta, teamB: ptb },
                      "7",
                      setPredOut
                    );
                  }}
                >
                  예측 실행
                </button>
              </div>
            </div>
          )}

          {tab === "shorts" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">8. 쇼츠 슬라이드 (PNG/ZIP)</div>
                <label>날짜</label>
                <input
                  type="date"
                  value={shDate}
                  onChange={(e) => setShDate(e.target.value)}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy === "shorts_slides_open"}
                    onClick={() => {
                      const todayStr = new Date().toLocaleDateString("sv-SE", {
                        timeZone: "Asia/Seoul",
                      });
                      setShDate(todayStr);
                      setActiveKey("shorts_slides");
                    }}
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy === "shorts_slides_open"}
                    onClick={() => {
                      const t = new Date(
                        new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })
                      );
                      t.setDate(t.getDate() - 1);
                      setShDate(t.toLocaleDateString("sv-SE"));
                      setActiveKey("shorts_slides");
                    }}
                  >
                    어제
                  </button>
                  <button
                    type="button"
                    className="primary primary-fill"
                    disabled={busy === "shorts_slides_open"}
                    onClick={() => {
                      setActiveKey("shorts_slides");
                    }}
                  >
                    슬라이드 생성 열기
                  </button>
                </div>
              </div>

              <div className="side-group">
                <div className="side-group-title">9. 주간 최고 투수 (쇼츠)</div>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("shorts_pitcher_week_9")}
                  onClick={() => {
                    setActiveKey("shorts_pitcher_week");
                    runWith("shorts_pitcher_week", {}, "9", setWkOut);
                  }}
                >
                  생성
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">10. 최악 매칭업 (쇼츠)</div>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("shorts_worst_matchup_10")}
                  onClick={() => {
                    setActiveKey("shorts_worst_matchup");
                    runWith("shorts_worst_matchup", {}, "10", setWorstOut);
                  }}
                >
                  생성
                </button>
              </div>
            </div>
          )}

        </aside>

        <main className="results">
          <div className="results-inner">
            {/* results are rendered by activeKey; sidebar contains all controls */}
            {!activeKey ? (
              <div className="empty-state">← 좌측에서 분석을 실행하세요</div>
            ) : activeKey === "game_results" ? (
              <div className="result-page">
                <div className="result-hero-title">
                  📅 {fmtKoreanDate(grOut.date || mvpDate)} 경기 결과 (
                  {Array.isArray(grOut.games) ? grOut.games.length : 0}경기)
                </div>

                <div className="section soft">
                  <div className="section-title">경기 목록</div>
                  {grBusy ? (
                    <div className="muted">불러오는 중…</div>
                  ) : grOut.error ? (
                    <pre className="result-error-light">{grOut.error}</pre>
                  ) : Array.isArray(grOut.games) && grOut.games.length ? (
                    <div className="game-card-list">
                      {grOut.games.map((g) => {
                        const gid = g?.game_id;
                        const away = g?.away_team || "—";
                        const home = g?.home_team || "—";
                        const as =
                          g?.away_score == null ? null : Number(g.away_score);
                        const hs =
                          g?.home_score == null ? null : Number(g.home_score);
                        const hasScore =
                          Number.isFinite(as) && Number.isFinite(hs);
                        const awayWin = hasScore ? as > hs : false;
                        const homeWin = hasScore ? hs > as : false;
                        const winScoreStyle = {
                          fontWeight: 1000,
                          color: "#00c853",
                        };
                        const loseScoreStyle = {
                          fontWeight: 900,
                          color: "rgba(26,26,46,0.55)",
                        };
                        return (
                          <div
                            key={gid || `${away}_${home}`}
                            className="game-card"
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleGame(gid)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleGame(gid);
                              }
                            }}
                            style={{ cursor: "pointer" }}
                          >
                            <div className="game-head">
                              <div className="game-title">
                                {away}{" "}
                                <span style={awayWin ? winScoreStyle : loseScoreStyle}>
                                  {hasScore ? as : "—"}
                                </span>{" "}
                                vs {home}{" "}
                                <span style={homeWin ? winScoreStyle : loseScoreStyle}>
                                  {hasScore ? hs : "—"}
                                </span>
                              </div>
                              <div className="game-score mono">
                                {grOpen[String(gid || "")] ? "상세 닫기" : "상세 보기"}
                              </div>
                            </div>
                            <div className="game-line">
                              승리투수: {g?.winning_pitcher || "—"} / 패전투수:{" "}
                              {g?.losing_pitcher || "—"}
                            </div>

                            {grOpen[String(gid || "")] && (
                              <div className="game-line">
                                {grBox[String(gid || "")]?.busy ? (
                                  <span className="muted">박스스코어 불러오는 중…</span>
                                ) : grBox[String(gid || "")]?.error ? (
                                  <pre className="result-error-light">
                                    {grBox[String(gid || "")]?.error}
                                  </pre>
                                ) : grBox[String(gid || "")]?.data ? (
                                  (() => {
                                    const data = grBox[String(gid || "")]?.data;
                                    const batSide = data?.batters_by_side || null;
                                    const pitSide = data?.pitchers_by_side || null;
                                    const awayBatters = Array.isArray(batSide?.away)
                                      ? batSide.away
                                      : Array.isArray(data?.awayBatters)
                                        ? data.awayBatters
                                      : [];
                                    const homeBatters = Array.isArray(batSide?.home)
                                      ? batSide.home
                                      : Array.isArray(data?.homeBatters)
                                        ? data.homeBatters
                                      : [];
                                    const awayPitchers = Array.isArray(pitSide?.away)
                                      ? pitSide.away
                                      : Array.isArray(data?.awayPitchers)
                                        ? data.awayPitchers
                                      : [];
                                    const homePitchers = Array.isArray(pitSide?.home)
                                      ? pitSide.home
                                      : Array.isArray(data?.homePitchers)
                                        ? data.homePitchers
                                      : [];

                                    const formatBatterLine = (r, idx) => {
                                      const name = r?.player || r?.name || "—";
                                      const ab = r?.ab ?? r?.AB ?? 0;
                                      const h = r?.h ?? r?.H ?? 0;
                                      const hrRaw = r?.hr ?? r?.HR ?? 0;
                                      const hr = Number(hrRaw);
                                      const runsRaw =
                                        r?.runs ?? r?.R ?? r?.run ?? r?.RUN ?? r?.득점 ?? 0;
                                      const runs = Number(runsRaw);
                                      const rbiRaw =
                                        r?.rbi ?? r?.RBI ?? r?.bi ?? r?.타점 ?? 0;
                                      const rbi = Number(rbiRaw);
                                      const avgDot = formatSeasonAvgDot(
                                        r?.avg ??
                                          r?.AVG ??
                                          r?.batting_avg ??
                                          r?.battingAvg ??
                                          r?.타율
                                      );
                                      const bo = pickBattingOrder(r);
                                      const no = bo ?? (idx ?? 0) + 1;
                                      const hrStr =
                                        Number.isFinite(hr) && hr > 0 ? ` ${hr}홈런` : "";
                                      return `${no}. ${name} — ${ab}타수 ${h}안타 ${runs}득점 ${rbi}타점${hrStr}${
                                        avgDot ? ` ${avgDot}` : ""
                                      }`;
                                    };

                                    const batterLines = (rows) => {
                                      const list = Array.isArray(rows) ? rows : [];
                                      const indexed = list.map((r, idx) => ({
                                        r,
                                        idx,
                                        bo: pickBattingOrder(r),
                                      }));
                                      indexed.sort((a, b) => {
                                        const ao = a.bo ?? 999;
                                        const bo = b.bo ?? 999;
                                        if (ao !== bo) return ao - bo;
                                        return a.idx - b.idx; // keep original order within same batting_order
                                      });
                                      const out = [];
                                      let prevBo = null;
                                      for (const it of indexed) {
                                        const isSub =
                                          it.bo != null && prevBo != null && it.bo === prevBo;
                                        out.push({
                                          key:
                                            String(it.r?.player || it.r?.name || "") +
                                            "_" +
                                            String(it.idx),
                                          text: isSub
                                            ? `   └ ${formatBatterLine(it.r, it.idx).replace(/^\s*\d+\.\s*/, "")}`
                                            : formatBatterLine(it.r, it.idx),
                                          isSub,
                                        });
                                        if (it.bo != null) prevBo = it.bo;
                                      }
                                      return out;
                                    };

                                    const formatPitcherLine = (r) => {
                                      const name = r?.player || r?.name || "—";
                                      const ip = r?.ip ?? r?.IP ?? 0;
                                      const ipStr = formatInnings(ip) || "0이닝";
                                      const er =
                                        r?.er ??
                                        r?.ER ??
                                        r?.earned_runs ??
                                        r?.r ??
                                        r?.R ??
                                        0;
                                      const so = r?.so ?? r?.SO ?? r?.k ?? r?.K ?? 0;
                                      const eraStr = formatEraMaybe(r?.era ?? r?.ERA);
                                      return `${name} — ${ipStr} ${er}실점 ${so}K ERA ${eraStr}`;
                                    };
                                    return (
                                      <div style={{ marginTop: 10 }}>
                                        <div className="muted" style={{ fontWeight: 900 }}>
                                          박스스코어
                                        </div>
                                        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                                          <div>
                                            <div className="muted">
                                              원정팀 타자 기록 ({away})
                                            </div>
                                            {awayBatters.length ? (
                                              <div className="mono batter-lines">
                                                {batterLines(awayBatters).map((x) => (
                                                  <div
                                                    key={x.key}
                                                    className={
                                                      x.isSub
                                                        ? "batter-line batter-line-sub"
                                                        : "batter-line"
                                                    }
                                                  >
                                                    {x.text}
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="mono">데이터 없음</div>
                                            )}
                                          </div>

                                          <div>
                                            <div className="muted">
                                              홈팀 타자 기록 ({home})
                                            </div>
                                            {homeBatters.length ? (
                                              <div className="mono batter-lines">
                                                {batterLines(homeBatters).map((x) => (
                                                  <div
                                                    key={x.key}
                                                    className={
                                                      x.isSub
                                                        ? "batter-line batter-line-sub"
                                                        : "batter-line"
                                                    }
                                                  >
                                                    {x.text}
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="mono">데이터 없음</div>
                                            )}
                                          </div>

                                          <div>
                                            <div className="muted">투수 기록</div>
                                            <div
                                              style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr 1fr",
                                                gap: 10,
                                                marginTop: 6,
                                              }}
                                            >
                                              <div>
                                                <div className="muted">원정 ({away})</div>
                                                <pre className="mono">
                                                  {awayPitchers.length
                                                    ? awayPitchers
                                                        .slice(0, 16)
                                                        .map(formatPitcherLine)
                                                        .join("\n")
                                                    : "데이터 없음"}
                                                </pre>
                                              </div>
                                              <div>
                                                <div className="muted">홈 ({home})</div>
                                                <pre className="mono">
                                                  {homePitchers.length
                                                    ? homePitchers
                                                        .slice(0, 16)
                                                        .map(formatPitcherLine)
                                                        .join("\n")
                                                    : "데이터 없음"}
                                                </pre>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <span className="muted">데이터 없음</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="muted">경기 데이터가 없습니다.</div>
                  )}
                </div>

                <div className="section soft">
                  <div className="section-title">🏆 MVP 분석 (기존 기능)</div>
                  <button
                    type="button"
                    className="ai-btn"
                    disabled={mvpAutoBusy}
                    onClick={async () => {
                      setMvpAutoBusy(true);
                      setMvpAuto({ data: null, aiText: "", error: null });
                      try {
                        const res = await postKbo({
                          action: "mvp_auto",
                          date: mvpDate,
                        });
                        console.log("[mvp_auto] overall_best:", res?.overall_best);
                        console.log(
                          "[mvp_auto] bestPitcher/bestBatter:",
                          res?.overall_best?.pitcher,
                          res?.overall_best?.batter
                        );
                        setMvpAuto({
                          data: res,
                          aiText: res.text ?? "",
                          error: null,
                        });
                      } catch (e) {
                        setMvpAuto({
                          data: null,
                          aiText: "",
                          error: e?.message || String(e),
                        });
                      } finally {
                        setMvpAutoBusy(false);
                      }
                    }}
                  >
                    {mvpAutoBusy ? "생성 중…" : "MVP 분석 실행"}
                  </button>

                  {mvpAuto.error ? (
                    <pre className="result-error-light">{mvpAuto.error}</pre>
                  ) : mvpAuto.data ? (
                    (() => {
                      const d = mvpAuto.data;
                      const overall = d.overall_best;
                      const games = d.games || [];
                      const pitch = overall?.pitcher;
                      const bat = overall?.batter;
                      return (
                        <>
                          <div className="best-grid" style={{ marginTop: 12 }}>
                            <div className="best-card">
                              <div className="best-head">🥎 베스트 투수</div>
                              <div className="best-name">
                                <strong>{pitch?.name || "—"}</strong>{" "}
                                {pitch?.team ? (
                                  <span className="best-team">({pitch.team})</span>
                                ) : null}
                              </div>
                              <div className="best-sub">{pitch?.key_stats || "—"}</div>
                            </div>
                            <div className="best-card">
                              <div className="best-head">⚾ 베스트 타자</div>
                              <div className="best-name">
                                <strong>{bat?.name || "—"}</strong>{" "}
                                {bat?.team ? (
                                  <span className="best-team">({bat.team})</span>
                                ) : null}
                              </div>
                              <div className="best-sub">{bat?.key_stats || "—"}</div>
                            </div>
                          </div>

                          <div className="section soft mvp-per-game-section">
                            <div className="section-title">📋 경기별 MVP</div>
                            <div className="mvp-game-list">
                              {games.length ? (
                                games.map((g) => (
                                  <div
                                    className="mvp-game-card"
                                    key={g.game_id || g.matchup}
                                  >
                                    <div className="mvp-game-title">
                                      {mvpGameHeadline(g)}
                                    </div>
                                    <div className="mvp-game-line">
                                      ⚾ 투수:{" "}
                                      {g.pitcher_mvp
                                        ? `${g.pitcher_mvp.name}${
                                            g.pitcher_mvp.team
                                              ? ` (${teamAbbr(g.pitcher_mvp.team)})`
                                              : ""
                                          } — ${g.pitcher_mvp.key_stats}`
                                        : "—"}
                                    </div>
                                    <div className="mvp-game-line">
                                      🏏 타자:{" "}
                                      {g.batter_mvp
                                        ? `${g.batter_mvp.name}${
                                            g.batter_mvp.team
                                              ? ` (${teamAbbr(g.batter_mvp.team)})`
                                              : ""
                                          } — ${g.batter_mvp.key_stats}`
                                        : "—"}
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="muted">경기 데이터가 없습니다.</div>
                              )}
                            </div>
                          </div>

                          <div className="section soft claude-rationale-section">
                            <div className="section-title">Claude 선정 이유</div>
                            <MarkdownView text={d.text || mvpAuto.aiText} />
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="muted" style={{ marginTop: 12 }}>
                      위에서 MVP 분석을 실행하면 결과가 표시됩니다.
                    </div>
                  )}
                </div>
              </div>
            ) : activeKey === "team_week" ? (
              <div className="result-page">
                <div className="result-hero-title">
                  {teamKw} 주간 트렌드 ({teamDays}일)
                </div>
                <div className="section soft">
                  <div className="section-title">분석</div>
                  {teamOut.error ? (
                    <pre className="result-error-light">{teamOut.error}</pre>
                  ) : (
                    <MarkdownView text={teamOut.text} />
                  )}
                </div>
              </div>
            ) : activeKey === "pv" ? (
              <div className="result-page">
                <div className="result-hero-title">
                  {pvP || "투수"} vs {pvB || "타자"}
                </div>
                <div className="mini-tabs" role="tablist" aria-label="기간 선택">
                  <button
                    type="button"
                    className={`mini-tab ${pvTab === "this" ? "active" : ""}`}
                    onClick={() => setPvTab("this")}
                  >
                    이번시즌 (2026)
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${pvTab === "prev" ? "active" : ""}`}
                    onClick={() => setPvTab("prev")}
                  >
                    직전시즌 (2025)
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${pvTab === "both" ? "active" : ""}`}
                    onClick={() => setPvTab("both")}
                  >
                    2시즌 합산 (2025~2026)
                  </button>
                </div>
                {pvStats.error ? (
                  <pre className="result-error-light">{pvStats.error}</pre>
                ) : pvStats.data ? (
                  (() => {
                    const d = pvStats.data;
                    const s =
                      pvTab === "this"
                        ? d.thisSeason
                        : pvTab === "prev"
                          ? d.prevSeason
                          : d.bothSeasons;
                    const rows =
                      (pvTab === "this"
                        ? d.per_game?.thisSeason
                        : pvTab === "prev"
                          ? d.per_game?.prevSeason
                          : d.per_game?.bothSeasons) ?? [];
                    const avg = Number(s?.avg);
                    const avgHot = Number.isFinite(avg) && avg >= 0.3;
                    return (
                      <>
                        <div className="metric-row">
                          <div className="metric big">
                            <div className="metric-k">타율</div>
                            <div className={`metric-v ${avgHot ? "hot" : "cold"}`}>
                              {s?.avg ?? "—"}
                            </div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">AB</div>
                            <div className="metric-v">{s?.ab ?? 0}</div>
                            <div className="metric-sub">타수</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">H</div>
                            <div className="metric-v">{s?.h ?? 0}</div>
                            <div className="metric-sub">안타</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">HR</div>
                            <div className="metric-v">{s?.hr ?? 0}</div>
                            <div className="metric-sub">홈런</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">BB</div>
                            <div className="metric-v">{s?.bb ?? 0}</div>
                            <div className="metric-sub">볼넷</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">SO</div>
                            <div className="metric-v">{s?.so ?? 0}</div>
                            <div className="metric-sub">삼진</div>
                          </div>
                        </div>

                        <div className="section soft">
                          <div className="section-title">공통 출전 경기</div>
                          <div
                            style={{
                              background: "#fff3e0",
                              border: "1px solid rgba(255, 152, 0, 0.25)",
                              color: "rgba(26, 26, 46, 0.78)",
                              padding: "10px 12px",
                              borderRadius: 12,
                              fontSize: "0.86rem",
                              fontWeight: 800,
                              marginBottom: 10,
                              lineHeight: 1.35,
                            }}
                          >
                            ⚠️ 주의: 같은 경기에 출전한 기록 기준입니다.
                            <br />
                            투수 교체 시점에 따라 실제 직접 대결이 아닐 수 있습니다.
                          </div>
                          <div className="timeline">
                            {rows.length ? (
                              rows.map((r) => (
                                <div className="timeline-item" key={r.game_id}>
                                  <div className="timeline-date">{r.date}</div>
                                  <div className="timeline-body">
                                    <div className="timeline-line">
                                      <span className="timeline-meta">
                                        {r.team_abbr} {r.home_away}({r.opponent_label})
                                      </span>
                                      <span className="timeline-gid mono">
                                        {r.game_id_display}
                                      </span>
                                    </div>
                                    <div className="timeline-line">
                                      <b>{r.pitcher_name}</b> — {r.pitcher_stats}
                                    </div>
                                    <div className="timeline-line">
                                      <b>{r.batter_name}</b> — {r.batter_stats}
                                    </div>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="muted">기록이 없습니다.</div>
                            )}
                          </div>
                        </div>

                        <div className="section soft">
                          <div className="section-title">AI 서술 분석</div>
                          <button
                            type="button"
                            className="ai-btn"
                            disabled={pvAiBusy || pvBusy}
                            onClick={async () => {
                              setPvAiBusy(true);
                              setPvAiOut({ text: "", error: null });
                              try {
                                const r = await postKbo({
                                  action: "pv_batter",
                                  pitcher: pvP,
                                  batter: pvB,
                                  tab: pvTab,
                                });
                                setPvAiOut({ text: r.text ?? "", error: null });
                              } catch (e) {
                                setPvAiOut({
                                  text: "",
                                  error: e?.message || String(e),
                                });
                              } finally {
                                setPvAiBusy(false);
                              }
                            }}
                          >
                            {pvAiBusy ? "생성 중…" : "🤖 AI 서술 분석 보기"}
                          </button>
                          {pvAiOut.error ? (
                            <pre className="result-error-light">{pvAiOut.error}</pre>
                          ) : pvAiOut.text ? (
                            <MarkdownView text={pvAiOut.text} />
                          ) : (
                            <div className="muted">
                              통계를 먼저 확인하고 필요할 때만 실행하세요.
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="empty-state">← 좌측에서 상대전적 통계를 실행하세요</div>
                )}
              </div>
            ) : (
              <div className="result-page">
                <div className="section soft">
                  {activeKey === "player_range" ? (
                    <>
                      {(() => {
                        const big = extractFirstHeading(prOut.text) || `${prPlayer || "선수"} 성적 분석`;
                        const games = Math.max(
                          prOut.uiData?.pitcherRows?.length ?? 0,
                          prOut.uiData?.batterRows?.length ?? 0
                        );
                        const sub = `${prTeam || "—"} / ${prPlayer || "—"} / ${games}경기`;
                        return (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontWeight: 1000, fontSize: "1.12rem" }}>{big}</div>
                            <div style={{ color: "rgba(26, 26, 46, 0.7)", fontWeight: 900, marginTop: 4 }}>
                              {sub}
                            </div>
                          </div>
                        );
                      })()}
                      {prOut.error ? (
                        <pre className="result-error-light">{prOut.error}</pre>
                      ) : pending("player_range_4") ? (
                        <div className="muted">생성 중…</div>
                      ) : (
                        <>
                          <div className="section-title">📊 전체 요약</div>
                          <SummaryCards batterRows={prOut.uiData?.batterRows} />
                          <MarkdownView
                            text={removeFirstHeading(prOut.text).replace(/^\s*0\s*(\r?\n)+/, "")}
                          />
                        </>
                      )}
                    </>
                  ) : activeKey === "sp_compare" ? (
                    <>
                      {(() => {
                        const ui = spOut.uiData;
                        const a = ui?.pitcherA || spa || "투수A";
                        const b = ui?.pitcherB || spb || "투수B";
                        const ra = Array.isArray(ui?.recentA) ? ui.recentA : [];
                        const rb = Array.isArray(ui?.recentB) ? ui.recentB : [];
                        if (!ra.length && !rb.length) return null;
                        return (
                          <>
                            <div className="section-title">{a} vs {b}</div>
                            {ra.length ? (
                              <>
                                <div className="muted" style={{ marginTop: 6, fontWeight: 900 }}>
                                  {a} 경기별 기록
                                </div>
                                <SimpleStatsTable
                                  headers={[
                                    { key: "date", label: "날짜" },
                                    { key: "opponent", label: "상대" },
                                    { key: "home_away", label: "홈/원정" },
                                    { key: "ip", label: "이닝" },
                                    { key: "r", label: "실점" },
                                    { key: "h", label: "피안타" },
                                    { key: "so", label: "K" },
                                    { key: "era", label: "ERA" },
                                  ]}
                                  rows={ra.map((r) => ({
                                    date: r.date,
                                    opponent: r.opponent,
                                    home_away: r.home_away,
                                    ip: formatInnings(r.ip) || "0이닝",
                                    r: r.r ?? 0,
                                    h: r.h ?? 0,
                                    so: r.so ?? 0,
                                    era: formatEraMaybe(r.era),
                                  }))}
                                />
                              </>
                            ) : null}
                            {rb.length ? (
                              <>
                                <div className="muted" style={{ marginTop: 10, fontWeight: 900 }}>
                                  {b} 경기별 기록
                                </div>
                                <SimpleStatsTable
                                  headers={[
                                    { key: "date", label: "날짜" },
                                    { key: "opponent", label: "상대" },
                                    { key: "home_away", label: "홈/원정" },
                                    { key: "ip", label: "이닝" },
                                    { key: "r", label: "실점" },
                                    { key: "h", label: "피안타" },
                                    { key: "so", label: "K" },
                                    { key: "era", label: "ERA" },
                                  ]}
                                  rows={rb.map((r) => ({
                                    date: r.date,
                                    opponent: r.opponent,
                                    home_away: r.home_away,
                                    ip: formatInnings(r.ip) || "0이닝",
                                    r: r.r ?? 0,
                                    h: r.h ?? 0,
                                    so: r.so ?? 0,
                                    era: formatEraMaybe(r.era),
                                  }))}
                                />
                              </>
                            ) : null}
                          </>
                        );
                      })()}
                      <ResultBlock
                        title={`${spATeam || "—"} / ${spa || "—"} / ${(
                          spOut.uiData?.recentA?.length ?? 0
                        )}경기  vs  ${spBTeam || "—"} / ${spb || "—"} / ${(
                          spOut.uiData?.recentB?.length ?? 0
                        )}경기`}
                        text={spOut.text}
                        error={spOut.error}
                        pending={pending("sp_compare_5")}
                      />
                    </>
                  ) : activeKey === "sp_matchup" ? (
                    <ResultBlock
                      title={null}
                      text={suOut.text}
                      error={suOut.error}
                      pending={pending("sp_matchup_6")}
                    />
                  ) : activeKey === "predict_form" ? (
                    <ResultBlock
                      title={null}
                      text={predOut.text}
                      error={predOut.error}
                      pending={pending("predict_form_7")}
                    />
                  ) : activeKey === "shorts_highlight" ? (
                    <ResultBlock
                      title={null}
                      text={hlOut.text}
                      error={hlOut.error}
                      pending={pending("shorts_highlight_8")}
                    />
                  ) : activeKey === "shorts_slides" ? (
                    <Card8Shorts defaultDate={shDate} />
                  ) : activeKey === "shorts_pitcher_week" ? (
                    <ResultBlock
                      title={null}
                      text={wkOut.text}
                      error={wkOut.error}
                      pending={pending("shorts_pitcher_week_9")}
                    />
                  ) : activeKey === "shorts_worst_matchup" ? (
                    <ResultBlock
                      title={null}
                      text={worstOut.text}
                      error={worstOut.error}
                      pending={pending("shorts_worst_matchup_10")}
                    />
                  ) : (
                    <div className="muted">← 좌측에서 실행하세요</div>
                  )}
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      <footer className="footer-note">
        Netlify 배포 시 환경 변수{" "}
        <span className="mono">ANTHROPIC_API_KEY</span>,{" "}
        <span className="mono">FIREBASE_SERVICE_ACCOUNT_JSON</span> 를 설정하고{" "}
        <span className="mono">netlify dev</span> 또는 프로덕션에서 API를
        호출하세요. 순수{" "}
        <span className="mono">npm run dev</span>만으로는 함수가 없어 API가
        동작하지 않습니다. Claude 응답이 길면 무료 플랜 함수 타임아웃(기본
        10초)에 걸릴 수 있으니 Netlify 대시보드에서 Functions 타임아웃을 늘리거나
        플랜을 확인하세요.
      </footer>
    </div>
  );
}
