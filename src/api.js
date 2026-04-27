/**
 * Netlify: netlify.toml redirects /api/kbo → kbo-api function.
 * 로컬 개발은 `netlify dev` 로 실행해야 동일 경로가 동작합니다.
 */
export async function postKbo(payload) {
  const res = await fetch("/api/kbo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

export function seoulToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
