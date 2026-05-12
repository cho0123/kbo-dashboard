/**
 * 쇼츠4 선발 선수 사진 — public `/players/{팀}-{선수명}.png` (loadSvgLogo와 동일 패턴)
 */

const __playerImgCache = new Map();

function safeFileSegment(s) {
  return String(s || "")
    .trim()
    .replace(/[/\\?*:|"<>]/g, "")
    .replace(/\s+/g, "");
}

/**
 * @param {string} team 팀 키워드 (예: 삼성, LG) — teamKeyword 결과 권장
 * @param {string} playerName 선수명 (파일명 세그먼트)
 * @returns {Promise<HTMLImageElement | null>}
 */
export async function loadPlayerImage(team, playerName) {
  const teamSeg = safeFileSegment(team);
  const nameSeg = safeFileSegment(playerName);
  if (!teamSeg || !nameSeg || nameSeg === "미정") return null;

  const path = `/players/${teamSeg}-${nameSeg}.png`;
  if (__playerImgCache.has(path)) return await __playerImgCache.get(path);

  const p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = path;
  });
  __playerImgCache.set(path, p);
  return await p;
}
