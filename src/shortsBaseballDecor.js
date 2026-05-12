const __pngImageCache = new Map();

async function loadPngImage(path) {
  const p = String(path || "").trim();
  if (!p) return null;
  if (__pngImageCache.has(p)) return await __pngImageCache.get(p);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = p;
  });
  __pngImageCache.set(p, promise);
  return await promise;
}

let __baseballDecorImg = null;

export async function loadShortsBaseballDecor() {
  if (!__baseballDecorImg) {
    __baseballDecorImg = await loadPngImage("/baseball.png");
  }
  return __baseballDecorImg;
}

export function drawBaseballBackground(ctx) {
  const baseballImg = __baseballDecorImg;
  if (!baseballImg) return;
  ctx.save();
  ctx.globalAlpha = 0.2;
  const size = 700;
  const centerX = 900;
  const centerY = 1400;
  ctx.drawImage(baseballImg, centerX - size / 2, centerY - size / 2, size, size);
  ctx.restore();
}

/** 쇼츠4 선발 슬라이드: 상·하 영역에 각각 야구공 (배경색 위, 로고·텍스트 아래) */
export function drawBaseballBackgroundStarter(ctx, w, h) {
  const baseballImg = __baseballDecorImg;
  if (!baseballImg || !baseballImg.complete) return;
  const drawOne = (cx, cy, size, a) => {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(baseballImg, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  };
  drawOne(w * 0.5, h * 0.26, 640, 0.2);
  drawOne(w * 0.5, h * 0.74, 640, 0.2);
}
