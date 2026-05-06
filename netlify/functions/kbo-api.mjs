import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";
import { randomUUID } from "crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

// 구장명(약칭) → 풀네임
const VENUE_MAP = {
  "잠실": "잠실야구장",
  "수원": "수원 KT위즈파크",
  "광주": "광주-기아 챔피언스필드",
  "대구": "대구 삼성라이온즈파크",
  "인천": "인천 SSG랜더스필드",
  "사직": "부산 사직야구장",
  "창원": "창원 NC파크",
  "고척": "고척 스카이돔",
  "대전": "대전 한화생명이글스파크",
};

/** 일간 쇼츠 경기결과 슬라이드: 경기 순 로테이션 (10팀 순환) */
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

/** 0=일…6=토. 월·화 동일 슬롯(0); 일요일은 별도(6) */
const DAY_INDEX = { 0: 6, 1: 0, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4 };

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

const YOUTUBE_COOKIE_S3_KEY = "cookies/youtube.txt";
const COOKIE_PRESIGN_EXPIRES_SEC = 3600;
const HIGHLIGHT_UPLOAD_PRESIGN_EXPIRES_SEC = 3600;
const HIGHLIGHT_PREVIEW_PRESIGN_EXPIRES_SEC = 3600;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 쇼츠3 하이라이트 인코딩: S3 메타 작성 후 Lambda 비동기 호출 (video-encode.mjs 와 동일 자격·버킷) */
function videoEncodeAwsClients() {
  const region = process.env.KBO_AWS_REGION || "ap-northeast-2";
  const kboAccessKeyId = process.env.KBO_AWS_ACCESS_KEY_ID;
  const kboSecretAccessKey = process.env.KBO_AWS_SECRET_ACCESS_KEY;
  const credentials =
    kboAccessKeyId && kboSecretAccessKey
      ? { accessKeyId: kboAccessKeyId, secretAccessKey: kboSecretAccessKey }
      : undefined;
  const cfg = { region, ...(credentials ? { credentials } : {}) };
  return {
    region,
    bucket: process.env.S3_VIDEO_BUCKET || "kbo-video-export",
    lambdaName: process.env.LAMBDA_VIDEO_ENCODER || "kbo-video-encoder",
    s3: new S3Client(cfg),
    lambda: new LambdaClient(cfg),
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

async function claudeRawUserPrompt(user, { model, maxTokens = 1000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: model || MODEL,
    max_tokens: maxTokens,
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

function isoSeoulTomorrow() {
  const s = isoSeoulToday();
  const parts = s.split("-").map((x) => parseInt(String(x), 10));
  const t = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

async function fetchScheduleRowsForDate(db, dateStr, collectionName = "schedule") {
  const rows = [];
  const coll = collectionName || "schedule";
  for (const field of ["game_date", "gameDate"]) {
    try {
      const snap = await db.collection(coll).where(field, "==", dateStr).get();
      snap.docs.forEach((d) => rows.push(docSnap(d)));
      if (rows.length) break;
    } catch (e) {
      console.warn(`[fetchScheduleRowsForDate] ${coll} ${field}:`, e?.message || e);
    }
  }
  if (rows.length) return rows;
  try {
    const snap = await db.collection(coll).limit(3000).get();
    for (const d of snap.docs) {
      const r = docSnap(d);
      const gd = String(r?.game_date ?? r?.gameDate ?? "").slice(0, 10);
      if (gd === dateStr) rows.push(r);
    }
  } catch (e) {
    console.warn(`[fetchScheduleRowsForDate] ${coll} scan:`, e?.message || e);
  }
  return rows;
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
            rows.push({ id: d.id, ...docSnap(d) });
          }
        });
      }
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

function seoulWeekdayAndDayOfYearForShortsRotation(dateStr) {
  const safe = safeIsoDate(dateStr);
  if (!safe) return { dayOfWeek: 0, dayOfYear: 1 };
  const anchor = new Date(`${safe}T12:00:00+09:00`);
  const wdParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "long",
  }).formatToParts(anchor);
  const wdName = wdParts.find((p) => p.type === "weekday")?.value || "Sunday";
  const DAY_LONG_TO_0SUN = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  const dayOfWeek = DAY_LONG_TO_0SUN[wdName] ?? 0;
  const [y, m, da] = safe.split("-").map(Number);
  const t = Date.UTC(y, m - 1, da);
  const yearStart = Date.UTC(y, 0, 0);
  const dayOfYear = Math.round((t - yearStart) / 86400000);
  return { dayOfWeek, dayOfYear };
}

function targetTeamForShortsRotationDate(dateStr) {
  const safe = safeIsoDate(dateStr);
  if (!safe) return TEAM_ROTATION[0];
  const { dayOfWeek, dayOfYear } = seoulWeekdayAndDayOfYearForShortsRotation(safe);
  const daySlot = DAY_INDEX[dayOfWeek] ?? 0;
  const weekOfYear = Math.floor(dayOfYear / 7);
  const teamIdx = (weekOfYear + daySlot) % 10;
  return TEAM_ROTATION[teamIdx];
}

function gameInvolvesShortsRotationTeam(game, rotationToken) {
  const tok = String(rotationToken || "").trim();
  if (!tok) return false;
  const targetFull = normalizeTeamKey(tok);
  if (!targetFull) return false;
  const h = normalizeTeamKey(game?.home_team || "");
  const a = normalizeTeamKey(game?.away_team || "");
  return h === targetFull || a === targetFull;
}

/** 로테이션 팀이 나오는 경기를 앞으로; 나머지는 기존 순서. 해당 팀 경기 없으면 원본 그대로 */
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

