/** 썸네일/하이라이트 오버레이 캔버스용 — Shorts3ThumbnailPanel, Shorts3Panel 공통 */

export const TEAM_COLORS = {
  KIA: { bg: "#EA0029", accent: "#FFFFFF", label: "KIA 타이거즈" },
  삼성: { bg: "#074CA1", accent: "#C0C0C0", label: "삼성 라이온즈" },
  LG: { bg: "#C30452", accent: "#FFFFFF", label: "LG 트윈스" },
  두산: { bg: "#131230", accent: "#FFFFFF", label: "두산 베어스" },
  KT: { bg: "#000000", accent: "#EB1C24", label: "kt wiz" },
  SSG: { bg: "#CE0E2D", accent: "#FFD700", label: "SSG 랜더스" },
  롯데: { bg: "#041E42", accent: "#EB1C24", label: "롯데 자이언츠" },
  한화: { bg: "#FF6600", accent: "#FFFFFF", label: "한화 이글스" },
  NC: { bg: "#071D5B", accent: "#BFA141", label: "NC 다이노스" },
  키움: { bg: "#570514", accent: "#FFFFFF", label: "키움 히어로즈" },
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
  canvas: existingCanvas,
}) {
  const W = 1080;
  const H = 1920;
  const canvas = existingCanvas || document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const TOP_BAR = 280;
  const SIDE_BAR = 40;
  const BOT_BAR = 160;
  const RADIUS = 48;

  const holeX = SIDE_BAR;
  const holeY = TOP_BAR;
  const holeW = W - SIDE_BAR * 2;
  const holeH = H - TOP_BAR - BOT_BAR;

  const innerFontFamilyMap = {
    "NotoSansKR-Bold": "'Noto Sans KR', sans-serif",
    "BlackHanSans-Regular": "'Black Han Sans', sans-serif",
    "NotoSerifKR-Bold": "'Noto Serif KR', serif",
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

  ctx.fillStyle = tc.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(holeX, holeY);
  ctx.lineTo(holeX + holeW, holeY);
  ctx.lineTo(holeX + holeW, holeY + holeH - RADIUS);
  ctx.arcTo(
    holeX + holeW,
    holeY + holeH,
    holeX + holeW - RADIUS,
    holeY + holeH,
    RADIUS
  );
  ctx.lineTo(holeX + RADIUS, holeY + holeH);
  ctx.arcTo(holeX, holeY + holeH, holeX, holeY + holeH - RADIUS, RADIUS);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

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

  ctx.fillStyle = textColor1;
  ctx.font = `bold ${fontSize1}px ${ff(font1)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(text1 || "", W / 2, holeCenterY - fontSize1 / 2 - 30);
  ctx.shadowBlur = 0;

  const lineY = holeCenterY + 20;
  ctx.strokeStyle = tc.accent;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(W * 0.25, lineY);
  ctx.lineTo(W * 0.75, lineY);
  ctx.stroke();

  ctx.fillStyle = textColor2;
  ctx.font = `${fontSize2}px ${ff(font2)}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 6;
  ctx.fillText(text2 || "", W / 2, lineY + fontSize2 / 2 + 30);
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
