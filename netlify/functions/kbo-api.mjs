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
  const gamesMeta = [];
  const allGames = await fetchAllGames(db);
  const byGid = Object.fromEntries(allGames.map((g) => [String(g.game_id), g]));
  for (const gid of common.slice(-30)) {
    gamesMeta.push(byGid[gid] || { game_id: gid });
  }
  const batLines = bb.filter((r) => common.includes(String(r.game_id)));
  const pitLines = pp.filter((r) => common.includes(String(r.game_id)));
  return {
    shared_game_ids: common,
    games: gamesMeta,
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
          new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
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
          new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
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
    const ctxCap = action === "team_week" ? 80000 : 190000;
    const claudeOut = action === "team_week" ? 1200 : 2048;
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
