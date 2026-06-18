import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postKbo, seoulToday } from "./api.js";
import VideoPresetsPanel from "./VideoPresetsPanel.jsx";
import MusicLibraryPanel from "./MusicLibraryPanel.jsx";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import Shorts3Panel from "./Shorts3Panel.jsx";
import Shorts3ThumbnailPanel from "./Shorts3ThumbnailPanel.jsx";
import Shorts3AIPanel from "./Shorts3AIPanel.jsx";
import Shorts4Panel from "./Shorts4Panel.jsx";
import ShortsPvPanel from "./ShortsPvPanel.jsx";
import Shorts5Panel from "./Shorts5Panel.jsx";
import ShortsProductReviewPanel from "./ShortsProductReviewPanel.jsx";
import VideoPrep from "./VideoPrep.jsx";
import MemoPadModal from "./MemoPadModal.jsx";
import JSZip from "jszip";
import { drawBaseballBackground, loadShortsBaseballDecor } from "./shortsBaseballDecor.js";
import { drawIntroSlide, drawStandingsSlide, KBO_INTRO_TEAM_KEYS, loadSvgLogo } from "./shorts1IntroStandingsDraw.js";
import {
  drawTomorrowPreviewGameSlide,
  drawTomorrowPreviewIntroSlide,
  SHORTS2_INTRO_TEAM_KEYS,
} from "./shorts2TomorrowPreviewDraw.js";

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

/** ShortsCanvas 미리보기 CSS 크기(360×640) ↔ 논리 캔버스 1080×1920 */
const SHORTS_EXPORT_W = 1080;
const SHORTS_EXPORT_H = 1920;

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

/** 일간 쇼츠 경기결과: 경기 순 로테이션 (kbo-api shorts_slides_data와 동일) */
const TEAM_ROTATION = [
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

const DAY_INDEX = { 0: 6, 1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4 };

function shortsRotationIsoDate(d) {
  const s = String(d || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function seoulWeekdayAndDayOfYearForShortsRotation(dateStr) {
  const safe = shortsRotationIsoDate(dateStr);
  if (!safe) return { dayOfWeek: 0, dayOfYear: 1 };
  const anchor = new Date(`${safe}T12:00:00+09:00`);
  const wdParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  }).formatToParts(anchor);
  const wdName = wdParts.find((p) => p.type === "weekday")?.value || "Sunday";
  const map = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  const dayOfWeek = map[wdName] ?? 0;
  const [y, m, da] = safe.split("-").map(Number);
  const t = Date.UTC(y, m - 1, da);
  const yearStart = Date.UTC(y, 0, 0);
  const dayOfYear = Math.round((t - yearStart) / 86400000);
  return { dayOfWeek, dayOfYear };
}

function targetTeamForShortsRotationDate(dateStr) {
  const safe = shortsRotationIsoDate(dateStr);
  if (!safe) return TEAM_ROTATION[0];
  const { dayOfWeek, dayOfYear } = seoulWeekdayAndDayOfYearForShortsRotation(safe);
  const daySlot = DAY_INDEX[dayOfWeek] ?? 0;
  const weekOfYear = Math.floor(dayOfYear / 7);
  const teamIdx = (weekOfYear + daySlot) % 10;
  return TEAM_ROTATION[teamIdx];
}

function gameInvolvesShortsRotationTeam(game, rotationToken) {
  const kw = String(rotationToken || "").trim();
  if (!kw) return false;
  const h = teamKeyword(game?.home_team || "");
  const a = teamKeyword(game?.away_team || "");
  return h === kw || a === kw;
}

function sortGamesForDailyShortsRotation(games, dateStr) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length) return list;
  const target = targetTeamForShortsRotationDate(dateStr);
  const front = [];
  const back = [];
  for (const g of list) {
    if (gameInvolvesShortsRotationTeam(g, target)) front.push(g);
    else back.push(g);
  }
  if (!front.length) return list;
  return [...front, ...back];
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

/** 슬라이드 전환 후 html2canvas 직전 — 매번 최신 FontFaceSet 반영 */
async function waitFontsReadyForCapture() {
  if (typeof document === "undefined" || !document.fonts?.ready) return;
  try {
    await document.fonts.ready;
  } catch {
    // ignore
  }
}

const CAPTURE_INTER_SLIDE_DELAY_MS = 100;

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/** NEXT GAME 슬라이드: 년도 없음, "N월 N일(요일) AM/PM h:mm", 24h → 12h */
function fmtNextGameSlideDateTime(iso, timeRaw) {
  const s = String(iso || "").slice(0, 10);
  const dm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const wk = dm
    ? new Date(s).toLocaleDateString("ko-KR", { weekday: "short" })
    : "";
  const datePart = dm
    ? `${Number(dm[2])}월 ${Number(dm[3])}일(${wk})`
    : "";

  const t = String(timeRaw ?? "").trim();
  const tm = t.match(/^(\d{1,2}):(\d{2})/);
  if (!tm || !datePart) {
    if (datePart && (!t || t === "—")) return datePart;
    return datePart ? `${datePart} ${t || "—"}`.trim() : t || "—";
  }

  let hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return datePart ? `${datePart} ${t}` : t;
  }

  const minStr = String(minute).padStart(2, "0");
  let period;
  let h12;
  if (hour === 0) {
    period = "AM";
    h12 = 12;
  } else if (hour < 12) {
    period = "AM";
    h12 = hour;
  } else if (hour === 12) {
    period = "PM";
    h12 = 12;
  } else {
    period = "PM";
    h12 = hour - 12;
  }

  return `${datePart} ${period} ${h12}:${minStr}`;
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

  drawBaseballBackground(ctx);
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

function shortsGrassFieldBackground(ctx, w, h, SAFE_TOP) {
  ctx.fillStyle = "#4CAF50";
  ctx.fillRect(0, 0, w, h);

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
}

