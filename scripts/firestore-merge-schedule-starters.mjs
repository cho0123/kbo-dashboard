import "dotenv/config";
import admin from "firebase-admin";

function parseServiceAccountJson(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("Missing env FIREBASE_SERVICE_ACCOUNT_JSON");
  return JSON.parse(s);
}

function initFirestore() {
  if (admin.apps.length) return admin.firestore();
  const serviceAccount = parseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  return admin.firestore();
}

const UPDATES = [
  {
    game_id: "20260508HTLT0",
    away_starter: "황동하",
    home_starter: "나균안",
  },
  {
    game_id: "20260508KTWOO",
    away_starter: "오원석",
    home_starter: "안우진",
  },
  {
    game_id: "20260508LGHH0",
    away_starter: "송승기",
    home_starter: "박준영",
  },
  {
    game_id: "20260508SKNC0",
    away_starter: "베니지아노",
    home_starter: "벤자민",
  },
  {
    game_id: "20260508SSLG0",
    away_starter: "장찬희",
    home_starter: "목지훈",
  },
];

async function main() {
  const db = initFirestore();
  const col = db.collection("schedule");

  const batch = db.batch();
  for (const u of UPDATES) {
    const gid = String(u.game_id || "").trim();
    if (!gid) continue;
    const ref = col.doc(gid);
    batch.set(
      ref,
      {
        away_starter: u.away_starter ?? null,
        home_starter: u.home_starter ?? null,
      },
      { merge: true }
    );
  }
  await batch.commit();

  console.log(
    JSON.stringify(
      { ok: true, updated: UPDATES.map((u) => u.game_id) },
      null,
      2
    )
  );

  await admin.app().delete();
}

main().catch(async (err) => {
  console.error(err);
  try {
    if (admin.apps.length) await admin.app().delete();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});

