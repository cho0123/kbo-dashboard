import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postKbo, seoulToday } from "./api.js";

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

function stripCompositeSummarySection(md) {
  const text = String(md || "");
  // Remove a "종합 성적 요약" block (the extra vertical summary the user wants gone),
  // but keep other sections like "경기별 ..." and the rest of the report.
  //
  // Claude output varies: this heading sometimes appears as a markdown heading,
  // a bold line, or a bullet item. We strip the block until the next section
  // heading (### ...) OR a line that starts a "경기별 ..." section.
  const re =
    /(^|\n)\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*(?:📌|📊|📅|📋)?\s*종합\s*성적\s*요약[^\n]*\n+([\s\S]*?)(?=\n\s*(?:#{1,6}\s+|(?:[-*]\s*)?(?:\*\*)?\s*(?:📋|📅|📊|📌)?\s*경기별|$))/m;
  return text.replace(re, "\n");
}

function stripMonthlySummarySection(md) {
  const text = String(md || "");
  // Remove a "월간 종합 성적" block regardless of formatting (heading/bold/bullet),
  // and keep the rest (e.g., 경기별 상세 성적).
  const re =
    /(^|\n)\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?\s*(?:📌|📊|📅|📋)?\s*월간\s*종합\s*성적[^\n]*\n+([\s\S]*?)(?=\n\s*(?:#{1,6}\s+|(?:[-*]\s*)?(?:\*\*)?\s*(?:📋|📅|📊|📌)?\s*경기별|$))/m;
  return text.replace(re, "\n");
}

function stripDuplicateSummaryTables(md) {
  const text = String(md || "");
  // Remove markdown tables under summary headings if present.
  // Keeps the rest of the report (e.g., 경기별 상세 성적).
  const patterns = [
    /(^|\n)\s*#{1,4}\s*📊?\s*전체\s*요약[^\n]*\n+(?:\|.*\n)+\|(?:\s*:?[-]+:?[\s|]*)\n(?:\|.*\n)+/m,
    /(^|\n)\s*#{1,4}\s*📅?\s*월간\s*종합\s*성적[^\n]*\n+(?:\|.*\n)+\|(?:\s*:?[-]+:?[\s|]*)\n(?:\|.*\n)+/m,
    /(^|\n)\s*#{1,4}\s*📅?\s*전체\s*누적\s*성적[^\n]*\n+(?:\|.*\n)+\|(?:\s*:?[-]+:?[\s|]*)\n(?:\|.*\n)+/m,
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, "\n");
  return out;
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
                <div className="side-group-title">8. 하이라이트 (쇼츠)</div>
                <label>날짜</label>
                <input
                  type="date"
                  value={shDate}
                  onChange={(e) => setShDate(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("shorts_highlight_8")}
                  onClick={() => {
                    setActiveKey("shorts_highlight");
                    runWith("shorts_highlight", { date: shDate }, "8", setHlOut);
                  }}
                >
                  쇼츠 대본 생성
                </button>
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
                                      const no = (idx ?? 0) + 1;
                                      const hrStr =
                                        Number.isFinite(hr) && hr > 0 ? ` ${hr}홈런` : "";
                                      return `${no}. ${name} — ${ab}타수 ${h}안타 ${rbi}타점${hrStr}${
                                        avgDot ? ` ${avgDot}` : ""
                                      }`;
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
                                            <pre className="mono">
                                              {awayBatters.length
                                                ? awayBatters
                                                    .slice(0, 18)
                                                        .map((r, idx) =>
                                                          formatBatterLine(r, idx)
                                                        )
                                                    .join("\n")
                                                : "데이터 없음"}
                                            </pre>
                                          </div>

                                          <div>
                                            <div className="muted">
                                              홈팀 타자 기록 ({home})
                                            </div>
                                            <pre className="mono">
                                              {homeBatters.length
                                                ? homeBatters
                                                    .slice(0, 18)
                                                        .map((r, idx) =>
                                                          formatBatterLine(r, idx)
                                                        )
                                                    .join("\n")
                                                : "데이터 없음"}
                                            </pre>
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
                            text={stripCompositeSummarySection(
                              stripMonthlySummarySection(
                                stripDuplicateSummaryTables(
                                  removeFirstHeading(prOut.text).replace(/^\s*0\s*(\r?\n)+/, "")
                                )
                              )
                            )}
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