/** ISO (YYYY-MM-DD) 기준 KST 내일 날짜 */
function isoSeoulTomorrowIso() {
  const s = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

function wrapTextLines(ctx, text, maxW, font, maxLines) {
  ctx.font = font;
  const raw = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return [];
  const words = raw.split(" ");
  const lines = [];
  let cur = words[0] || "";
  for (let i = 1; i < words.length; i++) {
    const next = `${cur} ${words[i]}`;
    if (ctx.measureText(next).width <= maxW) cur = next;
    else {
      lines.push(cur);
      cur = words[i];
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length > maxLines) return lines.slice(0, maxLines);
  return lines;
}

function drawSummarySlide(ctx, w, h, date, games, logosByTeamKey, titleMode = "result") {
  // Summary slide: 고정 야구장 그린 + 골드 악센트(텍스트만)
  const SAFE_TOP = 200;
  const SAFE_BOTTOM = 1720;
  ctx.clearRect(0, 0, w, h);
  shortsGrassFieldBackground(ctx, w, h, SAFE_TOP);

  // decor (behind contents)
  drawBaseballBackground(ctx);

  // Title: 결과 요약 또는 내일 예고 타이틀 — 날짜는 골드 고정
  const titleLeft = titleMode === "tomorrow" ? "⚾ 내일 경기 예고 " : "⚾ KBO ";
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
    // 좌: 원정 / 우: 홈 → 스코어가 로고 바깥(가운데 띠)에 오도록
    drawLogoInBox(x + 18, ly, logoBoxW, logoBoxH, g.away_team, logosByTeamKey?.[ak] || null);
    drawLogoInBox(
      x + cardW - 18 - logoBoxW,
      ly,
      logoBoxW,
      logoBoxH,
      g.home_team,
      logosByTeamKey?.[hk] || null
    );

    // Score: 원정점수 — 대시 — 홈점수 묶음을 두 로고 사이에서 가운데 정렬 (로고 위치 고정)
    const scoreFont = `700 88px "Bebas Neue", system-ui, sans-serif`;
    const dashFont = `400 88px "Bebas Neue", system-ui, sans-serif`;
    const hsText = String(g.home_score ?? "—");
    const asText = String(g.away_score ?? "—");
    const dashText = "-";
    const hsNum = Number(g?.home_score);
    const asNum = Number(g?.away_score);
    const homeWin = Number.isFinite(hsNum) && Number.isFinite(asNum) && hsNum > asNum;
    const awayWin = Number.isFinite(hsNum) && Number.isFinite(asNum) && asNum > hsNum;

    const yy = y + Math.round(cardH * 0.62);
    const LOGO_PAD = 18;
    const awayLogoRight = x + LOGO_PAD + logoBoxW;
    const homeLogoLeft = x + cardW - LOGO_PAD - logoBoxW;
    const innerBandW = homeLogoLeft - awayLogoRight;
    const MID_GAP = 40;

    const prevAlign = ctx.textAlign;
    const prevBaseline = ctx.textBaseline;
    ctx.textBaseline = "alphabetic";

    ctx.font = scoreFont;
    const wAway = ctx.measureText(asText).width;
    const wHome = ctx.measureText(hsText).width;
    ctx.font = dashFont;
    const wDash = ctx.measureText(dashText).width;

    const totalClusterW = wAway + MID_GAP + wDash + MID_GAP + wHome;
    let clusterLeft = awayLogoRight + (innerBandW - totalClusterW) / 2;
    const MIN_INSET = 4;
    if (totalClusterW > innerBandW - 2 * MIN_INSET) {
      clusterLeft = awayLogoRight + MIN_INSET;
    }

    const awayScoreLeft = clusterLeft;
    const dashCx = clusterLeft + wAway + MID_GAP + wDash / 2;
    const homeScoreRight = clusterLeft + wAway + MID_GAP + wDash + MID_GAP + wHome;

    ctx.font = scoreFont;
    ctx.textAlign = "left";
    ctx.fillStyle = awayWin ? "#FFD700" : "#FFFFFF";
    ctx.fillText(asText, awayScoreLeft, yy);

    ctx.font = dashFont;
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(dashText, dashCx, yy);

    ctx.font = scoreFont;
    ctx.textAlign = "right";
    ctx.fillStyle = homeWin ? "#FFD700" : "#FFFFFF";
    ctx.fillText(hsText, homeScoreRight, yy);

    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBaseline;

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
  const h2h =
    g?.headToHead ??
    g?.head_to_head ??
    g?.headToHeadRecord ??
    g?.head_to_head_record ??
    null;
  const h2hText = h2h
    ? `• 상대전적  ${homeTeamName} ${h2h.win ?? 0}승 ${h2h.draw ?? 0}무 ${h2h.lose ?? 0}패`
    : `• 상대전적 데이터 없음`;

  const drawCount = Number(g?.draws ?? g?.draw ?? g?.DRAW ?? 0) || 0;
  const isDrawGame =
    (Number.isFinite(hsNum) && Number.isFinite(asNum) && hsNum === asNum) ||
    drawCount > 0;

  const winNameRaw = String(g?.winning_pitcher || winTeam || "—");
  const loseNameRaw = String(g?.losing_pitcher || loseTeam || "—");
  const winEra = g?.winning_pitcher_era ?? null;
  const loseEra = g?.losing_pitcher_era ?? null;
  const isCancelled =
    (g?.home_score === undefined || g?.home_score === null) &&
    (g?.away_score === undefined || g?.away_score === null);
  const pitcherLine = isCancelled
    ? "• 경기 취소"
    : isDrawGame
      ? "• 연장전 무승부 종료"
      : `• 승: ${cleanName(winNameRaw)}(${fmtEra(winEra)})  패: ${cleanName(loseNameRaw)}(${fmtEra(loseEra)})`;
  const fmtMvpLineStat = (h, hr) =>
    h == null && hr == null ? "" : ` (${h ?? "—"}H ${hr ?? "—"}HR)`;
  const mvpRows =
    Array.isArray(g?.mvp_batters) && g.mvp_batters.length > 0
      ? g.mvp_batters.slice(0, 2)
      : g?.mvp_batter
        ? [g.mvp_batter]
        : [];

  ctx.textAlign = "left";
  ctx.fillStyle = "#FFFFFF";
  // 하단 텍스트 그림자(가독성)
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  // • 승/패 투수 — 맨 위, 반투명 검정 박스 강조 (박스 → 텍스트 순서)
  const bulletBodyPx = 48;
  const pitcherFontPx = Math.round(bulletBodyPx * 1.1);
  ctx.font = `600 ${pitcherFontPx}px "${FONT_BODY}", system-ui, sans-serif`;
  const pm = ctx.measureText(pitcherLine);
  const pAsc = pm.actualBoundingBoxAscent ?? pitcherFontPx * 0.72;
  const pDesc = pm.actualBoundingBoxDescent ?? pitcherFontPx * 0.28;
  const boxPadX = 30;
  const boxPadY = 18;
  const boxRadius = 12;
  const pitchBaselineY = listTop + lineGap * 0;
  const boxW = pm.width + boxPadX * 2;
  const boxH = pAsc + pDesc + boxPadY * 2;
  const boxLeft = leftX - boxPadX;
  const boxTop = pitchBaselineY - pAsc - boxPadY;

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.roundRect(boxLeft, boxTop, boxW, boxH, boxRadius);
  ctx.fill();

  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(pitcherLine, leftX, pitchBaselineY);

  // • 구장명
  ctx.font = `700 50px "${FONT_BODY}", system-ui, sans-serif`;
  const venueText = String(g?.venue || "—").slice(0, 24) || "—";
  ctx.fillText(`• ${venueText}`, leftX, listTop + lineGap * 1);

  // • 순위 (standings 기반)
  ctx.font = `600 48px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(
    `• 순위  ${homeTeamName} ${homeRank ?? "—"}위  |  ${awayTeamName} ${awayRank ?? "—"}위`,
    leftX,
    listTop + lineGap * 2
  );

  // • 상대전적 (홈팀기준)
  ctx.font = `600 48px "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(h2hText, leftX, listTop + lineGap * 3);

  // • ⭐ / ✨ 타자 MVP (최대 2명, API 미갱신 시 mvp_batter 단일 호환)
  ctx.font = `700 54px "Gmarket Sans", system-ui, sans-serif`;
  if (mvpRows.length === 0) {
    ctx.fillText(`• ⭐ —`, leftX, listTop + lineGap * 4);
  } else {
    mvpRows.forEach((row, i) => {
      const nm = cleanName(row?.name ?? "—");
      const stat = fmtMvpLineStat(row?.h ?? null, row?.hr ?? null);
      const bullet = i === 0 ? "• ⭐ " : "• ✨ ";
      ctx.fillText(`${bullet}${nm}${stat}`, leftX, listTop + lineGap * (4 + i));
    });
  }

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
  const TOP_CARD_SHIFT_Y = -150;
  const INFO_LINE_GAP = 85; // 기존(70) 대비 10~15px ↑

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
    // 쇼츠2(tomorrow_preview)와 동일한 필드명
    const home_starter = String(obj?.home_starter ?? obj?.homeStarter ?? "").trim();
    const away_starter = String(obj?.away_starter ?? obj?.awayStarter ?? "").trim();
    // ERA 필드명은 쇼츠2(tomorrow_preview)와 동일하게 home_starter_era/away_starter_era 우선
    // (데이터 소스에 따라 다른 이름이 섞일 수 있어 호환용 후보도 같이 체크)
    const home_starter_era = Number(
      obj?.home_starter_era ??
        obj?.homeStarterEra ??
        obj?.probable_pitcher_home_era ??
        obj?.probablePitcherHomeEra
    );
    const away_starter_era = Number(
      obj?.away_starter_era ??
        obj?.awayStarterEra ??
        obj?.probable_pitcher_away_era ??
        obj?.probablePitcherAwayEra
    );
    return {
      team,
      teamKey: tKey,
      opponent,
      oppKey: teamKeyword(opponent),
      dateIso,
      time,
      venue,
      isHome,
      home_starter,
      away_starter,
      home_starter_era: Number.isFinite(home_starter_era) ? home_starter_era : null,
      away_starter_era: Number.isFinite(away_starter_era) ? away_starter_era : null,
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

  // 중앙 타이틀: NEXT GAME — drawTomorrowPreviewGameSlide "GAME PREVIEW"와 동일 스타일, 크기만 기존 대비 80%
  const NEXT_GAME_TITLE_PX = Math.round(Math.round(132 * 0.8) * 0.8);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 1000 ${NEXT_GAME_TITLE_PX}px "${FONT_TITLE}", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText("NEXT GAME", 60, DIVIDER_Y + 30);
  ctx.restore();

  // NEXT GAME 아래 날짜/시간
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFE87C";
  ctx.font = `900 75px "${FONT_BODY}", system-ui, sans-serif`;
  shadowTextSoft(ctx);
  const dateIso = top.dateIso && top.dateIso !== "—" ? top.dateIso : bot.dateIso;
  const timeText = top.time && top.time !== "—" ? top.time : bot.time;
  ctx.fillText(fmtNextGameSlideDateTime(dateIso, timeText), w / 2, DIVIDER_Y + 120);
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
  const topMainY = SAFE_TOP + 100 + TOP_CARD_SHIFT_Y;
  const topOppY = topMainY + Math.round((mainLogoH - oppLogoH) / 2);

  // 하단(원정팀): 캔버스 하단에서 300px 위 근처로 정보까지 포함해 배치
  // info3(상대전적) baseline이 (h - 300) 근처가 되도록 역산
  const bottomInfo2YTarget = h - 300;
  const botMainY = Math.max(
    DIVIDER_Y + 120,
    bottomInfo2YTarget - (mainLogoH + INFO_LINE_GAP + INFO_LINE_GAP)
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
  const cx = w / 2;
  const fmtEra = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : "";
  };
  const topTeamPitcher = cleanName(top.isHome ? top.home_starter : top.away_starter);
  const topOppPitcher = cleanName(top.isHome ? top.away_starter : top.home_starter);
  const topTeamEra = fmtEra(top.isHome ? top.home_starter_era : top.away_starter_era);
  const topOppEra = fmtEra(top.isHome ? top.away_starter_era : top.home_starter_era);
  const topTeamText = topTeamPitcher
    ? topTeamEra
      ? `${topTeamPitcher}(${topTeamEra})`
      : topTeamPitcher
    : "미정";
  const topOppText = topOppPitcher
    ? topOppEra
      ? `${topOppPitcher}(${topOppEra})`
      : topOppPitcher
    : "미정";
  const topPitcherText = `예상선발 : ${topTeamText} vs ${topOppText}`;

  // 예상선발 검은 라운드박스 강조 (박스 → 텍스트)
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = '700 42px "Gmarket Sans", "Gmarket Sans", system-ui, sans-serif';
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  const topBoxW = ctx.measureText(topPitcherText).width + 80;
  const topBoxH = 70;
  const topBoxX = cx - topBoxW / 2;
  const topBoxY = topInfoY - 52;
  ctx.beginPath();
  ctx.roundRect(topBoxX, topBoxY, topBoxW, topBoxH, 20);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(topPitcherText, cx, topInfoY);
  ctx.restore();

  ctx.font = `800 52px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(`${venueFullName(top.venue)}`, cx, topInfoY + INFO_LINE_GAP);
  ctx.font = `700 48px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  const topH2h = top?.next_h2h
    ? `시즌 상대전적 : ${Number(top.next_h2h.win ?? 0) || 0}승 ${Number(top.next_h2h.draw ?? 0) || 0}무 ${Number(top.next_h2h.lose ?? 0) || 0}패`
    : `시즌 상대전적 : 데이터 없음`;
  ctx.fillText(topH2h, cx, topInfoY + INFO_LINE_GAP * 2);
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
  const botTeamPitcher = cleanName(bot.isHome ? bot.home_starter : bot.away_starter);
  const botOppPitcher = cleanName(bot.isHome ? bot.away_starter : bot.home_starter);
  const botTeamEra = fmtEra(bot.isHome ? bot.home_starter_era : bot.away_starter_era);
  const botOppEra = fmtEra(bot.isHome ? bot.away_starter_era : bot.home_starter_era);
  const botTeamText = botTeamPitcher
    ? botTeamEra
      ? `${botTeamPitcher}(${botTeamEra})`
      : botTeamPitcher
    : "미정";
  const botOppText = botOppPitcher
    ? botOppEra
      ? `${botOppPitcher}(${botOppEra})`
      : botOppPitcher
    : "미정";
  const botPitcherText = `예상선발 : ${botTeamText} vs ${botOppText}`;

  // 예상선발 검은 라운드박스 강조 (박스 → 텍스트)
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = '700 42px "Gmarket Sans", "Gmarket Sans", system-ui, sans-serif';
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  const botBoxW = ctx.measureText(botPitcherText).width + 80;
  const botBoxH = 70;
  const botBoxX = cx - botBoxW / 2;
  const botBoxY = botInfoY - 52;
  ctx.beginPath();
  ctx.roundRect(botBoxX, botBoxY, botBoxW, botBoxH, 20);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(botPitcherText, cx, botInfoY);
  ctx.restore();

  ctx.font = `800 52px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  ctx.fillText(`${venueFullName(bot.venue)}`, cx, botInfoY + INFO_LINE_GAP);
  ctx.font = `700 48px "Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;
  const botH2h = bot?.next_h2h
    ? `시즌 상대전적 : ${Number(bot.next_h2h.win ?? 0) || 0}승 ${Number(bot.next_h2h.draw ?? 0) || 0}무 ${Number(bot.next_h2h.lose ?? 0) || 0}패`
    : `시즌 상대전적 : 데이터 없음`;
  ctx.fillText(botH2h, cx, botInfoY + INFO_LINE_GAP * 2);
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

/**
 * 쇼츠1 프리셋 키: 요약 N번째 중 1~4번은 summary, 5번째 이상은 summary_last
 */
function slideExportKeyShorts1(slide, index, allSlides = []) {
  if (!slide?.type) return "intro";
  if (slide.type === "intro") return "intro";
  if (slide.type === "summary") {
    let ord = 0;
    for (let i = 0; i <= index && i < allSlides.length; i++) {
      if (allSlides[i]?.type === "summary") ord++;
    }
    return ord <= 4 ? "summary" : "summary_last";
  }
  if (slide.type === "game") return "game_detail";
  if (slide.type === "next_game") return "game_detail";
  if (slide.type === "standings") return "standings";
  return "intro";
}

function slideExportKeyShorts2(slide) {
  if (!slide?.type) return "intro";
  if (slide.type === "intro") return "intro";
  if (slide.type === "preview_game") {
    const p = Math.min(5, Math.max(1, Number(slide.page) || 1));
    return p <= 4 ? "game_preview" : "game_preview_last";
  }
  if (slide.type === "standings") return "standings";
  return "intro";
}

function Card8Shorts({ defaultDate, onShortsDateChange }) {
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const captureWrapRef = useRef(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [capturedSlides, setCapturedSlides] = useState([]);
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeTitleBusy, setYoutubeTitleBusy] = useState(false);
  const [youtubeTitleCopied, setYoutubeTitleCopied] = useState(false);
  const [cropImage, setCropImage] = useState(null);
  const [cropImageEl, setCropImageEl] = useState(null);
  const [cropOffsetX, setCropOffsetX] = useState(0.5);
  const [cropOffsetY, setCropOffsetY] = useState(0.3);
  const [cropScale, setCropScale] = useState(1.0);
  const cropFileRef = useRef(null);
  const cropCanvasRef = useRef(null);
  const [overlayText, setOverlayText] = useState("");
  const [overlayText2, setOverlayText2] = useState("1분컷");
  const [overlayText3, setOverlayText3] = useState("프로야구 경기결과");
  const [overlayTextSize, setOverlayTextSize] = useState(80);
  const [overlayTextColor, setOverlayTextColor] = useState("#ffffff");
  const [overlayTextPos, setOverlayTextPos] = useState("bottom");
  const [overlayBg, setOverlayBg] = useState(true);

  useEffect(() => {
    setDate(defaultDate);
  }, [defaultDate]);
  useEffect(() => {
    onShortsDateChange?.(date);
  }, [date, onShortsDateChange]);

  const slides = useMemo(() => {
    const games = Array.isArray(data?.games) ? data.games : [];
    const s = [];
    s.push({ type: "intro" });
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
    if (slide.type === "intro") {
      for (const tk of KBO_INTRO_TEAM_KEYS) teamKeys.add(tk);
    } else if (slide.type === "summary") {
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

    await loadShortsBaseballDecor();

    if (slide.type === "intro") drawIntroSlide(ctx, w, h, date, logosByTeamKey);
    else if (slide.type === "summary")
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
        games: sortGamesForDailyShortsRotation(res?.games, d),
      });
      setSlideIdx(0);
      setCapturedSlides([]);
    } catch (e) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateTitle = async () => {
    if (!data?.games?.length) return;
    setYoutubeTitleBusy(true);
    try {
      const games = data.games.map((g) => ({
        home_team: g.home_team,
        away_team: g.away_team,
        home_score: g.home_score,
        away_score: g.away_score,
        winning_pitcher: g.winning_pitcher,
        losing_pitcher: g.losing_pitcher,
      }));
      const res = await postKbo({
        action: "generate_shorts1_title",
        date,
        games,
      });
      if (res?.ok === false) throw new Error(res.error || "제목 생성 실패");
      setYoutubeTitle(res?.title || "");
    } catch (e) {
      setYoutubeTitle("제목 생성 실패: " + (e?.message || String(e)));
    } finally {
      setYoutubeTitleBusy(false);
    }
  };

  const handleCropImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setCropImage(dataUrl);
      const img = new Image();
      img.onload = () => setCropImageEl(img);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const drawCropPreview = useCallback(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas || !cropImageEl) return;
    const ctx = canvas.getContext("2d");
    const W = 270;
    const H = 480;
    canvas.width = W;
    canvas.height = H;

    const outW = 1080;
    const outH = 1920;
    const imgW = cropImageEl.naturalWidth;
    const imgH = cropImageEl.naturalHeight;

    const scale = cropScale;
    const scaledW = imgW * scale;
    const scaledH = imgH * scale;

    let srcW, srcH;
    if (scaledW / scaledH > outW / outH) {
      srcH = imgH;
      srcW = imgH * (outW / outH);
    } else {
      srcW = imgW;
      srcH = imgW * (outH / outW);
    }
    srcW /= scale;
    srcH /= scale;

    const maxOffX = Math.max(0, imgW - srcW);
    const maxOffY = Math.max(0, imgH - srcH);
    const sx = maxOffX * cropOffsetX;
    const sy = maxOffY * cropOffsetY;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cropImageEl, sx, sy, srcW, srcH, 0, 0, W, H);

    if (overlayText) {
      const previewScale = W / 1080;
      const fontSize = overlayTextSize * previewScale;
      ctx.font = `bold ${fontSize}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const posY =
        overlayTextPos === "top"
          ? H * 0.15
          : overlayTextPos === "middle"
            ? H * 0.5
            : H * 0.82;

      if (overlayBg) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, posY - fontSize * 0.8, W, fontSize * 1.6);
      }
      ctx.fillStyle = overlayTextColor;
      ctx.fillText(overlayText, W / 2, posY);
    }

    if (overlayText3) {
      const previewScale = W / 1080;
      let fontSize3 = 52 * previewScale;
      ctx.font = `bold ${fontSize3}px "Noto Sans KR", sans-serif`;
      const targetW = W * 0.7;
      const measured = ctx.measureText(overlayText3).width;
      if (measured > 0) fontSize3 = fontSize3 * (targetW / measured);
      ctx.font = `bold ${fontSize3}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const posY3 = H * 0.08;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, posY3 - fontSize3 * 0.8, W, fontSize3 * 1.6);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(overlayText3, W / 2, posY3);
    }

    const dateTextPrev = date
      ? `${date.slice(0, 4)}년 ${parseInt(date.slice(5, 7))}월 ${parseInt(date.slice(8, 10))}일`
      : "";
    if (dateTextPrev) {
      const previewScale = W / 1080;
      const fontSize4 = 44 * previewScale;
      ctx.font = `bold ${fontSize4}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const posY4 = H * 0.88;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, posY4 - fontSize4 * 0.8, W, fontSize4 * 1.6);
      ctx.fillStyle = "#FFD700";
      ctx.fillText(dateTextPrev, W / 2, posY4);
    }

    if (overlayText2) {
      const previewScale = W / 1080;
      const fontSize2 = 72 * previewScale;
      ctx.font = `bold ${fontSize2}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const posY2 = H * 0.94;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, posY2 - fontSize2 * 0.8, W, fontSize2 * 1.6);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(overlayText2, W / 2, posY2);
    }
  }, [
    cropImageEl,
    cropOffsetX,
    cropOffsetY,
    cropScale,
    date,
    overlayText,
    overlayText2,
    overlayText3,
    overlayTextSize,
    overlayTextColor,
    overlayTextPos,
    overlayBg,
  ]);

  useEffect(() => {
    drawCropPreview();
  }, [drawCropPreview]);

  const handleCropDownload = () => {
    if (!cropImageEl) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");

    const outW = 1080;
    const outH = 1920;
    const imgW = cropImageEl.naturalWidth;
    const imgH = cropImageEl.naturalHeight;
    const scale = cropScale;

    let srcW, srcH;
    if ((imgW * scale) / (imgH * scale) > outW / outH) {
      srcH = imgH;
      srcW = imgH * (outW / outH);
    } else {
      srcW = imgW;
      srcH = imgW * (outH / outW);
    }
    srcW /= scale;
    srcH /= scale;

    const maxOffX = Math.max(0, imgW - srcW);
    const maxOffY = Math.max(0, imgH - srcH);
    const sx = maxOffX * cropOffsetX;
    const sy = maxOffY * cropOffsetY;

    ctx.drawImage(cropImageEl, sx, sy, srcW, srcH, 0, 0, 1080, 1920);

    if (overlayText) {
      ctx.font = `bold ${overlayTextSize}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const posY =
        overlayTextPos === "top"
          ? 1920 * 0.15
          : overlayTextPos === "middle"
            ? 1920 * 0.5
            : 1920 * 0.82;

      if (overlayBg) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, posY - overlayTextSize * 0.8, 1080, overlayTextSize * 1.6);
      }
      ctx.fillStyle = overlayTextColor;
      ctx.fillText(overlayText, 540, posY);
    }

    if (overlayText3) {
      let fontSize3dl = 52;
      ctx.font = `bold ${fontSize3dl}px "Noto Sans KR", sans-serif`;
      const targetW = 1080 * 0.7;
      const measured = ctx.measureText(overlayText3).width;
      if (measured > 0) fontSize3dl = fontSize3dl * (targetW / measured);
      ctx.font = `bold ${fontSize3dl}px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 1920 * 0.08 - fontSize3dl * 0.8, 1080, fontSize3dl * 1.6);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(overlayText3, 540, 1920 * 0.08);
    }

    const dateTextDl = date
      ? `${date.slice(0, 4)}년 ${parseInt(date.slice(5, 7))}월 ${parseInt(date.slice(8, 10))}일`
      : "";
    if (dateTextDl) {
      ctx.font = `bold 44px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 1920 * 0.88 - 36, 1080, 72);
      ctx.fillStyle = "#FFD700";
      ctx.fillText(dateTextDl, 540, 1920 * 0.88);
    }

    if (overlayText2) {
      ctx.font = `bold 72px "Noto Sans KR", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 1920 * 0.94 - 58, 1080, 116);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(overlayText2, 540, 1920 * 0.94);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `thumbnail_${date}.png`);
    }, "image/png");
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

  const captureAllSlides = async () => {
    if (!data || !slides.length) return;
    setCaptureBusy(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const out = [];
      for (let i = 0; i < slides.length; i++) {
        setSlideIdx(i);
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r))
        );
        await waitFontsReadyForCapture();
        const el = captureWrapRef.current;
        if (!el) throw new Error("캡처 대상이 없습니다.");
        console.log("[shorts capture] el offsetSize", el.offsetWidth, el.offsetHeight);
        const scale = SHORTS_EXPORT_W / Math.max(1, el.offsetWidth);
        const c = await html2canvas(el, {
          scale,
          useCORS: true,
          backgroundColor: null,
        });
        if (c.width !== SHORTS_EXPORT_W || c.height !== SHORTS_EXPORT_H) {
          console.warn("[shorts capture] 예상 해상도와 다름", {
            expected: `${SHORTS_EXPORT_W}x${SHORTS_EXPORT_H}`,
            actual: `${c.width}x${c.height}`,
            elCss: `${el.offsetWidth}x${el.offsetHeight}`,
            scale,
          });
        }
        const blob = await new Promise((resolve, reject) => {
          c.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("PNG 변환 실패")),
            "image/png"
          );
        });
        out.push({ key: slideExportKeyShorts1(slides[i], i, slides), blob });
        if (i < slides.length - 1) {
          await delayMs(CAPTURE_INTER_SLIDE_DELAY_MS);
        }
      }
      setCapturedSlides(out);
    } catch (e) {
      window.alert(e?.message || String(e));
    } finally {
      setCaptureBusy(false);
    }
  };

  return (
    <div className="section soft">
      <div className="section-title">1. 쇼츠-일간-경기결과</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드</div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="primary"
          onClick={captureAllSlides}
          disabled={!data || busy || captureBusy}
        >
          {captureBusy ? "캡처 중…" : "슬라이드 캡처"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {capturedSlides.length === 0
            ? "미캡처"
            : `✅ ${capturedSlides.length}장 캡처됨`}
        </span>
      </div>

      <ShortsPresetPicker shortsType="shorts1" slides={capturedSlides} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          className="primary"
          onClick={() => {
            const todayStr = new Date().toLocaleDateString("sv-SE", {
              timeZone: "Asia/Seoul",
            });
            setDate(todayStr);
          }}
          disabled={busy}
        >
          오늘
        </button>
        <button type="button" className="primary" onClick={() => onGenerate()} disabled={busy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button type="button" className="primary primary-fill" onClick={downloadZip} disabled={!data || busy}>
          전체 ZIP 다운로드
        </button>
      </div>

            {data && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="primary primary-fill"
                  style={{ width: "100%" }}
                  onClick={handleGenerateTitle}
                  disabled={youtubeTitleBusy}
                >
                  {youtubeTitleBusy ? "제목 생성 중..." : "✨ 유튜브 제목 자동생성"}
                </button>
                {youtubeTitle && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="text"
                      value={youtubeTitle}
                      onChange={(e) => setYoutubeTitle(e.target.value)}
                      style={{ width: "100%", fontSize: 14, padding: "6px 8px" }}
                    />
                    <button
                      type="button"
                      className="primary"
                      style={{ marginTop: 4, width: "100%" }}
                      onClick={async () => {
                        await navigator.clipboard.writeText(youtubeTitle);
                        setYoutubeTitleCopied(true);
                        setTimeout(() => setYoutubeTitleCopied(false), 2000);
                      }}
                    >
                      {youtubeTitleCopied ? "✅ 복사됨!" : "📋 제목 복사"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {data && (
              <div style={{ marginTop: 8 }}>
                <div style={{ marginTop: 12, borderTop: "1px solid #333", paddingTop: 12 }}>
                  <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
                    🖼️ 썸네일 크롭 도구 (9:16)
                  </div>

                  <input
                    ref={cropFileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleCropImageUpload}
                  />
                  <button
                    type="button"
                    className="primary primary-fill"
                    style={{ width: "100%", marginBottom: 8 }}
                    onClick={() => cropFileRef.current?.click()}
                  >
                    📁 선수 사진 업로드
                  </button>

                  {cropImageEl && (
                    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 12 }}>
                      <div style={{ flexShrink: 0 }}>
                        <canvas
                          ref={cropCanvasRef}
                          style={{ border: "2px solid #444", borderRadius: 6, display: "block" }}
                        />
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>가로 위치</label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={cropOffsetX}
                            onChange={(e) => setCropOffsetX(Number(e.target.value))}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div style={{ marginBottom: 8 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>세로 위치</label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={cropOffsetY}
                            onChange={(e) => setCropOffsetY(Number(e.target.value))}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div style={{ marginBottom: 12 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>
                            확대 ({cropScale.toFixed(1)}x)
                          </label>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.05"
                            value={cropScale}
                            onChange={(e) => setCropScale(Number(e.target.value))}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div style={{ borderTop: "1px solid #333", paddingTop: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 12, color: "#aaa" }}>📝 텍스트 오버레이</span>
                        </div>

                        <div style={{ marginBottom: 6 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>상단 텍스트</label>
                          <input
                            type="text"
                            value={overlayText3}
                            onChange={(e) => setOverlayText3(e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                          />
                        </div>

                        <div style={{ marginBottom: 6 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>하단 텍스트</label>
                          <input
                            type="text"
                            value={overlayText2}
                            onChange={(e) => setOverlayText2(e.target.value)}
                            style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                          />
                        </div>

                        <div style={{ borderTop: "1px solid #444", paddingTop: 6, marginBottom: 6 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>AI 제목 (가운데)</label>
                        </div>

                        {youtubeTitle && (
                          <button
                            type="button"
                            className="primary"
                            style={{ width: "100%", marginBottom: 6, fontSize: 12, padding: "4px 8px" }}
                            onClick={() => setOverlayText(youtubeTitle)}
                          >
                            ✨ AI 제목 자동 반영
                          </button>
                        )}

                        <input
                          type="text"
                          value={overlayText}
                          onChange={(e) => setOverlayText(e.target.value)}
                          placeholder="텍스트 입력"
                          style={{ width: "100%", marginBottom: 6, padding: "4px 6px", fontSize: 12 }}
                        />

                        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                          <select
                            value={overlayTextPos}
                            onChange={(e) => setOverlayTextPos(e.target.value)}
                            style={{ flex: 1, fontSize: 12 }}
                          >
                            <option value="top">상단</option>
                            <option value="middle">중앙</option>
                            <option value="bottom">하단</option>
                          </select>
                          <input
                            type="color"
                            value={overlayTextColor}
                            onChange={(e) => setOverlayTextColor(e.target.value)}
                            style={{ width: 36, height: 28 }}
                          />
                        </div>

                        <div style={{ marginBottom: 6 }}>
                          <label style={{ fontSize: 12, color: "#aaa" }}>
                            크기 ({overlayTextSize}px)
                          </label>
                          <input
                            type="range"
                            min="40"
                            max="160"
                            step="4"
                            value={overlayTextSize}
                            onChange={(e) => setOverlayTextSize(Number(e.target.value))}
                            style={{ width: "100%" }}
                          />
                        </div>

                        <div style={{ marginBottom: 10, fontSize: 12, color: "#aaa" }}>
                          <label>
                            <input
                              type="checkbox"
                              checked={overlayBg}
                              onChange={(e) => setOverlayBg(e.target.checked)}
                              style={{ marginRight: 4 }}
                            />
                            텍스트 배경
                          </label>
                        </div>

                        <button
                          type="button"
                          className="primary primary-fill"
                          style={{ width: "100%" }}
                          onClick={handleCropDownload}
                        >
                          ⬇️ 다운로드 (1080×1920)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

      {error ? <pre className="result-error-light">{error}</pre> : null}

      {data ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <ShortsCanvas
              ref={captureWrapRef}
              slideIdx={slideIdx}
              renderSlide={(canvas) => renderSlideToCanvas(slideIdx, canvas)}
            />
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 ({slideIdx + 1}/{slides.length})
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSlideIdx((x) => Math.max(0, x - 1))} disabled={slideIdx === 0 || captureBusy}>
                이전
              </button>
              <button
                type="button"
                onClick={() => setSlideIdx((x) => Math.min(slides.length - 1, x + 1))}
                disabled={slideIdx >= slides.length - 1 || captureBusy}
              >
                다음
              </button>
              <button type="button" onClick={() => downloadPng(slideIdx)} disabled={busy || captureBusy}>
                현재 슬라이드 PNG 다운로드
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              - 슬라이드1: 전체 결과 요약<br />
              - 슬라이드2~N: 경기별 상세(구장/승패투수/타자 MVP 최대 2명)<br />
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

function CardTomorrowPreviewShorts({ previewDateIso }) {
  const [date, setDate] = useState(previewDateIso);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const captureWrapRefT = useRef(null);
  const [captureBusyT, setCaptureBusyT] = useState(false);
  const [capturedSlidesT, setCapturedSlidesT] = useState([]);

  const slides = useMemo(() => {
    const games = Array.isArray(data?.games) ? data.games : [];
    const s = [];
    s.push({ type: "intro" });
    for (const g of games) {
      for (let page = 1; page <= 5; page++) {
        s.push({ type: "preview_game", game: g, page });
      }
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
    const slide = slides[idx];
    if (!slide) return;

    const teamKeys = new Set();
    if (slide.type === "intro") {
      for (const tk of SHORTS2_INTRO_TEAM_KEYS) teamKeys.add(tk);
    } else if (slide.type === "preview_game") {
      teamKeys.add(teamKeyword(slide.game?.home_team));
      teamKeys.add(teamKeyword(slide.game?.away_team));
    } else if (slide.type === "standings") {
      for (const r of standings) {
        teamKeys.add(teamKeyword(r?.team ?? r?.TEAM_NM ?? r?.team_name ?? r?.name ?? ""));
      }
    }

    const logosByTeamKey = {};
    for (const tk of teamKeys) {
      const img = await loadSvgLogo(tk);
      logosByTeamKey[tk] = img;
    }

    await loadShortsBaseballDecor();

    if (slide.type === "intro")
      drawTomorrowPreviewIntroSlide(ctx, w, h, date, logosByTeamKey, games?.[0] || null);
    else if (slide.type === "preview_game")
      drawTomorrowPreviewGameSlide(
        ctx,
        w,
        h,
        date,
        slide.game,
        logosByTeamKey,
        Number(slide.page) || 1
      );
    else drawStandingsSlide(ctx, w, h, date, standings, logosByTeamKey);
  };

  const onLoad = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postKbo({ action: "tomorrow_preview", date });
      setData({
        ...res,
        games: sortGamesForDailyShortsRotation(res?.games, date),
      });
      setSlideIdx(0);
      setCapturedSlidesT([]);
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
    downloadBlob(blob, `shorts_tomorrow_${date}_${String(idx + 1).padStart(2, "0")}.png`);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    for (let i = 0; i < slides.length; i++) {
      const c = document.createElement("canvas");
      await renderSlideToCanvas(i, c);
      const blob = await canvasToBlob(c);
      if (!blob) continue;
      zip.file(`shorts_tomorrow_${date}_${String(i + 1).padStart(2, "0")}.png`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `shorts_tomorrow_${date}.zip`);
  };

  const captureAllSlidesTomorrow = async () => {
    if (!data || !slides.length) return;
    setCaptureBusyT(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const out = [];
      for (let i = 0; i < slides.length; i++) {
        setSlideIdx(i);
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r))
        );
        await waitFontsReadyForCapture();
        const el = captureWrapRefT.current;
        if (!el) throw new Error("캡처 대상이 없습니다.");
        console.log("[shorts capture T] el offsetSize", el.offsetWidth, el.offsetHeight);
        const scale = SHORTS_EXPORT_W / Math.max(1, el.offsetWidth);
        const c = await html2canvas(el, {
          scale,
          useCORS: true,
          backgroundColor: null,
        });
        if (c.width !== SHORTS_EXPORT_W || c.height !== SHORTS_EXPORT_H) {
          console.warn("[shorts capture T] 예상 해상도와 다름", {
            expected: `${SHORTS_EXPORT_W}x${SHORTS_EXPORT_H}`,
            actual: `${c.width}x${c.height}`,
            elCss: `${el.offsetWidth}x${el.offsetHeight}`,
            scale,
          });
        }
        const blob = await new Promise((resolve, reject) => {
          c.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("PNG 변환 실패")),
            "image/png"
          );
        });
        out.push({ key: slideExportKeyShorts2(slides[i]), blob });
        if (i < slides.length - 1) {
          await delayMs(CAPTURE_INTER_SLIDE_DELAY_MS);
        }
      }
      setCapturedSlidesT(out);
    } catch (e) {
      window.alert(e?.message || String(e));
    } finally {
      setCaptureBusyT(false);
    }
  };

  return (
    <div className="section soft">
      <div className="section-title">2. 쇼츠-내일경기-예고</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드 · 내일 일정 기준(KST 자동 계산)</div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginTop: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="primary"
          onClick={captureAllSlidesTomorrow}
          disabled={!data || busy || captureBusyT}
        >
          {captureBusyT ? "캡처 중…" : "슬라이드 캡처"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {capturedSlidesT.length === 0
            ? "미캡처"
            : `✅ ${capturedSlidesT.length}장 캡처됨`}
        </span>
      </div>

      <ShortsPresetPicker shortsType="shorts2" slides={capturedSlidesT} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          className="primary"
          onClick={() => {
            const todayStr = new Date().toLocaleDateString("sv-SE", {
              timeZone: "Asia/Seoul",
            });
            setDate(todayStr);
          }}
          disabled={busy}
        >
          오늘
        </button>
        <button type="button" className="primary" onClick={onLoad} disabled={busy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button type="button" className="primary primary-fill" onClick={downloadZip} disabled={!data || busy}>
          ZIP 다운로드
        </button>
      </div>

      {error ? <pre className="result-error-light">{error}</pre> : null}

      {data ? (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(0, auto) 1fr", gap: 14 }}>
          <div style={{ flexShrink: 0 }}>
            <ShortsCanvas
              ref={captureWrapRefT}
              slideIdx={slideIdx}
              renderSlide={(canvas) => renderSlideToCanvas(slideIdx, canvas)}
            />
          </div>
          <div>
            <div className="muted" style={{ fontWeight: 900 }}>
              슬라이드 ({slideIdx + 1}/{slides.length})
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setSlideIdx((x) => Math.max(0, x - 1))} disabled={slideIdx === 0 || captureBusyT}>
                이전
              </button>
              <button
                type="button"
                onClick={() => setSlideIdx((x) => Math.min(slides.length - 1, x + 1))}
                disabled={slideIdx >= slides.length - 1 || captureBusyT}
              >
                다음
              </button>
              <button type="button" onClick={() => downloadPng(slideIdx)} disabled={busy || captureBusyT}>
                현재 PNG 다운로드
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              - 슬라이드1: 인트로
              <br />
              - 슬라이드2~N: 경기별 예고 (상대전적 · 예상선발)
              <br />- 마지막: KBO 순위
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getWeekRangeKst(mode) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  // JS: Sunday=0 ... Saturday=6, we want Monday start
  const day = now.getDay();
  const daysSinceMon = (day + 6) % 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - daysSinceMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  const fromThis = mon.toLocaleDateString("sv-SE");
  const toThis = sun.toLocaleDateString("sv-SE");

  if (mode === "this") {
    return { from: fromThis, to: toThis };
  }
  // last week
  const mon2 = new Date(mon);
  mon2.setDate(mon.getDate() - 7);
  const sun2 = new Date(sun);
  sun2.setDate(sun.getDate() - 7);
  return { from: mon2.toLocaleDateString("sv-SE"), to: sun2.toLocaleDateString("sv-SE") };
}

const WEEKLY_BG = "#002B5B";
const WEEKLY_POINT = "#FFD700";
const WEEKLY_FONT = `"Gmarket Sans", "${FONT_BODY}", system-ui, sans-serif`;

// Weekly slides logo cache (populated in Card9WeeklySummary render step)
const teamLogoImages = {};
function normalizeTeamKey(teamName) {
  return teamKeyword(teamName);
}

function drawLogoInBox(ctx, teamName, x, y, size) {
  const img = teamLogoImages[normalizeTeamKey(teamName)];
  if (!img) return;
  const ratio = img.naturalWidth / img.naturalHeight;
  const drawW = size * ratio;
  const drawH = size;
  ctx.drawImage(img, x - drawW / 2, y - drawH / 2, drawW, drawH);
}

function drawWeeklyBase(ctx, w, h) {
  ctx.fillStyle = WEEKLY_BG;
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx); // watermark (existing same)
}

function weekOfMonthKst(isoDate) {
  const s = String(isoDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { y: 0, m: 0, w: 0 };
  const dt = new Date(new Date(`${s}T12:00:00`).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const first = new Date(dt);
  first.setDate(1);
  const firstDowMon0 = (first.getDay() + 6) % 7; // Mon=0..Sun=6
  const w = Math.floor((day + firstDowMon0 - 1) / 7) + 1;
  return { y, m, w };
}

function drawWeeklyIntroSlide(ctx, w, h, fromDate, toDate, logosByTeamKey) {
  // Reuse drawIntroSlide layout: we draw a "neutral" intro then overlay the title/date parts
  // Use toDate only to keep weekday parsing stable; background is overridden to WEEKLY_BG.
  drawWeeklyBase(ctx, w, h);

  // Reuse the same collage placements from drawIntroSlide by calling it, but immediately repaint bg
  // to keep WEEKLY navy and then draw collage manually.
  // (We duplicate the placements here to stay pixel-identical.)
  const SHIFT_Y = 50;
  const placements = [
    { team: "KIA", x: 120, y: 430, size: 160, angle: -12 },
    { team: "삼성", x: 480, y: 400, size: 145, angle: 8 },
    { team: "LG", x: 820, y: 440, size: 155, angle: -6 },
    { team: "두산", x: 90, y: 620, size: 140, angle: 15 },
    { team: "KT", x: 370, y: 580, size: 150, angle: -10 },
    { team: "SSG", x: 690, y: 600, size: 145, angle: 12 },
    { team: "롯데", x: 160, y: 790, size: 155, angle: -8 },
    { team: "한화", x: 440, y: 760, size: 148, angle: 6 },
    { team: "NC", x: 740, y: 780, size: 142, angle: -14 },
    { team: "키움", x: 900, y: 640, size: 138, angle: 10 },
  ];

  const centerX = w / 2;
  const topY = 180 + SHIFT_Y;
  const centralY = Math.round(h * 0.64) + SHIFT_Y;

  ctx.save();
  ctx.globalAlpha = 0.85;
  for (const p of placements) {
    const tk = teamKeyword(p.team);
    const img = logosByTeamKey?.[tk] || null;
    const size = p.size * 1.8 * 0.55 * 1.05;
    ctx.save();
    ctx.translate(p.x + size / 2, p.y + SHIFT_Y + size / 2);
    ctx.rotate((p.angle * Math.PI) / 180);
    if (img) {
      const iw = Number(img?.naturalWidth ?? img?.width) || 1;
      const ih = Number(img?.naturalHeight ?? img?.height) || 1;
      const ratio = iw / ih;
      const drawH = size;
      const drawW = size * ratio;
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      drawTeamLogoOrBadge(ctx, -size / 2, -size / 2, size, p.team, null);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Top title: "주간 분석"
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#FFFFFF";
  let titleSize = 112;
  ctx.font = `900 ${titleSize}px ${WEEKLY_FONT}`;
  while (ctx.measureText("주간 분석").width > 960 && titleSize > 70) {
    titleSize -= 2;
    ctx.font = `900 ${titleSize}px ${WEEKLY_FONT}`;
  }
  ctx.fillText("주간 분석", centerX, topY);

  // Center: keep "1분컷"
  ctx.textBaseline = "middle";
  ctx.font = `800 220px ${WEEKLY_FONT}`;
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fillText("1분컷", centerX, centralY);
  resetShadow(ctx);

  // Divider
  const divY = centralY + 110 + 60;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - 300, divY);
  ctx.lineTo(centerX + 300, divY);
  ctx.stroke();

  // Bottom: "YYYY년 MM월 W주차"
  const { y, m, w: wk } = weekOfMonthKst(toDate || fromDate);
  const label = y && m && wk ? `${y}년 ${m}월 ${wk}주차` : `${fromDate} ~ ${toDate}`;
  ctx.textBaseline = "middle";
  ctx.font = `700 92px ${WEEKLY_FONT}`;
  ctx.fillStyle = WEEKLY_POINT;
  ctx.fillText(label, centerX, divY + 92);

  ctx.restore();
}

function weeklyWinPct(r) {
  const w = Number(r?.wins ?? 0);
  const l = Number(r?.losses ?? 0);
  const d = Number(r?.draws ?? 0);
  void d;
  const denom = w + l;
  return denom > 0 ? w / denom : 0;
}

function drawWeeklyStandingsSlide(ctx, w, h, weeklyGames, logosByTeamKey) {
  drawWeeklyBase(ctx, w, h);

  const titleY = 170;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 86px ${WEEKLY_FONT}`;
  ctx.fillText("이번주 팀 성적", w / 2, titleY);
  ctx.restore();

  const list = (Array.isArray(weeklyGames) ? weeklyGames : [])
    .slice()
    .sort((a, b) => weeklyWinPct(b) - weeklyWinPct(a));
  const rows = list.slice(0, 10);

  const x0 = 90;
  const y0 = 320;
  const rowH = 135;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const teamRaw = String(r.team || "");
    const y = y0 + i * rowH;
    const isTop = i === 0;

    ctx.save();
    ctx.fillStyle = isTop ? "rgba(255,215,0,0.16)" : i % 2 === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)";
    ctx.strokeStyle = isTop ? "rgba(255,215,0,0.45)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = isTop ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(x0, y, w - x0 * 2, rowH - 14, 22);
    ctx.fill();
    ctx.stroke();

    // logo
    drawLogoInBox(ctx, teamRaw, x0 + 22 + 92 / 2, y + 18 + 92 / 2, 92);

    // team name
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isTop ? WEEKLY_POINT : "#FFFFFF";
    ctx.font = `900 ${isTop ? 62 : 56}px ${WEEKLY_FONT}`;
    ctx.fillText(teamRaw || "—", x0 + 130, y + (rowH - 14) / 2);

    // W-L-D
    ctx.textAlign = "right";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `800 ${isTop ? 54 : 48}px ${WEEKLY_FONT}`;
    ctx.fillText(`${r.wins ?? 0}승 ${r.losses ?? 0}패 ${r.draws ?? 0}무`, w - x0 - 30, y + (rowH - 14) / 2);

    ctx.restore();
  }
}

/** weekly_top_batters row → "3HR  12H  8RBI  5R  .312" */
function formatWeeklyTopBatterStatLine(b) {
  if (!b || typeof b !== "object") return "";
  const hr = Number(b.hr ?? 0) || 0;
  const h = Number(b.h ?? 0) || 0;
  const rbi = Number(b.rbi ?? 0) || 0;
  const runs = Number(b.runs ?? b.r ?? b.run ?? b.R ?? 0) || 0;
  const avgRaw = b.avg ?? b.AVG ?? b.batting_avg;
  let avgPart = "—";
  if (avgRaw != null && String(avgRaw).trim() !== "") {
    const av = Number(avgRaw);
    if (Number.isFinite(av)) {
      const s = av.toFixed(3);
      avgPart = av < 1 ? `.${s.slice(2)}` : s;
    }
  }
  return `${hr}HR  ${h}H  ${rbi}RBI  ${runs}R  ${avgPart}`;
}

function drawWeeklyHRSlide(ctx, w, h, weeklyTopBatters, logosByTeamKey) {
  drawWeeklyBase(ctx, w, h);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 86px ${WEEKLY_FONT}`;
  ctx.fillText("이번주 홈런왕 Top3", w / 2, 170);
  ctx.restore();

  const list = Array.isArray(weeklyTopBatters) ? weeklyTopBatters : [];
  const b1 = list[0] || null;
  const b2 = list[1] || null;
  const b3 = list[2] || null;

  const drawCard = (rank, b, x, y, cardW, cardH, big) => {
    ctx.save();
    ctx.fillStyle = big ? "rgba(255,215,0,0.14)" : "rgba(255,255,255,0.07)";
    ctx.strokeStyle = big ? "rgba(255,215,0,0.45)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 26);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = WEEKLY_POINT;
    ctx.font = `1000 ${big ? 70 : 58}px ${WEEKLY_FONT}`;
    ctx.fillText(String(rank), x + 26, y + 18);

    if (b) {
      const teamRaw = String(b.team || "");
      const logoSize = big ? 150 : 120;
      drawLogoInBox(
        ctx,
        teamRaw,
        x + 120 + logoSize / 2,
        y + (big ? 50 : 42) + logoSize / 2,
        logoSize
      );

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `1000 ${big ? 70 : 54}px ${WEEKLY_FONT}`;
      ctx.fillText(String(b.player || "—").slice(0, 10), x + 290, y + (big ? 60 : 56));

      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `800 ${big ? 50 : 42}px ${WEEKLY_FONT}`;
      ctx.fillText(teamRaw || "—", x + 290, y + (big ? 140 : 118));

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `800 ${big ? 44 : 36}px ${WEEKLY_FONT}`;
      ctx.fillText(formatWeeklyTopBatterStatLine(b), x + 290, y + (big ? 210 : 182));
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `900 ${big ? 54 : 44}px ${WEEKLY_FONT}`;
      ctx.fillText("데이터 없음", x + 140, y + 120);
    }
    ctx.restore();
  };

  // 1위 크게 (상단)
  drawCard(1, b1, 90, 320, 900, 520, true);
  // 2/3위 작게 (하단 2개)
  drawCard(2, b2, 90, 880, 900, 420, false);
  drawCard(3, b3, 90, 1340, 900, 420, false);
}

function drawWeeklyPitcherSlide(ctx, w, h, weeklyTopPitchers, logosByTeamKey) {
  drawWeeklyBase(ctx, w, h);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 86px ${WEEKLY_FONT}`;
  ctx.fillText("이번주 최고 투수 Top3", w / 2, 170);
  ctx.restore();

  const list = Array.isArray(weeklyTopPitchers) ? weeklyTopPitchers : [];
  const p1 = list[0] || null;
  const p2 = list[1] || null;
  const p3 = list[2] || null;

  const drawCard = (rank, p, x, y, cardW, cardH, big) => {
    ctx.save();
    ctx.fillStyle = big ? "rgba(255,215,0,0.14)" : "rgba(255,255,255,0.07)";
    ctx.strokeStyle = big ? "rgba(255,215,0,0.45)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 26);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = WEEKLY_POINT;
    ctx.font = `1000 ${big ? 70 : 58}px ${WEEKLY_FONT}`;
    ctx.fillText(String(rank), x + 26, y + 18);

    if (p) {
      const teamRaw = String(p.team || "");
      const logoSize = big ? 150 : 120;
      drawLogoInBox(
        ctx,
        teamRaw,
        x + 120 + logoSize / 2,
        y + (big ? 50 : 42) + logoSize / 2,
        logoSize
      );

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `1000 ${big ? 70 : 54}px ${WEEKLY_FONT}`;
      ctx.fillText(String(p.player || "—").slice(0, 10), x + 290, y + (big ? 60 : 56));

      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `800 ${big ? 50 : 42}px ${WEEKLY_FONT}`;
      ctx.fillText(teamRaw || "—", x + 290, y + (big ? 140 : 118));

      ctx.textAlign = "right";
      ctx.fillStyle = WEEKLY_POINT;
      ctx.font = `1000 ${big ? 92 : 74}px ${WEEKLY_FONT}`;
      ctx.fillText(`${Number(p.ip ?? 0).toFixed(1)} IP`, x + cardW - 30, y + (big ? 62 : 56));

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `900 ${big ? 54 : 44}px ${WEEKLY_FONT}`;
      const era = p.era == null ? "—" : Number(p.era).toFixed(2);
      ctx.fillText(`ERA ${era}`, x + cardW - 30, y + (big ? 176 : 150));
      ctx.fillText(`승 ${p.wins ?? 0}`, x + cardW - 30, y + (big ? 238 : 204));
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `900 ${big ? 54 : 44}px ${WEEKLY_FONT}`;
      ctx.fillText("데이터 없음", x + 140, y + 120);
    }
    ctx.restore();
  };

  drawCard(1, p1, 90, 320, 900, 520, true);
  drawCard(2, p2, 90, 880, 900, 420, false);
  drawCard(3, p3, 90, 1340, 900, 420, false);
}

function drawWeeklyNextSlide(ctx, w, h, nextWeekHighlights, logosByTeamKey) {
  drawWeeklyBase(ctx, w, h);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 86px ${WEEKLY_FONT}`;
  ctx.fillText("다음주 주목 경기", w / 2, 170);
  ctx.restore();

  const list = Array.isArray(nextWeekHighlights) ? nextWeekHighlights : [];
  const cardW = 900;
  const cardH = 430;
  const x = (w - cardW) / 2;
  const y0 = 320;
  const gap = 40;

  for (let i = 0; i < 3; i++) {
    const g = list[i] || null;
    const y = y0 + i * (cardH + gap);
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 26);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = WEEKLY_POINT;
    ctx.font = `1000 58px ${WEEKLY_FONT}`;
    ctx.fillText(String(i + 1), x + 26, y + 18);

    if (g) {
      const awayRaw = String(g.away_team || "");
      const homeRaw = String(g.home_team || "");
      drawLogoInBox(ctx, awayRaw, x + 110 + 130 / 2, y + 90 + 130 / 2, 130);
      drawLogoInBox(ctx, homeRaw, x + cardW - 110 - 130 + 130 / 2, y + 90 + 130 / 2, 130);

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `1000 60px ${WEEKLY_FONT}`;
      ctx.fillText(`${teamShortName(awayRaw)}  VS  ${teamShortName(homeRaw)}`, x + cardW / 2, y + 98);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `900 46px ${WEEKLY_FONT}`;
      ctx.fillText(
        `${String(g.game_date || "").slice(0, 10)} ${String(g.game_time || "").trim()}`,
        x + cardW / 2,
        y + 182
      );

      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = `800 40px ${WEEKLY_FONT}`;
      ctx.fillText(String(g.venue || "").slice(0, 22), x + cardW / 2, y + 248);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `900 44px ${WEEKLY_FONT}`;
      ctx.fillText("데이터 없음", x + 140, y + 160);
    }
    ctx.restore();
  }
}

function Card9WeeklySummary() {
  const last = useMemo(() => getWeekRangeKst("last"), []);
  const [fromDate, setFromDate] = useState(last.from);
  const [toDate, setToDate] = useState(last.to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const weeklyData = data;
  const [slideIdx, setSlideIdx] = useState(0);

  const slides = useMemo(
    () => [
      { type: "intro" },
      { type: "weekly_games" },
      { type: "weekly_top_batters" },
      { type: "weekly_top_pitchers" },
      { type: "next_week_highlights" },
    ],
    []
  );

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

    const slide = slides[idx];
    if (!slide) return;

    const weeklyGames = Array.isArray(weeklyData?.weekly_games) ? weeklyData.weekly_games : [];
    const topBatters = Array.isArray(weeklyData?.weekly_top_batters)
      ? weeklyData.weekly_top_batters
      : [];
    const topPitchers = Array.isArray(weeklyData?.weekly_top_pitchers)
      ? weeklyData.weekly_top_pitchers
      : [];
    const highlights = Array.isArray(weeklyData?.next_week_highlights)
      ? weeklyData.next_week_highlights
      : [];

    const teamKeys = new Set();
    // preload common 10 team logos for intro
    if (slide.type === "intro") {
      for (const tk of ["KIA", "삼성", "LG", "두산", "KT", "SSG", "롯데", "한화", "NC", "키움"]) {
        teamKeys.add(tk);
      }
    } else if (slide.type === "weekly_games") {
      for (const r of weeklyGames.slice(0, 10)) teamKeys.add(teamKeyword(r?.team || ""));
    } else if (slide.type === "weekly_top_batters") {
      for (const r of topBatters.slice(0, 3)) teamKeys.add(teamKeyword(r?.team || ""));
    } else if (slide.type === "weekly_top_pitchers") {
      for (const r of topPitchers.slice(0, 3)) teamKeys.add(teamKeyword(r?.team || ""));
    } else if (slide.type === "next_week_highlights") {
      for (const g of highlights.slice(0, 3)) {
        teamKeys.add(teamKeyword(g?.home_team || ""));
        teamKeys.add(teamKeyword(g?.away_team || ""));
      }
    }

    const logosByTeamKey = {};
    for (const tk of teamKeys) {
      const img = await loadSvgLogo(tk);
      logosByTeamKey[tk] = img;
    }
    // Expose loaded logos to weekly slides helper (teamName → keyword key)
    for (const [k, img] of Object.entries(logosByTeamKey)) {
      if (img) teamLogoImages[k] = img;
    }
    await loadShortsBaseballDecor();

    if (slide.type === "intro") drawWeeklyIntroSlide(ctx, w, h, fromDate, toDate, logosByTeamKey);
    else if (slide.type === "weekly_games") drawWeeklyStandingsSlide(ctx, w, h, weeklyGames, logosByTeamKey);
    else if (slide.type === "weekly_top_batters") drawWeeklyHRSlide(ctx, w, h, topBatters, logosByTeamKey);
    else if (slide.type === "weekly_top_pitchers") drawWeeklyPitcherSlide(ctx, w, h, topPitchers, logosByTeamKey);
    else drawWeeklyNextSlide(ctx, w, h, highlights, logosByTeamKey);
  };

  const onFetch = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await postKbo({
        action: "weekly_summary",
        from_date: fromDate,
        to_date: toDate,
      });
      setData(res);
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
    downloadBlob(
      blob,
      `weekly_${fromDate}_${toDate}_${String(idx + 1).padStart(2, "0")}.png`
    );
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    for (let i = 0; i < slides.length; i++) {
      const c = document.createElement("canvas");
      await renderSlideToCanvas(i, c);
      const blob = await canvasToBlob(c);
      if (!blob) continue;
      zip.file(
        `weekly_${fromDate}_${toDate}_${String(i + 1).padStart(2, "0")}.png`,
        blob
      );
    }
    const out = await zip.generateAsync({ type: "blob" });
    downloadBlob(out, `weekly_${fromDate}_${toDate}.zip`);
  };

  return (
    <div className="section soft">
      <div className="section-title">4. 쇼츠-주간-분석(월요일)</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드</div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontWeight: 900 }}>시작</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontWeight: 900 }}>종료</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>

        <button
          type="button"
          className="primary"
          onClick={() => {
            const r = getWeekRangeKst("this");
            setFromDate(r.from);
            setToDate(r.to);
          }}
          disabled={busy}
        >
          이번주
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const r = getWeekRangeKst("last");
            setFromDate(r.from);
            setToDate(r.to);
          }}
          disabled={busy}
        >
          지난주
        </button>

        <button type="button" className="primary primary-fill" onClick={onFetch} disabled={busy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
        <button type="button" className="primary" onClick={downloadZip} disabled={!data || busy}>
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
              - 슬라이드1: 인트로<br />
              - 슬라이드2: 주간 팀별 순위/성적<br />
              - 슬라이드3: 주간 최다 홈런 Top3<br />
              - 슬라이드4: 주간 최고 투수 Top3<br />
              - 슬라이드5: 다음주 주목 경기
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ShortsCanvas = forwardRef(function ShortsCanvas(
  { slideIdx, renderSlide },
  ref
) {
  const canvasRef = useRef(null);
  useEffect(() => {
    renderSlide(canvasRef.current);
  }, [slideIdx, renderSlide]);
  return (
    <div className="shorts-capture-wrap">
      <div
        ref={ref}
        className="slide-card"
        style={{
          margin: 0,
          padding: 0,
          display: "inline-block",
          lineHeight: 0,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            margin: 0,
            padding: 0,
            borderRadius: 14,
            border: "1px solid rgba(0,0,0,0.15)",
          }}
        />
      </div>
    </div>
  );
});

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

  const [tab, setTab] = useState("shorts");
  const [memoOpen, setMemoOpen] = useState(false);
  const [activeKey, setActiveKey] = useState("shorts_slides");
  const [pendingSegments, setPendingSegments] = useState([]);
  const [shorts3JobId, setShorts3JobId] = useState("");

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
  const [pvMode, setPvMode] = useState("pitcher");

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
  const shortsTomorrowIso = useMemo(() => isoSeoulTomorrowIso(), []);
  const [wkOut, setWkOut] = useState({
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
        <div className="topbar-row topbar-row-head">
          <div className="topbar-row-main">
            <span className="topbar-k">마지막 업데이트:</span>{" "}
            <span className="topbar-v">
              {lastMeta.error ? "—" : fmtKstTimestamp(lastMeta.data?.timestamp)}
            </span>
            {" "}
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await postKbo({ action: "trigger_crawl", date: mvpDate });
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
          <button
            type="button"
            className="memo-toolbar-btn"
            aria-label="메모장 열기"
            title="메모장"
            onClick={() => setMemoOpen(true)}
          >
            📝
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
      <MemoPadModal open={memoOpen} onClose={() => setMemoOpen(false)} />
      <div className="layout">
        <aside className="sidebar">
          <div className="side-head">
            <div className="side-brand">KBO Dashboard</div>
            <div className="side-sub">좌측에서 실행 → 우측에서 결과 확인</div>
          </div>

          <nav className="side-tabs" aria-label="기능 분류">
            <button
              type="button"
              className={`side-tab ${tab === "shorts" ? "active" : ""}`}
              onClick={() => {
                setTab("shorts");
                setActiveKey("shorts_slides");
              }}
            >
              KBO-쇼츠
            </button>
            <button
              type="button"
              className="shorts-verify-link shorts-verify-link--naver"
              style={{ marginTop: 4, width: "100%", boxSizing: "border-box" }}
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                window.open(
                  `https://m.sports.naver.com/kbaseball/schedule/index?date=${today}`,
                  "_blank"
                );
              }}
            >
              📅 네이버 야구일정
            </button>
            <button
              type="button"
              className="shorts-verify-link shorts-verify-link--naver"
              style={{ marginTop: 4, width: "100%", boxSizing: "border-box" }}
              onClick={() => window.open("https://www.koreabaseball.com/", "_blank")}
            >
              ⚾ KBO 공홈
            </button>
            <button
              type="button"
              className={`side-tab ${tab === "etc_shorts" ? "active" : ""}`}
              onClick={() => {
                setTab("etc_shorts");
                setActiveKey("shorts_product_review");
              }}
            >
              제품리뷰-쇼츠
            </button>
            <button
              type="button"
              className={`side-tab ${tab === "shorts_edit" ? "active" : ""}`}
              onClick={() => {
                setTab("shorts_edit");
                setActiveKey("shorts3_highlight");
              }}
            >
              쇼츠-영상편집
            </button>
          </nav>

          {tab === "etc_shorts" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">1. 쇼츠-제품리뷰</div>
                <button
                  type="button"
                  className="primary primary-fill"
                  style={{ marginTop: 10 }}
                  onClick={() => setActiveKey("shorts_product_review")}
                >
                  패널 열기
                </button>
              </div>
            </div>
          )}

          {tab === "shorts_edit" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">쇼츠-영상편집</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setActiveKey("shorts3_highlight")}
                  >
                    패널 열기
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setActiveKey("shorts3_thumbnail")}
                  >
                    썸네일
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => setActiveKey("shorts3_ai")}
                  >
                    AI 분석
                  </button>
                </div>
              </div>

              <div className="side-group">
                <div className="side-group-title">⚙️ 영상 설정</div>
                <div className="side-video-settings-actions">
                  <button
                    type="button"
                    className="primary primary-fill"
                    onClick={() => {
                      setActiveKey("video_presets");
                    }}
                  >
                    프리셋 열기
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setActiveKey("music_library");
                    }}
                  >
                    음원 관리
                  </button>
                  <a
                    className="primary primary-fill"
                    href="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
                    download="yt-dlp.exe"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ⬇ yt-dlp 다운로드
                  </a>
                  <a
                    className="primary"
                    href="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
                    download="ffmpeg-release-essentials.zip"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ⬇ FFmpeg 다운로드
                  </a>
                </div>
              </div>
            </div>
          )}

          {tab === "shorts" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">1. 쇼츠-일간-경기결과</div>
                <button
                  type="button"
                  className="primary primary-fill"
                  style={{ marginTop: 10 }}
                  disabled={busy === "shorts_slides_open"}
                  onClick={() => {
                    setActiveKey("shorts_slides");
                  }}
                >
                  패널 열기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">2. 쇼츠-내일경기-예고</div>
                <button
                  type="button"
                  className="primary primary-fill"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setActiveKey("shorts_tomorrow_preview");
                  }}
                >
                  패널 열기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">3. 쇼츠-경기별-전력비교</div>
                <button
                  type="button"
                  className="primary primary-fill"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setActiveKey("shorts4_matchup");
                  }}
                >
                  패널 열기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">4. 쇼츠-주간결산(월)</div>
                <button
                  type="button"
                  className="primary primary-fill"
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    setActiveKey("shorts5_team_weekly");
                  }}
                >
                  패널 열기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">5. 쇼츠-투수VS타자</div>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setActiveKey("pv")}
                >
                  패널 열기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">5. 팀별 주간 트렌드</div>
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
                <div className="side-group-title">7. 기간별 선수 성적</div>
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
                <div className="side-group-title">8. 선발 투수 비교</div>
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

              <div className="side-group">
                <div className="side-group-title">9. 선발 vs 상대 타선</div>
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
                <div className="side-group-title">10. 최근 5경기 폼 예측</div>
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
              <ShortsPvPanel />
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
                  ) : activeKey === "shorts3_highlight" ? (
                    <Shorts3Panel
                      pendingSegments={pendingSegments}
                      onPendingSegmentsUsed={() => setPendingSegments([])}
                      onJobIdChange={setShorts3JobId}
                    />
                  ) : activeKey === "shorts3_thumbnail" ? (
                    <Shorts3ThumbnailPanel jobId={shorts3JobId} />
                  ) : activeKey === "shorts3_ai" ? (
                    <Shorts3AIPanel
                      onAddSegments={(segs) => {
                        setPendingSegments(Array.isArray(segs) ? segs : []);
                        setActiveKey("shorts3_highlight");
                      }}
                    />
                  ) : activeKey === "video_presets" ? (
                    <VideoPresetsPanel />
                  ) : activeKey === "music_library" ? (
                    <MusicLibraryPanel />
                  ) : activeKey === "video_prep" ? (
                    <VideoPrep
                      onJobReady={(jobId) => {
                        const id = String(jobId || "").trim();
                        if (id) setShorts3JobId(id);
                        setActiveKey("shorts3_highlight");
                      }}
                    />
                  ) : activeKey === "shorts_slides" ? (
                    <Card8Shorts defaultDate={shDate} onShortsDateChange={setShDate} />
                  ) : activeKey === "shorts_tomorrow_preview" ? (
                    <CardTomorrowPreviewShorts previewDateIso={shortsTomorrowIso} />
                  ) : activeKey === "shorts4_matchup" ? (
                    <Shorts4Panel />
                  ) : activeKey === "shorts5_team_weekly" ? (
                    <Shorts5Panel />
                  ) : activeKey === "shorts_pitcher_week" ? (
                    <ResultBlock
                      title={null}
                      text={wkOut.text}
                      error={wkOut.error}
                      pending={pending("shorts_pitcher_week_9")}
                    />
                  ) : activeKey === "shorts_product_review" ? (
                    <ShortsProductReviewPanel />
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
