/** 썸네일/하이라이트 오버레이 캔버스용 — Shorts3ThumbnailPanel, Shorts3Panel 공통 */

export const TEAM_COLORS = {
  KIA: { bg: "#EA0029", accent: "#FFFFFF", label: "KIA 타이거즈" },
  삼성: { bg: "#0055A4", accent: "#C0C0C0", label: "삼성 라이온즈" },
  LG: { bg: "#C00C3F", accent: "#FFFFFF", label: "LG 트윈스" },
  두산: { bg: "#131230", accent: "#FFFFFF", label: "두산 베어스" },
  KT: { bg: "#000000", accent: "#EB1C24", label: "kt wiz" },
  SSG: { bg: "#CE0E2D", accent: "#FFD700", label: "SSG 랜더스" },
  롯데: { bg: "#042445", accent: "#EB1C24", label: "롯데 자이언츠" },
  한화: { bg: "#FF6600", accent: "#FFFFFF", label: "한화 이글스" },
  NC: { bg: "#1D467D", accent: "#BFA141", label: "NC 다이노스" },
  키움: { bg: "#7D0521", accent: "#FFFFFF", label: "키움 히어로즈" },
};

export const TEAM_LOGO_PATH = {
  KIA: "/logos/kia.svg",
  삼성: "/logos/samsung.svg",
  LG: "/logos/lg.svg",
  두산: "/logos/doosan.svg",
  KT: "/logos/kt.svg",
  SSG: "/logos/ssg.svg",
  롯데: "/logos/lotte.svg",
  한화: "/logos/hanwha.svg",
  NC: "/logos/nc.svg",
  키움: "/logos/kiwoom.svg",
};

/**
 * @param {object} opts
 * @param {string} opts.team
 * @param {{ bg: string, accent: string }} opts.tc
 * @param {string} [opts.text1]
 * @param {string} [opts.text2]
 * @param {string} [opts.font1] — NotoSansKR-Bold | BlackHanSans-Regular | NotoSerifKR-Bold
 * @param {string} [opts.font2]
 * @param {string} opts.textColor1
 * @param {string} opts.textColor2
 * @param {number} opts.fontSize1
 * @param {number} opts.fontSize2
 * @param {number} [opts.textY1] — 홀 영역 기준 세로 위치 0~100%
 * @param {number} [opts.textY2]
 * @param {boolean} [opts.showLine]
 * @param {HTMLCanvasElement} [opts.canvas]
 */
export async function drawThumbnail({
  team,
  tc,
  text1,
  text2,
  font1,
  font2,
  textColor1,
  textColor2,
  fontSize1,
  fontSize2,
  textY1,
  textY2,
  showLine,
  canvas: existingCanvas,
}) {
  const W = 1080;
  const H = 1920;
  const canvas = existingCanvas || document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: true });

  const TOP_BAR = 280;
  const SIDE_BAR = 40;
  const BOT_BAR = 160;
  const holeH = H - TOP_BAR - BOT_BAR;

  const innerFontFamilyMap = {
    "NotoSansKR-Bold": "'Noto Sans KR', sans-serif",
    "BlackHanSans-Regular": "'Black Han Sans', sans-serif",
    "NotoSerifKR-Bold": "'Noto Serif KR', serif",
    "GamjaFlower-Regular": "'Gamja Flower', cursive",
  };
  const ff = (k) =>
    innerFontFamilyMap[k] || innerFontFamilyMap["NotoSansKR-Bold"];

  const teamLabels = {
    KIA: "KIA 타이거즈",
    삼성: "삼성 라이온즈",
    LG: "LG 트윈스",
    두산: "두산 베어스",
    KT: "kt wiz",
    SSG: "SSG 랜더스",
    롯데: "롯데 자이언츠",
    한화: "한화 이글스",
    NC: "NC 다이노스",
    키움: "키움 히어로즈",
  };

  // 중앙 영상 영역은 처음부터 그리지 않아 투명 픽셀을 유지한다.
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = tc.bg;
  // 상단바
  ctx.fillRect(0, 0, W, TOP_BAR);
  // 하단바
  ctx.fillRect(0, H - BOT_BAR, W, BOT_BAR);
  // 좌측바
  ctx.fillRect(0, TOP_BAR, SIDE_BAR, H - TOP_BAR - BOT_BAR);
  // 우측바
  ctx.fillRect(W - SIDE_BAR, TOP_BAR, SIDE_BAR, H - TOP_BAR - BOT_BAR);

  const teamLabel = teamLabels[team] || team;
  ctx.font = `bold 52px 'Noto Sans KR', sans-serif`;
  const labelW = ctx.measureText(teamLabel).width + 80;
  const labelH = 80;
  const labelX = W / 2 - labelW / 2;
  const labelY = 120;
  const labelR = labelH / 2;

  ctx.fillStyle = tc.accent;
  ctx.beginPath();
  ctx.moveTo(labelX + labelR, labelY);
  ctx.lineTo(labelX + labelW - labelR, labelY);
  ctx.arcTo(labelX + labelW, labelY, labelX + labelW, labelY + labelH, labelR);
  ctx.lineTo(labelX + labelW, labelY + labelH - labelR);
  ctx.arcTo(
    labelX + labelW,
    labelY + labelH,
    labelX + labelW - labelR,
    labelY + labelH,
    labelR
  );
  ctx.lineTo(labelX + labelR, labelY + labelH);
  ctx.arcTo(labelX, labelY + labelH, labelX, labelY + labelH - labelR, labelR);
  ctx.lineTo(labelX, labelY + labelR);
  ctx.arcTo(labelX, labelY, labelX + labelR, labelY, labelR);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = tc.bg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(teamLabel, W / 2, labelY + labelH / 2);

  const holeCenterY = TOP_BAR + holeH / 2;
  const holeTextY = (pct) => TOP_BAR + (holeH * pct) / 100;
  const clampTextYPercent = (v) => Math.min(100, Math.max(0, Number(v)));
  const legacyText1Y = holeCenterY - fontSize1 / 2 - 30;
  const legacyText2Y = holeCenterY + fontSize2 / 2 + 50;
  const text1Y =
    textY1 != null && textY1 !== "" && Number.isFinite(Number(textY1))
      ? holeTextY(clampTextYPercent(textY1))
      : legacyText1Y;
  const text2Y =
    textY2 != null && textY2 !== "" && Number.isFinite(Number(textY2))
      ? holeTextY(clampTextYPercent(textY2))
      : legacyText2Y;

  ctx.fillStyle = textColor1;
  ctx.font = `bold ${fontSize1}px ${ff(font1)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(text1 || "", W / 2, text1Y);
  ctx.shadowBlur = 0;

  if (showLine) {
    const lineY = holeCenterY + 20;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(W * 0.25, lineY);
    ctx.lineTo(W * 0.75, lineY);
    ctx.stroke();
  }

  ctx.fillStyle = textColor2;
  ctx.font = `${fontSize2}px ${ff(font2)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 6;
  ctx.fillText(text2 || "", W / 2, text2Y);
  ctx.shadowBlur = 0;

  try {
    const logoSrc = TEAM_LOGO_PATH[team];
    if (!logoSrc) return canvas;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = logoSrc;
    });
    const LOGO_MAX = 160;
    const nw = img.naturalWidth || img.width || 1;
    const nh = img.naturalHeight || img.height || 1;
    const scale = Math.min(LOGO_MAX / nw, LOGO_MAX / nh);
    const logoW = nw * scale;
    const logoH = nh * scale;
    const logoX = SIDE_BAR - 10;
    const logoY = H - BOT_BAR - LOGO_MAX * 0.4;
    ctx.drawImage(img, logoX, logoY, logoW, logoH);
  } catch (e) {
    console.warn("로고 로드 실패:", e);
  }

  return canvas;
}