function normalizePitcherNameForMatch(nameRaw) {
  return String(nameRaw || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeEraNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function fetchLatestSeasonEraByPitcherName(db, seasonYear, pitcherNameRaw, cacheMap) {
  const name = normalizePitcherNameForMatch(pitcherNameRaw);
  if (!name) return null;
  const key = `${seasonYear}:${name}`;
  if (cacheMap?.has(key)) return cacheMap.get(key);

  let rows = [];
  try {
    const snap = await db.collection("pitchers").where("player", "==", name).limit(220).get();
    snap.forEach((d) => rows.push({ id: d.id, ...docSnap(d) }));
  } catch (e) {
    console.warn("[fetchLatestSeasonEraByPitcherName] query failed:", e?.message || e);
    cacheMap?.set(key, null);
    return null;
  }

  // sort: latest game_date first (fallback to id)
  const sortKey = (r) => {
    const gd = safeIsoDate(r?.game_date || r?.gameDate || "");
    const gid = String(r?.game_id || r?.gameId || r?.id || "");
    return `${gd || ""}__${gid}`;
  };
  rows.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  // pick first non-null era, prefer same season year if year field exists
  const y = Number(seasonYear) || 2026;
  const pickFrom = (arr) => {
    for (const r of arr) {
      const era = safeEraNumber(r?.era ?? r?.ERA ?? null);
      if (era != null) return era;
    }
    return null;
  };
  const sameYear = rows.filter((r) => Number(r?.year) === y);
  const eraPicked = pickFrom(sameYear.length ? sameYear : rows);

  cacheMap?.set(key, eraPicked);
  return eraPicked;
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
    // Extra innings support (kbo-project crawler stores total_innings from ScoreBoardScroll.maxInning)
    total_innings:
      Number.isFinite(Number(g?.total_innings))
        ? Number(g.total_innings)
        : Number.isFinite(Number(g?.totalInnings))
          ? Number(g.totalInnings)
          : Number.isFinite(Number(g?.maxInning))
            ? Number(g.maxInning)
            : null,
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

function winPct(w, l) {
  const ww = Number(w) || 0;
  const ll = Number(l) || 0;
  const denom = ww + ll;
  return denom > 0 ? ww / denom : 0;
}

function sumInningsToNumber(ipRaw) {
  return inningsToNumber(ipRaw);
}

function buildWeeklyTeamRecords(games) {
  const rows = Array.isArray(games) ? games : [];
  const byTeam = new Map();
  const ensure = (teamName) => {
    const team = normalizeTeamKey(teamName || "");
    if (!team) return null;
    if (!byTeam.has(team)) byTeam.set(team, { team, wins: 0, losses: 0, draws: 0 });
    return byTeam.get(team);
  };

  for (const g0 of rows) {
    const g = g0 && typeof g0 === "object" ? g0 : {};
    const home = normalizeTeamKey(g.home_team || g.home || g.homeTeam || "");
    const away = normalizeTeamKey(g.away_team || g.away || g.awayTeam || "");
    if (!home || !away) continue;
    const hs = Number(g.home_score);
    const as = Number(g.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    const homeRec = ensure(home);
    const awayRec = ensure(away);
    if (!homeRec || !awayRec) continue;

    if (hs === as) {
      homeRec.draws += 1;
      awayRec.draws += 1;
    } else if (hs > as) {
      homeRec.wins += 1;
      awayRec.losses += 1;
    } else {
      awayRec.wins += 1;
      homeRec.losses += 1;
    }
  }

  const out = [...byTeam.values()];
  out.sort((a, b) => {
    const ap = winPct(a.wins, a.losses);
    const bp = winPct(b.wins, b.losses);
    if (bp !== ap) return bp - ap;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return String(a.team).localeCompare(String(b.team), "ko");
  });
  return out;
}

function buildWeeklyTopBatters(batterRows, topN = 3) {
  const rows = Array.isArray(batterRows) ? batterRows : [];
  const byPlayer = new Map();

  for (const r0 of rows) {
    const r = r0 && typeof r0 === "object" ? r0 : {};
    const player = pickPlayerName(r);
    if (!player || player === "—") continue;
    const team = pickTeamName(r);
    const key = `${player}||${team || ""}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        player,
        team: team || null,
        hr: 0,
        h: 0,
        rbi: 0,
        runs: 0,
        ab: 0,
      });
    }
    const acc = byPlayer.get(key);
    acc.hr += pickNum(r, ["hr", "HR", "home_run", "홈런"]);
    acc.h += pickNum(r, ["h", "H", "hits", "hit", "안타"]);
    acc.rbi += pickNum(r, ["rbi", "RBI", "bi", "타점"]);
    acc.runs += pickNum(r, ["runs", "r", "R", "run", "득점", "rs"]);
    acc.ab += pickNum(r, ["ab", "AB", "at_bats", "atBats", "타수"]);
  }

  const out = [...byPlayer.values()].map((x) => {
    const avg = x.ab > 0 ? x.h / x.ab : null;
    return {
      player: x.player,
      team: x.team,
      hr: x.hr,
      h: x.h,
      rbi: x.rbi,
      runs: x.runs,
      avg: avg != null && Number.isFinite(avg) ? avg : null,
    };
  });
  out.sort((a, b) => {
    if (b.hr !== a.hr) return b.hr - a.hr;
    if (b.rbi !== a.rbi) return b.rbi - a.rbi;
    if (b.h !== a.h) return b.h - a.h;
    return String(a.player).localeCompare(String(b.player), "ko");
  });
  return out.slice(0, Math.max(0, Number(topN) || 3));
}

function buildWeeklyTopPitchers(pitcherRows, topN = 3) {
  const rows = Array.isArray(pitcherRows) ? pitcherRows : [];
  const byPlayer = new Map();

  for (const r0 of rows) {
    const r = r0 && typeof r0 === "object" ? r0 : {};
    const player = pickPitcherName(r) || pickPlayerName(r);
    if (!player || player === "—") continue;
    const team = pickTeamName(r);
    const key = `${player}||${team || ""}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, {
        player,
        team: team || null,
        ip: 0,
        _er: 0,
        _hasEr: false,
        wins: 0,
      });
    }
    const acc = byPlayer.get(key);
    const ipn = sumInningsToNumber(r?.ip ?? r?.IP ?? r?.inn ?? r?.innings ?? 0);
    if (ipn > 0) acc.ip += ipn;

    const er = pickAny(r, ["er", "ER", "earned_runs", "earnedRuns"]);
    const erNum = er == null ? null : Number(er);
    if (erNum != null && Number.isFinite(erNum) && erNum >= 0) {
      acc._er += erNum;
      acc._hasEr = true;
    } else {
      const era = pickAny(r, ["era", "ERA", "평균자책점", "평균자책"]);
      const eraNum = era == null ? null : Number(era);
      if (Number.isFinite(eraNum) && eraNum >= 0 && ipn > 0) {
        acc._er += (eraNum * ipn) / 9;
        acc._hasEr = true;
      }
    }

    const result = String(r?.result || "").trim();
    if (result === "승") acc.wins += 1;
  }

  const list = [...byPlayer.values()]
    .map((x) => {
      const era = x.ip > 0 && x._hasEr ? (x._er * 9) / x.ip : null;
      return {
        player: x.player,
        team: x.team,
        ip: x.ip,
        era,
        wins: x.wins,
      };
    })
    // 2이닝 이상만
    .filter((x) => Number(x.ip) >= 2);

  list.sort((a, b) => {
    if (b.ip !== a.ip) return b.ip - a.ip;
    const ae = a.era == null ? Infinity : Number(a.era);
    const be = b.era == null ? Infinity : Number(b.era);
    if (ae !== be) return ae - be;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return String(a.player).localeCompare(String(b.player), "ko");
  });

  return list.slice(0, Math.max(0, Number(topN) || 3)).map((x) => ({
    ...x,
    ip: Number.isFinite(x.ip) ? Number(x.ip.toFixed(2)) : x.ip,
    era: x.era == null ? null : Number(x.era.toFixed(2)),
  }));
}

async function fetchClosestStandingsHistoryDoc(db, targetDateIso) {
  const target = safeIsoDate(targetDateIso);
  if (!target) return null;
  // Prefer query by 'date' field (uploaded by new uploader). Fallback: scan.
  try {
    const snap = await db
      .collection("standings_history")
      .where("date", "<=", target)
      .orderBy("date", "desc")
      .limit(1)
      .get();
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...docSnap(d) };
    }
  } catch (e) {
    console.warn("[standings_history] date query failed:", e?.message || e);
  }

  try {
    const snap2 = await db.collection("standings_history").limit(800).get();
    const docs = [];
    snap2.forEach((d) => docs.push({ id: d.id, ...docSnap(d) }));
    let best = null;
    for (const doc of docs) {
      const d0 = safeIsoDate(doc?.date || "") || safeIsoDate(String(doc?.id || "").slice(0, 10));
      if (!d0) continue;
      if (d0 > target) continue;
      if (!best || d0 > best._date) best = { ...doc, _date: d0 };
    }
    return best ? { ...best, date: best._date } : null;
  } catch (e2) {
    console.warn("[standings_history] scan failed:", e2?.message || e2);
    return null;
  }
}

function buildStandingsDiff(prevDoc, curDoc) {
  const prevRows = Array.isArray(prevDoc?.standings) ? prevDoc.standings : [];
  const curRows = Array.isArray(curDoc?.standings) ? curDoc.standings : [];
  const prevRank = new Map();
  for (const r of prevRows) {
    const team = normalizeTeamKey(r?.team || r?.TEAM || "");
    const rank = Number(r?.rank ?? r?.RANK);
    if (!team || !Number.isFinite(rank)) continue;
    prevRank.set(team, rank);
  }
  const out = [];
  for (const r of curRows) {
    const team = normalizeTeamKey(r?.team || r?.TEAM || "");
    const rank = Number(r?.rank ?? r?.RANK);
    if (!team || !Number.isFinite(rank)) continue;
    const pr = prevRank.has(team) ? prevRank.get(team) : null;
    out.push({
      team,
      current_rank: rank,
      prev_rank: pr,
      diff: pr == null ? null : pr - rank,
    });
  }
  out.sort((a, b) => (a.current_rank ?? 999) - (b.current_rank ?? 999));
  return out;
}

