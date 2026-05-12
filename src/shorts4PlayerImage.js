/**
 * 쇼츠4 선발 선수 사진 — S3 `players/{팀}-{선수명}.png`
 */

const PLAYER_IMAGE_S3_BASE =
  "https://kbo-video-export.s3.ap-northeast-2.amazonaws.com/players/";

const __playerImgCache = new Map();
let __playerImgBust = 0;

function safeFileSegment(s) {
  return String(s || "")
    .trim()
    .replace(/[/\\?*:|"<>]/g, "")
    .replace(/\s+/g, "");
}

/** 업로드 직후 동일 키 이미지가 브라우저·메모리 캐시 없이 반영되도록 */
export function clearPlayerImageCache() {
  __playerImgCache.clear();
  __playerImgBust += 1;
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

  const qs = __playerImgBust > 0 ? `?v=${__playerImgBust}` : "";
  const url = `${PLAYER_IMAGE_S3_BASE}${teamSeg}-${nameSeg}.png${qs}`;
  if (__playerImgCache.has(url)) return await __playerImgCache.get(url);

  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  __playerImgCache.set(url, p);
  return await p;
}
