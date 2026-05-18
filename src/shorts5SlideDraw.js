/**
 * 쇼츠5 — 팀별 주간결산 슬라이드 (쇼츠1~4 미수정)
 */
import { teamKeyword } from "./shorts1IntroStandingsDraw.js";

const FONT_TITLE = "Black Han Sans";
const FONT_BODY = "Noto Sans KR";

const TEAM_STRONG_COLOR = {
  삼성: "#0055A4",
  LG: "#C0001C",
  KT: "#2B2B2B",
  SSG: "#CE0E2D",
  NC: "#071D49",
  두산: "#131230",
  KIA: "#EA0029",
  롯데: "#002B7F",
  한화: "#FF6600",
  키움: "#820024",
};

function getTeamStrongColor(teamName) {
  const kw = teamKeyword(teamName);
  return (kw && TEAM_STRONG_COLOR[kw]) || "#131922";
}

function fmtTeamShort(team) {
  const t = String(team || "").trim();
  if (!t) return "—";
  return t.split(/\s+/)[0].slice(0, 6);
}

function shadowText(ctx) {
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
}

function resetShadow(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function drawLogoInBox(ctx, x, y, boxW, boxH, teamName, img) {
  if (img && img.width > 0) {
    const iw = img.width;
    const ih = img.height;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
    return;
  }
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.beginPath();
  ctx.arc(x + boxW / 2, y + boxH / 2, boxW * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `900 72px "${FONT_TITLE}", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fmtTeamShort(teamName), x + boxW / 2, y + boxH / 2);
  ctx.restore();
}

function fmtRankChange(rankChange) {
  const d = rankChange?.diff;
  if (d == null || !Number.isFinite(Number(d))) return "순위 —";
  const n = Number(d);
  if (n > 0) return `▲${n}`;
  if (n < 0) return `▼${Math.abs(n)}`;
  return "—";
}

/** slide1: 인트로 */
export function drawShorts5IntroSlide(ctx, w, h, data, logoImg) {
  const team = data?.team_name || data?.team_keyword || "팀";
  ctx.clearRect(0, 0, w, h);
  const bg = getTeamStrongColor(team);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, "#0a0e14");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const logoBox = 420;
  drawLogoInBox(ctx, (w - logoBox) / 2, h * 0.22, logoBox, logoBox, team, logoImg);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(data?.week_label || ""), w / 2, h * 0.58);
  resetShadow(ctx);

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 120px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText("주간결산", w / 2, h * 0.72);
  resetShadow(ctx);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `700 56px "${FONT_BODY}", sans-serif`;
  ctx.fillText(fmtTeamShort(team), w / 2, h * 0.86);
}

/** slide2: 경기 결과(상단) + 주간 팀성적(하단) */
export function drawShorts5RecordSlide(ctx, w, h, data, logoImg) {
  const team = data?.team_name || "";
  const rec = data?.week_record || {};
  const wins = Number(rec.wins) || 0;
  const losses = Number(rec.losses) || 0;
  const rc = data?.rank_change || {};

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1628";
  ctx.fillRect(0, 0, w, h);

  const splitY = h / 2;
  const halfScale = 0.5;
  const padX = 56;

  const games = Array.isArray(data?.games) ? data.games : [];

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, splitY);
  ctx.clip();
  ctx.scale(1, halfScale);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 64px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("경기 결과", w / 2, 120);

  const rowH = 130;
  const y0 = 220;
  const maxRows = 8;
  const list = games.slice(-maxRows);

  if (!list.length) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `700 44px "${FONT_BODY}", sans-serif`;
    ctx.fillText("해당 주간 경기 없음", w / 2, h / 2);
  } else {
    ctx.textAlign = "left";
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      const y = y0 + i * rowH;
      const result = g.result === "win" ? "승" : g.result === "loss" ? "패" : "무";
      const resultColor =
        g.result === "win" ? "#4ade80" : g.result === "loss" ? "#f87171" : "#94a3b8";
      const opp = fmtTeamShort(g.opponent);
      const score = `${g.team_score ?? "—"} : ${g.opp_score ?? "—"}`;
      const dateStr = String(g.game_date || "").slice(5).replace("-", "/");
      const homeMark = g.is_home ? "홈" : "원정";

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.roundRect(padX, y, w - padX * 2, rowH - 16, 20);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = `600 32px "${FONT_BODY}", sans-serif`;
      ctx.fillText(`${dateStr} ${homeMark}`, padX + 24, y + 36);

      ctx.fillStyle = "#ffffff";
      ctx.font = `800 48px "${FONT_BODY}", sans-serif`;
      ctx.fillText(`${opp}  ${score}`, padX + 24, y + 88);

      ctx.textAlign = "right";
      ctx.fillStyle = resultColor;
      ctx.font = `900 52px "${FONT_TITLE}", sans-serif`;
      ctx.fillText(result, w - padX - 24, y + 72);
      ctx.textAlign = "left";
    }
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, splitY);
  ctx.lineTo(w - padX, splitY);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, splitY, w, h - splitY);
  ctx.clip();
  ctx.translate(0, splitY);
  ctx.scale(1, halfScale);

  drawLogoInBox(ctx, w / 2 - 90, 120, 180, 180, team, logoImg);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `700 52px "${FONT_BODY}", sans-serif`;
  ctx.fillText(String(data?.week_label || ""), w / 2, 340);

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 140px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(`${wins}승 ${losses}패`, w / 2, h * 0.48);
  resetShadow(ctx);

  const rankLine =
    rc.current_rank != null
      ? `현재 ${rc.current_rank}위  ${fmtRankChange(rc)}`
      : "순위 정보 없음";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  ctx.fillText(rankLine, w / 2, h * 0.62);

  if (rc.prev_rank != null && rc.current_rank != null) {
    ctx.font = `600 40px "${FONT_BODY}", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillText(`전주 ${rc.prev_rank}위 → 이번주 ${rc.current_rank}위`, w / 2, h * 0.72);
  }

  ctx.restore();
}

/** slide3: 타격 하이라이트 */
export function drawShorts5BattingSlide(ctx, w, h, data) {
  const b = data?.top_batter;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1a2840";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 72px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("타격 하이라이트", w / 2, 200);

  if (!b?.player) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText("주간 타자 기록 없음", w / 2, h / 2);
    return;
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 96px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(b.player), w / 2, h * 0.42);
  resetShadow(ctx);

  const hr = Number(b.hr) || 0;
  const hits = Number(b.h) || 0;
  const rbi = Number(b.rbi) || 0;
  const avg =
    b.avg != null && Number.isFinite(Number(b.avg))
      ? Number(b.avg).toFixed(3).replace(/^0/, "")
      : "—";

  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const statLine = hr > 0 ? `${hr}홈런  ${hits}안타  ${rbi}타점` : `${hits}안타  ${rbi}타점  타율 ${avg}`;
  ctx.fillText(statLine, w / 2, h * 0.58);
}

