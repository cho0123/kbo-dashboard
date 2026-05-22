import { drawBaseballBackground } from "./shortsBaseballDecor.js";
import { teamKeyword, drawStandingsSlide, loadSvgLogo } from "./shorts1IntroStandingsDraw.js";
import { loadPlayerImage, drawableShorts4Portrait } from "./shorts4PlayerImage.js";

// 상수
const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";
const TEXT_MAIN = "#ffffff";
const TEXT_YELLOW = "#F9FF00";
const SHORTS_W = 1080;
const SHORTS_H = 1920;

const TEAM_STRONG_COLOR = {
  삼성: "#0055A4", LG: "#C0001C", KT: "#2B2B2B",
  SSG: "#CE0E2D", NC: "#071D49", 두산: "#131230",
  KIA: "#EA0029", 롯데: "#002B7F", 한화: "#FF6600", 키움: "#820024"
};

const TEAM_GRAD = {
  삼성: "#4ab0e8", LG: "#e85c5c", KT: "#728e98",
  SSG: "#e87a98", NC: "#4a86e8", 두산: "#9866e8",
  KIA: "#e8843a", 롯데: "#4a70e8", 한화: "#e8ac48", 키움: "#d870a0"
};

function getTeamColor(teamName) {
  const kw = teamKeyword(teamName);
  return TEAM_STRONG_COLOR[kw] || "#1a1a2e";
}

function getTeamGrad(teamName) {
  const kw = teamKeyword(teamName);
  return TEAM_GRAD[kw] || "#4a86e8";
}

