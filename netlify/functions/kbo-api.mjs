import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

function initFirebase() {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) {
    throw new Error(
      "Set FIREBASE_SERVICE_ACCOUNT_JSON (full service account JSON string)"
    );
  }
  let cred;
  try {
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is empty");
      cred = JSON.parse(s);
    } else {
      cred = raw;
    }
  } catch (e) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON 파싱 실패(한 줄 JSON인지 확인): ${e?.message || e}`
    );
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(cred),
    });
  }
  return admin.firestore();
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function claude(system, user, maxTokens = 2048) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: system,
    messages: [{ role: "user", content: user }],
  });
  const parts = [];
  for (const block of msg.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("").trim();
}

function docSnap(d) {
  const v =
    typeof d?.data === "function"
      ? d.data()
      : d && typeof d === "object"
        ? d
        : null;
  return v && typeof v === "object" ? { ...v } : {};
}

function isoSeoulToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function pickStr(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function pickTeamName(row) {
  return (
    pickStr(row, ["team", "team_name", "club", "teamName", "TEAM"]) || "—"
  ).slice(0, 18);
}

function pickPlayerName(row) {
  return (
    pickStr(row, ["player", "name", "player_name", "batter", "pitcher"]) || "—"
  ).slice(0, 24);
}

function scoreBatter(row) {
  const hr = pickNum(row, ["hr", "HR", "home_run"]);
  const rbi = pickNum(row, ["rbi", "RBI", "bi"]);
  const h = pickNum(row, ["h", "H", "hits"]);
  return hr * 100 + rbi * 10 + h * 3;
}

function scorePitcher(row) {
  const ip = pickNum(row, ["ip", "IP", "inn", "innings"]);
  const runs = pickNum(row, ["er", "ER", "earned_runs", "r", "R", "runs"]);
  const k = pickNum(row, ["so", "SO", "k", "K", "strikeouts"]);
  // 이닝 가중↑, 실점 페널티↑ (단순 휴리스틱)
  return ip * 10 + k * 1 - runs * 20;
}

function formatPitcherKeyStats(row) {
  const ipRaw = row?.ip ?? row?.IP ?? row?.inn ?? row?.innings;
  const ip = ipRaw != null && String(ipRaw).trim() !== "" ? String(ipRaw).trim() : String(pickNum(row, ["ip", "IP", "inn", "innings"]) || 0);
  const runs = pickNum(row, ["er", "ER", "earned_runs", "r", "R", "runs"]);
  const k = pickNum(row, ["so", "SO", "k", "K", "strikeouts"]);
  return `${ip}이닝 ${runs}실점 ${k}K`;
}

function formatBatterKeyStats(row) {
  const ab = pickNum(row, ["ab", "AB", "at_bats"]);
  const h = pickNum(row, ["h", "H", "hits"]);
  const hr = pickNum(row, ["hr", "HR", "home_run"]);
  const rbi = pickNum(row, ["rbi", "RBI", "bi"]);
  return `${ab}타수 ${h}안타 ${hr}홈런 ${rbi}타점`;
}

function bestByScore(rows, scorer) {
  let best = null;
  let bestScore = -Infinity;
  for (const r of rows || []) {
    const s = scorer(r);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchGamesByDate(db, dateStr) {
  const snap = await db
    .collection("games")
    .where("game_date", "==", dateStr)
    .get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  return rows;
}

function variantsForGameId(gid) {
  const out = new Set();
  if (gid == null || gid === "") return [];
  out.add(gid);
  if (typeof gid === "string") {
    const t = gid.trim();
    if (t !== "") {
      out.add(t);
      if (/^-?\d+$/.test(t)) {
        const n = Number(t);
        if (!Number.isNaN(n)) out.add(n);
      }
    }
  } else if (typeof gid === "number" && !Number.isNaN(gid)) {
    out.add(String(gid));
  }
  return [...out];
}

async function fetchBoxForGames(db, gameIds) {
  const batters = [];
  const pitchers = [];
  const seenB = new Set();
  const seenP = new Set();

  async function mergeCollection(collName, rows, seen, gid) {
    for (const v of variantsForGameId(gid)) {
      const snap = await db
        .collection(collName)
        .where("game_id", "==", v)
        .get();
      snap.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          rows.push({ id: d.id, ...docSnap(d) });
        }
      });
    }
  }

  for (const gid of gameIds) {
    await mergeCollection("batters", batters, seenB, gid);
    await mergeCollection("pitchers", pitchers, seenP, gid);
  }
  return { batters, pitchers };
}

async function fetchAllGames(db, max = 2500) {
  const snap = await db.collection("games").limit(max).get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  return rows;
}

function teamMatches(teamField, kw) {
  return kw && String(teamField || "").includes(kw.trim());
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickNum(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function normalizeGameId(x) {
  if (x == null) return "";
  const s = String(x).trim();
  return s;
}

function safeIsoDate(x) {
  const s = String(x || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

async function queryPlayerByRange(db, collection, player, start, end, max = 1800) {
  const p = String(player || "").trim();
  const s = safeIsoDate(start);
  const e = safeIsoDate(end);
  if (!p) return [];
  try {
    // Requires composite index: (player, game_date)
    let q = db.collection(collection).where("player", "==", p);
    if (s) q = q.where("game_date", ">=", s);
    if (e) q = q.where("game_date", "<=", e);
    if (s || e) q = q.orderBy("game_date", "asc");
    q = q.limit(max);
    const snap = await q.get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
    return rows;
  } catch (err) {
    console.warn(`[pv_batter_stats] range query failed (${collection}):`, err?.message || err);
    // Fallback: player-only scan (still bounded)
    const snap = await db
      .collection(collection)
      .where("player", "==", p)
      .limit(max)
      .get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
    if (!s && !e) return rows;
    return rows.filter((r) => {
      const gd = safeIsoDate(r.game_date);
      if (!gd) return false;
      if (s && gd < s) return false;
      if (e && gd > e) return false;
      return true;
    });
  }
}

function summarizeMatchupFromBatterLines(batterLines) {
  const totals = {
    games: 0,
    pa: 0,
    ab: 0,
    h: 0,
    hr: 0,
    bb: 0,
    so: 0,
  };
  const gameIds = new Set();
  for (const r of batterLines) {
    const gid = normalizeGameId(r.game_id);
    if (gid) gameIds.add(gid);
    totals.pa += pickNum(r, ["pa", "PA", "plate_appearances", "plateAppearances"]);
    totals.ab += pickNum(r, ["ab", "AB", "at_bats", "atBats", "at_bat"]);
    totals.h += pickNum(r, ["h", "H", "hits"]);
    totals.hr += pickNum(r, ["hr", "HR", "home_run", "homeRuns", "home_runs"]);
    totals.bb += pickNum(r, ["bb", "BB", "walks", "base_on_balls", "bases_on_balls"]);
    totals.so += pickNum(r, ["so", "SO", "k", "K", "strikeouts", "strikeout"]);
  }
  totals.games = gameIds.size;
  const avg = totals.ab > 0 ? totals.h / totals.ab : 0;
  const fmtAvg = totals.ab > 0 ? avg.toFixed(3) : "—";
  const pa = totals.pa || (totals.ab + totals.bb);
  return {
    ...totals,
    pa,
    avg: fmtAvg,
  };
}

function isInsufficient(stat) {
  return (stat?.games ?? 0) < 3 || (stat?.ab ?? 0) < 10;
}

async function pvBatterStats(db, pitcher, batter, start, end) {
  const [bats, pits] = await Promise.all([
    queryPlayerByRange(db, "batters", batter, start, end, 1800),
    queryPlayerByRange(db, "pitchers", pitcher, start, end, 1200),
  ]);
  const bg = new Set(bats.map((r) => normalizeGameId(r.game_id)).filter(Boolean));
  const pg = new Set(pits.map((r) => normalizeGameId(r.game_id)).filter(Boolean));
  const common = [...bg].filter((g) => pg.has(g));
  const batLines = bats.filter((r) => pg.has(normalizeGameId(r.game_id)));
  const pitLines = pits.filter((r) => bg.has(normalizeGameId(r.game_id)));
  const stat = summarizeMatchupFromBatterLines(batLines);
  return {
    pitcher,
    batter,
    shared_game_ids: common,
    batter_lines: batLines,
    pitcher_lines: pitLines,
    stat,
    insufficient: isInsufficient(stat),
  };
}

function firstNonEmptyString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function pickOpponentTeam(bat, pit) {
  const keys = [
    "vs_team",
    "opp_team",
    "opponent_team",
    "opponent",
    "against_team",
    "matchup_team",
    "상대",
  ];
  const a = firstNonEmptyString(bat || {}, keys);
  if (a) return a.slice(0, 36);
  const b = firstNonEmptyString(pit || {}, keys);
  if (b) return b.slice(0, 36);
  return "—";
}

/** 투수 한 줄: "4이닝 7실점 10피안타 1K" */
function formatPitcherGameLine(p) {
  if (!p || typeof p !== "object") return "기록 없음";
  const ipRaw = p.ip ?? p.IP ?? p.inn ?? p.innings ?? p.innings_pitched;
  const ipStr =
    ipRaw != null && String(ipRaw).trim() !== ""
      ? String(ipRaw).trim()
      : "";
  const runs = pickNum(p, [
    "er",
    "ER",
    "earned_runs",
    "r",
    "R",
    "runs",
    "runs_allowed",
  ]);
  const hAllowed = pickNum(p, ["h", "H", "hits", "hits_allowed", "ha"]);
  const k = pickNum(p, ["so", "SO", "k", "K", "strikeouts"]);
  const parts = [];
  if (ipStr) parts.push(`${ipStr}이닝`);
  else {
    const ipn = pickNum(p, ["ip", "IP", "inn", "innings"]);
    if (ipn > 0) parts.push(`${ipn}이닝`);
  }
  parts.push(`${runs}실점`);
  parts.push(`${hAllowed}피안타`);
  if (k > 0) parts.push(`${k}K`);
  return parts.join(" ");
}

/** 타자 한 줄: "4타수 1안타 1홈런 2타점" */
function formatBatterGameLine(b) {
  if (!b || typeof b !== "object") return "기록 없음";
  const ab = pickNum(b, ["ab", "AB", "at_bats"]);
  const h = pickNum(b, ["h", "H", "hits"]);
  const hr = pickNum(b, ["hr", "HR", "home_run"]);
  const rbi = pickNum(b, ["rbi", "RBI", "bi"]);
  const parts = [];
  parts.push(`${ab}타수`);
  parts.push(`${h}안타`);
  parts.push(`${hr}홈런`);
  parts.push(`${rbi}타점`);
  return parts.join(" ");
}

function pickTeamAbbr(b, p) {
  const keys = ["team_code", "abbr", "team_abbr", "short_team"];
  const v =
    firstNonEmptyString(b || {}, keys) ||
    firstNonEmptyString(p || {}, keys);
  if (v) return v.slice(0, 8).toUpperCase();
  const team = firstNonEmptyString(b || {}, ["team", "team_name", "club"]);
  if (team) return team.slice(0, 4);
  return "—";
}

function pickHomeAwayLabel(b, p) {
  const raw =
    firstNonEmptyString(b || {}, [
      "ha",
      "home_away",
      "venue_type",
      "is_home",
      "away_home",
      "홈원정",
    ]) ||
    firstNonEmptyString(p || {}, [
      "ha",
      "home_away",
      "venue_type",
      "is_home",
    ]);
  const s = String(raw).toLowerCase();
  if (
    s.includes("away") ||
    s.includes("원정") ||
    s === "a" ||
    s === "visit"
  )
    return "원정";
  if (s.includes("home") || s.includes("홈") || s === "h") return "홈";
  if (raw === 0 || raw === "0") return "원정";
  if (raw === 1 || raw === "1") return "홈";
  const ht = firstNonEmptyString(b || {}, ["home_team"]);
  const at = firstNonEmptyString(b || {}, ["away_team"]);
  const mt =
    firstNonEmptyString(b || {}, ["team", "team_name"]) ||
    firstNonEmptyString(p || {}, ["team", "team_name"]);
  if (mt && ht && String(ht).includes(mt)) return "홈";
  if (mt && at && String(at).includes(mt)) return "원정";
  return "—";
}

function displayGameId(gid) {
  const s = String(gid || "");
  if (!s) return "—";
  return s.length > 16 ? `…${s.slice(-12)}` : s;
}

/** 경기별 카드용 — 동일 game_id당 1건 */
function buildPvPerGameRows(
  batterLines,
  pitcherLines,
  pitcherName,
  batterName,
  maxRows = 80
) {
  const byBat = new Map();
  for (const r of batterLines || []) {
    const gid = normalizeGameId(r.game_id);
    if (!gid || byBat.has(gid)) continue;
    byBat.set(gid, r);
  }
  const byPit = new Map();
  for (const r of pitcherLines || []) {
    const gid = normalizeGameId(r.game_id);
    if (!gid || !byBat.has(gid) || byPit.has(gid)) continue;
    byPit.set(gid, r);
  }
  const rows = [];
  for (const [gid, p] of byPit) {
    const b = byBat.get(gid);
    const dateFull = safeIsoDate(b?.game_date || p?.game_date || "");
    const pn =
      firstNonEmptyString(p || {}, ["player", "pitcher", "name"]) ||
      pitcherName ||
      "투수";
    const bn =
      firstNonEmptyString(b || {}, ["player", "batter", "name"]) ||
      batterName ||
      "타자";
    const opp = pickOpponentTeam(b, p);
    rows.push({
      game_id: gid,
      game_id_display: displayGameId(gid),
      date: dateFull || "—",
      team_abbr: pickTeamAbbr(b, p),
      home_away: pickHomeAwayLabel(b, p),
      opponent_label: opp,
      pitcher_name: pn,
      pitcher_stats: formatPitcherGameLine(p),
      batter_name: bn,
      batter_stats: formatBatterGameLine(b),
    });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows.slice(0, maxRows);
}

function gamesForTeamWindow(allGames, teamKw, days = 7) {
  const sorted = [...allGames].sort((a, b) =>
    String(a.game_date || "").localeCompare(String(b.game_date || ""))
  );
  const last = sorted[sorted.length - 1];
  if (!last?.game_date) return [];
  const end = new Date(last.game_date + "T12:00:00");
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const from = iso(start);
  const to = iso(end);
  const kw = (teamKw || "").trim();
  return sorted.filter((g) => {
    const gd = String(g.game_date || "");
    if (gd < from || gd > to) return false;
    if (!kw) return true;
    return teamMatches(g.away_team, kw) || teamMatches(g.home_team, kw);
  });
}

/** team_week 전용: 최근 N일(포함) 구간의 시작일 (YYYY-MM-DD, UTC 일 단위) */
function inclusiveDateWindowFromEnd(endIso, days) {
  const n = Math.max(1, Math.min(Number(days) || 7, 366));
  const parts = String(endIso).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) {
    const e = String(endIso).slice(0, 10);
    return { from: e, to: e };
  }
  const end = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const iso = (dt) => dt.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

const TEAM_WEEK_MAX_GAMES = 48;

function slimTeamWeekGame(g) {
  if (!g || typeof g !== "object") return {};
  return {
    game_date: g.game_date ?? null,
    game_id: g.game_id ?? null,
    home_team: g.home_team ?? null,
    away_team: g.away_team ?? null,
    home_score: g.home_score ?? null,
    away_score: g.away_score ?? null,
  };
}

async function fetchLatestGameRow(db) {
  const snap = await db
    .collection("games")
    .orderBy("game_date", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...docSnap(d) };
}

async function fetchGamesDateRange(db, fromStr, toStr) {
  const snap = await db
    .collection("games")
    .where("game_date", ">=", fromStr)
    .where("game_date", "<=", toStr)
    .get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  return rows;
}

function filterAndSlimTeamWeekGames(rows, teamKw) {
  const kw = (teamKw || "").trim();
  const filtered = rows.filter(
    (g) =>
      !kw ||
      teamMatches(g.away_team, kw) ||
      teamMatches(g.home_team, kw)
  );
  const sorted = [...filtered].sort((a, b) =>
    String(a.game_date || "").localeCompare(String(b.game_date || ""))
  );
  return sorted.slice(-TEAM_WEEK_MAX_GAMES).map(slimTeamWeekGame);
}

/** 정렬된 전체 목록에서 rolling window (gamesForTeamWindow 와 동일 규칙) */
function filterGamesInRollingWindow(sortedAsc, teamKw, days) {
  const last = sortedAsc[sortedAsc.length - 1];
  if (!last?.game_date) return [];
  const endIso = String(last.game_date).slice(0, 10);
  const { from } = inclusiveDateWindowFromEnd(endIso, days);
  const kw = (teamKw || "").trim();
  return sortedAsc.filter((g) => {
    const gd = String(g.game_date || "").slice(0, 10);
    if (gd < from || gd > endIso) return false;
    if (!kw) return true;
    return teamMatches(g.away_team, kw) || teamMatches(g.home_team, kw);
  });
}

/**
 * 팀 주간 트렌드: 전체 games 스캔 대신 (1) 최신일 조회 + (2) 날짜 구간 쿼리만 사용.
 * 실패 시 소량 스캔으로 폴백.
 */
async function fetchGamesForTeamWeek(db, teamKw, days) {
  const dayCount = Math.min(Math.max(Number(days) || 7, 1), 30);
  try {
    const latest = await fetchLatestGameRow(db);
    if (!latest?.game_date) {
      return { games: [], window: null, queryNote: "empty_db" };
    }
    const endIso = String(latest.game_date).slice(0, 10);
    const { from, to } = inclusiveDateWindowFromEnd(endIso, dayCount);
    const inRange = await fetchGamesDateRange(db, from, to);
    const games = filterAndSlimTeamWeekGames(inRange, teamKw);
    return {
      games,
      window: { from, to },
      queryNote: "date_range",
    };
  } catch (e) {
    console.warn("[team_week] range query failed:", e?.message || e);
    const all = await fetchAllGames(db, 900);
    const sorted = [...all].sort((a, b) =>
      String(a.game_date || "").localeCompare(String(b.game_date || ""))
    );
    const subset = filterGamesInRollingWindow(sorted, teamKw, dayCount);
    const slim = subset
      .slice(-TEAM_WEEK_MAX_GAMES)
      .map(slimTeamWeekGame);
    const first =
      subset.length > 0
        ? String(subset[0].game_date || "").slice(0, 10)
        : null;
    const last =
      subset.length > 0
        ? String(subset[subset.length - 1].game_date || "").slice(0, 10)
        : null;
    return {
      games: slim,
      window: first && last ? { from: first, to: last } : null,
      queryNote: `fallback:${String(e?.message || e).slice(0, 120)}`,
    };
  }
}

async function fetchPlayerLines(db, player, max = 500) {
  const bats = [];
  const pits = [];
  const bs = await db
    .collection("batters")
    .where("player", "==", player)
    .limit(max)
    .get();
  bs.forEach((d) => bats.push({ id: d.id, ...docSnap(d) }));
  const ps = await db
    .collection("pitchers")
    .where("player", "==", player)
    .limit(max)
    .get();
  ps.forEach((d) => pits.push({ id: d.id, ...docSnap(d) }));
  const sortKey = (r) =>
    `${r.game_date || ""}_${r.game_id || ""}`;
  bats.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  pits.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { batters: bats, pitchers: pits };
}

async function pitcherBatterOverlap(db, batterName, pitcherName) {
  const { batters: bb } = await fetchPlayerLines(db, batterName, 600);
  const { pitchers: pp } = await fetchPlayerLines(db, pitcherName, 600);
  const bg = new Set(bb.map((r) => String(r.game_id)));
  const pg = new Set(pp.map((r) => String(r.game_id)));
  const common = [...bg].filter((g) => pg.has(g));
  // 상대전적 서술형에서 allGames 전체 스캔은 타임아웃의 주요 원인이라 제거합니다.
  // 필요한 경우 shared_game_ids 만으로도 충분히 맥락을 만들 수 있습니다.
  const batLines = bb.filter((r) => common.includes(String(r.game_id))).slice(-120);
  const pitLines = pp.filter((r) => common.includes(String(r.game_id))).slice(-120);
  return {
    shared_game_ids: common,
    batter_lines: batLines,
    pitcher_lines: pitLines,
  };
}

async function fetchPitcherRecent(db, name, maxGames = 12) {
  const { pitchers } = await fetchPlayerLines(db, name, 400);
  const byGame = {};
  for (const row of pitchers) {
    const gid = String(row.game_id);
    if (!byGame[gid]) byGame[gid] = [];
    byGame[gid].push(row);
  }
  const gids = Object.keys(byGame).sort().slice(-maxGames);
  const lines = [];
  for (const gid of gids) lines.push(...byGame[gid]);
  return lines;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Invalid JSON" }),
    };
  }

  const action = payload.action;
  if (!action) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Missing action" }),
    };
  }

  try {
    const db = initFirebase();
    let context = {};
    let userQ = "";

    switch (action) {
      case "today_mvp": {
        const dateStr =
          payload.date ||
          isoSeoulToday();
        const games = await fetchGamesByDate(db, dateStr);
        const gids = games
          .map((g) => g.game_id)
          .filter((x) => x != null && x !== "");
        const box = await fetchBoxForGames(db, gids);
        context = {
          date: dateStr,
          games,
          batters: box.batters,
          pitchers: box.pitchers,
        };
        userQ =
          payload.question ||
          `${dateStr} KBO 경기 데이터를 바탕으로 오늘의 MVP 타자 1명, MVP 투수 1명을 선정하고 근거를 한국어로 간결히 설명해줘.`;
        break;
      }
      case "mvp_auto": {
        const dateStr = payload.date || isoSeoulToday();
        const games = await fetchGamesByDate(db, dateStr);
        const gids = games
          .map((g) => g.game_id)
          .filter((x) => x != null && x !== "");
        const box = await fetchBoxForGames(db, gids);

        const batByGame = {};
        for (const b of box.batters || []) {
          const gid = String(b.game_id || "");
          if (!gid) continue;
          if (!batByGame[gid]) batByGame[gid] = [];
          batByGame[gid].push(b);
        }
        const pitByGame = {};
        for (const p of box.pitchers || []) {
          const gid = String(p.game_id || "");
          if (!gid) continue;
          if (!pitByGame[gid]) pitByGame[gid] = [];
          pitByGame[gid].push(p);
        }

        const perGame = [];
        const allBestBatters = [];
        const allBestPitchers = [];
        for (const g of games) {
          const gid = String(g.game_id || "");
          const bats = batByGame[gid] || [];
          const pits = pitByGame[gid] || [];
          const bestB = bestByScore(bats, scoreBatter);
          const bestP = bestByScore(pits, scorePitcher);
          if (bestB) allBestBatters.push(bestB);
          if (bestP) allBestPitchers.push(bestP);

          const away = pickStr(g, ["away_team", "away", "awayTeam"]);
          const home = pickStr(g, ["home_team", "home", "homeTeam"]);
          const as = safeNum(g.away_score);
          const hs = safeNum(g.home_score);
          const scoreLine =
            as != null && hs != null ? `${away} ${as} : ${hs} ${home}` : "";
          const matchup =
            away && home ? `${away} vs ${home}` : String(g.game_name || "");

          perGame.push({
            game_id: gid,
            game_date: String(g.game_date || dateStr),
            matchup,
            score: scoreLine,
            pitcher_mvp: bestP
              ? {
                  name: pickPlayerName(bestP),
                  team: pickTeamName(bestP),
                  key_stats: formatPitcherKeyStats(bestP),
                }
              : null,
            batter_mvp: bestB
              ? {
                  name: pickPlayerName(bestB),
                  team: pickTeamName(bestB),
                  key_stats: formatBatterKeyStats(bestB),
                }
              : null,
          });
        }

        const overallPitcher = bestByScore(allBestPitchers, scorePitcher);
        const overallBatter = bestByScore(allBestBatters, scoreBatter);

        const structured = {
          date: dateStr,
          overall_best: {
            pitcher: overallPitcher
              ? {
                  name: pickPlayerName(overallPitcher),
                  team: pickTeamName(overallPitcher),
                  key_stats: formatPitcherKeyStats(overallPitcher),
                }
              : null,
            batter: overallBatter
              ? {
                  name: pickPlayerName(overallBatter),
                  team: pickTeamName(overallBatter),
                  key_stats: formatBatterKeyStats(overallBatter),
                }
              : null,
          },
          games: perGame,
        };

        const sys =
          "You are a KBO analytics assistant. Use only the JSON context provided; if data is missing, say so clearly. Respond in Korean unless asked otherwise.";
        const userQ =
          payload.question ||
          `${dateStr} KBO 경기별 MVP(투수/타자)와 전체 베스트(투수/타자)를 위 컨텍스트만 사용해서 선정 근거를 한국어로 8~12줄로 요약해줘.`;
        const text = await claude(
          sys,
          `컨텍스트(JSON):\n${JSON.stringify(structured).slice(0, 120000)}\n\n요청:\n${userQ}`,
          800
        );

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            model: MODEL,
            date: dateStr,
            overall_best: structured.overall_best,
            games: structured.games,
            text,
          }),
        };
      }
      case "team_week": {
        const teamKw = payload.teamKeyword || "";
        const days = Number(payload.days) || 7;
        const tw = await fetchGamesForTeamWeek(db, teamKw, days);
        context = {
          teamKeyword: teamKw,
          days,
          window: tw.window,
          queryNote: tw.queryNote,
          games: tw.games,
        };
        userQ =
          payload.question ||
          `${teamKw} 팀의 최근 ${days}일 구간 경기만을 사용해 주간 성적 추이(승패·득실·타격/불펜 면에서의 인상)을 한국어로 분석해줘.`;
        break;
      }
      case "pv_batter": {
        const pitcher = payload.pitcher || "";
        const batter = payload.batter || "";
        const ov = await pitcherBatterOverlap(db, batter, pitcher);
        context = ov;
        userQ =
          payload.question ||
          `동일 경기에 같이 등장한 기록을 바탕으로 ${pitcher} 투수 vs ${batter} 타자의 맞대결·맥락을 한국어로 설명해줘. (완벽한 상대전 데이터가 없으면 한계를 밝혀줘)`;
        break;
      }
      case "pv_batter_stats": {
        const pitcher = String(payload.pitcher || "").trim();
        const batter = String(payload.batter || "").trim();
        if (!pitcher || !batter) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ error: "Missing pitcher or batter" }),
          };
        }
        const end = safeIsoDate(payload.end) || isoSeoulToday();
        const overallStart = safeIsoDate(payload.overallStart) || "2024-01-01";
        const yearStart = safeIsoDate(payload.yearStart) || "2026-01-01";

        const [overall, year] = await Promise.all([
          pvBatterStats(db, pitcher, batter, overallStart, end),
          pvBatterStats(db, pitcher, batter, yearStart, end),
        ]);

        const per_game = {
          overall: buildPvPerGameRows(
            overall.batter_lines,
            overall.pitcher_lines,
            pitcher,
            batter
          ),
          year: buildPvPerGameRows(
            year.batter_lines,
            year.pitcher_lines,
            pitcher,
            batter
          ),
        };

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            pitcher,
            batter,
            end,
            overallStart,
            yearStart,
            overall: overall.stat,
            year: year.stat,
            per_game,
            insufficient: {
              overall: overall.insufficient,
              year: year.insufficient,
            },
            counts: {
              overallSharedGames: overall.shared_game_ids.length,
              yearSharedGames: year.shared_game_ids.length,
              overallBatterLines: overall.batter_lines.length,
              yearBatterLines: year.batter_lines.length,
            },
          }),
        };
      }
      case "player_range": {
        const player = payload.player || "";
        const start = payload.start || "";
        const end = payload.end || "";
        const { batters, pitchers } = await fetchPlayerLines(db, player, 800);
        const inRange = (r) => {
          const gd = String(r.game_date || "");
          return gd >= start && gd <= end;
        };
        context = {
          player,
          start,
          end,
          batters: batters.filter(inRange),
          pitchers: pitchers.filter(inRange),
        };
        userQ =
          payload.question ||
          `기간 ${start}~${end} 동안 ${player} 선수의 성적을 한국어로 분석해줘.`;
        break;
      }
      case "sp_compare": {
        const a = payload.pitcherA || "";
        const b = payload.pitcherB || "";
        const la = await fetchPitcherRecent(db, a, 15);
        const lb = await fetchPitcherRecent(db, b, 15);
        context = { pitcherA: a, pitcherB: b, recentA: la, recentB: lb };
        userQ =
          payload.question ||
          `${a} vs ${b} 선발 투수를 최근 등판 기록 위주로 비교 분석해줘 (한국어).`;
        break;
      }
      case "sp_matchup": {
        const teamPitcher = payload.teamPitcher || "";
        const oppTeam = payload.opponentTeamKeyword || "";
        const all = await fetchAllGames(db);
        const recent = all
          .filter(
            (g) =>
              teamMatches(g.away_team, oppTeam) ||
              teamMatches(g.home_team, oppTeam)
          )
          .slice(-40);
        const la = await fetchPitcherRecent(db, teamPitcher, 10);
        context = {
          focusPitcher: teamPitcher,
          opponentKeyword: oppTeam,
          opponentRecentGames: recent,
          pitcherRecent: la,
        };
        userQ =
          payload.question ||
          `${teamPitcher} 선발이 상대 팀(${oppTeam}) 타선과 맞붙을 때 고려할 포인트를 데이터 기반으로 한국어로 정리해줘.`;
        break;
      }
      case "predict_form": {
        const ta = payload.teamA || "";
        const tb = payload.teamB || "";
        const all = await fetchAllGames(db);
        const sortByDate = (arr) =>
          [...arr].sort((a, b) =>
            String(a.game_date || "").localeCompare(String(b.game_date || ""))
          );
        const pick = (kw) =>
          sortByDate(
            all.filter(
              (g) =>
                teamMatches(g.away_team, kw) || teamMatches(g.home_team, kw)
            )
          );
        const ga = pick(ta).slice(-5);
        const gb = pick(tb).slice(-5);
        context = { teamA: ta, teamB: tb, last5A: ga, last5B: gb };
        userQ =
          payload.question ||
          `두 팀(${ta}, ${tb})의 최근 5경기 기록만 참고해 경기 양상 예측(승부 트렌드·주의점)을 한국어로 균형 있게 작성해줘.`;
        break;
      }
      case "shorts_highlight": {
        const dateStr =
          payload.date ||
          isoSeoulToday();
        const games = await fetchGamesByDate(db, dateStr);
        const gids = games
          .map((g) => g.game_id)
          .filter((x) => x != null && x !== "");
        const box = await fetchBoxForGames(db, gids);
        context = { date: dateStr, games, ...box };
        userQ =
          `너는 KBO 유튜브 쇼츠 작가야. ${dateStr} 데이터로 '오늘의 하이라이트 선수' 30초 쇼츠 대본을 작성해줘. 훅 1문장 + 핵심 스탯 2~3개 + 마무리 멘트. 한국어, 초보 팬도 이해하게.`;
        break;
      }
      case "shorts_pitcher_week": {
        const all = await fetchAllGames(db);
        const weekGames = gamesForTeamWindow(all, "", 7);
        const gameIds = weekGames
          .map((g) => g.game_id)
          .filter((x) => x != null && x !== "");
        const pitRows = [];
        const seen = new Set();
        for (const gid of gameIds.slice(0, 120)) {
          for (const v of variantsForGameId(gid)) {
            const p = await db
              .collection("pitchers")
              .where("game_id", "==", v)
              .get();
            p.forEach((d) => {
              if (!seen.has(d.id)) {
                seen.add(d.id);
                pitRows.push(docSnap(d));
              }
            });
          }
        }
        context = { pitcher_rows_sample: pitRows.slice(0, 400) };
        userQ =
          `이번 주(최근 7일 창) 투수 기록 샘플을 보고 '이번 주 최고 투수' 쇼츠용 35초 대본을 한국어로 써줘. 근거 스탯을 언급하고 흥미로운 타이틀을 붙여줘.`;
        break;
      }
      case "shorts_worst_matchup": {
        const all = await fetchAllGames(db);
        const hi = all.filter((g) => {
          const as = Number(g.away_score);
          const hs = Number(g.home_score);
          return (
            !Number.isNaN(as) &&
            !Number.isNaN(hs) &&
            as + hs >= 18
          );
        }).slice(-15);
        context = { high_scoring_games: hi };
        userQ =
          `아래 고득점 경기들을 참고해 '역대급(또는 극단적인) 매칭업/한판' 쇼츠용 자극적이지만 사실 기반인 훅 멘트와 짧은 스토리를 한국어로 만들어줘. 과장은 쇼츠 톤으로 허용하되 출처가 빈약하면 그 한계도 말해줘.`;
        break;
      }
      default:
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ error: `Unknown action: ${action}` }),
        };
    }

    const sys =
      "You are a KBO analytics assistant. Use only the JSON context provided; if data is missing, say so clearly. Respond in Korean unless asked otherwise.";
    const ctxCap =
      action === "team_week" ? 80000 : action === "pv_batter" ? 70000 : 190000;
    const claudeOut =
      action === "team_week" ? 1200 : action === "pv_batter" ? 500 : 2048;
    const text = await claude(
      sys,
      `컨텍스트(JSON):\n${JSON.stringify(context).slice(0, ctxCap)}\n\n요청:\n${userQ}`,
      claudeOut
    );

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        action,
        model: MODEL,
        text,
        contextSummary: summarizeContext(action, context),
      }),
    };
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: false,
        error: String(e?.message || e),
      }),
    };
  }
};

function summarizeContext(action, ctx) {
  switch (action) {
    case "today_mvp":
      return {
        games: ctx.games?.length ?? 0,
        batters: ctx.batters?.length ?? 0,
        pitchers: ctx.pitchers?.length ?? 0,
      };
    case "mvp_auto":
      return {
        date: ctx.date,
        games: ctx.games?.length ?? 0,
      };
    case "team_week":
      return {
        games: ctx.games?.length ?? 0,
        window: ctx.window,
        queryNote: ctx.queryNote,
      };
    case "pv_batter":
      return { sharedGames: ctx.shared_game_ids?.length ?? 0 };
    case "player_range":
      return {
        batters: ctx.batters?.length ?? 0,
        pitchers: ctx.pitchers?.length ?? 0,
      };
    case "sp_compare":
      return { a: ctx.recentA?.length ?? 0, b: ctx.recentB?.length ?? 0 };
    case "predict_form":
      return { last5A: ctx.last5A?.length ?? 0, last5B: ctx.last5B?.length ?? 0 };
    default:
      return {};
  }
}
