import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { postKbo, seoulToday } from "./api.js";

/** 라벨은 정식 구단명, value는 Firestore home/away 팀 필드와 부분 일치시키는 키워드 */
const KBO_TEAMS = [
  { label: "삼성 라이온즈", keyword: "삼성" },
  { label: "KIA 타이거즈", keyword: "KIA" },
  { label: "LG 트윈스", keyword: "LG" },
  { label: "두산 베어스", keyword: "두산" },
  { label: "KT 위즈", keyword: "KT" },
  { label: "SSG 랜더스", keyword: "SSG" },
  { label: "롯데 자이언츠", keyword: "롯데" },
  { label: "한화 이글스", keyword: "한화" },
  { label: "NC 다이노스", keyword: "NC" },
  { label: "키움 히어로즈", keyword: "키움" },
];

function MarkdownView({ text }) {
  const value = (text || "").trim();
  if (!value) return <div className="md">—</div>;
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
}

function useAnalyzer() {
  const [busy, setBusy] = useState(null);
  const runWith = async (action, payload, slot, setOut) => {
    const id = `${action}_${slot}`;
    setBusy(id);
    try {
      const res = await postKbo({ action, ...payload });
      setOut({
        text: res.text ?? "",
        summary: res.contextSummary ?? null,
        error: null,
      });
    } catch (e) {
      setOut({
        text: "",
        summary: null,
        error: e?.message || String(e),
      });
    } finally {
      setBusy((b) => (b === id ? null : b));
    }
  };
  return { busy, runWith };
}

function ResultBlock({ summary, text, pending, error }) {
  return (
    <div className="result">
      <div className="result-head">
        <span>{pending ? "생성 중…" : error ? "오류" : "결과"}</span>
        {summary && !error && (
          <span className="mono">{JSON.stringify(summary)}</span>
        )}
      </div>
      {error ? (
        <pre className="mono result-error">{error}</pre>
      ) : (
        <MarkdownView text={text} />
      )}
    </div>
  );
}

