import "dotenv/config";
import admin from "firebase-admin";

function parseServiceAccountJson(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    throw new Error("Missing env FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(
      `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
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

async function main() {
  const db = initFirestore();

  const snap = await db
    .collection("games")
    .where("home_score", "==", 0)
    .where("away_score", "==", 0)
    .get();

  console.log(
    JSON.stringify(
      {
        query: { home_score: 0, away_score: 0 },
        count: snap.size,
      },
      null,
      2
    )
  );

  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const g of docs) {
    console.log(
      JSON.stringify(
        {
          game_id: g.game_id ?? g.gameId ?? g.id,
          game_date: g.game_date ?? g.gameDate ?? null,
          home_team: g.home_team ?? g.homeTeam ?? null,
          away_team: g.away_team ?? g.awayTeam ?? null,
          full: g,
        },
        null,
        2
      )
    );
  }

  // Ensure Node exits even if SDK keeps sockets open
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