export const LAYOUT_TYPES = {
  KBO: "kbo",
  FULLSCREEN: "fullscreen",
  TOPBOTTOM: "topbottom",
};

const THUMB_FONT_FAMILY_MAP = {
  "NotoSansKR-Bold": "'Noto Sans KR', sans-serif",
  "BlackHanSans-Regular": "'Black Han Sans', sans-serif",
  "NotoSerifKR-Bold": "'Noto Serif KR', serif",
  "GamjaFlower-Regular": "'Gamja Flower', cursive",
};

function thumbFontFamily(key) {
  return THUMB_FONT_FAMILY_MAP[key] || THUMB_FONT_FAMILY_MAP["NotoSansKR-Bold"];
}

function createThumbCanvas(existingCanvas) {
  const W = 1080;
  const H = 1920;
  const canvas = existingCanvas || document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  return { canvas, ctx: canvas.getContext("2d", { alpha: true }), W, H };
}

/**
 * 풀스크린 — 1080×1920 전체 투명 PNG
 */
export async function drawThumbnailFullscreen({ canvas: existingCanvas } = {}) {
  const { canvas, ctx, W, H } = createThumbCanvas(existingCanvas);
  ctx.clearRect(0, 0, W, H);
  return canvas;
}

function normalizeBarColor(raw, fallback) {
  const s = String(raw || "").trim();
  return /^#[0-9A-Fa-f]{6}$/i.test(s) ? s.toLowerCase() : fallback;
}

/**
 * 상하바 — 상·하 400px 바, 가운데 1120px 투명 (로고·좌우 바·텍스트 없음)
 */
export async function drawThumbnailTopBottom({
  topBarColor = "#1a1a2e",
  bottomBarColor = "#16213e",
  canvas: existingCanvas,
} = {}) {
  const { canvas, ctx, W, H } = createThumbCanvas(existingCanvas);
  const TOP_BAR_H = 400;
  const BOT_BAR_H = 400;
  const topFill = normalizeBarColor(topBarColor, "#1a1a2e");
  const bottomFill = normalizeBarColor(bottomBarColor, "#16213e");

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = topFill;
  ctx.fillRect(0, 0, W, TOP_BAR_H);
  ctx.fillStyle = bottomFill;
  ctx.fillRect(0, H - BOT_BAR_H, W, BOT_BAR_H);

  return canvas;
}

/**
 * @param {string} layout — LAYOUT_TYPES 값
 * @param {object} opts — drawThumbnail과 동일 옵션
 */
export async function drawThumbnailByLayout(layout, opts) {
  const key = String(layout || LAYOUT_TYPES.KBO).trim().toLowerCase();
  if (key === LAYOUT_TYPES.FULLSCREEN) {
    return drawThumbnailFullscreen(opts);
  }
  if (key === LAYOUT_TYPES.TOPBOTTOM) {
    return drawThumbnailTopBottom({
      topBarColor: opts?.topBarColor,
      bottomBarColor: opts?.bottomBarColor,
      text1: opts?.text1,
      text2: opts?.text2,
      font1: opts?.font1,
      font2: opts?.font2,
      textColor1: opts?.textColor1,
      textColor2: opts?.textColor2,
      fontSize1: opts?.fontSize1,
      fontSize2: opts?.fontSize2,
      canvas: opts?.canvas,
    });
  }
  return drawThumbnail(opts);
}
