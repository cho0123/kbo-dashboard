import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

/** KBO game_id 내 2글자 팀코드 → 정식 구단명 (문서에 team 필드가 없을 때 사용) */
const TEAM_MAP = {
  KT: "KT 위즈",
  SK: "SSG 랜더스",
  LG: "LG 트윈스",
  OB: "두산 베어스",
  SS: "삼성 라이온즈",
  HT: "KIA 타이거즈",
  LT: "롯데 자이언츠",
  NC: "NC 다이노스",
  WO: "키움 히어로즈",
  HH: "한화 이글스",
};

// schedule(약칭) ↔ games(풀네임) 매칭용 팀명 정규화
const TEAM_ALIAS_TO_FULL = (() => {
  const pairs = [
    ["LG", "LG 트윈스"],
    ["NC", "NC 다이노스"],
    ["KIA", "KIA 타이거즈"],
    ["KT", "KT 위즈"],
    ["SSG", "SSG 랜더스"],
    ["두산", "두산 베어스"],
    ["롯데", "롯데 자이언츠"],
    ["삼성", "삼성 라이온즈"],
    ["한화", "한화 이글스"],
    ["키움", "키움 히어로즈"],
  ];

  const map = {};
  for (const [abbr, full] of pairs) {
    map[abbr] = full;
    map[full] = full;
  }
  // 기존 game_id 코드(2글자)도 동일 canonical(full)로 정규화
  for (const [code, full] of Object.entries(TEAM_MAP)) {
    map[code] = full;
    map[full] = full;
  }
  return map;
})();

// Firestore 문서 샘플 로그는 함수 인스턴스당 1회만 출력
let __didLogBoxSamples = false;

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

/**
 * game_id 예: "20260410NCSM0" → YYYYMMDD(8) + 홈코드(2) + 원정코드(2) + …
 * Firestore의 side는 경기 장소가 아니라 타자/투수 레코드 기준 구분 등으로 들어오는 경우가 있어,
 * 검증 단계에서는 home↔코드 매핑을 반대로 시험 중이다.
 * (기대: side home → 원정팀 코드, side away → 홈팀 코드)
 */
function teamCodeFromGameIdAndSide(gameId, sideRaw) {
  const s = String(gameId ?? "").trim();
  const side = String(sideRaw ?? "").trim().toLowerCase();
  if (s.length < 12) return "";
  const homeCode = s.slice(8, 10);
  const awayCode = s.slice(10, 12);
  if (side === "home") return awayCode;
  if (side === "away") return homeCode;
  return "";
}

function pickTeamName(row) {
  const t =
    pickStr(row, [
      // 명시적으로 들어오는 팀 필드들(프로젝트별로 다양)
      "pitcher_team",
      "batter_team",
      "team",
      "team_name",
      "teamName",
      "team_nm",
      "team_full",
      "teamFull",
      "club",
      "club_name",
      "clubName",
      "club_full",
      "clubFull",
      "TEAM",
      "team_kr",
      "teamKR",
      "team_kor",
      "teamKor",
    ]) ||
    // nested 형태 대응 (예: { team: { name: "LG" } })
    pickStr(row?.team, ["name", "team_name", "teamName", "team_full", "teamFull"]) ||
    pickStr(row?.club, ["name", "club_name", "clubName", "club_full", "clubFull"]) ||
    "";
  // UI에서 "(—)" 같은 표시가 나오지 않도록 서버 응답에서는 대시 플레이스홀더를 제거한다.
  const cleaned = String(t || "").trim();
  if (cleaned && cleaned !== "—") return cleaned.slice(0, 36);

  const code = teamCodeFromGameIdAndSide(row?.game_id, row?.side);
  const mapped = code ? TEAM_MAP[code] || code : "";
  const derivedTeam = mapped ? String(mapped).trim().slice(0, 36) : "";
  return derivedTeam;
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

function formatInnings(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return "";
    // 이미 야구식 표기라면 그대로 사용 (예: "5.2", "6.1")
    if (/^\d+(\.\d)?$/.test(s)) {
      const parts = s.split(".");
      if (parts.length === 2 && (parts[1] === "1" || parts[1] === "2")) return s;
    }
    // "5 2/3" 같은 형태
    const m = s.match(/^(\d+)\s+(\d)\/3$/);
    if (m) {
      const full = Number(m[1]);
      const frac = Number(m[2]);
      if (frac === 1) return `${full}.1`;
      if (frac === 2) return `${full}.2`;
      return `${full}`;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return s;
    raw = n;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  const full = Math.floor(n);
  const frac = n - full;
  // 1/3, 2/3 근처 값 허용
  if (frac < 0.12) return `${full}`;
  if (frac < 0.5) return `${full}.1`;
  return `${full}.2`;
}

function formatPitcherKeyStats(row) {
  const ipRaw = row?.ip ?? row?.IP ?? row?.inn ?? row?.innings;
  const ipVal =
    ipRaw != null && String(ipRaw).trim() !== ""
      ? ipRaw
      : pickNum(row, ["ip", "IP", "inn", "innings"]) || 0;
  const ip = formatInnings(ipVal) || "0";
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
  const rows = [];
  // Primary: canonical field name (string "YYYY-MM-DD")
  try {
    const snap = await db
      .collection("games")
      .where("game_date", "==", dateStr)
      .get();
    snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  } catch (e) {
    console.warn("[fetchGamesByDate] query(game_date==) failed:", e?.message || e);
  }
  if (rows.length) return rows;

  // Fallback: alternate field name used in some datasets
  try {
    const snap2 = await db
      .collection("games")
      .where("gameDate", "==", dateStr)
      .get();
    snap2.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  } catch (e) {
    console.warn("[fetchGamesByDate] query(gameDate==) failed:", e?.message || e);
  }
  if (rows.length) return rows;

  // Last resort: bounded scan + filter (handles Timestamp/dirty strings)
  try {
    const snap3 = await db.collection("games").limit(2500).get();
    snap3.forEach((d) => {
      const doc = { id: d.id, ...docSnap(d) };
      const gd = safeIsoDate(doc.game_date || doc.gameDate || "");
      if (gd === dateStr) rows.push(doc);
    });
  } catch (e) {
    console.warn("[fetchGamesByDate] fallback scan failed:", e?.message || e);
  }
  return rows;
}

function normalizeTeamKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  // exact match 우선
  const direct = TEAM_ALIAS_TO_FULL[s];
  if (direct) return direct;

  // substring match (e.g. "LG 트윈스" / "LG" / "두산 베어스" / "두산")
  for (const [alias, full] of Object.entries(TEAM_ALIAS_TO_FULL)) {
    if (!alias) continue;
    if (s.includes(alias)) return full;
  }

  // fallback: 기존 매핑(구장 키 등)도 시도
  const keys = [...new Set([...Object.keys(TEAM_STADIUM), ...Object.keys(TEAM_MAP)])];
  for (const k of keys) {
    if (!k) continue;
    if (s.includes(k)) return TEAM_ALIAS_TO_FULL[k] || TEAM_MAP?.[k] || k;
    const full = TEAM_MAP?.[k];
    if (full && s.includes(String(full))) return TEAM_ALIAS_TO_FULL[full] || String(full);
  }
  return s;
}

async function fetchScheduleFromDate(db, startDateIso) {
  const out = [];
  try {
    const snap = await db
      .collection("schedule")
      .where("game_date", ">=", String(startDateIso || ""))
      .orderBy("game_date", "asc")
      .limit(1200)
      .get();
    snap.forEach((d) => out.push({ id: d.id, ...docSnap(d) }));
    return out;
  } catch (e) {
    console.warn("[fetchScheduleFromDate] query failed:", e?.message || e);
  }
  // fallback scan
  try {
    const snap2 = await db.collection("schedule").limit(3000).get();
    snap2.forEach((d) => {
      const doc = { id: d.id, ...docSnap(d) };
      const gd = safeIsoDate(doc.game_date || "");
      if (!gd) return;
      if (String(gd) >= String(startDateIso || "")) out.push(doc);
    });
  } catch (e) {
    console.warn("[fetchScheduleFromDate] fallback scan failed:", e?.message || e);
  }
  out.sort((a, b) => String(a?.game_date || "").localeCompare(String(b?.game_date || "")));
  return out;
}

function pickNextGameForTeams(scheduleRows, teamA, teamB, afterDateIso) {
  const a = normalizeTeamKey(teamA);
  const after = String(afterDateIso || "").slice(0, 10);
  const scored = [];
  for (const r of scheduleRows || []) {
    const gd = String(r?.game_date || "").slice(0, 10);
    if (!gd) continue;
    if (after && gd <= after) continue;
    const hk = normalizeTeamKey(r?.home_team || "");
    const ak = normalizeTeamKey(r?.away_team || "");
    const match =
      hk === a || ak === a;
    if (!match) continue;
    const tm = String(r?.game_time || "").trim();
    const stamp = `${gd}T${tm || "00:00"}`;
    scored.push({ r, stamp });
  }
  scored.sort((x, y) => String(x.stamp).localeCompare(String(y.stamp)));
  const pick = scored[0]?.r || null;
  if (!pick) return null;
  const hs = pick?.home_starter ?? null;
  const as = pick?.away_starter ?? null;
  return {
    game_date: String(pick?.game_date || "").slice(0, 10) || null,
    game_time: String(pick?.game_time || "").trim() || null,
    home_team: pick?.home_team ?? null,
    away_team: pick?.away_team ?? null,
    venue: pick?.venue ?? null,
    home_starter: hs == null || String(hs).trim() === "" ? "미정" : hs,
    away_starter: as == null || String(as).trim() === "" ? "미정" : as,
  };
}

async function fetchLastUpdated(db) {
  const snap = await db.collection("meta").doc("lastUpdated").get();
  if (!snap.exists) return null;
  return docSnap(snap);
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
      // 일부 데이터셋은 필드명이 gameId 로 저장되어 있을 수 있어 폴백 쿼리를 추가한다.
      const q1 = db.collection(collName).where("game_id", "==", v).get();
      const q2 = db.collection(collName).where("gameId", "==", v).get();
      const [snap1, snap2] = await Promise.all([q1, q2]);
      for (const snap of [snap1, snap2]) {
        snap.forEach((d) => {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            const row = { id: d.id, ...docSnap(d) };
            rows.push(row);
            if (collName === "batters") {
              const doc = row;
              console.log("BATTER_RBI_CHECK:", {
                player: doc.player,
                game_id: doc.game_id ?? doc.gameId,
                hr: doc.hr,
                rbi: doc.rbi,
                h: doc.h,
                ab: doc.ab,
              });
            }
          }
        });
      }
    }
  }

  for (const gid of gameIds) {
    await mergeCollection("batters", batters, seenB, gid);
    await mergeCollection("pitchers", pitchers, seenP, gid);
  }

  // Firestore 실제 필드명 확인용 샘플 로그 (배포 후 Netlify Functions logs에서 확인)
  if (!__didLogBoxSamples) {
    __didLogBoxSamples = true;
    // 투수 문서 첫 번째 샘플
    console.log("PITCHER_KEYS:", Object.keys(pitchers[0] || {}));
    console.log("PITCHER_SAMPLE:", JSON.stringify(pitchers[0]));
    // 타자 문서 첫 번째 샘플
    console.log("BATTER_KEYS:", Object.keys(batters[0] || {}));
    console.log("BATTER_SAMPLE:", JSON.stringify(batters[0]));
  }

  return { batters, pitchers };
}