function shadowText(ctx, text, x, y) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 8;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// 슬라이드 1: 인트로
export function drawPvIntroSlide(ctx, w, h, pitcher, pitcherTeam, batter, batterTeam, logosByTeamKey) {
  ctx.clearRect(0, 0, w, h);

  // 배경: 상단 투수팀 / 하단 타자팀 대각 분할
  const pitcherColor = getTeamColor(pitcherTeam);
  const batterColor = getTeamColor(batterTeam);

  // 상단 삼각형 (투수팀)
  ctx.fillStyle = pitcherColor;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, 0);
  ctx.lineTo(w, h * 0.5); ctx.lineTo(0, h * 0.5);
  ctx.closePath(); ctx.fill();

  // 하단 삼각형 (타자팀)
  ctx.fillStyle = batterColor;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
  ctx.lineTo(w, h); ctx.lineTo(0, h);
  ctx.closePath(); ctx.fill();

  drawBaseballBackground(ctx);

  // 흰 구분선
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5);
  ctx.stroke();

  // 투수팀 로고
  const pkw = teamKeyword(pitcherTeam);
  const pitcherLogo = logosByTeamKey?.[pkw];
  if (pitcherLogo) {
    ctx.drawImage(pitcherLogo, w/2 - 120, h * 0.12, 240, 240);
  }

  // 타자팀 로고
  const bkw = teamKeyword(batterTeam);
  const batterLogo = logosByTeamKey?.[bkw];
  if (batterLogo) {
    ctx.drawImage(batterLogo, w/2 - 120, h * 0.58, 240, 240);
  }

  // VS 텍스트
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold 90px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_YELLOW;
  shadowText(ctx, "VS", w/2, h * 0.5);

  // 투수명
  ctx.font = `bold 72px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, pitcher, w/2, h * 0.38);

  // 타자명
  ctx.font = `bold 72px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, batter, w/2, h * 0.84);

  // 하단 라벨
  ctx.font = `500 44px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_YELLOW;
  shadowText(ctx, "투수 VS 타자 상대전적", w/2, h * 0.93);
}

// 슬라이드 2: 투수 프로필
export function drawPvPitcherSlide(ctx, w, h, pitcher, pitcherTeam, pitcherImg, logosByTeamKey, seasonData) {
  ctx.clearRect(0, 0, w, h);

  const color = getTeamColor(pitcherTeam);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color);
  grad.addColorStop(1, getTeamGrad(pitcherTeam));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  // 팀 로고
  const pkw = teamKeyword(pitcherTeam);
  const logo = logosByTeamKey?.[pkw];
  if (logo) ctx.drawImage(logo, 40, 60, 110, 110);

  // 헤더
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 44px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, "⚾ 투수 프로필", w/2, 115);

  // 선수 사진
  if (pitcherImg && drawableShorts4Portrait(pitcherImg)) {
    const imgW = 420, imgH = 480;
    ctx.drawImage(pitcherImg, (w - imgW) / 2, 180, imgW, imgH);
  }

  // 선수명
  ctx.font = `bold 80px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_YELLOW;
  ctx.textAlign = "center";
  shadowText(ctx, pitcher, w/2, 730);

  // 팀명
  ctx.font = `500 44px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, pitcherTeam, w/2, 800);

  if (!seasonData) {
    ctx.font = `500 38px ${FONT_BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    shadowText(ctx, "시즌 데이터 로딩 중...", w/2, 900);
    return;
  }

  // 구분선
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(60, 850); ctx.lineTo(w - 60, 850);
  ctx.stroke();

  // 스탯 라인 (5줄)
  const statLines = [
    `ERA ${seasonData.era ?? "—"}  |  ${seasonData.games ?? 0}경기  |  QS ${seasonData.qs ?? 0}`,
    `${seasonData.wins ?? 0}승 ${seasonData.losses ?? 0}패  |  승률 ${
      (seasonData.wins + seasonData.losses) > 0
        ? ((seasonData.wins / (seasonData.wins + seasonData.losses)) * 100).toFixed(1) + "%"
        : "—"
    }`,
    `이닝 ${seasonData.total_ip ?? "—"}  |  WHIP ${seasonData.whip != null && Number.isFinite(Number(seasonData.whip)) ? Number(seasonData.whip).toFixed(2) : "—"}`,
    `삼진 ${seasonData.so ?? 0}  |  볼넷 ${seasonData.bb ?? 0}  |  피안타 ${seasonData.h ?? 0}`,
    `피홈런 ${seasonData.hr ?? 0}  |  자책 ${seasonData.er ?? 0}`,
  ];

  const lineH = 90;
  const startY = 900;
  statLines.forEach((line, i) => {
    ctx.font = `500 40px ${FONT_BODY}`;
    ctx.fillStyle = i === 0 ? TEXT_YELLOW : TEXT_MAIN;
    ctx.textAlign = "center";
    shadowText(ctx, line, w/2, startY + i * lineH);
  });

  // 시즌 순위 배지
  if (seasonData.ranks) {
    const badges = [];
    const r = seasonData.ranks;
    if (r.win_rank  && r.win_rank  <= 20) badges.push({ label: `승 ${r.win_rank}위`,  color: "#FFD700" });
    if (r.era_rank  && r.era_rank  <= 20) badges.push({ label: `ERA ${r.era_rank}위`, color: "#4a86e8" });
    if (r.whip_rank && r.whip_rank <= 20) badges.push({ label: `WHIP ${r.whip_rank}위`,color: "#4a86e8" });
    if (r.ip_rank   && r.ip_rank   <= 20) badges.push({ label: `이닝 ${r.ip_rank}위`, color: "#27ae60" });

    if (badges.length > 0) {
      const badgeW = 180, badgeH = 54, gap = 16;
      const totalW = badges.length * badgeW + (badges.length - 1) * gap;
      let bx = (w - totalW) / 2;
      const by = startY + statLines.length * lineH + 20;

      badges.forEach(b => {
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.roundRect(bx, by, badgeW, badgeH, 27);
        ctx.fill();
        ctx.font = `bold 30px ${FONT_BODY}`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        shadowText(ctx, b.label, bx + badgeW / 2, by + badgeH / 2);
        bx += badgeW + gap;
      });
    }
  }
}

// 슬라이드 3: 타자 프로필
export function drawPvBatterSlide(ctx, w, h, batter, batterTeam, batterImg, logosByTeamKey) {
  ctx.clearRect(0, 0, w, h);

  const color = getTeamColor(batterTeam);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color);
  grad.addColorStop(1, getTeamGrad(batterTeam));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  const bkw = teamKeyword(batterTeam);
  const logo = logosByTeamKey?.[bkw];
  if (logo) ctx.drawImage(logo, 40, 80, 120, 120);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 48px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, "🏏 타자 프로필", w/2, 140);

  if (batterImg && drawableShorts4Portrait(batterImg)) {
    const imgW = 480, imgH = 540;
    ctx.drawImage(batterImg, (w - imgW) / 2, 280, imgW, imgH);
  }

  ctx.font = `bold 88px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_YELLOW;
  ctx.textAlign = "center";
  shadowText(ctx, batter, w/2, 900);

  ctx.font = `500 52px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, batterTeam, w/2, 980);

  ctx.font = `500 44px ${FONT_BODY}`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  shadowText(ctx, "시즌 상대전적 기록", w/2, 1080);
}

