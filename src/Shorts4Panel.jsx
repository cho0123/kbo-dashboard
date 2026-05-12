import { useCallback, useMemo, useState } from "react";
import { postKbo, seoulToday } from "./api.js";
import "./Shorts4Panel.css";

function fmtWdl(rec) {
  if (!rec || typeof rec !== "object") return "—";
  const w = Number(rec.win);
  const d = Number(rec.draw);
  const l = Number(rec.lose);
  const parts = [];
  if (Number.isFinite(w)) parts.push(`${w}승`);
  if (Number.isFinite(d) && d > 0) parts.push(`${d}무`);
  if (Number.isFinite(l)) parts.push(`${l}패`);
  return parts.length ? parts.join(" ") : "—";
}

function fmtRankLine(rankObj) {
  if (!rankObj || typeof rankObj !== "object") return "순위 —";
  const r = Number(rankObj.rank);
  if (Number.isFinite(r) && r > 0) return `${r}위`;
  return "순위 —";
}

function fmtLast5(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.join(" ");
}

function fmtEra(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return n.toFixed(2);
  return String(v);
}

function fmtNum(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return String(n);
  return String(v);
}

function sortLineup(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
}

function LineupTable({ title, rows }) {
  const sorted = sortLineup(rows);
  return (
    <div>
      <div className="shorts4-subtitle">{title}</div>
      <table className="shorts4-lineup-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th className="pos">포</th>
            <th>타자</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted shorts4-lineup-note">
                라인업 없음
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr key={`${row.order}-${row.player}-${i}`}>
                <td className="num">{row.order || i + 1}</td>
                <td className="pos">{row.pos || "—"}</td>
                <td>{row.player || "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function GameCard({ game }) {
  if (!game) return null;

  const h2h = game.head_to_head || {};
  const hw = Number(h2h.home_wins) || 0;
  const aw = Number(h2h.away_wins) || 0;
  const dr = Number(h2h.draws) || 0;
  const hName = game.home_team || "홈";
  const aName = game.away_team || "원정";

  return (
    <div className="card shorts4-matchup">
      <div className="shorts4-card-head">
        <div className="muted" style={{ fontSize: 13 }}>
          {game.game_date || "—"}
          {game.game_time ? ` · ${game.game_time}` : ""}
          {game.venue ? ` · ${game.venue}` : ""}
        </div>
        <div className="shorts4-vs-line">
          {hName} vs {aName}
        </div>
        <div className="shorts4-meta-grid">
          <div className="shorts4-team-block">
            <h4>{aName}</h4>
            <div className="muted">
              {fmtRankLine(game.away_rank)} · 전적 {fmtWdl(game.away_record)}
              <br />
              최근 5경기: {fmtLast5(game.away_last5)}
            </div>
          </div>
          <div className="shorts4-team-block">
            <h4>{hName}</h4>
            <div className="muted">
              {fmtRankLine(game.home_rank)} · 전적 {fmtWdl(game.home_record)}
              <br />
              최근 5경기: {fmtLast5(game.home_last5)}
            </div>
          </div>
        </div>
      </div>

      <div className="shorts4-subtitle">선발 투수</div>
      <div className="shorts4-pitcher-grid">
        <div className="shorts4-pitcher-box">
          <div className="shorts4-pitcher-name">{game.away_starter || "미정"}</div>
          <div className="shorts4-pitcher-stats">
            ERA {fmtEra(game.away_starter_era)}
            <br />
            이닝 {fmtNum(game.away_starter_ip)} · 삼진 {fmtNum(game.away_starter_so)}
          </div>
        </div>
        <div className="shorts4-pitcher-box">
          <div className="shorts4-pitcher-name">{game.home_starter || "미정"}</div>
          <div className="shorts4-pitcher-stats">
            ERA {fmtEra(game.home_starter_era)}
            <br />
            이닝 {fmtNum(game.home_starter_ip)} · 삼진 {fmtNum(game.home_starter_so)}
          </div>
        </div>
      </div>
      <div className="shorts4-h2h">
        시즌 상대전적: {hName} {hw}승 · {aName} {aw}승
        {dr ? ` · 무승부 ${dr}` : ""}
      </div>

      <div className="shorts4-subtitle" style={{ marginTop: 18 }}>
        직전경기 라인업
      </div>
      <div className="shorts4-lineup-wrap">
        <LineupTable title={`${aName} (원정)`} rows={game.away_lineup} />
        <LineupTable title={`${hName} (홈)`} rows={game.home_lineup} />
      </div>
    </div>
  );
}

export default function Shorts4Panel() {
  const [date, setDate] = useState(() => seoulToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [tabIdx, setTabIdx] = useState(0);

  const games = useMemo(() => {
    const g = Array.isArray(data?.games) ? data.games : [];
    return g.slice(0, 5);
  }, [data]);

  const activeGame = games[tabIdx] || null;

  const fetchMatchupPreview = useCallback(async (dateStr) => {
    const d = String(dateStr || "").trim().slice(0, 10) || seoulToday();
    setBusy(true);
    setError(null);
    try {
      const res = await postKbo({ action: "matchup_preview", date: d });
      if (res && res.ok === false) {
        setError(String(res.error || res.message || "API가 데이터를 반환하지 않았습니다."));
        setData(null);
        return;
      }
      setData(res);
      setTabIdx(0);
    } catch (e) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onLoad = () => {
    void fetchMatchupPreview(date);
  };

  const onShortsCreate = () => {
    console.log("[Shorts4] 쇼츠 생성 클릭", { date, game: activeGame, games });
  };

  return (
    <div className="shorts4-panel">
      <div className="section soft">
      <div className="section-title">4. 쇼츠-예상전력-비교</div>
      <div className="muted">선발·순위·최근 폼·상대전적·직전 라인업 비교</div>

      {!data && !busy ? (
        <p className="shorts4-hint">날짜를 선택한 뒤 <strong>데이터 불러오기</strong>를 누르세요. 경기가 있으면 아래에 탭·카드가 표시됩니다.</p>
      ) : null}

      <div className="shorts4-controls-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button
          type="button"
          className="primary"
          onClick={() => setDate(seoulToday())}
          disabled={busy}
        >
          오늘
        </button>
        <button type="button" className="primary" onClick={onLoad} disabled={busy}>
          {busy ? "불러오는 중…" : "데이터 불러오기"}
        </button>
      </div>

      {error ? (
        <div className="result-error-light shorts4-error" role="alert">
          {error}
        </div>
      ) : null}

      {data && games.length > 0 ? (
        <>
          <div className="tabs shorts4-tab-row">
            {games.map((g, i) => {
              const label = `${g?.home_team || "홈"} vs ${g?.away_team || "원정"}`;
              return (
                <button
                  key={g?.game_id || i}
                  type="button"
                  className={`tab${i === tabIdx ? " active" : ""}`}
                  onClick={() => setTabIdx(i)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <GameCard game={activeGame} />
        </>
      ) : data && games.length === 0 ? (
        <div className="empty-state shorts4-empty">
          해당 날짜에 예정된 경기가 없습니다.
        </div>
      ) : null}

      <div className="shorts4-footer-actions">
        <button type="button" className="primary primary-fill" onClick={onShortsCreate} disabled={!activeGame}>
          쇼츠 생성
        </button>
      </div>
      </div>
    </div>
  );
}