async function fetchAllGames(db, max = 2500) {
  const snap = await db.collection("games").limit(max).get();
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  return rows;
}

// get_players 에서 팀 필터링용 (팀명 → game_id 2글자 코드)
const TEAM_CODE_MAP = {
  "KIA 타이거즈": ["HT"],
  "LG 트윈스": ["LG"],
  "SSG 랜더스": ["SK"],
  "삼성 라이온즈": ["SS"],
  "KT 위즈": ["KT"],
  "NC 다이노스": ["NC"],
  "한화 이글스": ["HH"],
  "두산 베어스": ["OB"],
  "키움 히어로즈": ["WO"],
  "롯데 자이언츠": ["LT"],
};

// get_players 에서는 side 매핑이 데이터셋마다 다를 수 있어
// 프로젝트 전반에서 이미 사용 중인 teamCodeFromGameIdAndSide 로직을 재사용한다.
function teamCodeForPlayers(row) {
  return teamCodeFromGameIdAndSide(row?.game_id, row?.side);
}

function isPitcherPosition(posRaw) {
  if (posRaw == null) return false;
  const s = String(posRaw).trim().toLowerCase();
  if (!s) return false;
  return s === "p" || s.includes("투수") || s.includes("pitcher");
}

async function getPlayers(db, { team, year, type }) {
  const y = Number(year);
  const teamFull = String(team || "").trim();
  const coll = type === "pitcher" ? "pitchers" : "batters";
  const nameKeyCandidates = ["player", "name", "player_name", "playerName", "선수명"];

  const allowedCodes = TEAM_CODE_MAP[teamFull] || [];
  if (!allowedCodes.length) return [];

  // 팀 필드가 없으므로 year로 먼저 가져온 후 game_id+side로 팀 판별
  const snap = await db.collection(coll).where("year", "==", y).limit(4000).get();

  // batters 컬렉션에 투수(포지션 P)가 섞이는 케이스 대응:
  // - position 필드가 있으면 P/투수 제외
  // - position이 없으면 같은 팀(코드 기준)의 pitchers 컬렉션에 있는 선수명을 투수로 간주해 제외
  let pitcherNameSet = null;
  if (type !== "pitcher") {
    const pSnap = await db.collection("pitchers").where("year", "==", y).limit(4000).get();
    const ps = new Set();
    pSnap.forEach((d) => {
      const row = docSnap(d);
      const code = teamCodeForPlayers(row);
      if (!code || !allowedCodes.includes(code)) return;
      const n = pickStr(row, nameKeyCandidates);
      if (n) ps.add(n);
    });
    pitcherNameSet = ps;
  }

  const set = new Set();
  snap.forEach((d) => {
    const row = docSnap(d);
    const code = teamCodeForPlayers(row);
    if (!code || !allowedCodes.includes(code)) return;
    const n = pickStr(row, nameKeyCandidates);
    if (!n) return;
    if (type !== "pitcher") {
      const pos = pickAny(row, ["position", "pos", "POSITION", "포지션"]);
      if (isPitcherPosition(pos)) return;
      if (pos == null && pitcherNameSet && pitcherNameSet.has(n)) return;
    }
    set.add(n);
  });

  const players = [...set].sort((a, b) => String(a).localeCompare(String(b), "ko"));
  return players;
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

function pickAny(obj, keys) {
  for (const k of keys) {
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return null;
}

let __avgCheckLogged = 0;
function normalizeBatterRowForUi(row) {
  if (!row || typeof row !== "object") return row;
  const rawAvg = pickAny(row, [
    "avg",
    "AVG",
    "batting_avg",
    "battingAvg",
    "bat_avg",
    "batAvg",
    "타율",
  ]);

  const ab = pickNum(row, ["ab", "AB", "at_bats", "atBats", "타수"]);
  const h = pickNum(row, ["h", "H", "hits", "hit", "안타"]);

  const avgNum = rawAvg == null ? null : Number(rawAvg);
  const computedAvg = ab > 0 ? h / ab : 0;
  const displayAvg =
    avgNum != null && Number.isFinite(avgNum) && avgNum > 0 ? avgNum : computedAvg;

  if (__avgCheckLogged < 30) {
    __avgCheckLogged += 1;
    console.log("AVG_CHECK:", {
      player: row?.player ?? row?.name ?? null,
      avg: row?.avg ?? null,
      rawAvg,
      ab,
      h,
      displayAvg,
    });
  }

  return { ...row, avg: displayAvg };
}

let __pitcherEraCheckLogged = 0;
let __batterRbiCheckLogged2 = 0;

function mergeBattersByPlayer(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const merged = {};
  const out = [];

  const num0 = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  for (const b0 of list) {
    const b = b0 && typeof b0 === "object" ? b0 : {};
    const player = String(b.player || b.name || "").trim();
    const side = normalizeSide(b.side);
    // 같은 이름이 양 팀에 동시에 있을 수 있으니 side까지 키에 포함
    const key = player ? `${side}|${player}` : null;
    if (!key) {
      out.push(b);
      continue;
    }

    if (!merged[key]) {
      merged[key] = { ...b, side };
      out.push(merged[key]);
      continue;
    }

    const acc = merged[key];
    acc.ab = num0(acc.ab) + num0(b.ab ?? b.AB);
    acc.h = num0(acc.h) + num0(b.h ?? b.H);
    acc.rbi = num0(acc.rbi) + num0(b.rbi ?? b.RBI ?? b.bi);
    acc.runs = num0(acc.runs) + num0(b.runs ?? b.R ?? b.r);
    acc.hr = num0(acc.hr) + num0(b.hr ?? b.HR);

    // avg는 시즌 누적이므로 "마지막 값" 유지
    if (b.avg != null) acc.avg = b.avg;
    if (b.AVG != null) acc.AVG = b.AVG;
    if (b.batting_avg != null) acc.batting_avg = b.batting_avg;
    if (b.battingAvg != null) acc.battingAvg = b.battingAvg;
    if (b.타율 != null) acc.타율 = b.타율;

    // 타순 등은 첫 유효값 유지 (중복 라인은 대타일 수 있음)
    if (acc.batting_order == null && b.batting_order != null)
      acc.batting_order = b.batting_order;
    if (acc.battingOrder == null && b.battingOrder != null)
      acc.battingOrder = b.battingOrder;
    if (acc.order == null && b.order != null) acc.order = b.order;
    if (acc.타순 == null && b.타순 != null) acc.타순 = b.타순;
  }

  return out;
}

function normalizeSide(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (s === "home" || s === "h" || s.includes("홈")) return "home";
  if (s === "away" || s === "a" || s.includes("원정") || s.includes("visit"))
    return "away";
  return s;
}

function pickBattingOrder(row) {
  const v = pickAny(row, [
    "order",
    "batting_order",
    "battingOrder",
    "lineup_order",
    "lineupOrder",
    "타순",
  ]);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 20 ? n : null;
}

function splitAndSortBattersBySide(batters) {
  const out = { away: [], home: [] };
  const rows = Array.isArray(batters) ? batters : [];
  const withUi = rows.map((r) => {
    const ui = normalizeBatterRowForUi(r);
    const side = normalizeSide(ui?.side);
    const batting_order = pickBattingOrder(ui);
    return { ...ui, side, batting_order };
  });

  const bySide = {
    away: withUi.filter((r) => r.side === "away"),
    home: withUi.filter((r) => r.side === "home"),
  };

  for (const side of ["away", "home"]) {
    const list = bySide[side] || [];
    const hasAnyOrder = list.some((r) => r.batting_order != null);
    if (hasAnyOrder) {
      // Prefer batting_order sort; de-duplicate by (order, player)
      const seen = new Set();
      const uniq = [];
      for (const r of list) {
        const key = `${r.batting_order ?? "x"}_${String(r.player || r.name || "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(r);
      }
      uniq.sort((a, b) => {
        const ao = a.batting_order ?? 999;
        const bo = b.batting_order ?? 999;
        if (ao !== bo) return ao - bo;
        return String(a.player || a.name || "").localeCompare(
          String(b.player || b.name || ""),
          "ko"
        );
      });
      out[side] = uniq;
    } else {
      // Fallback: no batting order → group unique by player name
      const seen = new Set();
      const uniq = [];
      for (const r of list) {
        const name = String(r.player || r.name || "").trim();
        if (!name) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        uniq.push(r);
      }
      uniq.sort((a, b) =>
        String(a.player || a.name || "").localeCompare(String(b.player || b.name || ""), "ko")
      );
      out[side] = uniq;
    }
  }
  return out;
}

function splitPitchersBySide(pitchers) {
  const rows = Array.isArray(pitchers) ? pitchers : [];
  const withSide = rows.map((r) => ({ ...r, side: normalizeSide(r?.side) }));
  const away = withSide.filter((r) => r.side === "away");
  const home = withSide.filter((r) => r.side === "home");
  const sortByIpDesc = (a, b) => Number(b?.ip ?? b?.IP ?? 0) - Number(a?.ip ?? a?.IP ?? 0);
  away.sort(sortByIpDesc);
  home.sort(sortByIpDesc);
  return { away, home };
}

function normalizeGameId(x) {
  if (x == null) return "";
  const s = String(x).trim();
  return s;
}

function safeIsoDate(x) {
  const s = String(x || "").slice(0, 15);
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

async function queryPlayerByYear(db, collection, player, year, max = 2200) {
  const p = String(player || "").trim();
  const y = Number(year);
  if (!p || !Number.isFinite(y)) return [];
  try {
    // Requires composite index: (player, year)
    const snap = await db
      .collection(collection)
      .where("player", "==", p)
      .where("year", "==", y)
      .limit(max)
      .get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
    return rows;
  } catch (err) {
    console.warn(`[pv_batter_stats] year query failed (${collection}):`, err?.message || err);
    // Fallback: player-only scan then filter by year
    const snap = await db
      .collection(collection)
      .where("player", "==", p)
      .limit(max)
      .get();
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
    return rows.filter((r) => Number(r?.year) === y);
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

function mergePvStats(a, b) {
  const ax = a && typeof a === "object" ? a : {};
  const bx = b && typeof b === "object" ? b : {};
  const ab = (ax.ab ?? 0) + (bx.ab ?? 0);
  const h = (ax.h ?? 0) + (bx.h ?? 0);
  const hr = (ax.hr ?? 0) + (bx.hr ?? 0);
  const bb = (ax.bb ?? 0) + (bx.bb ?? 0);
  const so = (ax.so ?? 0) + (bx.so ?? 0);
  const games = (ax.games ?? 0) + (bx.games ?? 0);
  const pa = (ax.pa ?? 0) + (bx.pa ?? 0);
  const avg = ab > 0 ? (h / ab).toFixed(3) : "—";
  return { games, pa, ab, h, hr, bb, so, avg };
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

function yearOfRow(r) {
  const y = Number(r?.year);
  if (Number.isFinite(y) && y >= 1900 && y <= 2100) return y;
  const gd = String(r?.game_date || "").slice(0, 4);
  if (/^\d{4}$/.test(gd)) return Number(gd);
  const gid = String(r?.game_id || "").slice(0, 4);
  if (/^\d{4}$/.test(gid)) return Number(gid);
  return 0;
}

function filterPvContextByTab(ctx, tab) {
  const mode = String(tab || "").trim().toLowerCase();
  const keep = (y) => {
    if (mode === "this") return y >= 2026;
    if (mode === "prev") return y === 2025;
    if (mode === "both") return y >= 2025;
    return y >= 2025;
  };
  const bats = (ctx?.batter_lines || []).filter((r) => keep(yearOfRow(r)));
  const pits = (ctx?.pitcher_lines || []).filter((r) => keep(yearOfRow(r)));
  const bg = new Set(bats.map((r) => normalizeGameId(r.game_id)).filter(Boolean));
  const pg = new Set(pits.map((r) => normalizeGameId(r.game_id)).filter(Boolean));
  const common = [...bg].filter((g) => pg.has(g));
  return {
    ...ctx,
    shared_game_ids: common,
    batter_lines: bats.filter((r) => pg.has(normalizeGameId(r.game_id))),
    pitcher_lines: pits.filter((r) => bg.has(normalizeGameId(r.game_id))),
  };
}

function deriveOpponentFromGameId(gameId, teamCode) {
  const s = String(gameId || "").trim();
  if (s.length < 12) return { opponent: "—", home_away: "—" };
  const homeCode = s.slice(8, 10);
  const awayCode = s.slice(10, 12);
  const oppCode = teamCode === homeCode ? awayCode : homeCode;
  const opponent = TEAM_MAP[oppCode] || oppCode || "—";
  const home_away = teamCode === homeCode ? "홈" : "원정";
  return { opponent, home_away };
}

function buildUiData(action, ctx) {
  if (action === "player_range") {
    const player = String(ctx?.player || "");
    const start = String(ctx?.start || "");
    const end = String(ctx?.end || "");
    const pitcherRows = (ctx?.pitchers || []).map((p) => {
      const teamCode = teamCodeFromGameIdAndSide(p?.game_id, p?.side);
      const { opponent, home_away } = deriveOpponentFromGameId(p?.game_id, teamCode);
      return {
        date: String(p?.game_date || ""),
        opponent,
        home_away,
        ip: p?.ip ?? p?.IP ?? 0,
        r: p?.r ?? p?.R ?? 0,
        h: p?.h ?? p?.H ?? 0,
        so: p?.so ?? p?.SO ?? p?.k ?? p?.K ?? 0,
        era: p?.era ?? p?.ERA ?? null,
      };
    });
    const batterRows = (ctx?.batters || []).map((b) => {
      const teamCode = teamCodeFromGameIdAndSide(b?.game_id, b?.side);
      const { opponent, home_away } = deriveOpponentFromGameId(b?.game_id, teamCode);
      const ab = pickNum(b, ["ab", "AB", "at_bats"]);
      const h = pickNum(b, ["h", "H", "hits"]);
      const rbi = pickNum(b, ["rbi", "RBI", "bi", "타점"]);
      const hr = pickNum(b, ["hr", "HR", "home_run"]);
      const runs = pickNum(b, ["runs", "run", "r", "R", "득점"]);
      const avgRaw = pickAny(b, ["avg", "AVG", "batting_avg", "battingAvg", "타율"]);
      const avgNum = avgRaw == null ? null : Number(avgRaw);
      const avg = Number.isFinite(avgNum) ? avgNum : ab > 0 ? h / ab : 0;
      return {
        date: String(b?.game_date || ""),
        opponent,
        home_away,
        ab,
        h,
        rbi,
        hr,
        runs,
        avg,
      };
    });
    return { player, start, end, pitcherRows, batterRows };
  }
  if (action === "sp_compare") {
    const a = String(ctx?.pitcherA || "");
    const b = String(ctx?.pitcherB || "");
    const mapP = (p) => {
      const teamCode = teamCodeFromGameIdAndSide(p?.game_id, p?.side);
      const { opponent, home_away } = deriveOpponentFromGameId(p?.game_id, teamCode);
      return {
        date: String(p?.game_date || ""),
        opponent,
        home_away,
        ip: p?.ip ?? p?.IP ?? 0,
        r: p?.r ?? p?.R ?? 0,
        h: p?.h ?? p?.H ?? 0,
        so: p?.so ?? p?.SO ?? p?.k ?? p?.K ?? 0,
        era: p?.era ?? p?.ERA ?? null,
      };
    };
    const recentA = (ctx?.recentA || []).map(mapP);
    const recentB = (ctx?.recentB || []).map(mapP);
    return { pitcherA: a, pitcherB: b, recentA, recentB };
  }
  return null;
}

async function pvBatterStatsByYear(db, pitcher, batter, year, endDate = "") {
  const y = Number(year);
  const end = safeIsoDate(endDate);
  const [bats, pits] = await Promise.all([
    queryPlayerByYear(db, "batters", batter, y, 2200),
    queryPlayerByYear(db, "pitchers", pitcher, y, 1800),
  ]);
  const batsF =
    end && y === 2026 ? bats.filter((r) => safeIsoDate(r.game_date) <= end) : bats;
  const pitsF =
    end && y === 2026 ? pits.filter((r) => safeIsoDate(r.game_date) <= end) : pits;

  const bg = new Set(batsF.map((r) => normalizeGameId(r.game_id)).filter(Boolean));
  const pg = new Set(pitsF.map((r) => normalizeGameId(r.game_id)).filter(Boolean));
  const common = [...bg].filter((g) => pg.has(g));
  const batLines = batsF.filter((r) => pg.has(normalizeGameId(r.game_id)));
  const pitLines = pitsF.filter((r) => bg.has(normalizeGameId(r.game_id)));
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
  const ipStr = formatInnings(ipRaw);
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
    const ipnStr = formatInnings(ipn);
    if (ipnStr) parts.push(`${ipnStr}이닝`);
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
  const iso = (dt) => dt.toISOString().slice(0, 15);
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
  const parts = String(endIso).slice(0, 15).split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => Number.isNaN(x))) {
    const e = String(endIso).slice(0, 15);
    return { from: e, to: e };
  }
  const end = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const iso = (dt) => dt.toISOString().slice(0, 15);
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

async function fetchHeadToHeadRecord(db, teamA, teamB, season) {
  const y = Number(season) || 2026;
  const from = `${y}-01-01`;
  const to = `${y}-12-31`;
  console.log("[h2h] teams:", teamA, "vs", teamB, "season:", y);

  const keyOf = (nameRaw) => {
    const s = String(nameRaw || "").trim();
    if (!s) return "";
    const keys = Object.keys(TEAM_STADIUM);
    const hit = keys.find((k) => s.includes(k));
    if (hit) return hit;
    // fallback: TEAM_MAP values (e.g. "KT 위즈") → keys ("KT")
    const hit2 = keys.find((k) => (TEAM_MAP?.[k] || "") && s.includes(TEAM_MAP[k]));
    return hit2 || s;
  };

  const aKey = keyOf(teamA);
  const bKey = keyOf(teamB);
  if (!aKey || !bKey) return { win: 0, draw: 0, lose: 0 };

  const rows = await fetchGamesDateRange(db, from, to);
  console.log("[h2h] games fetched:", Array.isArray(rows) ? rows.length : 0);
  const out = { win: 0, draw: 0, lose: 0 };
  let matched = 0;

  for (const g of rows || []) {
    const gd = String(g?.game_date || g?.gameDate || "");
    if (!gd.startsWith(`${y}-`)) continue;

    const hKey = keyOf(g?.home_team);
    const awKey = keyOf(g?.away_team);
    const isMatch =
      (hKey === aKey && awKey === bKey) || (hKey === bKey && awKey === aKey);
    if (!isMatch) continue;
    matched += 1;

    const hsRaw = g?.home_score;
    const asRaw = g?.away_score;
    if (hsRaw == null || asRaw == null) continue;
    if (typeof hsRaw === "string" && hsRaw.trim() === "") continue;
    if (typeof asRaw === "string" && asRaw.trim() === "") continue;

    const hs = Number(hsRaw);
    const as = Number(asRaw);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

    if (hs === as) {
      out.draw += 1;
      continue;
    }

    const teamAIsHome = hKey === aKey;
    const teamAScore = teamAIsHome ? hs : as;
    const teamBScore = teamAIsHome ? as : hs;
    if (teamAScore > teamBScore) out.win += 1;
    else out.lose += 1;
  }

  console.log("[h2h] matched games:", matched);
  console.log("[h2h] result:", out);
  return out;
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
  const endIso = String(last.game_date).slice(0, 15);
  const { from } = inclusiveDateWindowFromEnd(endIso, days);
  const kw = (teamKw || "").trim();
  return sortedAsc.filter((g) => {
    const gd = String(g.game_date || "").slice(0, 15);
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
    const endIso = String(latest.game_date).slice(0, 15);
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
        ? String(subset[0].game_date || "").slice(0, 15)
        : null;
    const last =
      subset.length > 0
        ? String(subset[subset.length - 1].game_date || "").slice(0, 15)
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

function slimGameResultRow(g) {
  if (!g || typeof g !== "object") return {};
  const home = pickStr(g, ["home_team", "home", "homeTeam"]);
  const away = pickStr(g, ["away_team", "away", "awayTeam"]);
  const gid = pickStr(g, ["game_id", "gameId", "gameID"]) || (g.game_id ?? g.gameId ?? g.id ?? null);
  const winningPitcher = pickStr(g, [
    "winning_pitcher",
    "win_pitcher",
    "w_pitcher",
    "winner_pitcher",
    "winningPitcher",
    "winPitcher",
    "winnerPitcher",
    "승리투수",
  ]);
  const losingPitcher = pickStr(g, [
    "losing_pitcher",
    "lose_pitcher",
    "l_pitcher",
    "loser_pitcher",
    "losingPitcher",
    "losePitcher",
    "loserPitcher",
    "패전투수",
  ]);
  return {
    game_id: gid,
    game_date: g.game_date ?? null,
    home_team: home || null,
    away_team: away || null,
    home_score: safeNum(g.home_score),
    away_score: safeNum(g.away_score),
    winning_pitcher: winningPitcher || "",
    losing_pitcher: losingPitcher || "",
  };
}

function pickPitcherName(row) {
  return (
    pickAny(row, ["player", "name", "player_name", "playerName", "선수명"]) ??
    null
  );
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

function pickTopInningsPitcher(pitchers) {
  const rows = Array.isArray(pitchers) ? pitchers : [];
  let best = null;
  let bestIp = -1;
  for (const p of rows) {
    const ip = inningsToNumber(p?.ip ?? p?.IP ?? p?.inn ?? p?.innings);
    if (ip > bestIp) {
      bestIp = ip;
      best = p;
    }
  }
  return best;
}

async function fetchPitchersForGame(db, gameId) {
  const out = [];
  const seen = new Set();
  for (const v of variantsForGameId(gameId)) {
    const q1 = db.collection("pitchers").where("game_id", "==", v).get();
    const q2 = db.collection("pitchers").where("gameId", "==", v).get();
    const [s1, s2] = await Promise.all([q1, q2]);
    for (const snap of [s1, s2]) {
      snap.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        out.push({ id: d.id, ...docSnap(d) });
      });
    }
  }
  return out;
}

async function fetchBattersForGame(db, gameId) {
  const out = [];
  const seen = new Set();
  for (const v of variantsForGameId(gameId)) {
    const q1 = db.collection("batters").where("game_id", "==", v).get();
    const q2 = db.collection("batters").where("gameId", "==", v).get();
    const [s1, s2] = await Promise.all([q1, q2]);
    for (const snap of [s1, s2]) {
      snap.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        out.push({ id: d.id, ...docSnap(d) });
      });
    }
  }
  return out;
}

const TEAM_STADIUM = {
  KT: "수원KT위즈파크",
  LG: "잠실야구장",
  "두산": "잠실야구장",
  SSG: "인천SSG랜더스필드",
  NC: "창원NC파크",
  KIA: "광주-기아챔피언스필드",
  "삼성": "대구삼성라이온즈파크",
  "한화": "대전한화생명이글스파크",
  "롯데": "사직야구장",
  "키움": "고척스카이돔",
};

function pickVenueName(g) {
  return (
    pickStr(g, ["stadium", "venue", "ballpark", "park", "place", "경기장"]) || ""
  ).slice(0, 24);
}

/**
 * 업로드 스크립트 기준: standings 컬렉션 단일 문서 `{ year, standings: [...] }`
 * 문서 ID 예: 2026_standings
 */
async function fetchStandings2026Document(db) {
  try {
    const snap = await db.collection("standings").doc("2026_standings").get();
    if (!snap.exists) return { standings: [], year: 2026 };
    const data = docSnap(snap);
    const standings = Array.isArray(data.standings) ? data.standings : [];
    const year = typeof data.year === "number" ? data.year : 2026;
    return { standings, year };
  } catch (e) {
    console.warn("[fetchStandings2026Document]", e?.message || e);
    return { standings: [], year: 2026 };
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }
  const method = String(event.httpMethod || "").toUpperCase();

  let payload;
  if (method === "GET") {
    payload = event.queryStringParameters || {};
  } else if (method === "POST") {
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Invalid JSON" }),
      };
    }
  } else {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Method not allowed" }),
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
      case "trigger_crawl": {
        const response = await fetch(
          "https://api.github.com/repos/cho0123/kbo-project/actions/workflows/crawl.yml/dispatches",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ref: "main" }),
          }
        );
        if (response.status === 204) {
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              success: true,
              message: "크롤링 시작됐어요!",
            }),
          };
        } else {
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              success: false,
              message: "크롤링 실행 실패",
            }),
          };
        }
      }
      case "shorts_slides_data": {
        const dateStr = payload.date || isoSeoulToday();
        const gameDocs = await fetchGamesByDate(db, dateStr);
        const base = (gameDocs || []).map(slimGameResultRow);

        const __h2hCache = new Map();
        const __nextGameCache = new Map();
        const scheduleRows = await fetchScheduleFromDate(db, dateStr);

        const games = [];
        for (const g of base) {
          const gid = String(g?.game_id || "").trim();
          if (!gid) continue;

          // Winning/losing pitcher (same heuristic as game_results)
          const needsWin = !g?.winning_pitcher;
          const needsLose = !g?.losing_pitcher;
          let winName = g.winning_pitcher || "";
          let loseName = g.losing_pitcher || "";

          const pitchers = await fetchPitchersForGame(db, gid);
          const homeStarter =
            pitchers.find(
              (p) => normalizeSide(p?.side) === "home" && p?.is_starter === true
            ) ||
            pitchers.find((p) => normalizeSide(p?.side) === "home");
          const awayStarter =
            pitchers.find(
              (p) => normalizeSide(p?.side) === "away" && p?.is_starter === true
            ) ||
            pitchers.find((p) => normalizeSide(p?.side) === "away");
          const homeScore = Number(g?.home_score);
          const awayScore = Number(g?.away_score);
          const hasScores =
            Number.isFinite(homeScore) &&
            Number.isFinite(awayScore) &&
            homeScore !== awayScore;

          if (hasScores && (needsWin || needsLose)) {
            const withSide = (Array.isArray(pitchers) ? pitchers : []).map((p) => ({
              ...p,
              side: normalizeSide(p?.side),
            }));
            const homePitchers = withSide.filter((p) => p.side === "home");
            const awayPitchers = withSide.filter((p) => p.side === "away");
            const homeWin = homeScore > awayScore;
            const winSide = homeWin ? "home" : "away";
            const loseSide = homeWin ? "away" : "home";
            const winByResult = (pitchers || []).find(
              (p) => String(p?.result || "").trim() === "승"
            );
            const loseByResult = (pitchers || []).find(
              (p) => String(p?.result || "").trim() === "패"
            );

            if (needsWin && winByResult) {
              winName = pickPitcherName(winByResult) || "";
            }
            if (needsLose && loseByResult) {
              loseName = pickPitcherName(loseByResult) || "";
            }

            if ((needsWin && !winName) || (needsLose && !loseName)) {
              const win = pickTopInningsPitcher(winSide === "home" ? homePitchers : awayPitchers);
              const lose = pickTopInningsPitcher(loseSide === "home" ? homePitchers : awayPitchers);
              if (needsWin && !winName) winName = (pickPitcherName(win) || "") ? `${pickPitcherName(win)} (추정)` : "";
              if (needsLose && !loseName) loseName = (pickPitcherName(lose) || "") ? `${pickPitcherName(lose)} (추정)` : "";
            }
          }

          // MVP batter: winner team only, HR first then hits
          const batters = await fetchBattersForGame(db, gid);
          const homeWin = (g.home_score ?? 0) > (g.away_score ?? 0);
          const winTeam = homeWin ? g.home_team : g.away_team;

          const winBatters = (batters || []).filter((b) => {
            const bt = pickTeamName(b);
            return bt && winTeam && (bt.includes(winTeam) || winTeam.includes(bt));
          });
          let best = null;
          let bestHr = -1;
          let bestH = -1;
          for (const b of winBatters) {
            const hr = pickNum(b, ["hr", "HR", "home_run", "홈런"]);
            const h = pickNum(b, ["h", "H", "hits", "hit", "안타"]);
            if (hr > bestHr || (hr === bestHr && h > bestH)) {
              bestHr = hr;
              bestH = h;
              best = b;
            }
          }
          const mvp = best
            ? {
                name: pickPlayerName(best),
                team: pickTeamName(best),
                h: bestH,
                hr: bestHr,
                ab: pickNum(best, ["ab", "AB", "at_bats", "타수"]),
              }
            : null;

          const rawGame = (gameDocs || []).find((x) => String(x?.game_id || x?.gameId || "") === gid) || {};
          const homeTeamRaw = String(g?.home_team || rawGame?.home_team || "");
          const venueKey = Object.keys(TEAM_STADIUM).find((k) =>
            homeTeamRaw.includes(k)
          );
          const venue = venueKey ? TEAM_STADIUM[venueKey] : "";

          const h2hKey = `2026:${String(g?.home_team || "")}__${String(g?.away_team || "")}`;
          let headToHead = __h2hCache.get(h2hKey);
          if (!headToHead) {
            headToHead = await fetchHeadToHeadRecord(
              db,
              g?.home_team || "",
              g?.away_team || "",
              2026
            );
            __h2hCache.set(h2hKey, headToHead);
          }

          const homeKey = `${String(dateStr || "").slice(0, 10)}:${normalizeTeamKey(g?.home_team || "")}`;
          const awayKey = `${String(dateStr || "").slice(0, 10)}:${normalizeTeamKey(g?.away_team || "")}`;

          let homeNextGame = __nextGameCache.get(homeKey);
          if (homeNextGame === undefined) {
            homeNextGame = pickNextGameForTeams(
              scheduleRows,
              g?.home_team || "",
              "",
              dateStr
            );
            __nextGameCache.set(homeKey, homeNextGame ?? null);
          }

          let awayNextGame = __nextGameCache.get(awayKey);
          if (awayNextGame === undefined) {
            awayNextGame = pickNextGameForTeams(
              scheduleRows,
              g?.away_team || "",
              "",
              dateStr
            );
            __nextGameCache.set(awayKey, awayNextGame ?? null);
          }

          games.push({
            ...g,
            winning_pitcher: winName,
            losing_pitcher: loseName,
            home_starter: homeStarter
              ? {
                  name: pickPitcherName(homeStarter),
                  era: homeStarter?.era ?? null,
                  ip: homeStarter?.ip ?? null,
                }
              : null,
            away_starter: awayStarter
              ? {
                  name: pickPitcherName(awayStarter),
                  era: awayStarter?.era ?? null,
                  ip: awayStarter?.ip ?? null,
                }
              : null,
            winning_pitcher_era:
              pitchers.find(
                (p) =>
                  pickPitcherName(p) === winName.replace(" (추정)", "")
              )?.era ?? null,
            losing_pitcher_era:
              pitchers.find(
                (p) =>
                  pickPitcherName(p) === loseName.replace(" (추정)", "")
              )?.era ?? null,
            venue,
            headToHead,
            mvp_batter: mvp,
            home_next_game: homeNextGame ?? null,
            away_next_game: awayNextGame ?? null,
            // Backward-compat: keep next_game but align with home team next game
            next_game: homeNextGame ?? null,
          });
        }

        const { standings, year: standingsYear } = await fetchStandings2026Document(db);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            date: dateStr,
            games,
            standings,
            standingsYear,
          }),
        };
      }
      case "last_updated": {
        const meta = await fetchLastUpdated(db);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            meta,
          }),
        };
      }
      case "game_results": {
        const dateStr = payload.date || isoSeoulToday();
        const gameDocs = await fetchGamesByDate(db, dateStr);
        if (gameDocs?.length) {
          console.log("GAME_SAMPLE:", JSON.stringify(gameDocs[0]));
          // games 컬렉션 실제 필드명 확인용 (Netlify Functions logs에서 확인)
          console.log("GAME_DOC:", JSON.stringify(gameDocs[0]));
        }
        const base = (gameDocs || []).map(slimGameResultRow);
        const games = [];
        for (const g of base) {
          const gid = String(g?.game_id || "").trim();
          const needsWin = !g?.winning_pitcher;
          const needsLose = !g?.losing_pitcher;
          if (!gid || (!needsWin && !needsLose)) {
            games.push(g);
            continue;
          }

          const pitchers = await fetchPitchersForGame(db, gid);
          const homeScore = Number(g?.home_score);
          const awayScore = Number(g?.away_score);
          const hasScores =
            Number.isFinite(homeScore) &&
            Number.isFinite(awayScore) &&
            homeScore !== awayScore;

          const withSide = (Array.isArray(pitchers) ? pitchers : []).map((p) => ({
            ...p,
            side: normalizeSide(p?.side),
          }));
          const homePitchers = withSide.filter((p) => p.side === "home");
          const awayPitchers = withSide.filter((p) => p.side === "away");

          let win = null;
          let lose = null;
          if (hasScores) {
            const homeWin = homeScore > awayScore;
            const winSide = homeWin ? "home" : "away";
            const loseSide = homeWin ? "away" : "home";
            win = pickTopInningsPitcher(winSide === "home" ? homePitchers : awayPitchers);
            lose = pickTopInningsPitcher(loseSide === "home" ? homePitchers : awayPitchers);
          }

          // 필드명 확인이 필요할 때 로그로 확인 가능하게 일부만 출력
          if (pitchers?.length) {
            console.log("PITCHERS_FOR_GAME_SAMPLE:", {
              game_id: gid,
              keys: Object.keys(pitchers[0] || {}),
              sample: pitchers[0],
            });
          }

          games.push({
            ...g,
            winning_pitcher: needsWin
              ? ((pickPitcherName(win) || "") ? `${pickPitcherName(win)} (추정)` : "")
              : g.winning_pitcher,
            losing_pitcher: needsLose
              ? ((pickPitcherName(lose) || "") ? `${pickPitcherName(lose)} (추정)` : "")
              : g.losing_pitcher,
          });
        }
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            date: dateStr,
            games,
          }),
        };
      }
      case "game_boxscore": {
        const gidRaw = payload.gameId || payload.game_id || "";
        const gameId = String(gidRaw || "").trim();
        if (!gameId) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ error: "Missing game_id" }),
          };
        }

        // 이전에 잘 되던 단순 방식으로 복구: game_id == gameId 로 직접 조회 후 side 분리
        const battersSnap = await db
          .collection("batters")
          .where("game_id", "==", gameId)
          .get();
        const batters = battersSnap.docs.map((d) => docSnap(d));
        console.log("BOXSCORE batters count:", batters.length, "gameId:", gameId);
        for (const b of batters) {
          if (__batterRbiCheckLogged2 >= 60) break;
          __batterRbiCheckLogged2 += 1;
          console.log("BATTER_RBI_CHECK2:", {
            player: b?.player ?? b?.name ?? null,
            rbi: b?.rbi ?? b?.RBI ?? b?.bi ?? null,
            h: b?.h ?? b?.H ?? null,
            ab: b?.ab ?? b?.AB ?? null,
            game_id: b?.game_id ?? b?.gameId ?? gameId,
          });
        }

        const pitchersSnap = await db
          .collection("pitchers")
          .where("game_id", "==", gameId)
          .get();
        const pitchers = pitchersSnap.docs.map((d) => docSnap(d));
        console.log("BOXSCORE pitchers count:", pitchers.length);
        for (const p of pitchers) {
          if (__pitcherEraCheckLogged >= 40) break;
          __pitcherEraCheckLogged += 1;
          console.log("PITCHER_ERA_CHECK:", {
            player: p?.player ?? p?.name ?? null,
            era: p?.era ?? p?.ERA ?? null,
            game_id: p?.game_id ?? p?.gameId ?? gameId,
          });
        }

        const awayBatters = batters.filter((b) => String(b?.side) === "away");
        const homeBatters = batters.filter((b) => String(b?.side) === "home");
        const awayPitchers = pitchers.filter((p) => String(p?.side) === "away");
        const homePitchers = pitchers.filter((p) => String(p?.side) === "home");

        const awayBattersUi = mergeBattersByPlayer(
          awayBatters.map(normalizeBatterRowForUi)
        );
        const homeBattersUi = mergeBattersByPlayer(
          homeBatters.map(normalizeBatterRowForUi)
        );
        const batters_by_side = { away: awayBattersUi, home: homeBattersUi };
        const pitchers_by_side = { away: awayPitchers, home: homePitchers };

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            game_id: gameId,
            // 이전/호환 필드들
            awayBatters: awayBattersUi,
            homeBatters: homeBattersUi,
            awayPitchers,
            homePitchers,
            // 현재 프론트가 사용하는 구조(홈/원정)
            batters_by_side,
            pitchers_by_side,
            // 디버깅/호환용 원본 리스트
            batters: awayBattersUi.concat(homeBattersUi),
            pitchers,
          }),
        };
      }
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

        let pitcherSnap = { docs: [] };
        let batterSnap = { docs: [] };
        if (gids.length) {
          const gid0 = gids[0];
          for (const v of variantsForGameId(gid0)) {
            const s = await db
              .collection("pitchers")
              .where("game_id", "==", v)
              .limit(1)
              .get();
            if (!s.empty) {
              pitcherSnap = s;
              break;
            }
          }
          for (const v of variantsForGameId(gid0)) {
            const s = await db
              .collection("batters")
              .where("game_id", "==", v)
              .limit(1)
              .get();
            if (!s.empty) {
              batterSnap = s;
              break;
            }
          }
        }
        console.log('DOC_SAMPLE_PITCHER:', JSON.stringify(pitcherSnap.docs[0]?.data()));
        console.log('DOC_SAMPLE_BATTER:', JSON.stringify(batterSnap.docs[0]?.data()));

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

        const bestPitcher = structured.overall_best.pitcher;
        const bestBatter = structured.overall_best.batter;
        const claudeOnlyBest = {
          date: dateStr,
          bestPitcher,
          bestBatter,
        };

        const sys =
          "당신은 KBO 야구 분석가입니다.\n" +
          "오늘의 전체 베스트 투수 1명, 베스트 타자 1명에 대해서만\n" +
          "각각 3~4줄로 선정 이유를 설명하세요.\n" +
          "경기별 MVP 서술은 하지 마세요.\n" +
          "완결된 문장으로 마무리하세요.";
        const userQ =
          payload.question ||
          `${dateStr} 일자 기준으로 위 JSON의 bestPitcher·bestBatter만 근거로 선정 이유를 한국어로 작성하세요. 데이터가 없으면 해당 항목은 생략하고 그 사실을 짧게 밝히세요.`;
        const text = await claude(
          sys,
          `데이터(JSON):\n${JSON.stringify(claudeOnlyBest)}\n\n요청:\n${userQ}`,
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
      case "get_players": {
        const team = payload.team || "";
        // 트레이드 선수를 고려해 '현재 시즌' 선수 목록만 제공 (2026 고정)
        const year = "2026";
        const type = payload.type === "pitcher" ? "pitcher" : "batter";
        const players = await getPlayers(db, { team, year, type });
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            team,
            year: Number(year),
            type,
            players,
          }),
        };
      }
      case "pv_batter": {
        const pitcher = payload.pitcher || "";
        const batter = payload.batter || "";
        const tab = payload.tab || payload.pvTab || payload.season || "both";
        const ov0 = await pitcherBatterOverlap(db, batter, pitcher);
        context = filterPvContextByTab(ov0, tab);
        userQ =
          payload.question ||
          `동일 경기에 같이 등장한 기록을 바탕으로 ${pitcher} 투수 vs ${batter} 타자의 맞대결·맥락을 한국어로 설명해줘. (완벽한 상대전 데이터가 없으면 한계를 밝혀줘)\n\n출력 형식:\n- 마크다운을 사용해도 되지만, 표는 마크다운 테이블로 작성하되 코드블록(\\\`\\\`\\\`)으로 감싸지 마.`;
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

        const [thisSeason, prevSeason] = await Promise.all([
          pvBatterStatsByYear(db, pitcher, batter, 2026, end),
          pvBatterStatsByYear(db, pitcher, batter, 2025, "2025-12-31"),
        ]);

        const per_game = {
          thisSeason: buildPvPerGameRows(
            thisSeason.batter_lines,
            thisSeason.pitcher_lines,
            pitcher,
            batter
          ),
          prevSeason: buildPvPerGameRows(
            prevSeason.batter_lines,
            prevSeason.pitcher_lines,
            pitcher,
            batter
          ),
        };
        const bothSeasons = {
          stat: mergePvStats(thisSeason.stat, prevSeason.stat),
          batter_lines: (prevSeason.batter_lines || []).concat(thisSeason.batter_lines || []),
          pitcher_lines: (prevSeason.pitcher_lines || []).concat(thisSeason.pitcher_lines || []),
          shared_game_ids: (prevSeason.shared_game_ids || []).concat(thisSeason.shared_game_ids || []),
        };
        const per_game_both = buildPvPerGameRows(
          bothSeasons.batter_lines,
          bothSeasons.pitcher_lines,
          pitcher,
          batter
        );

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            pitcher,
            batter,
            end,
            thisSeason: thisSeason.stat,
            prevSeason: prevSeason.stat,
            bothSeasons: bothSeasons.stat,
            per_game: { ...per_game, bothSeasons: per_game_both },
            insufficient: {
              thisSeason: thisSeason.insufficient,
              prevSeason: prevSeason.insufficient,
              bothSeasons: isInsufficient(bothSeasons.stat),
            },
            counts: {
              thisSeasonSharedGames: thisSeason.shared_game_ids.length,
              prevSeasonSharedGames: prevSeason.shared_game_ids.length,
              thisSeasonBatterLines: thisSeason.batter_lines.length,
              prevSeasonBatterLines: prevSeason.batter_lines.length,
              bothSeasonsBatterLines: bothSeasons.batter_lines.length,
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
        const batsIn = batters.filter(inRange);
        const pitsIn = pitchers.filter(inRange);
        const addOpponent = (row) => {
          const teamCode = teamCodeFromGameIdAndSide(row?.game_id, row?.side);
          const { opponent, home_away } = deriveOpponentFromGameId(row?.game_id, teamCode);
          return { ...row, opponent, home_away };
        };
        context = {
          player,
          start,
          end,
          // Claude가 표를 만들 때 팀코드(LTSS 등) 대신 팀 이름을 쓰도록 도와준다.
          batters: batsIn.map(addOpponent),
          pitchers: pitsIn.map(addOpponent),
        };
        userQ =
          payload.question ||
          `기간 ${start}~${end} 동안 ${player} 선수의 성적을 한국어로 분석해줘.\n\n중요 지시사항(반드시 준수):\n- 응답에 전체 요약, 종합 성적 요약, 월간 종합 성적, 전체 누적 성적 같은 항목/수치 세로 테이블은 절대 포함하지 마세요.\n- 전체 요약 stat 카드는 UI에서 별도로 표시되므로 응답에 중복으로 넣지 마세요.\n- 경기별 상세 기록 테이블과 분석 텍스트만 작성하세요.\n\n표/상대팀 표기 규칙:\n- 상대는 2글자 코드가 아니라 구단명(예: 롯데 자이언츠)으로 표기해줘.\n- 홈/원정은 "홈" 또는 "원정"으로 표기해줘.`;
        break;
      }
      case "sp_compare": {
        const a = payload.pitcherA || "";
        const b = payload.pitcherB || "";
        const la = await fetchPitcherRecent(db, a, 15);
        const lb = await fetchPitcherRecent(db, b, 15);
        const addOpponent = (row) => {
          const teamCode = teamCodeFromGameIdAndSide(row?.game_id, row?.side);
          const { opponent, home_away } = deriveOpponentFromGameId(row?.game_id, teamCode);
          return { ...row, opponent, home_away };
        };
        context = {
          pitcherA: a,
          pitcherB: b,
          recentA: la.map(addOpponent),
          recentB: lb.map(addOpponent),
        };
        userQ =
          payload.question ||
          `${a} vs ${b} 선발 투수를 최근 등판 기록 위주로 비교 분석해줘 (한국어).\n\n표/상대팀 표기 규칙:\n- 상대는 2글자 코드가 아니라 구단명(예: 롯데 자이언츠)으로 표기해줘.\n- 홈/원정은 "홈" 또는 "원정"으로 표기해줘.`;
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
      action === "team_week" ? 1200 : action === "pv_batter" ? 1700 : 2048;
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
        uiData: buildUiData(action, context),
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
    case "last_updated":
      return {};
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
    case "game_results":
      return { date: ctx.date, games: ctx.games?.length ?? 0 };
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
