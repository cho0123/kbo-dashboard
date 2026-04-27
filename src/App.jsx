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

export default function App() {
  const today = useMemo(() => seoulToday(), []);
  const { busy, runWith } = useAnalyzer();

  const [tab, setTab] = useState("analysis");

  /* --- Analysis --- */
  const [mvpDate, setMvpDate] = useState(today);
  const [mvpOut, setMvpOut] = useState({
    text: "",
    summary: null,
    error: null,
  });

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
    <div className="app-shell">
      <header className="hero">
        <div>
          <div className="badge">Firestore · Claude · Netlify Ready</div>
          <h1>KBO 분석 웹 대시보드</h1>
          <p>
            경기·박스 데이터를 불러와 Claude가 요약·트렌드·쇼츠 대본까지 자동
            생성합니다.
          </p>
        </div>
      </header>

      <nav className="tabs" aria-label="기능 분류">
        <button
          type="button"
          className={`tab ${tab === "analysis" ? "active" : ""}`}
          onClick={() => setTab("analysis")}
        >
          분석 (1–5)
        </button>
        <button
          type="button"
          className={`tab ${tab === "predict" ? "active" : ""}`}
          onClick={() => setTab("predict")}
        >
          예측 (6–7)
        </button>
        <button
          type="button"
          className={`tab ${tab === "shorts" ? "active" : ""}`}
          onClick={() => setTab("shorts")}
        >
          쇼츠 (8–10)
        </button>
      </nav>

      {tab === "analysis" && (
        <section className="panel-grid">
          <article className="card">
            <h3>1. 오늘의 MVP 자동 선정</h3>
            <p className="hint">
              해당 날짜의 모든 경기 박스스코어가 Firestore에 있어야 정확합니다.
            </p>
            <label htmlFor="mvp-date">경기 날짜</label>
            <input
              id="mvp-date"
              type="date"
              value={mvpDate}
              onChange={(e) => setMvpDate(e.target.value)}
            />
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("today_mvp_1")}
                onClick={() =>
                  runWith("today_mvp", { date: mvpDate }, "1", setMvpOut)
                }
              >
                MVP 분석 생성
              </button>
            </div>
            <ResultBlock
              summary={mvpOut.summary}
              text={mvpOut.text}
              error={mvpOut.error}
              pending={pending("today_mvp_1")}
            />
          </article>

          <article className="card">
            <h3>2. 팀별 주간 성적 트렌드</h3>
            <p className="hint">
              최근 경기일 기준으로 되돌아가며, 선택한 팀이 홈·원정 팀명에 포함되는
              경기만 모아 분석합니다.
            </p>
            <div className="row two">
              <div>
                <label htmlFor="team-week-team">팀</label>
                <select
                  id="team-week-team"
                  value={teamKw}
                  onChange={(e) => setTeamKw(e.target.value)}
                >
                  {KBO_TEAMS.map(({ label, keyword }) => (
                    <option key={keyword} value={keyword}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>일수</label>
                <input
                  value={teamDays}
                  onChange={(e) => setTeamDays(e.target.value)}
                  placeholder="7"
                />
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("team_week_2")}
                onClick={() =>
                  runWith(
                    "team_week",
                    {
                      teamKeyword: teamKw,
                      days: Number(teamDays) || 7,
                    },
                    "2",
                    setTeamOut
                  )
                }
              >
                주간 트렌드 분석
              </button>
            </div>
            <ResultBlock
              summary={teamOut.summary}
              text={teamOut.text}
              error={teamOut.error}
              pending={pending("team_week_2")}
            />
          </article>

          <article className="card pv-card">
            <h3>3. 투수 vs 타자 상대 전적</h3>
            <p className="hint">
              동일 game_id에 두 선수 기록이 모두 있을 때 비교합니다.
            </p>
            <div className="row two">
              <div>
                <label>투수 이름</label>
                <input value={pvP} onChange={(e) => setPvP(e.target.value)} />
              </div>
              <div>
                <label>타자 이름</label>
                <input value={pvB} onChange={(e) => setPvB(e.target.value)} />
              </div>
            </div>
            <div className="pv-title">
              <span className="mono">{pvP || "투수"}</span>
              <span className="pv-vs">vs</span>
              <span className="mono">{pvB || "타자"}</span>
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

            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pvBusy}
                onClick={async () => {
                  setPvBusy(true);
                  setPvAiOut({ text: "", error: null });
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
                    setPvStats({ data: null, error: e?.message || String(e) });
                  } finally {
                    setPvBusy(false);
                  }
                }}
              >
                상대 전적 분석
              </button>
            </div>
            <div className="result">
              <div className="result-head">
                <span>
                  {pvBusy
                    ? "생성 중…"
                    : pvStats.error
                      ? "오류"
                      : "결과"}
                </span>
                {pvStats.data?.counts && !pvStats.error && (
                  <span className="mono">
                    {pvTab === "all"
                      ? `games=${pvStats.data.overall?.games ?? 0}`
                      : `games=${pvStats.data.year?.games ?? 0}`}
                  </span>
                )}
              </div>

              {pvStats.error ? (
                <pre className="mono result-error">{pvStats.error}</pre>
              ) : pvStats.data ? (
                (() => {
                  const d = pvStats.data;
                  const isAll = pvTab === "all";
                  const s = isAll ? d.overall : d.year;
                  const insufficient = isAll
                    ? d.insufficient?.overall
                    : d.insufficient?.year;
                  return (
                    <div className="pv-metrics">
                      <div className="pv-meta">
                        <span className="mono">
                          기간:{" "}
                          {isAll ? d.overallStart : d.yearStart} ~ {d.end}
                        </span>
                        {insufficient && (
                          <span className="pv-warn">데이터 부족</span>
                        )}
                      </div>
                      <div className="pv-table-wrap">
                        <table className="pv-table">
                          <tbody>
                            <tr>
                              <th>대결(동일 경기) 횟수</th>
                              <td>{s?.games ?? 0}</td>
                            </tr>
                            <tr>
                              <th>타율</th>
                              <td>{s?.avg ?? "—"}</td>
                            </tr>
                            <tr>
                              <th>AB / H</th>
                              <td>
                                {s?.ab ?? 0} / {s?.h ?? 0}
                              </td>
                            </tr>
                            <tr>
                              <th>HR / BB / SO</th>
                              <td>
                                {s?.hr ?? 0} / {s?.bb ?? 0} / {s?.so ?? 0}
                              </td>
                            </tr>
                            <tr>
                              <th>PA (가능시)</th>
                              <td>{s?.pa ?? 0}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {insufficient && (
                        <p className="hint pv-hint">
                          표본이 적어서 해석이 불안정할 수 있어요. (기준: 3경기
                          미만 또는 AB 10 미만)
                        </p>
                      )}

                      <div className="pv-ai">
                        <button
                          type="button"
                          className="pv-ai-btn"
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
                      </div>

                      {pvAiOut.error ? (
                        <pre className="mono result-error">{pvAiOut.error}</pre>
                      ) : pvAiOut.text ? (
                        <div className="pv-ai-out">
                          <MarkdownView text={pvAiOut.text} />
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              ) : (
                <div className="md">—</div>
              )}
            </div>
          </article>

          <article className="card">
            <h3>4. 기간별 선수 성적 분석</h3>
            <label>선수 이름</label>
            <input
              value={prPlayer}
              onChange={(e) => setPrPlayer(e.target.value)}
              placeholder="정확히 Firestore player 필드와 동일"
            />
            <div className="row two">
              <div>
                <label>시작일</label>
                <input
                  type="date"
                  value={prStart}
                  onChange={(e) => setPrStart(e.target.value)}
                />
              </div>
              <div>
                <label>종료일</label>
                <input
                  type="date"
                  value={prEnd}
                  onChange={(e) => setPrEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("player_range_4")}
                onClick={() =>
                  runWith(
                    "player_range",
                    {
                      player: prPlayer,
                      start: prStart,
                      end: prEnd,
                    },
                    "4",
                    setPrOut
                  )
                }
              >
                기간 분석 생성
              </button>
            </div>
            <ResultBlock
              summary={prOut.summary}
              text={prOut.text}
              error={prOut.error}
              pending={pending("player_range_4")}
            />
          </article>

          <article className="card">
            <h3>5. 선발 투수 비교</h3>
            <div className="row two">
              <div>
                <label>투수 A</label>
                <input value={spa} onChange={(e) => setSpa(e.target.value)} />
              </div>
              <div>
                <label>투수 B</label>
                <input value={spb} onChange={(e) => setSpb(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("sp_compare_5")}
                onClick={() =>
                  runWith(
                    "sp_compare",
                    { pitcherA: spa, pitcherB: spb },
                    "5",
                    setSpOut
                  )
                }
              >
                비교 분석
              </button>
            </div>
            <ResultBlock
              summary={spOut.summary}
              text={spOut.text}
              error={spOut.error}
              pending={pending("sp_compare_5")}
            />
          </article>
        </section>
      )}

      {tab === "predict" && (
        <section className="panel-grid">
          <article className="card">
            <h3>6. 선발 vs 상대 타선 매칭업</h3>
            <p className="hint">
              포커스 투수 최근 등판 + 상대 팀 키워드로 최근 경기 맥락을
              줍니다.
            </p>
            <label>포커스 투수 이름</label>
            <input value={suPit} onChange={(e) => setSuPit(e.target.value)} />
            <label>상대 팀 키워드</label>
            <input
              value={suOpp}
              onChange={(e) => setSuOpp(e.target.value)}
              placeholder="예: 삼성"
            />
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("sp_matchup_6")}
                onClick={() =>
                  runWith(
                    "sp_matchup",
                    {
                      teamPitcher: suPit,
                      opponentTeamKeyword: suOpp,
                    },
                    "6",
                    setSuOut
                  )
                }
              >
                매칭업 분석
              </button>
            </div>
            <ResultBlock
              summary={suOut.summary}
              text={suOut.text}
              error={suOut.error}
              pending={pending("sp_matchup_6")}
            />
          </article>

          <article className="card">
            <h3>7. 최근 5경기 폼 기반 예측</h3>
            <div className="row two">
              <div>
                <label>팀 A 키워드</label>
                <input value={pta} onChange={(e) => setPta(e.target.value)} />
              </div>
              <div>
                <label>팀 B 키워드</label>
                <input value={ptb} onChange={(e) => setPtb(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("predict_form_7")}
                onClick={() =>
                  runWith(
                    "predict_form",
                    { teamA: pta, teamB: ptb },
                    "7",
                    setPredOut
                  )
                }
              >
                폼 예측 생성
              </button>
            </div>
            <ResultBlock
              summary={predOut.summary}
              text={predOut.text}
              error={predOut.error}
              pending={pending("predict_form_7")}
            />
          </article>
        </section>
      )}

      {tab === "shorts" && (
        <section className="panel-grid">
          <article className="card">
            <h3>8. 오늘의 하이라이트 선수 (쇼츠)</h3>
            <label>경기 날짜</label>
            <input
              type="date"
              value={shDate}
              onChange={(e) => setShDate(e.target.value)}
            />
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("shorts_highlight_8")}
                onClick={() =>
                  runWith(
                    "shorts_highlight",
                    { date: shDate },
                    "8",
                    setHlOut
                  )
                }
              >
                쇼츠 대본 생성
              </button>
            </div>
            <ResultBlock
              summary={hlOut.summary}
              text={hlOut.text}
              error={hlOut.error}
              pending={pending("shorts_highlight_8")}
            />
          </article>

          <article className="card">
            <h3>9. 이번 주 최고 투수 (쇼츠)</h3>
            <p className="hint">
              최근 7일 창의 투수 기록 샘플을 바탕으로 네러티브를 만듭니다.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("shorts_pitcher_week_9")}
                onClick={() =>
                  runWith("shorts_pitcher_week", {}, "9", setWkOut)
                }
              >
                주간 투수 쇼츠 생성
              </button>
            </div>
            <ResultBlock
              summary={wkOut.summary}
              text={wkOut.text}
              error={wkOut.error}
              pending={pending("shorts_pitcher_week_9")}
            />
          </article>

          <article className="card">
            <h3>10. 역대 최악 매칭업 (쇼츠)</h3>
            <p className="hint">
              고득점 경기 샘플을 바탕으로 극적인 각본을 시도합니다.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={pending("shorts_worst_matchup_10")}
                onClick={() =>
                  runWith("shorts_worst_matchup", {}, "10", setWorstOut)
                }
              >
                최악 매칭업 쇼츠 생성
              </button>
            </div>
            <ResultBlock
              summary={worstOut.summary}
              text={worstOut.text}
              error={worstOut.error}
              pending={pending("shorts_worst_matchup_10")}
            />
          </article>
        </section>
      )}

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