function pickNextWeekHighlights(scheduleRows, topTeams, afterDateIso, topN = 3) {
  const after = safeIsoDate(afterDateIso);
  const topSet = new Set((topTeams || []).map((t) => normalizeTeamKey(t)).filter(Boolean));
  const rows = Array.isArray(scheduleRows) ? scheduleRows : [];
  const candidates = [];
  for (const r of rows) {
    const gd = safeIsoDate(r?.game_date || "");
    if (!gd) continue;
    if (after && gd <= after) continue;
    const home = normalizeTeamKey(r?.home_team || "");
    const away = normalizeTeamKey(r?.away_team || "");
    if (!home || !away) continue;
    if (!topSet.has(home) && !topSet.has(away)) continue;
    const tm = String(r?.game_time || "").trim() || "00:00";
    const stamp = `${gd}T${tm}`;
    candidates.push({
      game_date: gd,
      game_time: tm,
      home_team: r?.home_team ?? null,
      away_team: r?.away_team ?? null,
      venue: r?.venue ?? null,
      stamp,
    });
  }
  candidates.sort((a, b) => String(a.stamp).localeCompare(String(b.stamp)));
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    const key = `${c.game_date}:${c.home_team}__${c.away_team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= (Number(topN) || 3)) break;
  }
  return out;
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
        const dateInput = safeIsoDate(payload.date || "");
        const dispatchBody = dateInput
          ? { ref: "main", inputs: { date: dateInput } }
          : { ref: "main" };
        const response = await fetch(
          "https://api.github.com/repos/cho0123/kbo-project/actions/workflows/crawl.yml/dispatches",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(dispatchBody),
          }
        );
        if (response.status === 204) {
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              success: true,
              date: dateInput || null,
              message: dateInput
                ? `${dateInput} 크롤링 시작됐어요!`
                : "크롤링 시작됐어요!",
            }),
          };
        } else {
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              success: false,
              date: dateInput || null,
              message: "크롤링 실행 실패",
            }),
          };
        }
      }
      case "ai_highlight_analysis": {
        const games = Array.isArray(payload.games) ? payload.games : [];
        if (games.length < 1) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              action,
              error: "Missing games array",
            }),
          };
        }

        const userPrompt = `다음 KBO 경기 데이터를 분석해서 각 경기별로 아래 형식으로 답해줘.
형식:
[경기] 홈팀 vs 원정팀 (점수)
핫이슈: (핵심 이슈 1줄)
하이라이트 텍스트: (영상 하단 자막용 임팩트 있는 문구 10자 이내)
썸네일 텍스트: (썸네일 메인 텍스트 8자 이내)

경기 데이터:
${JSON.stringify(games, null, 2)}`;

        const model =
          process.env.CLAUDE_HIGHLIGHT_MODEL || "claude-sonnet-4-5";
        const text = await claudeRawUserPrompt(userPrompt, {
          model,
          maxTokens: 1000,
        });

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            model,
            text,
          }),
        };
      }
      case "highlight_upload": {
        try {
          const jobId = randomUUID();
          const { s3, bucket } = videoEncodeAwsClients();
          const key = `jobs/${jobId}/source.mp4`;
          const cmd = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
          });
          const presignedPutUrl = await getSignedUrl(s3, cmd, {
            expiresIn: HIGHLIGHT_UPLOAD_PRESIGN_EXPIRES_SEC,
          });
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              jobId,
              key,
              bucket,
              presignedPutUrl,
            }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "highlight_upload_url_from_url": {
        const sourceUrl = String(payload.sourceUrl || "").trim();
        if (!/^https?:\/\//i.test(sourceUrl)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error: "http(s) URL을 입력하세요.",
            }),
          };
        }
        const jobId = randomUUID();
        try {
          const { lambda, bucket, lambdaName } = videoEncodeAwsClients();
          const invokeOut = await lambda.send(
            new InvokeCommand({
              FunctionName: lambdaName,
              InvocationType: "RequestResponse",
              Payload: Buffer.from(
                JSON.stringify({
                  bucket,
                  jobId,
                  meta: { type: "download_url", sourceUrl },
                })
              ),
            })
          );
          const lamRaw = invokeOut.Payload
            ? Buffer.from(invokeOut.Payload).toString("utf8")
            : "";
          let lamResult;
          try {
            lamResult = lamRaw ? JSON.parse(lamRaw) : {};
          } catch {
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error: "Lambda 응답 JSON 파싱 실패",
              }),
            };
          }
          if (invokeOut.FunctionError) {
            const msg =
              lamResult?.errorMessage ||
              lamResult?.error ||
              lamRaw ||
              "Lambda download_url 실패";
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({ ok: false, error: String(msg) }),
            };
          }
          if (!lamResult?.ok || !lamResult?.jobId) {
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error:
                  lamResult?.error ||
                  "URL 다운로드(Lambda)에 실패했습니다.",
              }),
            };
          }
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              jobId: lamResult.jobId,
              outputKey: lamResult.outputKey,
            }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "youtube_search": {
        const query = String(payload.query ?? "").trim();
        if (!query) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error: "검색어(query)가 필요합니다.",
            }),
          };
        }
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!apiKey) {
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error: "YOUTUBE_API_KEY 없음",
            }),
          };
        }
        try {
          const dateStr = payload.date ? String(payload.date).trim() : "";
          const d = dateStr ? new Date(dateStr) : new Date();
          const m = d.getMonth() + 1;
          const day = d.getDate();
          const year = d.getFullYear();

          // 올해 1월 1일
          const yearStart = new Date(year, 0, 1).toISOString();

          // 검색은 두 형식으로 시도
          const dateFormats = [`${m}.${day}`, `${m}/${day}`];

          // 쿼리 간소화: 점수/팀종류명 제거 → 팀명만
          const cleanQuery = query
            .replace(/\[경기\s*\d*\]\s*/g, "")
            .replace(/\s*\(\d+-\d+\)\s*/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          console.log("[youtube] final query:", cleanQuery);
          const teamSuffixes = [
            "타이거즈",
            "라이온즈",
            "트윈스",
            "베어스",
            "위즈",
            "랜더스",
            "자이언츠",
            "이글스",
            "다이노스",
            "히어로즈",
          ];
          let shortQuery = cleanQuery;
          for (const s of teamSuffixes) {
            shortQuery = shortQuery.replaceAll(s, " ");
          }
          shortQuery = shortQuery
            .replace(/\bvs\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim();

          const parseItems = (data) =>
            (data?.items || [])
              .filter((item) => item?.id?.videoId && item?.snippet)
              .map((item) => ({
                videoId: item.id.videoId,
                title: item.snippet.title,
                thumbnail:
                  item.snippet.thumbnails?.medium?.url ||
                  item.snippet.thumbnails?.default?.url ||
                  "",
                channelTitle: item.snippet.channelTitle,
                publishedAt: item.snippet.publishedAt,
                url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
              }));

          const results = [];
          const seen = new Set();
          for (const fmt of dateFormats) {
            const searchQuery = `${shortQuery} ${fmt} 하이라이트`;
            const searchUrl =
              `https://www.googleapis.com/youtube/v3/search?` +
              `part=snippet&q=${encodeURIComponent(searchQuery)}&` +
              `type=video&maxResults=5&order=relevance&` +
              `publishedAfter=${encodeURIComponent(yearStart)}&` +
              `key=${encodeURIComponent(apiKey)}`;

            console.log("[youtube] searchUrl:", searchUrl);
            console.log("[youtube] query:", searchQuery);

            const res = await fetch(searchUrl);
            const data = await res.json();
            console.log("[youtube] response status:", res.status);
            console.log("[youtube] response data:", JSON.stringify(data));

            if (!res.ok || data?.error) {
              const msg =
                data?.error?.message || `YouTube API 오류 (HTTP ${res.status})`;
              return {
                statusCode:
                  res.status >= 400 && res.status < 600 ? res.status : 502,
                headers: corsHeaders(),
                body: JSON.stringify({ ok: false, error: msg }),
              };
            }

            for (const it of parseItems(data)) {
              if (seen.has(it.videoId)) continue;
              seen.add(it.videoId);
              results.push(it);
              if (results.length >= 5) break;
            }
            if (results.length >= 5) break;
          }

          const items = results;
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: true, items }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "thumbnail_upload_url": {
        try {
          const { jobId } = payload;
          if (!jobId) {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({ ok: false, error: "Missing jobId" }),
            };
          }
          const { s3, bucket } = videoEncodeAwsClients();
          const key = `jobs/${jobId}/thumbnail.png`;
          const cmd = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: "image/png",
          });
          const putUrl = await getSignedUrl(s3, cmd, {
            expiresIn: HIGHLIGHT_UPLOAD_PRESIGN_EXPIRES_SEC,
          });
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: true, jobId, key, putUrl }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "highlight_video_create": {
        const HIGHLIGHT_FONT_FILES = new Set([
          "NotoSansKR-Bold.ttf",
          "BlackHanSans-Regular.ttf",
          "NotoSerifKR-Bold.ttf",
          "NotoSerifKR-Bold.otf",
        ]);
        const DEFAULT_HIGHLIGHT_FONT = "NotoSansKR-Bold.ttf";
        const sanitizeHighlightFont = (v) => {
          const s = v != null ? String(v).trim() : "";
          if (s && HIGHLIGHT_FONT_FILES.has(s)) return s;
          return DEFAULT_HIGHLIGHT_FONT;
        };
        const clamp01 = (x) => {
          const n = Number(x);
          return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
        };
        const jobId = String(payload.jobId || "").trim();
        const segmentsIn = payload.segments;
        if (!jobId || !UUID_V4_RE.test(jobId)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "유효한 jobId가 필요합니다." }),
          };
        }
        if (!Array.isArray(segmentsIn)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "구간(segments) 배열이 필요합니다." }),
          };
        }
        if (segmentsIn.length > 10) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "구간은 최대 10개입니다." }),
          };
        }
        const topText =
          payload.topText != null ? String(payload.topText).trim() : "";
        if (topText.length > 500) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error: "상단 제목은 500자 이하로 입력하세요.",
            }),
          };
        }
        let topTextColor = "#ffffff";
        if (payload.topTextColor != null) {
          const c = String(payload.topTextColor).trim();
          if (/^#[0-9A-Fa-f]{6}$/i.test(c)) {
            topTextColor = c.toLowerCase();
          }
        }
        const topTextSizeRaw = Number(payload.topTextSize);
        const topTextSize = Number.isFinite(topTextSizeRaw)
          ? Math.min(200, Math.max(20, Math.round(topTextSizeRaw)))
          : 72;
        const topTextOpacity = clamp01(payload.topTextOpacity);
        const topTextFont = sanitizeHighlightFont(payload.topTextFont);

        const segments = [];
        for (const s of segmentsIn) {
          if (!s || typeof s !== "object") {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error:
                  "각 구간은 { start, end, startMs?, endMs?, cropOffset?, text?, textY?, textColor?, textSize?, textOpacity?, textFont? } 형식이어야 합니다.",
              }),
            };
          }
          const st = s.start != null ? String(s.start).trim() : "";
          const en = s.end != null ? String(s.end).trim() : "";
          if (!st || !en) {
            continue;
          }
          const offRaw = Number(s.cropOffset);
          const cropOffset = Number.isFinite(offRaw)
            ? Math.min(50, Math.max(-50, offRaw))
            : 0;
          const text = s.text != null ? String(s.text).trim() : "";
          if (text.length > 500) {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error: "하단 텍스트는 구간당 500자 이하로 입력하세요.",
              }),
            };
          }
          const ty = Number(s.textY);
          const textY = Number.isFinite(ty)
            ? Math.min(100, Math.max(0, Math.round(ty)))
            : 85;
          let textColor = "#ffffff";
          if (s.textColor != null) {
            const c = String(s.textColor).trim();
            if (/^#[0-9A-Fa-f]{6}$/i.test(c)) {
              textColor = c.toLowerCase();
            }
          }
          const textSizeRaw = Number(s.textSize);
          const textSize = Number.isFinite(textSizeRaw)
            ? Math.min(200, Math.max(20, Math.round(textSizeRaw)))
            : 48;
          const textOpacity = clamp01(s.textOpacity);
          const textFont = sanitizeHighlightFont(s.textFont);
          const startMsRaw = Number(s.startMs);
          const endMsRaw = Number(s.endMs);
          const startMs = Number.isFinite(startMsRaw)
            ? Math.min(99, Math.max(0, Math.round(startMsRaw)))
            : 0;
          const endMs = Number.isFinite(endMsRaw)
            ? Math.min(99, Math.max(0, Math.round(endMsRaw)))
            : 0;
          segments.push({
            start: st,
            end: en,
            startMs,
            endMs,
            cropOffset,
            text,
            textY,
            textColor,
            textSize,
            textOpacity,
            textFont,
          });
        }
        if (segments.length < 1) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error:
                "시작·종료가 모두 입력된 유효한 구간이 최소 1개 필요합니다.",
            }),
          };
        }

        const { s3, lambda, bucket, lambdaName } = videoEncodeAwsClients();
        const sourceKey = `jobs/${jobId}/source.mp4`;
        try {
          await s3.send(
            new HeadObjectCommand({ Bucket: bucket, Key: sourceKey })
          );
        } catch {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error:
                "원본 영상이 S3에 없습니다. 먼저 하이라이트 업로드로 파일을 올려주세요.",
            }),
          };
        }

        const muteOriginal =
          payload.muteOriginal === true ||
          (typeof payload.muteOriginal === "string" &&
            payload.muteOriginal.toLowerCase() === "true");
        const music_s3_key = (() => {
          const s =
            payload.music_s3_key != null
              ? String(payload.music_s3_key).trim()
              : "";
          return s || "";
        })();
        const mo =
          payload.musicOptions && typeof payload.musicOptions === "object"
            ? payload.musicOptions
            : {};
        const vol = Number(mo.volume);
        const mst = Number(mo.startTime);
        const mfo = Number(mo.fadeOutDuration);
        const musicOptions = {
          volume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 0.8,
          startTime: Number.isFinite(mst) ? Math.max(0, mst) : 0,
          fadeOutDuration: Number.isFinite(mfo)
            ? Math.min(5, Math.max(0, mfo))
            : 2,
        };

        const thumbRaw = payload.thumbnailTime;
        const thumbNum = Number(thumbRaw);
        const thumbnailTime =
          thumbRaw != null &&
          thumbRaw !== "" &&
          Number.isFinite(thumbNum) &&
          thumbNum >= 0
            ? thumbNum
            : null;

        const tcoRaw = payload.thumbnailCropOffset;
        let thumbnailCropOffsetMeta = null;
        if (tcoRaw !== undefined && tcoRaw !== null && tcoRaw !== "") {
          const tco = Number(tcoRaw);
          if (!Number.isFinite(tco) || tco < -50 || tco > 50) {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error: "썸네일 크롭 오프셋은 -50~50 사이여야 합니다.",
              }),
            };
          }
          thumbnailCropOffsetMeta = Math.min(50, Math.max(-50, Math.round(tco)));
        }

        const thumbTxt =
          payload.thumbnailText != null
            ? String(payload.thumbnailText).trim()
            : "";
        let thumbnailTextMeta = null;
        if (thumbTxt.length > 0) {
          if (thumbTxt.length > 500) {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error: "썸네일 텍스트는 500자 이하로 입력하세요.",
              }),
            };
          }
          const tty = Number(payload.thumbnailTextY);
          const thumbnailTextY = Number.isFinite(tty)
            ? Math.min(100, Math.max(0, Math.round(tty)))
            : 85;
          let thumbnailTextColor = "#ffffff";
          if (payload.thumbnailTextColor != null) {
            const c = String(payload.thumbnailTextColor).trim();
            if (/^#[0-9A-Fa-f]{6}$/i.test(c)) {
              thumbnailTextColor = c.toLowerCase();
            }
          }
          const thumbnailTextOpacity = clamp01(payload.thumbnailTextOpacity);
          const ttsRaw = Number(payload.thumbnailTextSize);
          const thumbnailTextSize = Number.isFinite(ttsRaw)
            ? Math.min(200, Math.max(20, Math.round(ttsRaw)))
            : 72;
          const thumbnailTextFont = sanitizeHighlightFont(
            payload.thumbnailTextFont
          );
          thumbnailTextMeta = {
            thumbnailText: thumbTxt,
            thumbnailTextY,
            thumbnailTextColor,
            thumbnailTextOpacity,
            thumbnailTextSize,
            thumbnailTextFont,
          };
        }

        const meta = {
          type: "highlight",
          sourceUpload: true,
          segments,
          muteOriginal,
          musicOptions,
          topText,
          topTextColor,
          topTextSize,
          topTextOpacity,
          topTextFont,
        };
        if (music_s3_key) {
          meta.music_s3_key = music_s3_key;
        }
        if (thumbnailTime != null) {
          meta.thumbnailTime = thumbnailTime;
        }
        if (thumbnailCropOffsetMeta != null) {
          meta.thumbnailCropOffset = thumbnailCropOffsetMeta;
        }
        if (thumbnailTextMeta) {
          Object.assign(meta, thumbnailTextMeta);
        }

        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/meta.json`,
            Body: JSON.stringify(meta),
            ContentType: "application/json",
          })
        );
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `jobs/${jobId}/status.json`,
            Body: JSON.stringify({ state: "queued", progress: 5 }),
            ContentType: "application/json",
          })
        );

        await lambda.send(
          new InvokeCommand({
            FunctionName: lambdaName,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({ bucket, jobId })),
          })
        );

        return {
          statusCode: 202,
          headers: corsHeaders(),
          body: JSON.stringify({ ok: true, jobId, message: "queued" }),
        };
      }
      case "highlight_list": {
        try {
          const { s3, bucket } = videoEncodeAwsClients();
          const items = [];
          let continuationToken = undefined;
          do {
            const out = await s3.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: "jobs/",
                ContinuationToken: continuationToken,
              })
            );
            for (const obj of out.Contents || []) {
              const key = obj.Key || "";
              if (!key.endsWith("/source.mp4")) continue;
              const parts = key.split("/").filter(Boolean);
              if (parts.length < 3) continue;
              const jobId = parts[1];
              if (!UUID_V4_RE.test(jobId)) continue;
              items.push({
                jobId,
                lastModified: obj.LastModified
                  ? obj.LastModified.toISOString()
                  : null,
                size: typeof obj.Size === "number" ? obj.Size : 0,
              });
            }
            continuationToken = out.IsTruncated
              ? out.NextContinuationToken
              : undefined;
          } while (continuationToken);

          items.sort((a, b) => {
            const ta = a.lastModified ? new Date(a.lastModified).getTime() : 0;
            const tb = b.lastModified ? new Date(b.lastModified).getTime() : 0;
            return tb - ta;
          });

          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: true, items }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "highlight_delete": {
        const jobId = String(payload.jobId || "").trim();
        if (!jobId || !UUID_V4_RE.test(jobId)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "유효한 jobId가 필요합니다." }),
          };
        }
        try {
          const { s3, bucket } = videoEncodeAwsClients();
          const sourceKey = `jobs/${jobId}/source.mp4`;
          await s3.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey })
          );
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: true, jobId }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "highlight_preview": {
        const jobId = String(payload.jobId || "").trim();
        if (!jobId || !UUID_V4_RE.test(jobId)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "유효한 jobId가 필요합니다." }),
          };
        }
        try {
          const { s3, bucket } = videoEncodeAwsClients();
          const sourceKey = `jobs/${jobId}/source.mp4`;
          try {
            await s3.send(
              new HeadObjectCommand({ Bucket: bucket, Key: sourceKey })
            );
          } catch {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error:
                  "원본 영상이 S3에 없습니다. 먼저 하이라이트 업로드를 완료하세요.",
              }),
            };
          }
          const cmd = new GetObjectCommand({ Bucket: bucket, Key: sourceKey });
          const presignedGetUrl = await getSignedUrl(s3, cmd, {
            expiresIn: HIGHLIGHT_PREVIEW_PRESIGN_EXPIRES_SEC,
          });
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              jobId,
              previewUrl: presignedGetUrl,
              expiresIn: HIGHLIGHT_PREVIEW_PRESIGN_EXPIRES_SEC,
            }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "whisper_analyze": {
        const jobId = String(payload.jobId || "").trim();
        if (!jobId || !UUID_V4_RE.test(jobId)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "유효한 jobId가 필요합니다." }),
          };
        }
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error: "OPENAI_API_KEY가 설정되어 있지 않습니다.",
            }),
          };
        }
        try {
          const { s3, bucket, lambda, lambdaName } = videoEncodeAwsClients();
          const sourceKey = `jobs/${jobId}/source.mp4`;
          try {
            await s3.send(
              new HeadObjectCommand({ Bucket: bucket, Key: sourceKey })
            );
          } catch {
            return {
              statusCode: 400,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error:
                  "원본 영상이 S3에 없습니다. 먼저 하이라이트 업로드를 완료하세요.",
              }),
            };
          }

          const invokeOut = await lambda.send(
            new InvokeCommand({
              FunctionName: lambdaName,
              InvocationType: "RequestResponse",
              Payload: Buffer.from(
                JSON.stringify({
                  bucket,
                  jobId,
                  meta: { type: "extract_audio" },
                })
              ),
            })
          );
          const lamRaw = invokeOut.Payload
            ? Buffer.from(invokeOut.Payload).toString("utf8")
            : "";
          let lamResult;
          try {
            lamResult = lamRaw ? JSON.parse(lamRaw) : {};
          } catch {
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error: "Lambda 응답 JSON 파싱 실패",
              }),
            };
          }
          if (invokeOut.FunctionError) {
            const msg =
              lamResult?.errorMessage ||
              lamResult?.error ||
              lamRaw ||
              "Lambda extract_audio 실패";
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({ ok: false, error: String(msg) }),
            };
          }
          if (!lamResult?.ok || !lamResult?.presignedUrl) {
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error:
                  lamResult?.error ||
                  "오디오 추출(Lambda)에 실패했습니다.",
              }),
            };
          }

          const audioRes = await fetch(lamResult.presignedUrl);
          if (!audioRes.ok) {
            return {
              statusCode: 502,
              headers: corsHeaders(),
              body: JSON.stringify({
                ok: false,
                error: `S3에서 audio.mp3를 받지 못했습니다 (HTTP ${audioRes.status}).`,
              }),
            };
          }
          const audioBuffer = await audioRes.arrayBuffer();

          const formData = new FormData();
          formData.append(
            "file",
            new Blob([audioBuffer], { type: "audio/mpeg" }),
            "audio.mp3"
          );
          formData.append("model", "whisper-1");
          formData.append("language", "ko");
          formData.append("response_format", "verbose_json");
          formData.append("timestamp_granularities[]", "segment");

          const whisperRes = await fetch(
            "https://api.openai.com/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: formData,
            }
          );
          const whisperData = await whisperRes.json();
          if (!whisperRes.ok) {
            const errMsg =
              whisperData?.error?.message ||
              whisperData?.message ||
              `Whisper API 오류 (HTTP ${whisperRes.status})`;
            return {
              statusCode: whisperRes.status >= 400 && whisperRes.status < 500
                ? whisperRes.status
                : 502,
              headers: corsHeaders(),
              body: JSON.stringify({ ok: false, error: errMsg }),
            };
          }

          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              segments: whisperData.segments,
              text: whisperData.text,
            }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "cookie_upload": {
        try {
          const { s3, bucket } = videoEncodeAwsClients();
          const cmd = new PutObjectCommand({
            Bucket: bucket,
            Key: YOUTUBE_COOKIE_S3_KEY,
            ContentType: "text/plain; charset=utf-8",
          });
          const presignedPutUrl = await getSignedUrl(s3, cmd, {
            expiresIn: COOKIE_PRESIGN_EXPIRES_SEC,
          });
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: true,
              key: YOUTUBE_COOKIE_S3_KEY,
              bucket,
              presignedPutUrl,
            }),
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "youtube_cookie_status": {
        try {
          const { s3, bucket } = videoEncodeAwsClients();
          await s3.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: YOUTUBE_COOKIE_S3_KEY,
            })
          );
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: true, exists: true }),
          };
        } catch (e) {
          const sc = e?.$metadata?.httpStatusCode;
          const name = e?.name || e?.Code || "";
          if (sc === 404 || name === "NotFound") {
            return {
              statusCode: 200,
              headers: corsHeaders(),
              body: JSON.stringify({ ok: true, exists: false }),
            };
          }
          const msg = e instanceof Error ? e.message : String(e);
          return {
            statusCode: 500,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: msg }),
          };
        }
      }
      case "shorts_slides_data": {
        const dateStr = payload.date || isoSeoulToday();
        const gameDocs = await fetchGamesByDate(db, dateStr);
        const base = (gameDocs || []).map(slimGameResultRow);

        const __h2hCache = new Map();
        const __nextGameCache = new Map();
        const __starterEraCache = new Map();
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

          // MVP batter:
          // - 무승부(home_score === away_score)면 홈팀 1명 + 원정팀 1명
          // - 그 외엔 승리팀 1·2위(기존) — 홈런 우선, 동률이면 안타
          const batters = await fetchBattersForGame(db, gid);
          const hs = Number(g?.home_score);
          const as = Number(g?.away_score);
          const isDraw =
            Number.isFinite(hs) && Number.isFinite(as) ? hs === as : false;

          const scoreOneTeamTopBatter = (teamName) => {
            const team = String(teamName || "").trim();
            if (!team) return null;
            const teamBatters = (batters || []).filter((b) => {
              const bt = pickTeamName(b);
              return bt && (bt.includes(team) || team.includes(bt));
            });
            const scored = teamBatters.map((b) => {
              const hr = pickNum(b, ["hr", "HR", "home_run", "홈런"]);
              const h = pickNum(b, ["h", "H", "hits", "hit", "안타"]);
              return { b, hr, h };
            });
            scored.sort((a, b) => {
              if (b.hr !== a.hr) return b.hr - a.hr;
              return b.h - a.h;
            });
            const top = scored[0];
            if (!top) return null;
            return {
              name: pickPlayerName(top.b),
              team: pickTeamName(top.b),
              h: top.h,
              hr: top.hr,
              ab: pickNum(top.b, ["ab", "AB", "at_bats", "타수"]),
            };
          };

          let mvpBatters = [];
          if (isDraw) {
            const homeTop = scoreOneTeamTopBatter(g?.home_team);
            const awayTop = scoreOneTeamTopBatter(g?.away_team);
            mvpBatters = [homeTop, awayTop].filter(Boolean);
          } else {
            const homeWin = (g.home_score ?? 0) > (g.away_score ?? 0);
            const winTeam = homeWin ? g.home_team : g.away_team;

            const winBatters = (batters || []).filter((b) => {
              const bt = pickTeamName(b);
              return (
                bt && winTeam && (bt.includes(winTeam) || winTeam.includes(bt))
              );
            });
            const scoredBatters = winBatters.map((b) => {
              const hr = pickNum(b, ["hr", "HR", "home_run", "홈런"]);
              const h = pickNum(b, ["h", "H", "hits", "hit", "안타"]);
              return { b, hr, h };
            });
            scoredBatters.sort((a, b) => {
              if (b.hr !== a.hr) return b.hr - a.hr;
              return b.h - a.h;
            });
            const topBatters = scoredBatters.slice(0, 2);
            mvpBatters = topBatters.map(({ b, hr, h }) => ({
              name: pickPlayerName(b),
              team: pickTeamName(b),
              h,
              hr,
              ab: pickNum(b, ["ab", "AB", "at_bats", "타수"]),
            }));
          }
          const mvp = mvpBatters[0] ?? null;

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
            if (homeNextGame) {
              const hs = String(homeNextGame?.home_starter || "").trim();
              const as = String(homeNextGame?.away_starter || "").trim();
              const home_starter_era =
                hs && hs !== "미정"
                  ? await fetchLatestSeasonEraByPitcherName(
                      db,
                      2026,
                      hs,
                      __starterEraCache
                    )
                  : null;
              const away_starter_era =
                as && as !== "미정"
                  ? await fetchLatestSeasonEraByPitcherName(
                      db,
                      2026,
                      as,
                      __starterEraCache
                    )
                  : null;
              homeNextGame = {
                ...homeNextGame,
                home_starter_era,
                away_starter_era,
              };
            }
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
            if (awayNextGame) {
              const hs = String(awayNextGame?.home_starter || "").trim();
              const as = String(awayNextGame?.away_starter || "").trim();
              const home_starter_era =
                hs && hs !== "미정"
                  ? await fetchLatestSeasonEraByPitcherName(
                      db,
                      2026,
                      hs,
                      __starterEraCache
                    )
                  : null;
              const away_starter_era =
                as && as !== "미정"
                  ? await fetchLatestSeasonEraByPitcherName(
                      db,
                      2026,
                      as,
                      __starterEraCache
                    )
                  : null;
              awayNextGame = {
                ...awayNextGame,
                home_starter_era,
                away_starter_era,
              };
            }
            __nextGameCache.set(awayKey, awayNextGame ?? null);
          }

          const attachNextH2H = async (teamName, nextGameObj) => {
            if (!nextGameObj) return null;
            const teamKey = normalizeTeamKey(teamName || "");
            const nh = String(nextGameObj?.home_team || "");
            const na = String(nextGameObj?.away_team || "");
            const nhKey = normalizeTeamKey(nh);
            const naKey = normalizeTeamKey(na);
            const opponent =
              teamKey && nhKey === teamKey
                ? na
                : teamKey && naKey === teamKey
                  ? nh
                  : nh || na || "";
            if (!teamName || !opponent) return { ...nextGameObj, next_h2h: null };
            const key = `next_h2h:2026:${teamKey}__${normalizeTeamKey(opponent)}`;
            let rec = __h2hCache.get(key);
            if (!rec) {
              rec = await fetchHeadToHeadRecord(db, teamName, opponent, 2026);
              __h2hCache.set(key, rec);
            }
            return { ...nextGameObj, next_h2h: rec };
          };

          const homeNextGameWithH2h = await attachNextH2H(
            g?.home_team || "",
            homeNextGame
          );
          const awayNextGameWithH2h = await attachNextH2H(
            g?.away_team || "",
            awayNextGame
          );

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
            mvp_batters: mvpBatters,
            home_next_game: homeNextGameWithH2h ?? null,
            away_next_game: awayNextGameWithH2h ?? null,
            // Backward-compat: keep next_game but align with home team next game
            next_game: homeNextGameWithH2h ?? null,
          });
        }

        const gamesOrdered = sortGamesForDailyShortsRotation(games, dateStr);

        const { standings, year: standingsYear } = await fetchStandings2026Document(db);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            date: dateStr,
            games: gamesOrdered,
            standings,
            standingsYear,
          }),
        };
      }
      case "weekly_summary": {
        const from = safeIsoDate(payload.from_date || payload.fromDate || "");
        const to = safeIsoDate(payload.to_date || payload.toDate || "");
        if (!from || !to) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "Missing from_date or to_date (YYYY-MM-DD)" }),
          };
        }
        if (to < from) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "to_date must be >= from_date" }),
          };
        }

        const games = await fetchGamesDateRange(db, from, to);
        const weekly_games = buildWeeklyTeamRecords(games);

        const gameIds = (games || [])
          .map((g) => String(g?.game_id || g?.gameId || "").trim())
          .filter(Boolean);
        const uniqueGameIds = [...new Set(gameIds)];
        const box = await fetchBoxForGames(db, uniqueGameIds);

        const weekly_top_batters = buildWeeklyTopBatters(box.batters, 3);
        const weekly_top_pitchers = buildWeeklyTopPitchers(box.pitchers, 3);

        console.log("[weekly] from:", from, "to:", to);
        console.log("[weekly] games:", weekly_games?.length);
        console.log("[weekly] batters:", weekly_top_batters?.length);
        console.log("[weekly] pitchers:", weekly_top_pitchers?.length);

        const [prevStand, curStand] = await Promise.all([
          fetchClosestStandingsHistoryDoc(db, from),
          fetchClosestStandingsHistoryDoc(db, to),
        ]);
        const weekly_standings_diff = buildStandingsDiff(prevStand, curStand);

        const top5Teams = weekly_games.slice(0, 5).map((r) => r.team);
        const scheduleRows = await fetchScheduleFromDate(db, to);
        const next_week_highlights = pickNextWeekHighlights(scheduleRows, top5Teams, to, 3);

        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            from_date: from,
            to_date: to,
            weekly_games,
            weekly_top_batters,
            weekly_top_pitchers,
            weekly_standings_diff,
            next_week_highlights,
            debug: {
              games_found: Array.isArray(games) ? games.length : 0,
              standings_prev_doc: prevStand ? String(prevStand.id || "") : null,
              standings_cur_doc: curStand ? String(curStand.id || "") : null,
            },
          }),
        };
      }
      case "tomorrow_preview": {
        const dateStr = safeIsoDate(payload.date || "") || isoSeoulTomorrow();

        // standings 전체 + 팀별 순위/승/패/무 매핑
        const { standings, year: standingsYear } = await fetchStandings2026Document(db);
        const findRankRow = (teamName) => {
          const key = normalizeTeamKey(teamName || "");
          if (!key) return null;
          return (
            (standings || []).find((r) => {
              const tn = pickStr(r, ["team", "TEAM_NM", "team_name", "name", "club", "TEAM"]);
              return normalizeTeamKey(tn) === key;
            }) || null
          );
        };
        const toRankObj = (row) => {
          if (!row) return null;
          const rank = pickNum(row, ["rank", "RANK", "순위"]);
          const wins = pickNum(row, ["wins", "W", "win", "승", "WINS"]);
          const losses = pickNum(row, ["losses", "L", "loss", "패", "LOSSES"]);
          const draws = pickNum(row, ["draws", "D", "draw", "무", "DRAWS"]);
          return {
            rank: Number.isFinite(rank) && rank > 0 ? rank : null,
            wins: Number.isFinite(wins) ? wins : null,
            losses: Number.isFinite(losses) ? losses : null,
            draws: Number.isFinite(draws) ? draws : null,
          };
        };

        // schedule에서 내일 경기만 (비어 있으면 직전 스냅샷 schedule_prev)
        let rawRows = await fetchScheduleRowsForDate(db, dateStr);
        if (!rawRows?.length) {
          rawRows = await fetchScheduleRowsForDate(db, dateStr, "schedule_prev");
        }
        const byId = new Map();
        for (const r of rawRows || []) {
          const gid = String(r?.game_id ?? r?.gameId ?? "").trim();
          if (gid) byId.set(gid, { ...r, game_id: gid });
        }
        const rows = [...byId.values()].sort((a, b) =>
          String(a?.game_id || "").localeCompare(String(b?.game_id || ""))
        );

        // 2026 season games for derived stats (home/away record, last5 flow)
        const seasonYear = Number(standingsYear) || 2026;
        const seasonFrom = `${seasonYear}-01-01`;
        const seasonTo = `${seasonYear}-12-31`;
        const seasonGames = await fetchGamesDateRange(db, seasonFrom, seasonTo);

        // Build per-team game list (all opponents) for last5
        const gamesByTeam = new Map(); // team(full) -> [{ gd, isHome, hs, as }]
        const pushTeamGame = (team, item) => {
          if (!team) return;
          const list = gamesByTeam.get(team) || [];
          list.push(item);
          gamesByTeam.set(team, list);
        };

        const pickGameTeam = (g, side /* "home" | "away" */) => {
          if (!g || typeof g !== "object") return "";
          const raw =
            side === "home"
              ? g.home_team ?? g.home ?? g.homeTeam ?? ""
              : g.away_team ?? g.away ?? g.awayTeam ?? "";
          return normalizeTeamKey(raw || "");
        };
        const pickGameDate = (g) => safeIsoDate(g?.game_date || g?.gameDate || "");
        const pickScore = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const ensureRec = () => ({ win: 0, draw: 0, lose: 0 });

        const homeOnlyRecordByTeam = new Map(); // team(full) -> {win,draw,lose} when team is home
        const awayOnlyRecordByTeam = new Map(); // team(full) -> {win,draw,lose} when team is away

        for (const g of seasonGames || []) {
          const gd = pickGameDate(g);
          if (!gd) continue;
          const hTeam = pickGameTeam(g, "home");
          const aTeam = pickGameTeam(g, "away");
          if (!hTeam || !aTeam) continue;

          const hs = pickScore(g?.home_score);
          const as = pickScore(g?.away_score);
          if (hs == null || as == null) continue;

          pushTeamGame(hTeam, { gd, isHome: true, hs, as });
          pushTeamGame(aTeam, { gd, isHome: false, hs, as });

          // home-only record for home team
          const hr = homeOnlyRecordByTeam.get(hTeam) || ensureRec();
          if (hs === as) hr.draw += 1;
          else if (hs > as) hr.win += 1;
          else hr.lose += 1;
          homeOnlyRecordByTeam.set(hTeam, hr);

          // away-only record for away team
          const ar = awayOnlyRecordByTeam.get(aTeam) || ensureRec();
          if (hs === as) ar.draw += 1;
          else if (as > hs) ar.win += 1;
          else ar.lose += 1;
          awayOnlyRecordByTeam.set(aTeam, ar);
        }

        const last5ByTeam = new Map();
        for (const [team, list] of gamesByTeam.entries()) {
          const sortedDesc = [...list].sort((x, y) => String(y.gd).localeCompare(String(x.gd)));
          const out = [];
          for (const it of sortedDesc.slice(0, 5)) {
            const r =
              it.hs === it.as
                ? "무"
                : it.isHome
                  ? it.hs > it.as
                    ? "승"
                    : "패"
                  : it.as > it.hs
                    ? "승"
                    : "패";
            out.push(r);
          }
          last5ByTeam.set(team, out);
        }

        const __starterEraCache = new Map();

        const games = [];
        for (const r of rows) {
          const game_id = String(r?.game_id ?? r?.gameId ?? "").trim() || null;
          const game_date = String(safeIsoDate(r?.game_date || "") || dateStr).slice(0, 10);
          const game_time = pickStr(r, ["game_time", "gameTime", "time", "G_TM"]) || null;
          const venueRaw = pickStr(r, ["venue", "stadium", "S_NM"]) || "";
          const venue =
            venueRaw && typeof venueRaw === "string"
              ? VENUE_MAP[venueRaw.trim()] ||
                Object.entries(VENUE_MAP).find(([k]) => venueRaw.includes(k))?.[1] ||
                venueRaw.trim()
              : null;

          const home_team = pickStr(r, ["home_team", "homeTeam", "HOME_NM", "home_nm"]) || null;
          const away_team = pickStr(r, ["away_team", "awayTeam", "AWAY_NM", "away_nm"]) || null;

          const hs = r?.home_starter ?? r?.homeStarter ?? null;
          const as = r?.away_starter ?? r?.awayStarter ?? null;
          const home_starter =
            hs == null || String(hs).trim() === "" ? null : String(hs).replace(/\s+/g, " ").trim();
          const away_starter =
            as == null || String(as).trim() === "" ? null : String(as).replace(/\s+/g, " ").trim();

          const home_starter_era =
            home_starter == null
              ? null
              : await fetchLatestSeasonEraByPitcherName(
                  db,
                  seasonYear,
                  home_starter,
                  __starterEraCache
                );
          const away_starter_era =
            away_starter == null
              ? null
              : await fetchLatestSeasonEraByPitcherName(
                  db,
                  seasonYear,
                  away_starter,
                  __starterEraCache
                );

          const home_rank = toRankObj(findRankRow(home_team));
          const away_rank = toRankObj(findRankRow(away_team));

          const homeKey = normalizeTeamKey(home_team || "");
          const awayKey = normalizeTeamKey(away_team || "");
          const home_record = homeOnlyRecordByTeam.get(homeKey) || { win: 0, draw: 0, lose: 0 };
          const away_record = awayOnlyRecordByTeam.get(awayKey) || { win: 0, draw: 0, lose: 0 };
          const home_last5 = last5ByTeam.get(homeKey) || [];
          const away_last5 = last5ByTeam.get(awayKey) || [];

          const h2h = await fetchHeadToHeadRecord(
            db,
            normalizeTeamKey(home_team || ""),
            normalizeTeamKey(away_team || ""),
            standingsYear || 2026
          );
          // fetchHeadToHeadRecord는 teamA(=home) 기준 { win, draw, lose }를 반환
          // 슬라이드(drawTomorrowPreviewGameSlide)는 { home_wins, away_wins, draws }를 기대
          const head_to_head = {
            home_wins: Number(h2h?.win) || 0,
            away_wins: Number(h2h?.lose) || 0,
            draws: Number(h2h?.draw) || 0,
          };

          games.push({
            game_id,
            game_date,
            game_time,
            venue,
            home_team,
            away_team,
            home_starter,
            away_starter,
            home_starter_era,
            away_starter_era,
            home_rank,
            away_rank,
            head_to_head,
            home_record,
            away_record,
            home_last5,
            away_last5,
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
            standings,
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
      case "video_presets_list": {
        const filterType = payload.shorts_type;
        let snap;
        try {
          if (filterType && String(filterType) !== "all") {
            snap = await db
              .collection("video_presets")
              .where("shorts_type", "==", String(filterType))
              .get();
          } else {
            snap = await db.collection("video_presets").limit(500).get();
          }
        } catch (e) {
          console.warn("[video_presets_list]", e?.message || e);
          snap = { docs: [], empty: true };
        }
        const presets = (snap.docs || []).map((d) => ({ id: d.id, ...docSnap(d) }));
        presets.sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "ko")
        );
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            presets,
          }),
        };
      }
      case "video_presets_save": {
        const id = payload.id ? String(payload.id) : "";
        const name = String(payload.name || "").trim();
        const shorts_type = String(payload.shorts_type || "");
        if (!name) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "이름이 필요합니다." }),
          };
        }
        if (!["shorts1", "shorts2", "shorts3", "shorts4"].includes(shorts_type)) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({
              ok: false,
              error: "shorts_type이 올바르지 않습니다.",
            }),
          };
        }
        const slidesRaw =
          payload.slides && typeof payload.slides === "object" ? payload.slides : {};
        const slides = {};
        for (const [k, v] of Object.entries(slidesRaw)) {
          const n = Number(v);
          if (Number.isFinite(n)) slides[k] = n;
        }
        const transition = Number(payload.transition);
        const music_s3_key =
          payload.music_s3_key == null || String(payload.music_s3_key).trim() === ""
            ? null
            : String(payload.music_s3_key).trim();
        const music_name =
          payload.music_name == null || String(payload.music_name).trim() === ""
            ? null
            : String(payload.music_name).trim();
        const mv = Number(payload.music_volume);
        const music_volume = Number.isFinite(mv) ? Math.min(1, Math.max(0, mv)) : 0.8;
        const mst = Number(payload.music_start_time);
        const music_start_time = Number.isFinite(mst) ? Math.max(0, mst) : 0;
        const mfo = Number(payload.music_fade_out);
        const music_fade_out = Number.isFinite(mfo) ? Math.min(5, Math.max(0, mfo)) : 2;
        const data = {
          name,
          shorts_type,
          slides,
          transition: Number.isFinite(transition) ? transition : 0,
          music_s3_key,
          music_name,
          music_volume,
          music_start_time,
          music_fade_out,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (id) {
          await db.collection("video_presets").doc(id).set(data, { merge: true });
          return {
            statusCode: 200,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: true, action, id }),
          };
        }
        data.createdAt = admin.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection("video_presets").add(data);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ ok: true, action, id: ref.id }),
        };
      }
      case "video_presets_delete": {
        const delId = String(payload.id || "").trim();
        if (!delId) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "id가 필요합니다." }),
          };
        }
        await db.collection("video_presets").doc(delId).delete();
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ ok: true, action, id: delId }),
        };
      }
      case "music_list": {
        let snap;
        try {
          snap = await db.collection("music_library").limit(500).get();
        } catch (e) {
          console.warn("[music_list]", e?.message || e);
          snap = { docs: [], empty: true };
        }
        const tracks = (snap.docs || []).map((d) => ({ id: d.id, ...docSnap(d) }));
        tracks.sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "ko")
        );
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({
            ok: true,
            action,
            tracks,
          }),
        };
      }
      case "music_save": {
        const name = String(payload.name || "").trim();
        const s3_key = String(payload.s3_key || "").trim();
        const duration = Number(payload.duration);
        if (!name) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "이름이 필요합니다." }),
          };
        }
        if (!s3_key.startsWith("music/")) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "s3_key가 music/ 로 시작해야 합니다." }),
          };
        }
        if (!Number.isFinite(duration) || duration < 0) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "duration이 올바르지 않습니다." }),
          };
        }
        const data = {
          name,
          s3_key,
          duration,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const ref = await db.collection("music_library").add(data);
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ ok: true, action, id: ref.id }),
        };
      }
      case "music_delete": {
        const mid = String(payload.id || "").trim();
        if (!mid) {
          return {
            statusCode: 400,
            headers: corsHeaders(),
            body: JSON.stringify({ ok: false, error: "id가 필요합니다." }),
          };
        }
        await db.collection("music_library").doc(mid).delete();
        return {
          statusCode: 200,
          headers: corsHeaders(),
          body: JSON.stringify({ ok: true, action, id: mid }),
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
