/**
 * 쇼츠4 선발 선수 사진 — S3 `players/{팀}-{선수명}.png`
 */

import { postKbo } from "./api.js";

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
  __urlImgCache.clear();
  __naverProxyImgCache.clear();
  __playerImgBust += 1;
}

/** URL 기반 선수 이미지 로드 캐시 (네이버 사진 등 임의 URL용) */
const __urlImgCache = new Map();

/** Netlify `proxy_player_image` 경유 네이버 선수 사진 캐시 */
const __naverProxyImgCache = new Map();

/**
 * 임의의 절대 URL에서 선수 사진을 로드. crossOrigin="anonymous"로 캔버스 사용 안전.
 * CORS가 허용되지 않으면 onerror로 null 반환 (호출부에서 텍스트 폴백).
 * @param {string} url 절대 URL (예: 네이버 sports-phinf.pstatic.net/player/...)
 * @returns {Promise<HTMLImageElement | null>}
 */
export async function loadPlayerImageFromUrl(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  if (__urlImgCache.has(u)) return await __urlImgCache.get(u);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = u;
  });
  __urlImgCache.set(u, p);
  return await p;
}

/**
 * Netlify 함수로 네이버 선수 사진을 프록시해 Image로 로드 (캔버스 사용 안전).
 * @param {string} url `https://sports-phinf.pstatic.net/player/kbo/default/*.png`
 * @returns {Promise<HTMLImageElement | null>}
 */
export async function loadPlayerImageFromNaverProxy(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  if (__naverProxyImgCache.has(u)) return await __naverProxyImgCache.get(u);

  const p = (async () => {
    try {
      const res = await postKbo({ action: "proxy_player_image", url: u });
      if (!res || res.ok !== true || typeof res.data !== "string" || !res.data) {
        return null;
      }
      const mime = String(res.contentType || "image/png").trim() || "image/png";
      const dataUrl = `data:${mime};base64,${String(res.data).replace(/\s/g, "")}`;
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    } catch {
      return null;
    }
  })();
  __naverProxyImgCache.set(u, p);
  return await p;
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
