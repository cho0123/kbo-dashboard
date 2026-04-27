/**
 * Netlify: 브라우저는 `/.netlify/functions/kbo-api` 를 직접 호출하는 것이 가장 안정적입니다.
 * `netlify.toml` 의 `/api/kbo` 리라이트는 백업으로 시도합니다.
 * 로컬 개발은 `netlify dev` 로 실행해야 함수 경로가 동작합니다.
 */
const KBO_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_KBO_API_URL) ||
  "";

async function postOnce(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) {
    throw new Error(
      `API 응답이 JSON이 아닙니다 (${url}, HTTP ${res.status}). ` +
        `Netlify 함수가 배포됐는지·경로가 맞는지 확인하세요.\n${raw.slice(0, 500)}`
    );
  }
  let json;
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`JSON 파싱 실패 (${url}): ${raw.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }
  if (json && json.ok === false && json.error) {
    throw new Error(json.error);
  }
  return json;
}

export async function postKbo(payload) {
  const candidates = [
    KBO_URL,
    "/.netlify/functions/kbo-api",
    "/api/kbo",
  ].filter(Boolean);
  const tried = [...new Set(candidates)];
  let last;
  for (const url of tried) {
    try {
      return await postOnce(url, payload);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export function seoulToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