// 슬라이드 4: 상대전적 통계
export function drawPvStatsSlide(ctx, w, h, pitcher, pitcherTeam, batter, batterTeam, stats, logosByTeamKey) {
  ctx.clearRect(0, 0, w, h);

  // 배경: 다크 그라데이션
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0d1b2a");
  grad.addColorStop(1, "#1a1a2e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  // 헤더
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 48px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_YELLOW;
  shadowText(ctx, "📊 상대전적 통계", w/2, 140);

  // 투수 vs 타자
  ctx.font = `bold 60px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, `${pitcher} vs ${batter}`, w/2, 240);

  if (!stats) {
    ctx.font = `500 44px ${FONT_BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    shadowText(ctx, "데이터 없음", w/2, h/2);
    return;
  }

  // 스탯 카드
  const statItems = [
    { label: "타율", value: stats.avg || "—" },
    { label: "타수", value: String(stats.ab ?? "—") },
    { label: "안타", value: String(stats.h ?? "—") },
    { label: "홈런", value: String(stats.hr ?? "—") },
    { label: "볼넷", value: String(stats.bb ?? "—") },
    { label: "삼진", value: String(stats.so ?? "—") },
  ];

  const colW = w / 2 - 40;
  const rowH = 220;
  const startY = 360;

  statItems.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 40 : w / 2 + 20;
    const y = startY + row * rowH;

    // 카드 배경
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(x, y, colW, rowH - 20, 16);
    ctx.fill();

    // 라벨
    ctx.font = `500 40px ${FONT_BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "center";
    shadowText(ctx, item.label, x + colW/2, y + 60);

    // 값
    ctx.font = `bold 80px ${FONT_TITLE}`;
    ctx.fillStyle = item.label === "타율" && parseFloat(item.value) >= 0.3
      ? TEXT_YELLOW : TEXT_MAIN;
    shadowText(ctx, item.value, x + colW/2, y + 150);
  });
}

// 슬라이드 5: 경기별 타임라인
export function drawPvTimelineSlide(ctx, w, h, pitcher, batter, rows) {
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0d1b2a");
  grad.addColorStop(1, "#1a1a2e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  drawBaseballBackground(ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 48px ${FONT_BODY}`;
  ctx.fillStyle = TEXT_YELLOW;
  shadowText(ctx, "📅 경기별 기록", w/2, 140);

  ctx.font = `bold 52px ${FONT_TITLE}`;
  ctx.fillStyle = TEXT_MAIN;
  shadowText(ctx, `${pitcher} vs ${batter}`, w/2, 230);

  if (!rows || rows.length === 0) {
    ctx.font = `500 44px ${FONT_BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    shadowText(ctx, "경기 기록 없음", w/2, h/2);
    return;
  }

  // 최대 8경기 표시
  const displayRows = rows.slice(0, 8);
  const rowH = 180;
  const startY = 320;

  displayRows.forEach((row, i) => {
    const y = startY + i * rowH;

    // 행 배경
    ctx.fillStyle = i % 2 === 0
      ? "rgba(255,255,255,0.06)"
      : "rgba(255,255,255,0.03)";
    ctx.fillRect(40, y, w - 80, rowH - 10);

    // 날짜
    ctx.font = `500 36px ${FONT_BODY}`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.textAlign = "left";
    ctx.fillText(row.date || "", 60, y + 45);

    // 상대
    ctx.fillStyle = TEXT_YELLOW;
    ctx.fillText(row.opponent_label || "", 60, y + 90);

    // 타자 성적
    ctx.font = `500 38px ${FONT_BODY}`;
    ctx.fillStyle = TEXT_MAIN;
    ctx.textAlign = "right";
    ctx.fillText(row.batter_stats || "", w - 60, y + 70);
  });
}