/** slide4: 투수 하이라이트 */
export function drawShorts5PitcherSlide(ctx, w, h, data) {
  const p = data?.top_pitcher;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#142018";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#7fd4a8";
  ctx.font = `800 72px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("투수 하이라이트", w / 2, 200);

  if (!p?.player) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText("주간 투수 기록 없음", w / 2, h / 2);
    return;
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = `900 96px "${FONT_TITLE}", sans-serif`;
  shadowText(ctx);
  ctx.fillText(String(p.player), w / 2, h * 0.42);
  resetShadow(ctx);

  const ip = p.ip != null ? String(p.ip) : "—";
  const era = p.era != null ? Number(p.era).toFixed(2) : "—";
  const wins = Number(p.wins) || 0;
  ctx.font = `800 64px "${FONT_BODY}", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const statLine =
    p.era != null ? `ERA ${era}  ${ip}이닝  ${wins}승` : `${ip}이닝  ${wins}승`;
  ctx.fillText(statLine, w / 2, h * 0.58);
}

/** slide5: 경기 결과 목록 */
export function drawShorts5GamesSlide(ctx, w, h, data) {
  const games = Array.isArray(data?.games) ? data.games : [];
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f141c";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 64px "${FONT_TITLE}", sans-serif`;
  ctx.fillText("경기 결과", w / 2, 120);

  const padX = 56;
  const rowH = 130;
  const y0 = 220;
  const maxRows = 8;
  const list = games.slice(-maxRows);

  if (!list.length) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `700 44px "${FONT_BODY}", sans-serif`;
    ctx.fillText("해당 주간 경기 없음", w / 2, h / 2);
    return;
  }

  ctx.textAlign = "left";
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const y = y0 + i * rowH;
    const result = g.result === "win" ? "승" : g.result === "loss" ? "패" : "무";
    const resultColor =
      g.result === "win" ? "#4ade80" : g.result === "loss" ? "#f87171" : "#94a3b8";
    const opp = fmtTeamShort(g.opponent);
    const score = `${g.team_score ?? "—"} : ${g.opp_score ?? "—"}`;
    const dateStr = String(g.game_date || "").slice(5).replace("-", "/");
    const homeMark = g.is_home ? "홈" : "원정";

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(padX, y, w - padX * 2, rowH - 16, 20);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `600 32px "${FONT_BODY}", sans-serif`;
    ctx.fillText(`${dateStr} ${homeMark}`, padX + 24, y + 36);

    ctx.fillStyle = "#ffffff";
    ctx.font = `800 48px "${FONT_BODY}", sans-serif`;
    ctx.fillText(`${opp}  ${score}`, padX + 24, y + 88);

    ctx.textAlign = "right";
    ctx.fillStyle = resultColor;
    ctx.font = `900 52px "${FONT_TITLE}", sans-serif`;
    ctx.fillText(result, w - padX - 24, y + 72);
    ctx.textAlign = "left";
  }
}

/** slide6: KBO 순위표 — drawStandingsSlide 위임용 메타만 (패널에서 drawStandingsSlide 호출) */
export function shorts5StandingsDateLabel(data) {
  return String(data?.week_end || data?.week_start || "").slice(0, 10);
}
