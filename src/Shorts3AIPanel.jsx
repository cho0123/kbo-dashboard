import { useCallback, useEffect, useMemo, useState } from "react";
import { postKbo, seoulToday } from "./api.js";

function safeJsonStringify(obj, maxLen = 120000) {
  try {
    const s = JSON.stringify(obj, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen) + "\n... (truncated)" : s;
  } catch {
    return "[]";
  }
}

function parseClaudeBlocks(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  // 기대 포맷:
  // ## [경기 N] (타이틀 optional)
  // (경기 결과 라인 optional)
  // **핫이슈:** ...
  // **하이라이트 텍스트:** ...
  // **썸네일 텍스트:** ...
  const blocks = raw
    .split(/\n(?=##\s*\[경기\s*\d+\])/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const pickLineAfterHeader = (b) => {
    const lines = b.split("\n").map((s) => s.trim());
    const headerIdx = lines.findIndex((l) => /^##\s*\[경기\s*\d+\]/.test(l));
    for (let i = headerIdx + 1; i >= 0 && i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      if (/^\*\*.+\*\*:/.test(l)) continue;
      if (/^##\s*\[경기\s*\d+\]/.test(l)) continue;
      return l;
    }
    return "";
  };

  return blocks.map((b) => {
    const titleMatch = b.match(/##\s*\[경기\s*\d+\]\s*(.+)/);
    const title = titleMatch ? String(titleMatch[1] || "").trim() : "";
    const header = (b.match(/^##\s*(\[경기\s*\d+\].*)$/m) || [])[1] || "";
    const gameLine = pickLineAfterHeader(b);
    const hot = (b.match(/\*\*핫이슈:\*\*\s*(.+)$/m) || [])[1] || "";
    const hi =
      (b.match(/\*\*하이라이트\s*텍스트:\*\*\s*(.+)$/m) || [])[1] || "";
    const th =
      (b.match(/\*\*썸네일\s*텍스트:\*\*\s*(.+)$/m) || [])[1] || "";
    return {
      title,
      game: (gameLine || header).trim(),
      hot: hot.trim(),
      highlight: hi.trim(),
      thumbnail: th.trim(),
      raw: b,
    };
  }).filter((card, idx) => {
    // 상단 "# KBO 경기 분석" 같은 헤더성 블록이 첫 카드로 들어오는 경우 숨김
    const hasAny =
      Boolean(card.hot) || Boolean(card.highlight) || Boolean(card.thumbnail);
    if (idx === 0 && !hasAny) return false;
    return true;
  });
}

function seoulYesterday() {
  const s = seoulToday(); // YYYY-MM-DD (Asia/Seoul)
  const parts = String(s)
    .split("-")
    .map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return s;
  const t = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

async function copyText(t) {
  const s = String(t ?? "");
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

export default function Shorts3AIPanel() {
  const [dateMode, setDateMode] = useState("today");
  const targetDate = dateMode === "today" ? seoulToday() : seoulYesterday();
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [gamesError, setGamesError] = useState(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiRaw, setAiRaw] = useState("");

  const [cards, setCards] = useState([]);
  const [savedFiles, setSavedFiles] = useState([]);

  useEffect(() => {
    postKbo({ action: "highlight_list" })
      .then((res) => {
        setSavedFiles(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        setSavedFiles([]);
      });
  }, []);

  const gamesData = useMemo(() => {
    // Claude로 보내는 데이터는 너무 크지 않게 최소 형태만
    return (Array.isArray(games) ? games : []).map((g) => ({
      game_id: g?.game_id || g?.gameId,
      home_team: g?.home_team,
      away_team: g?.away_team,
      home_score: g?.home_score,
      away_score: g?.away_score,
      venue: g?.venue,
      winning_pitcher: g?.winning_pitcher,
      losing_pitcher: g?.losing_pitcher,
      mvp_batters: g?.mvp_batters,
    }));
  }, [games]);

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    setGamesError(null);
    setAiError(null);
    setAiRaw("");
    setCards([]);
    try {
      // 서버 구현에 따라 date 파라미터가 무시될 수도 있어서 둘 다 시도
      let res;
      try {
        res = await postKbo({ action: "shorts_slides_data", date: targetDate });
      } catch {
        res = await postKbo({ action: "shorts_slides_data" });
      }
      const list = Array.isArray(res?.games) ? res.games : [];
      setGames(list);
    } catch (e) {
      setGamesError(e instanceof Error ? e.message : String(e));
      setGames([]);
    } finally {
      setLoadingGames(false);
    }
  }, [targetDate]);

  const runClaude = useCallback(async () => {
    setAiBusy(true);
    setAiError(null);
    setAiRaw("");
    setCards([]);
    try {
      const res = await postKbo({
        action: "ai_highlight_analysis",
        games: gamesData,
      });
      const text = String(res?.text || "");
      setAiRaw(text);
      const parsed = parseClaudeBlocks(text);
      setCards(parsed);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [gamesData]);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  useEffect(() => {
    if (Array.isArray(games) && games.length > 0) {
      runClaude();
    }
  }, [games, runClaude]);

  return (
    <div className="section soft" style={{ overflow: "visible" }}>
      <div className="section-title">3. 쇼츠-하이라이트 · 🤖 AI 분석</div>
      <p className="muted" style={{ marginTop: 6 }}>
        오늘 경기 데이터를 불러온 뒤, 경기별 핫이슈/추천 문구를 생성합니다.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setDateMode("today")}
          disabled={loadingGames || aiBusy}
          style={{
            background: dateMode === "today" ? "#4ade80" : "#1e1e1e",
            color: dateMode === "today" ? "#000" : "#aaa",
            border: "1px solid #444",
            padding: "4px 12px",
            borderRadius: 6,
            cursor: "pointer",
            opacity: loadingGames || aiBusy ? 0.7 : 1,
          }}
        >
          오늘
        </button>
        <button
          type="button"
          onClick={() => setDateMode("yesterday")}
          disabled={loadingGames || aiBusy}
          style={{
            background: dateMode === "yesterday" ? "#4ade80" : "#1e1e1e",
            color: dateMode === "yesterday" ? "#000" : "#aaa",
            border: "1px solid #444",
            padding: "4px 12px",
            borderRadius: 6,
            cursor: "pointer",
            opacity: loadingGames || aiBusy ? 0.7 : 1,
          }}
        >
          어제
        </button>
        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
          {targetDate}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button
          type="button"
          className="primary"
          disabled={loadingGames || aiBusy}
          onClick={loadGames}
        >
          {loadingGames ? "불러오는 중…" : "경기 데이터 새로고침"}
        </button>
        <button
          type="button"
          className="primary primary-fill"
          disabled={loadingGames || aiBusy || (games || []).length === 0}
          onClick={runClaude}
        >
          {aiBusy ? "AI 분석 중…" : "AI 분석 다시 실행"}
        </button>
      </div>

      {gamesError ? (
        <pre className="result-error-light" style={{ marginTop: 12 }}>
          {gamesError}
        </pre>
      ) : null}
      {aiError ? (
        <pre className="result-error-light" style={{ marginTop: 12 }}>
          {aiError}
        </pre>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          결과
        </div>

        {aiBusy && cards.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            AI가 분석 중입니다…
          </div>
        ) : cards.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            표시할 결과가 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cards.map((c, idx) => (
              <div
                key={`${c.game}_${idx}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                {c.title ? (
                  <div
                    style={{
                      fontWeight: "bold",
                      fontSize: 14,
                      color: "#fff",
                      marginBottom: 6,
                    }}
                  >
                    ⚾ {c.title}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, flex: "1 1 240px" }}>
                    {c.game || `경기 #${idx + 1}`}
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => copyText(c.raw)}
                  >
                    전체 복사
                  </button>
                </div>
                <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                  <div>
                    <strong>핫이슈</strong>: {c.hot || "—"}
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginLeft: 8 }}
                      onClick={() => copyText(c.hot)}
                    >
                      복사
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <strong>하이라이트 텍스트</strong>: {c.highlight || "—"}
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginLeft: 8 }}
                      onClick={() => copyText(c.highlight)}
                    >
                      복사
                    </button>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <strong>썸네일 텍스트</strong>: {c.thumbnail || "—"}
                    <button
                      type="button"
                      className="ghost"
                      style={{ marginLeft: 8 }}
                      onClick={() => copyText(c.thumbnail)}
                    >
                      복사
                    </button>
                  </div>

                  <select
                    style={{
                      width: "100%",
                      marginTop: 8,
                      padding: "4px",
                      background: "#1e1e1e",
                      color: "#aaa",
                      border: "1px solid #444",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                    defaultValue=""
                  >
                    <option value="">— 관련 영상 선택 —</option>
                    {savedFiles.map((f) => (
                      <option key={f.jobId} value={f.jobId}>
                        {String(f.jobId || "").slice(0, 8)} ·{" "}
                        {f.lastModified
                          ? new Date(f.lastModified).toLocaleString("ko-KR", {
                              timeZone: "Asia/Seoul",
                              dateStyle: "short",
                              timeStyle: "short",
                            })
                          : "—"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {aiRaw ? (
        <details style={{ marginTop: 14 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            원문 보기
          </summary>
          <pre
            style={{
              marginTop: 8,
              whiteSpace: "pre-wrap",
              background: "rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              padding: 12,
            }}
          >
            {aiRaw}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