function extractMvpTitle(md) {
  const text = String(md || "");
  const m = text.match(/^\s*#{1,3}\s*(.+?)\s*$/m);
  if (m?.[1]) return m[1].trim();
  return "오늘의 MVP";
}

function extractKoreanBattingLine(md) {
  const text = String(md || "");
  const m = text.match(
    /(\d+)\s*타수[\s/]*(\d+)\s*안타[\s/]*(\d+)\s*홈런[\s/]*(\d+)\s*타점/
  );
  if (!m) return null;
  return {
    ab: Number(m[1]),
    h: Number(m[2]),
    hr: Number(m[3]),
    rbi: Number(m[4]),
  };
}

function nameWithTeam(name, team) {
  const n = String(name || "").trim();
  const t = String(team || "").trim();
  if (!t || t === "—") return n || "—";
  return `${n || "—"} (${t})`;
}

function teamAbbr(team) {
  const t = String(team || "").trim();
  if (!t || t === "—") return "";
  // "SSG 랜더스" -> "SSG"
  const first = t.split(/\s+/)[0];
  if (first) return first.slice(0, 6);
  return t.slice(0, 6);
}

/** API score "NC 5 : 8 삼성" → 표시용 "NC 5 vs 8 삼성" */
function mvpGameHeadline(g) {
  const score = String(g?.score || "").trim();
  if (score) return score.replace(/\s*:\s*/, " vs ");
  return String(g?.matchup || "").trim() || "—";
}

export default function App() {
  const today = useMemo(() => seoulToday(), []);
  const { busy, runWith } = useAnalyzer();

  const [tab, setTab] = useState("analysis");
  const [activeKey, setActiveKey] = useState(null);

  /* --- Analysis --- */
  const [mvpDate, setMvpDate] = useState(today);
  const [mvpOut, setMvpOut] = useState({
    text: "",
    summary: null,
    error: null,
  });
  const [mvpAuto, setMvpAuto] = useState({
    data: null,
    aiText: "",
    error: null,
  });
  const [mvpAutoBusy, setMvpAutoBusy] = useState(false);

  const [teamKw, setTeamKw] = useState("LG");
  const [teamDays, setTeamDays] = useState("7");
  const [teamOut, setTeamOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const [pvP, setPvP] = useState("");
  const [pvB, setPvB] = useState("");
  const [pvTab, setPvTab] = useState("all"); // all | year
  const [pvBusy, setPvBusy] = useState(false);
  const [pvStats, setPvStats] = useState({
    data: null,
    error: null,
  });
  const [pvAiBusy, setPvAiBusy] = useState(false);
  const [pvAiOut, setPvAiOut] = useState({ text: "", error: null });
  const [pvGamesOpen, setPvGamesOpen] = useState(false);

  const [prPlayer, setPrPlayer] = useState("");
  const [prStart, setPrStart] = useState("2026-03-01");
  const [prEnd, setPrEnd] = useState("2026-03-31");
  const [prOut, setPrOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const [spa, setSpa] = useState("");
  const [spb, setSpb] = useState("");
  const [spOut, setSpOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  /* Predict */
  const [suPit, setSuPit] = useState("");
  const [suOpp, setSuOpp] = useState("");
  const [suOut, setSuOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const [pta, setPta] = useState("LG");
  const [ptb, setPtb] = useState("KT");
  const [predOut, setPredOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  /* Shorts */
  const [shDate, setShDate] = useState(today);
  const [hlOut, setHlOut] = useState({
    text: "",
    summary: null,
    error: null,
  });
  const [wkOut, setWkOut] = useState({
    text: "",
    summary: null,
    error: null,
  });
  const [worstOut, setWorstOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

  const pending = (key) => busy === key;

  return (
    <div className="app-shell shell-wide">
      <div className="layout">
        <aside className="sidebar">
          <div className="side-head">
            <div className="side-brand">KBO Dashboard</div>
            <div className="side-sub">좌측에서 실행 → 우측에서 결과 확인</div>
          </div>

          <nav className="side-tabs" aria-label="기능 분류">
            <button
              type="button"
              className={`side-tab ${tab === "analysis" ? "active" : ""}`}
              onClick={() => {
                setTab("analysis");
                setActiveKey(null);
              }}
            >
              분석 (1–5)
            </button>
            <button
              type="button"
              className={`side-tab ${tab === "predict" ? "active" : ""}`}
              onClick={() => {
                setTab("predict");
                setActiveKey(null);
              }}
            >
              예측 (6–7)
            </button>
            <button
              type="button"
              className={`side-tab ${tab === "shorts" ? "active" : ""}`}
              onClick={() => {
                setTab("shorts");
                setActiveKey(null);
              }}
            >
              쇼츠 (8–10)
            </button>
          </nav>

          {tab === "analysis" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">1. 오늘의 MVP</div>
                <label>경기 날짜</label>
                <input
                  type="date"
                  value={mvpDate}
                  onChange={(e) => setMvpDate(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={mvpAutoBusy}
                  onClick={async () => {
                    setActiveKey("mvp");
                    setMvpAutoBusy(true);
                    setMvpAuto({ data: null, aiText: "", error: null });
                    try {
                      const res = await postKbo({
                        action: "mvp_auto",
                        date: mvpDate,
                      });
                      console.log("[mvp_auto] overall_best:", res?.overall_best);
                      console.log(
                        "[mvp_auto] bestPitcher/bestBatter:",
                        res?.overall_best?.pitcher,
                        res?.overall_best?.batter
                      );
                      setMvpAuto({
                        data: res,
                        aiText: res.text ?? "",
                        error: null,
                      });
                    } catch (e) {
                      setMvpAuto({
                        data: null,
                        aiText: "",
                        error: e?.message || String(e),
                      });
                    } finally {
                      setMvpAutoBusy(false);
                    }
                  }}
                >
                  MVP 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">2. 팀별 주간 트렌드</div>
                <label>팀</label>
                <select
                  value={teamKw}
                  onChange={(e) => setTeamKw(e.target.value)}
                >
                  {KBO_TEAMS.map(({ label, keyword }) => (
                    <option key={keyword} value={keyword}>
                      {label}
                    </option>
                  ))}
                </select>
                <label>일수</label>
                <input
                  value={teamDays}
                  onChange={(e) => setTeamDays(e.target.value)}
                  placeholder="7"
                />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("team_week_2")}
                  onClick={() => {
                    setActiveKey("team_week");
                    runWith(
                      "team_week",
                      { teamKeyword: teamKw, days: Number(teamDays) || 7 },
                      "2",
                      setTeamOut
                    );
                  }}
                >
                  트렌드 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">3. 투수 vs 타자</div>
                <label>투수 이름</label>
                <input value={pvP} onChange={(e) => setPvP(e.target.value)} />
                <label>타자 이름</label>
                <input value={pvB} onChange={(e) => setPvB(e.target.value)} />
                <button
                  type="button"
                  className="primary"
                  disabled={pvBusy}
                  onClick={async () => {
                    setActiveKey("pv");
                    setPvBusy(true);
                    setPvAiOut({ text: "", error: null });
                    setPvGamesOpen(false);
                    try {
                      const res = await postKbo({
                        action: "pv_batter_stats",
                        pitcher: pvP,
                        batter: pvB,
                        overallStart: "2024-01-01",
                        yearStart: "2026-01-01",
                      });
                      setPvStats({ data: res, error: null });
                    } catch (e) {
                      setPvStats({
                        data: null,
                        error: e?.message || String(e),
                      });
                    } finally {
                      setPvBusy(false);
                    }
                  }}
                >
                  상대전적 통계 보기
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">4. 기간별 선수 성적</div>
                <label>선수 이름</label>
                <input
                  value={prPlayer}
                  onChange={(e) => setPrPlayer(e.target.value)}
                />
                <label>시작일</label>
                <input
                  type="date"
                  value={prStart}
                  onChange={(e) => setPrStart(e.target.value)}
                />
                <label>종료일</label>
                <input
                  type="date"
                  value={prEnd}
                  onChange={(e) => setPrEnd(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("player_range_4")}
                  onClick={() => {
                    setActiveKey("player_range");
                    runWith(
                      "player_range",
                      { player: prPlayer, start: prStart, end: prEnd },
                      "4",
                      setPrOut
                    );
                  }}
                >
                  기간 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">5. 선발 투수 비교</div>
                <label>투수 A</label>
                <input value={spa} onChange={(e) => setSpa(e.target.value)} />
                <label>투수 B</label>
                <input value={spb} onChange={(e) => setSpb(e.target.value)} />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("sp_compare_5")}
                  onClick={() => {
                    setActiveKey("sp_compare");
                    runWith(
                      "sp_compare",
                      { pitcherA: spa, pitcherB: spb },
                      "5",
                      setSpOut
                    );
                  }}
                >
                  비교 분석 실행
                </button>
              </div>
            </div>
          )}

          {tab === "predict" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">6. 선발 vs 상대 타선</div>
                <label>포커스 투수</label>
                <input value={suPit} onChange={(e) => setSuPit(e.target.value)} />
                <label>상대 팀 키워드</label>
                <input value={suOpp} onChange={(e) => setSuOpp(e.target.value)} />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("sp_matchup_6")}
                  onClick={() => {
                    setActiveKey("sp_matchup");
                    runWith(
                      "sp_matchup",
                      { teamPitcher: suPit, opponentTeamKeyword: suOpp },
                      "6",
                      setSuOut
                    );
                  }}
                >
                  매칭업 분석 실행
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">7. 최근 5경기 폼 예측</div>
                <label>팀 A</label>
                <input value={pta} onChange={(e) => setPta(e.target.value)} />
                <label>팀 B</label>
                <input value={ptb} onChange={(e) => setPtb(e.target.value)} />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("predict_form_7")}
                  onClick={() => {
                    setActiveKey("predict_form");
                    runWith(
                      "predict_form",
                      { teamA: pta, teamB: ptb },
                      "7",
                      setPredOut
                    );
                  }}
                >
                  예측 실행
                </button>
              </div>
            </div>
          )}

          {tab === "shorts" && (
            <div className="side-section">
              <div className="side-group">
                <div className="side-group-title">8. 하이라이트 (쇼츠)</div>
                <label>날짜</label>
                <input
                  type="date"
                  value={shDate}
                  onChange={(e) => setShDate(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={pending("shorts_highlight_8")}
                  onClick={() => {
                    setActiveKey("shorts_highlight");
                    runWith("shorts_highlight", { date: shDate }, "8", setHlOut);
                  }}
                >
                  쇼츠 대본 생성
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">9. 주간 최고 투수 (쇼츠)</div>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("shorts_pitcher_week_9")}
                  onClick={() => {
                    setActiveKey("shorts_pitcher_week");
                    runWith("shorts_pitcher_week", {}, "9", setWkOut);
                  }}
                >
                  생성
                </button>
              </div>

              <div className="side-group">
                <div className="side-group-title">10. 최악 매칭업 (쇼츠)</div>
                <button
                  type="button"
                  className="primary"
                  disabled={pending("shorts_worst_matchup_10")}
                  onClick={() => {
                    setActiveKey("shorts_worst_matchup");
                    runWith("shorts_worst_matchup", {}, "10", setWorstOut);
                  }}
                >
                  생성
                </button>
              </div>
            </div>
          )}

        </aside>

        <main className="results">
          <div className="results-inner">
            {/* results are rendered by activeKey; sidebar contains all controls */}
            {!activeKey ? (
              <div className="empty-state">← 좌측에서 분석을 실행하세요</div>
            ) : activeKey === "mvp" ? (
              <div className="result-page">
                <div className="result-hero-title">🏆 전체 베스트</div>

                {mvpAutoBusy ? (
                  <div className="empty-state">생성 중…</div>
                ) : mvpAuto.error ? (
                  <pre className="result-error-light">{mvpAuto.error}</pre>
                ) : mvpAuto.data ? (
                  (() => {
                    const d = mvpAuto.data;
                    const overall = d.overall_best;
                    const games = d.games || [];
                    const pitch = overall?.pitcher;
                    const bat = overall?.batter;
                    return (
                      <>
                        <div className="best-grid">
                          <div className="best-card">
                            <div className="best-head">🥎 베스트 투수</div>
                            <div className="best-name">
                              <strong>{pitch?.name || "—"}</strong>{" "}
                              {pitch?.team ? (
                                <span className="best-team">({pitch.team})</span>
                              ) : null}
                            </div>
                            <div className="best-sub">{pitch?.key_stats || "—"}</div>
                          </div>
                          <div className="best-card">
                            <div className="best-head">⚾ 베스트 타자</div>
                            <div className="best-name">
                              <strong>{bat?.name || "—"}</strong>{" "}
                              {bat?.team ? (
                                <span className="best-team">({bat.team})</span>
                              ) : null}
                            </div>
                            <div className="best-sub">{bat?.key_stats || "—"}</div>
                          </div>
                        </div>

                        <div className="section soft mvp-per-game-section">
                          <div className="section-title">📋 경기별 MVP</div>
                          <div className="mvp-game-list">
                            {games.length ? (
                              games.map((g) => (
                                <div
                                  className="mvp-game-card"
                                  key={g.game_id || g.matchup}
                                >
                                  <div className="mvp-game-title">
                                    {mvpGameHeadline(g)}
                                  </div>
                                  <div className="mvp-game-line">
                                    ⚾ 투수:{" "}
                                    {g.pitcher_mvp
                                      ? `${g.pitcher_mvp.name}${
                                          g.pitcher_mvp.team
                                            ? ` (${teamAbbr(g.pitcher_mvp.team)})`
                                            : ""
                                        } — ${g.pitcher_mvp.key_stats}`
                                      : "—"}
                                  </div>
                                  <div className="mvp-game-line">
                                    🏏 타자:{" "}
                                    {g.batter_mvp
                                      ? `${g.batter_mvp.name}${
                                          g.batter_mvp.team
                                            ? ` (${teamAbbr(g.batter_mvp.team)})`
                                            : ""
                                        } — ${g.batter_mvp.key_stats}`
                                      : "—"}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="muted">경기 데이터가 없습니다.</div>
                            )}
                          </div>
                        </div>

                        <div className="section soft claude-rationale-section">
                          <div className="section-title">Claude 선정 이유</div>
                          <MarkdownView text={d.text || mvpAuto.aiText} />
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="empty-state">← 좌측에서 MVP 분석을 실행하세요</div>
                )}
              </div>
            ) : activeKey === "team_week" ? (
              <div className="result-page">
                <div className="result-hero-title">
                  {teamKw} 주간 트렌드 ({teamDays}일)
                </div>
                <div className="section soft">
                  <div className="section-title">분석</div>
                  {teamOut.error ? (
                    <pre className="result-error-light">{teamOut.error}</pre>
                  ) : (
                    <MarkdownView text={teamOut.text} />
                  )}
                </div>
              </div>
            ) : activeKey === "pv" ? (
              <div className="result-page">
                <div className="result-hero-title">
                  {pvP || "투수"} vs {pvB || "타자"}
                </div>
                <div className="mini-tabs" role="tablist" aria-label="기간 선택">
                  <button
                    type="button"
                    className={`mini-tab ${pvTab === "all" ? "active" : ""}`}
                    onClick={() => setPvTab("all")}
                  >
                    전체 (2024~현재)
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${pvTab === "year" ? "active" : ""}`}
                    onClick={() => setPvTab("year")}
                  >
                    올해 (2026)
                  </button>
                </div>
                {pvStats.error ? (
                  <pre className="result-error-light">{pvStats.error}</pre>
                ) : pvStats.data ? (
                  (() => {
                    const d = pvStats.data;
                    const isAll = pvTab === "all";
                    const s = isAll ? d.overall : d.year;
                    const rows =
                      (isAll ? d.per_game?.overall : d.per_game?.year) ?? [];
                    const avg = Number(s?.avg);
                    const avgHot = Number.isFinite(avg) && avg >= 0.3;
                    return (
                      <>
                        <div className="metric-row">
                          <div className="metric big">
                            <div className="metric-k">타율</div>
                            <div className={`metric-v ${avgHot ? "hot" : "cold"}`}>
                              {s?.avg ?? "—"}
                            </div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">AB</div>
                            <div className="metric-v">{s?.ab ?? 0}</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">H</div>
                            <div className="metric-v">{s?.h ?? 0}</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">HR</div>
                            <div className="metric-v">{s?.hr ?? 0}</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">BB</div>
                            <div className="metric-v">{s?.bb ?? 0}</div>
                          </div>
                          <div className="metric">
                            <div className="metric-k">SO</div>
                            <div className="metric-v">{s?.so ?? 0}</div>
                          </div>
                        </div>

                        <div className="section soft">
                          <div className="section-title">공통 출전 경기</div>
                          <div className="timeline">
                            {rows.length ? (
                              rows.map((r) => (
                                <div className="timeline-item" key={r.game_id}>
                                  <div className="timeline-date">{r.date}</div>
                                  <div className="timeline-body">
                                    <div className="timeline-line">
                                      <span className="timeline-meta">
                                        {r.team_abbr} {r.home_away}({r.opponent_label})
                                      </span>
                                      <span className="timeline-gid mono">
                                        {r.game_id_display}
                                      </span>
                                    </div>
                                    <div className="timeline-line">
                                      <b>{r.pitcher_name}</b> — {r.pitcher_stats}
                                    </div>
                                    <div className="timeline-line">
                                      <b>{r.batter_name}</b> — {r.batter_stats}
                                    </div>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="muted">기록이 없습니다.</div>
                            )}
                          </div>
                        </div>

                        <div className="section soft">
                          <div className="section-title">AI 서술 분석</div>
                          <button
                            type="button"
                            className="ai-btn"
                            disabled={pvAiBusy || pvBusy}
                            onClick={async () => {
                              setPvAiBusy(true);
                              setPvAiOut({ text: "", error: null });
                              try {
                                const r = await postKbo({
                                  action: "pv_batter",
                                  pitcher: pvP,
                                  batter: pvB,
                                });
                                setPvAiOut({ text: r.text ?? "", error: null });
                              } catch (e) {
                                setPvAiOut({
                                  text: "",
                                  error: e?.message || String(e),
                                });
                              } finally {
                                setPvAiBusy(false);
                              }
                            }}
                          >
                            {pvAiBusy ? "생성 중…" : "🤖 AI 서술 분석 보기"}
                          </button>
                          {pvAiOut.error ? (
                            <pre className="result-error-light">{pvAiOut.error}</pre>
                          ) : pvAiOut.text ? (
                            <MarkdownView text={pvAiOut.text} />
                          ) : (
                            <div className="muted">
                              통계를 먼저 확인하고 필요할 때만 실행하세요.
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()
                ) : (
                  <div className="empty-state">← 좌측에서 상대전적 통계를 실행하세요</div>
                )}
              </div>
            ) : (
              <div className="result-page">
                <div className="section soft">
                  <div className="section-title">결과</div>
                  {activeKey === "player_range" ? (
                    <ResultBlock
                      summary={prOut.summary}
                      text={prOut.text}
                      error={prOut.error}
                      pending={pending("player_range_4")}
                    />
                  ) : activeKey === "sp_compare" ? (
                    <ResultBlock
                      summary={spOut.summary}
                      text={spOut.text}
                      error={spOut.error}
                      pending={pending("sp_compare_5")}
                    />
                  ) : activeKey === "sp_matchup" ? (
                    <ResultBlock
                      summary={suOut.summary}
                      text={suOut.text}
                      error={suOut.error}
                      pending={pending("sp_matchup_6")}
                    />
                  ) : activeKey === "predict_form" ? (
                    <ResultBlock
                      summary={predOut.summary}
                      text={predOut.text}
                      error={predOut.error}
                      pending={pending("predict_form_7")}
                    />
                  ) : activeKey === "shorts_highlight" ? (
                    <ResultBlock
                      summary={hlOut.summary}
                      text={hlOut.text}
                      error={hlOut.error}
                      pending={pending("shorts_highlight_8")}
                    />
                  ) : activeKey === "shorts_pitcher_week" ? (
                    <ResultBlock
                      summary={wkOut.summary}
                      text={wkOut.text}
                      error={wkOut.error}
                      pending={pending("shorts_pitcher_week_9")}
                    />
                  ) : activeKey === "shorts_worst_matchup" ? (
                    <ResultBlock
                      summary={worstOut.summary}
                      text={worstOut.text}
                      error={worstOut.error}
                      pending={pending("shorts_worst_matchup_10")}
                    />
                  ) : (
                    <div className="muted">← 좌측에서 실행하세요</div>
                  )}
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      <footer className="footer-note">
        Netlify 배포 시 환경 변수{" "}
        <span className="mono">ANTHROPIC_API_KEY</span>,{" "}
        <span className="mono">FIREBASE_SERVICE_ACCOUNT_JSON</span> 를 설정하고{" "}
        <span className="mono">netlify dev</span> 또는 프로덕션에서 API를
        호출하세요. 순수{" "}
        <span className="mono">npm run dev</span>만으로는 함수가 없어 API가
        동작하지 않습니다. Claude 응답이 길면 무료 플랜 함수 타임아웃(기본
        10초)에 걸릴 수 있으니 Netlify 대시보드에서 Functions 타임아웃을 늘리거나
        플랜을 확인하세요.
      </footer>
    </div>
  );
}
