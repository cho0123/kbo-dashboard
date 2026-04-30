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

// 파스텔 팀 컬러 (Card8Shorts 배경용)
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

/** Card8Shorts 첫 슬라이드 악센트 — 날짜·VS·서브타이틀·헤드라인 고정 */
const SHORTS_SUMMARY_ACCENT = "#FFD700";

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

  // secondary: 5:5 비율 기반 사선 분할
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
  // secondary: full opacity (same treatment as primary)
  ctx.fillStyle = s;
  ctx.fill();

  // boundary line (white 5px)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, yL);
  ctx.lineTo(w, yR);
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

/** 순위 슬라이드 배경 — 단색 네이비 + 야구공 워터마크 */
function drawStandingsSolidBackground(ctx, w, h) {
  ctx.fillStyle = "#1E88E5";
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);
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

function drawSummarySlide(ctx, w, h, date, games, logosByTeamKey) {
  // Summary slide: 고정 야구장 그린 + 골드 악센트(텍스트만)
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

  // Title: "⚾ KBO 2026.04.28 (화)" — 날짜는 골드 고정
  const titleLeft = "⚾ KBO ";
  const titleRight = fmtKoreanDotDate(date);
  const titleBaseline = SAFE_TOP + 80;
  ctx.font = `900 78px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(titleLeft, 64, titleBaseline);
  const leftW = ctx.measureText(titleLeft).width;
  ctx.fillStyle = "#F9FF00";
  ctx.fillText(titleRight, 64 + leftW, titleBaseline);
  resetShadow(ctx);

  if (!games?.length) {
    return;
  }

  const cardW = 952;
  const cardH = 230;
  const x = 64;
  let y = SAFE_TOP + 200;

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
    const hsNum = Number(g?.home_score);
    const asNum = Number(g?.away_score);
    const homeWin = Number.isFinite(hsNum) && Number.isFinite(asNum) && hsNum > asNum;
    const awayWin = Number.isFinite(hsNum) && Number.isFinite(asNum) && asNum > hsNum;

    ctx.font = scoreFont;
    const w1 = ctx.measureText(hsText + pad).width;
    const w3 = ctx.measureText(pad + asText).width;
    ctx.font = vsFont;
    const w2 = ctx.measureText(vsText).width;
    const totalW = w1 + w2 + w3;
    const startX = x + (cardW - totalW) / 2;
    const yy = y + Math.round(cardH * 0.62);

    ctx.font = scoreFont;
    ctx.fillStyle = homeWin ? "#FFB3DE" : "#FFFFFF";
    ctx.fillText(hsText + pad, startX, yy);
    ctx.fillStyle = "#F9FF00";
    ctx.font = vsFont;
    ctx.fillText(vsText, startX + w1, yy + 6);
    ctx.font = scoreFont;
    ctx.fillStyle = awayWin ? "#FFB3DE" : "#FFFFFF";
    ctx.fillText(pad + asText, startX + w1 + w2, yy);
    resetShadow(ctx);

    y += cardH + 22;
    if (y > SAFE_BOTTOM - 120) break;
  }

  // "오늘 N경기" 텍스트 제거
}

function drawGameSlide(ctx, w, h, date, g, index, total, logosByTeamKey, batters, standings) {
  const SAFE_TOP = 200;
  const SAFE_BOTTOM = 1720;
  const DIVIDER_Y = 960;

  const hsNum = Number(g?.home_score);
  const asNum = Number(g?.away_score);
  const homeWin = Number.isFinite(hsNum) && Number.isFinite(asNum) ? hsNum > asNum : true;
  const winTeam = homeWin ? g.home_team : g.away_team;
  const loseTeam = homeWin ? g.away_team : g.home_team;

  ctx.clearRect(0, 0, w, h);
  winLoseVerticalGradient(ctx, w, h, winTeam, loseTeam);

  const hk = teamKeyword(g.home_team);
  const ak = teamKeyword(g.away_team);
  const homeImg = logosByTeamKey?.[hk] || null;
  const awayImg = logosByTeamKey?.[ak] || null;

  const cleanName = (s) =>
    String(s || "—")
      .replace(/\(추정\)/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18);

  const fmtEra = (v) => {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toFixed(2);
    const s = String(v ?? "").trim();
    return s ? s : "—";
  };

  const homeStreak =
    standings?.find(
      (s) =>
        String(s?.team || "").includes(teamKeyword(g.home_team)) ||
        String(g.home_team || "").includes(teamKeyword(s?.team))
    )?.streak || "";
  const awayStreak =
    standings?.find(
      (s) =>
        String(s?.team || "").includes(teamKeyword(g.away_team)) ||
        String(g.away_team || "").includes(teamKeyword(s?.team))
    )?.streak || "";

  const winStreak = homeWin ? homeStreak : awayStreak;
  const loseStreak = homeWin ? awayStreak : homeStreak;

  // 1) 날짜
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 80px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText(fmtKoreanLongDate(date), 64, SAFE_TOP + 80);
  resetShadow(ctx);

  // 2) 서브텍스트
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `500 50px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("KBO 경기 결과", 64, SAFE_TOP + 160);
  resetShadow(ctx);

  // 3) 팀 로고
  const drawLogoInBox = (x, y, boxW, boxH, teamName, img) => {
    if (!img) {
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

  const logoY = SAFE_TOP + 220;
  const logoBoxW = 260;
  const logoBoxH = 180;
  drawLogoInBox(64, logoY, logoBoxW, logoBoxH, g.home_team, homeImg);
  drawLogoInBox(w - 64 - logoBoxW, logoY, logoBoxW, logoBoxH, g.away_team, awayImg);

  // 4) 스코어 (홈 - 원정)
  const hsText = String(g?.home_score ?? "—");
  const asText = String(g?.away_score ?? "—");
  const vsText = " - ";
  const scoreY = SAFE_TOP + 480;

  const homeIsWinner =
    Number.isFinite(hsNum) && Number.isFinite(asNum) ? hsNum > asNum : true;
  const scoreFont = `1000 145px "${FONT_TITLE}", system-ui, sans-serif`;
  const vsFont = `1000 145px "${FONT_TITLE}", system-ui, sans-serif`;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = scoreFont;
  const w1 = ctx.measureText(hsText).width;
  ctx.font = vsFont;
  const w2 = ctx.measureText(vsText).width;
  ctx.font = scoreFont;
  const w3 = ctx.measureText(asText).width;
  const startX = (w - (w1 + w2 + w3)) / 2;

  shadowTextSoft(ctx);
  ctx.font = scoreFont;
  ctx.fillStyle = homeIsWinner ? "#FFD700" : "#FFFFFF";
  ctx.fillText(hsText, startX, scoreY);

  ctx.font = vsFont;
  ctx.fillStyle = "#F9FF00";
  ctx.fillText(vsText, startX + w1, scoreY);

  ctx.font = scoreFont;
  ctx.fillStyle = homeIsWinner ? "#FFFFFF" : "#FFD700";
  ctx.fillText(asText, startX + w1 + w2, scoreY);
  resetShadow(ctx);

  // 5) 선발투수 대결
  const homeStarterName = cleanName(g?.home_starter?.name ?? "");
  const awayStarterName = cleanName(g?.away_starter?.name ?? "");
  const homeStarterEra = g?.home_starter?.era ?? null;
  const awayStarterEra = g?.away_starter?.era ?? null;
  const starterLine = `${homeStarterName || "—"}(${fmtEra(homeStarterEra)}) vs ${awayStarterName || "—"}(${fmtEra(awayStarterEra)})`;

  ctx.textAlign = "center";
  ctx.font = `700 54px "${FONT_BODY}", system-ui, sans-serif`;
  const homePart = `${homeStarterName || "—"}(${fmtEra(homeStarterEra)})`;
  const awayPart = `${awayStarterName || "—"}(${fmtEra(awayStarterEra)})`;
  const vsPart = "  vs  ";
  const yStarter = SAFE_TOP + 605;
  ctx.textAlign = "left";
  ctx.font = `700 54px "${FONT_BODY}", system-ui, sans-serif`;
  const wHomeP = ctx.measureText(homePart).width;
  const wVsP = ctx.measureText(vsPart).width;
  const wAwayP = ctx.measureText(awayPart).width;
  const sx = (w - (wHomeP + wVsP + wAwayP)) / 2;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(homePart, sx, yStarter);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(vsPart, sx + wHomeP, yStarter);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(awayPart, sx + wHomeP + wVsP, yStarter);

  // 하단 영역
  const leftX = 72;
  const listTop = DIVIDER_Y + 180;
  const lineGap = 107;

  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  // 하단 텍스트 그림자(가독성)
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  // • 구장명
  ctx.font = `700 50px "${FONT_BODY}", system-ui, sans-serif`;
  const venueText = String(g?.venue || "—").slice(0, 24) || "—";
  ctx.fillText(`• ${venueText}`, leftX, listTop);

  // • 순위 (standings 기반)
  const homeTeamName = String(g?.home_team || "—");
  const awayTeamName = String(g?.away_team || "—");
  const homeKey = teamKeyword(homeTeamName);
  const awayKey = teamKeyword(awayTeamName);
  const rows = Array.isArray(standings) ? standings : [];
  const pickRowTeamRaw = (r) =>
    r?.team ?? r?.TEAM_NM ?? r?.team_name ?? r?.name ?? "";
  const homeRow =
    rows.find((r) => teamKeyword(pickRowTeamRaw(r)) === homeKey) || null;
  const awayRow =
    rows.find((r) => teamKeyword(pickRowTeamRaw(r)) === awayKey) || null;
  const pickRank = (r) => r?.rank ?? r?.RANK ?? r?.순위 ?? null;
  const homeRank = pickRank(homeRow);
  const awayRank = pickRank(awayRow);
  ctx.font = `600 48px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(
    `• 순위  ${homeTeamName} ${homeRank ?? "—"}위  |  ${awayTeamName} ${awayRank ?? "—"}위`,
    leftX,
    listTop + lineGap * 1
  );

  // • 상대전적 (홈팀기준)
  const h2h =
    g?.headToHead ??
    g?.head_to_head ??
    g?.headToHeadRecord ??
    g?.head_to_head_record ??
    null;
  const h2hText = h2h
    ? `• 상대전적  ${homeTeamName} ${h2h.win ?? 0}승 ${h2h.draw ?? 0}무 ${h2h.lose ?? 0}패`
    : `• 상대전적 데이터 없음`;
  ctx.font = `600 48px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(h2hText, leftX, listTop + lineGap * 2);

  // • 승/패 투수
  const winNameRaw = String(g?.winning_pitcher || winTeam || "—");
  const loseNameRaw = String(g?.losing_pitcher || loseTeam || "—");
  const winEra = g?.winning_pitcher_era ?? null;
  const loseEra = g?.losing_pitcher_era ?? null;
  ctx.font = `600 48px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(
    `• 승: ${cleanName(winNameRaw)}(${fmtEra(winEra)})  패: ${cleanName(loseNameRaw)}(${fmtEra(loseEra)})`,
    leftX,
    listTop + lineGap * 3
  );

  // • ⭐ MVP
  const mvpName = cleanName(g?.mvp_batter?.name ?? "—");
  const mvpH = g?.mvp_batter?.h ?? null;
  const mvpHr = g?.mvp_batter?.hr ?? null;
  const mvpStat =
    mvpH == null && mvpHr == null ? "" : ` (${mvpH ?? "—"}H ${mvpHr ?? "—"}HR)`;
  ctx.font = `700 54px "Gmarket Sans", system-ui, sans-serif`;
  ctx.fillText(`• ⭐ ${mvpName}${mvpStat}`, leftX, listTop + lineGap * 4);

  // 하단 텍스트 그림자 초기화
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 하단 인덱스 텍스트 제거
}

function drawNextGameSlide(ctx, w, h, date, g, index, total, logosByTeamKey, standings) {
  const SAFE_TOP = 200;
  const SAFE_BOTTOM = 1720;
  const DIVIDER_Y = 960;

  const homeTeam = String(g?.home_team || "—");
  const awayTeam = String(g?.away_team || "—");

  const homeNg = g?.home_next_game ?? g?.next_game ?? g?.nextGame ?? null;
  const awayNg = g?.away_next_game ?? null;

  const cleanName = (s) =>
    String(s || "—")
      .replace(/\(추정\)/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18);

  const pickNextInfoForTeam = (teamName, ng) => {
    const team = String(teamName || "—");
    const tKey = teamKeyword(team);
    const obj = ng && typeof ng === "object" ? ng : null;
    const dateIso = String(obj?.game_date || date || "").slice(0, 10);
    const time = String(obj?.game_time || "—").trim() || "—";
    const homeNm = String(obj?.home_team || "—");
    const awayNm = String(obj?.away_team || "—");
    const isHome = teamKeyword(homeNm) === tKey;
    const opponent = isHome ? awayNm : homeNm;
    const venue = String(obj?.venue || "—").slice(0, 24) || "—";
    return {
      team,
      teamKey: tKey,
      opponent,
      oppKey: teamKeyword(opponent),
      dateIso,
      time,
      venue,
      next_h2h: obj?.next_h2h ?? null,
    };
  };

  // 승/패 팀 판별 (drawGameSlide와 동일 방식)
  const hsNum = Number(g?.home_score);
  const asNum = Number(g?.away_score);
  const homeWin =
    Number.isFinite(hsNum) && Number.isFinite(asNum) ? hsNum > asNum : true;
  const winTeam = homeWin ? homeTeam : awayTeam;
  const loseTeam = homeWin ? awayTeam : homeTeam;

  const pickNgForTeam = (teamName) => {
    const k = teamKeyword(teamName);
    if (k && k === teamKeyword(homeTeam)) return homeNg;
    if (k && k === teamKeyword(awayTeam)) return awayNg;
    return null;
  };

  // next_game 슬라이드: 반드시 반대로 교차 (상단=패전팀, 하단=승리팀)
  const top = pickNextInfoForTeam(loseTeam, pickNgForTeam(loseTeam));
  const bot = pickNextInfoForTeam(winTeam, pickNgForTeam(winTeam));

  const shortVenue = (v) => {
    const s = String(v || "").trim();
    if (!s) return "—";
    // "광주-기아 챔피언스 필드" -> "광주", "잠실" -> "잠실"
    return s.split(/[\s-]/)[0] || s;
  };

  const VENUE_FULLNAME = {
    잠실: "잠실야구장",
    수원: "수원 KT위즈파크",
    광주: "광주-기아 챔피언스필드",
    대구: "대구 삼성라이온즈파크",
    인천: "인천 SSG랜더스필드",
    사직: "부산 사직야구장",
    창원: "창원 NC파크",
    고척: "고척 스카이돔",
    대전: "대전 한화생명이글스파크",
  };
  const venueFullName = (v) => {
    const key = shortVenue(v);
    return VENUE_FULLNAME[key] || String(v || key || "—");
  };

  // 배경: next_game는 승패팀 색상 교차 (상단=패전팀, 하단=승리팀)
  ctx.clearRect(0, 0, w, h);
  winLoseVerticalGradient(ctx, w, h, loseTeam, winTeam);

  // 중앙 타이틀: NEXT GAME (VS 폰트 기반, 더 크게, 반투명)
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `1000 155px "Gmarket Sans", "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("NEXT GAME", w / 2, DIVIDER_Y + 30);
  resetShadow(ctx);

  // NEXT GAME 아래 날짜/시간
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFD700";
  ctx.font = `1000 78px "Gmarket Sans", "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  const dateIso = top.dateIso && top.dateIso !== "—" ? top.dateIso : bot.dateIso;
  const timeText = top.time && top.time !== "—" ? top.time : bot.time;
  ctx.fillText(`${fmtKoreanLongDate(dateIso)}  ${timeText}`, w / 2, DIVIDER_Y + 120);
  resetShadow(ctx);

  // 2) 팀 로고 (drawGameSlide와 동일 위치/크기)
  const drawLogoInBox = (x, y, boxW, boxH, teamName, img) => {
    if (!img) {
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

  // 팀 배치: 상단팀은 더 위로, 하단팀은 더 아래로
  const logoBoxW = 260;
  const logoBoxH = 180;
  const MAIN_LOGO_SCALE = 1.3 * 1.3; // 기존 대비 +30%
  const mainLogoW = Math.round(logoBoxW * MAIN_LOGO_SCALE);
  const mainLogoH = Math.round(logoBoxH * MAIN_LOGO_SCALE);
  const oppLogoW = Math.round(mainLogoW / 2);
  const oppLogoH = Math.round(mainLogoH / 2);

  const PAD_X = 64;
  const RIGHT_X = w - 64 - oppLogoW;

  // 상단(홈팀): SAFE_TOP + 100 근처
  const topMainY = SAFE_TOP + 100;
  const topOppY = topMainY + Math.round((mainLogoH - oppLogoH) / 2);

  // 하단(원정팀): 캔버스 하단에서 300px 위 근처로 정보까지 포함해 배치
  // info2(상대전적) baseline이 (h - 300) 근처가 되도록 역산
  const bottomInfo2YTarget = h - 300;
  const botMainY = Math.max(
    DIVIDER_Y + 120,
    bottomInfo2YTarget - (mainLogoH + 70 + 70)
  );
  const botOppY = botMainY + Math.round((mainLogoH - oppLogoH) / 2);
  const topTeamImg = logosByTeamKey?.[top.teamKey] || null;
  const topOppImg = logosByTeamKey?.[top.oppKey] || null;
  drawLogoInBox(PAD_X, topMainY, mainLogoW, mainLogoH, top.team, topTeamImg);
  drawLogoInBox(RIGHT_X, topOppY, oppLogoW, oppLogoH, top.opponent, topOppImg);

  // 3) 상단: VS (두 로고 정중앙)
  const topLeftCx = PAD_X + mainLogoW / 2;
  const topLeftCy = topMainY + mainLogoH / 2;
  const topRightCx = RIGHT_X + oppLogoW / 2;
  const topRightCy = topOppY + oppLogoH / 2;
  const topVsX = (topLeftCx + topRightCx) / 2;
  const topVsY = (topLeftCy + topRightCy) / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#F9FF00";
  ctx.font = `1000 110px "Gmarket Sans", "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("VS", topVsX, topVsY);
  resetShadow(ctx);

  // 상단팀(홈팀) 로고 아래 정보 (가운데 정렬)
  const topInfoY = topMainY + mainLogoH + 70;
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  // 하단 영역 텍스트 그림자(가독성) - 지정값
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.font = `800 52px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(`${venueFullName(top.venue)}`, w / 2, topInfoY);
  ctx.font = `700 48px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  const topH2h = top?.next_h2h
    ? `시즌 상대전적 : ${Number(top.next_h2h.win ?? 0) || 0}승 ${Number(top.next_h2h.draw ?? 0) || 0}무 ${Number(top.next_h2h.lose ?? 0) || 0}패`
    : `시즌 상대전적 : 데이터 없음`;
  ctx.fillText(topH2h, w / 2, topInfoY + 70);
  // 그림자 초기화
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // ===== 하단: home_next_game 데이터 =====
  const botTeamImg = logosByTeamKey?.[bot.teamKey] || null;
  const botOppImg = logosByTeamKey?.[bot.oppKey] || null;
  drawLogoInBox(PAD_X, botMainY, mainLogoW, mainLogoH, bot.team, botTeamImg);
  drawLogoInBox(RIGHT_X, botOppY, oppLogoW, oppLogoH, bot.opponent, botOppImg);

  // 하단: VS (두 로고 정중앙)
  const botLeftCx = PAD_X + mainLogoW / 2;
  const botLeftCy = botMainY + mainLogoH / 2;
  const botRightCx = RIGHT_X + oppLogoW / 2;
  const botRightCy = botOppY + oppLogoH / 2;
  const botVsX = (botLeftCx + botRightCx) / 2;
  const botVsY = (botLeftCy + botRightCy) / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#F9FF00";
  ctx.font = `1000 110px "Gmarket Sans", "${FONT_TITLE}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  ctx.fillText("VS", botVsX, botVsY);
  resetShadow(ctx);

  // 하단팀(원정팀) 로고 아래 정보 (가운데 정렬, 상대전적 win/lose 반전)
  const botInfoY = botMainY + mainLogoH + 70;
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFFFFF";
  // 하단 영역 텍스트 그림자(가독성) - 지정값
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.font = `800 52px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(`${venueFullName(bot.venue)}`, w / 2, botInfoY);
  ctx.font = `700 48px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  const botH2h = bot?.next_h2h
    ? `시즌 상대전적 : ${Number(bot.next_h2h.win ?? 0) || 0}승 ${Number(bot.next_h2h.draw ?? 0) || 0}무 ${Number(bot.next_h2h.lose ?? 0) || 0}패`
    : `시즌 상대전적 : 데이터 없음`;
  ctx.fillText(botH2h, w / 2, botInfoY + 70);
  // 그림자 초기화
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  void standings;
  void SAFE_BOTTOM;
  void index;
  void total;
}

function drawStandingsSlide(ctx, w, h, date, standings, logosByTeamKey) {
  ctx.clearRect(0, 0, w, h);
  drawStandingsSolidBackground(ctx, w, h);

  const TOP_PAD = 120;
  const BOTTOM_PAD = 120;
  const TITLE_FS = 72;
  const TITLE_BASELINE = TOP_PAD + TITLE_FS;
  const DATE_BASELINE = TITLE_BASELINE + 80;
  const DIVIDER_Y = DATE_BASELINE + 20;
  const LIST_TOP = DIVIDER_Y + 60;
  const LIST_BOTTOM = h - BOTTOM_PAD;
  const ROW_PITCH = (LIST_BOTTOM - LIST_TOP) / 10;

  const rows = Array.isArray(standings) ? standings : [];
  console.log("standings[0]:", JSON.stringify(rows[0]));
  const rawDate =
    rows[0]?.date ?? rows[0]?.DATE ?? rows[0]?.game_date ?? "";
  const isoPick = String(rawDate || date || "").slice(0, 10);
  const dateLabel =
    /^\d{4}-\d{2}-\d{2}$/.test(isoPick) ? fmtKoreanLongDate(isoPick) : fmtKoreanLongDate(date);

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

  // Layout constants
  const X0 = 64;
  const TOP_GAP = 36;
  const GRID_GAP = 20;

  // Top (1~2)
  const TOP_W = 952;
  const TOP_H = 220;

  // Bottom (3~10) grid
  const GRID_W = 460;
  const GRID_H = 230;
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
      // Some SVG images can report 0x0 even when drawable.
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
    // KBO GB usually in 0.5 steps; show one decimal, trim trailing .0
    const s = gamesBehind.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };

  // 1st box
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

    // logo (120x120)
    const logoSize = 120;
    const lx = x + 28;
    const ly = y + (TOP_H - logoSize) / 2;
    drawLogoInBox(lx, ly, logoSize, logoSize, d.teamRaw, d.logo);

    // text
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
    ctx.letterSpacing = "0px";
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = `400 52px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = "#FFD700";
    ctx.fillText(`  ${d.ws}승 ${d.ls}패 ${d.pct}`, tx + leftW, lineY);
    ctx.restore();
    ctx.restore();
  }

  // 2nd box
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
    ctx.letterSpacing = "0px";
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = `400 52px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = "#1a3a5c";
    ctx.fillText(`  ${d.ws}승 ${d.ls}패 ${d.pct}${gbPart}`, tx + leftW, lineY);
    ctx.restore();
    ctx.restore();
  }

  // 3~10 boxes (2 columns x 4 rows)
  const gridStartY = LIST_TOP + TOP_H * 2 + TOP_GAP + GRID_GAP;
  for (let idx = 2; idx < Math.min(rows.length, 10); idx++) {
    const d = pick(idx);
    const j = idx - 2; // 0..7
    const col = j % 2; // 0..1
    const row = Math.floor(j / 2); // 0..3
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

    // rank (top-left)
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `900 60px "${FONT_TITLE}", system-ui, sans-serif`;
    ctx.fillStyle = "#FFF5E0";
    ctx.fillText(String(d.rank), x + 24, y + 24);

    // logo (center) or team name fallback
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

    // GB (bottom-right)
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

function Card8Shorts({ defaultDate }) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);

  const slides = useMemo(() => {
    const games = Array.isArray(data?.games) ? data.games : [];
    const s = [];
    // Summary slides: 누적 표시 (1경기 → 2경기 → ... → 전체)
    const n = Math.max(1, games.length);
    for (let upto = 1; upto <= n; upto++) {
      s.push({ type: "summary", upto });
    }
    for (const g of games) {
      s.push({ type: "game", game: g });
      if (g?.home_next_game || g?.away_next_game || g?.next_game || g?.nextGame)
        s.push({ type: "next_game", game: g });
    }
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
    const standings = Array.isArray(data?.standings)
      ? data.standings
      : Array.isArray(data?.standing_rows)
        ? data.standing_rows
        : [];
    const batters = Array.isArray(data?.batters) ? data.batters : [];
    const slide = slides[idx];
    if (!slide) return;
    // Preload local SVG logos (same-origin) for this slide
    const teamKeys = new Set();
    if (slide.type === "summary") {
      const upto = Math.max(1, Math.min(Number(slide.upto) || games.length || 1, games.length || 1));
      const subset = games.slice(0, upto);
      for (const gg of subset) {
        teamKeys.add(teamKeyword(gg?.home_team));
        teamKeys.add(teamKeyword(gg?.away_team));
      }
    } else if (slide.type === "game") {
      teamKeys.add(teamKeyword(slide.game?.home_team));
      teamKeys.add(teamKeyword(slide.game?.away_team));
    } else if (slide.type === "next_game") {
      const homeTeam = String(slide.game?.home_team ?? "");
      const awayTeam = String(slide.game?.away_team ?? "");
      teamKeys.add(teamKeyword(homeTeam));
      teamKeys.add(teamKeyword(awayTeam));

      const homeNg =
        slide.game?.home_next_game ?? slide.game?.next_game ?? slide.game?.nextGame ?? null;
      const awayNg = slide.game?.away_next_game ?? null;
      const addNgTeams = (ng) => {
        if (!ng || typeof ng !== "object") return;
        teamKeys.add(teamKeyword(ng?.home_team ?? ""));
        teamKeys.add(teamKeyword(ng?.away_team ?? ""));
      };
      addNgTeams(homeNg);
      addNgTeams(awayNg);
    } else if (slide.type === "standings") {
      for (const r of standings) {
        teamKeys.add(teamKeyword(r?.team ?? r?.TEAM_NM ?? r?.team_name ?? r?.name ?? ""));
      }
    }
    const logosByTeamKey = {};
    for (const tk of teamKeys) {
      // Use the keyword to resolve path
      const img = await loadSvgLogo(tk);
      logosByTeamKey[tk] = img;
    }

    __baseballDecorImg = await loadPngImage("/baseball.png");

    if (slide.type === "summary")
      drawSummarySlide(
        ctx,
        w,
        h,
        date,
        games.slice(0, Math.max(1, Math.min(Number(slide.upto) || games.length || 1, games.length || 1))),
        logosByTeamKey
      );
    else if (slide.type === "game")
      drawGameSlide(
        ctx,
        w,
        h,
        date,
        slide.game,
        idx,
        Math.max(1, games.length),
        logosByTeamKey,
        batters,
        standings
      );
    else if (slide.type === "next_game")
      drawNextGameSlide(
        ctx,
        w,
        h,
        date,
        slide.game,
        idx,
        Math.max(1, games.length),
        logosByTeamKey,
        standings
      );
    else drawStandingsSlide(ctx, w, h, date, standings, logosByTeamKey);
  };

  const onGenerate = async (nextDate) => {
    setBusy(true);
    setError(null);
    try {
      const d = nextDate || date;
      if (nextDate) setDate(nextDate);
      const res = await postKbo({ action: "shorts_slides_data", date: d });
      console.log("standings[0] (fetched):", JSON.stringify(res?.standings?.[0]));
      setData({
        ...res,
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
          {" "}
          <button
            type="button"
            onClick={async () => {
              try {
                const r = await postKbo({ action: "trigger_crawl" });
                if (r?.success) alert("✅ 크롤링 시작됐어요!");
                else alert("❌ 실패했어요");
              } catch {
                alert("❌ 실패했어요");
              }
            }}
          >
            크롤링 실행
          </button>
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
