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
    const titleMatch = b.match(/##\s*\[경기\s*\d+\]\s*(.*)/);
    const titleRaw = titleMatch ? String(titleMatch[1] || "").trim() : "";
    const header = (b.match(/^##\s*(\[경기\s*\d+\].*)$/m) || [])[1] || "";
    const gameLine = pickLineAfterHeader(b);
    const hot = (b.match(/\*\*핫이슈:\*\*\s*(.+)$/m) || [])[1] || "";
    const hi =
      (b.match(/\*\*하이라이트\s*텍스트:\*\*\s*(.+)$/m) || [])[1] || "";
    const th =
      (b.match(/\*\*썸네일\s*텍스트:\*\*\s*(.+)$/m) || [])[1] || "";
    const title = titleRaw || String(gameLine || header || "").trim();
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

function formatTimestampSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return "0:00";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 카드 title(팀명·점수 등)에서 검색용 문자열을 만듭니다 */
function naverSearchQueryFromCard(title, gameFallback) {
  const raw = String(title || gameFallback || "").trim();
  if (!raw) return "";
  return raw
    .replace(/\d+\s*[:-]\s*\d+/g, " ")
    .replace(/\[경기\s*\d+\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Shorts3AIPanel() {
  const [dateMode, setDateMode] = useState("today");
  const targetDate = dateMode === "today" ? seoulToday() : seoulYesterday();
  const [showAll, setShowAll] = useState(false);
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [gamesError, setGamesError] = useState(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiRaw, setAiRaw] = useState("");

  const [cards, setCards] = useState([]);
  const [cardUrl, setCardUrl] = useState({});
  const [cardDownloading, setCardDownloading] = useState({});
  const [cardDownloaded, setCardDownloaded] = useState({});
  const [cardLocalPath, setCardLocalPath] = useState({});
  const [cardUploading, setCardUploading] = useState({});
  const [cardJobId, setCardJobId] = useState({});
  const [cardDownloadError, setCardDownloadError] = useState({});
  /** 카드 인덱스 → Whisper 결과·로딩 */
  const [whisperByCard, setWhisperByCard] = useState({});
  const [cardYoutubeResults, setCardYoutubeResults] = useState({});
  const [cardYoutubeLoading, setCardYoutubeLoading] = useState({});

  const fetchYoutubeSearch = useCallback(async (cardIndex, card, selectedDate) => {
    if (!String(card?.title ?? "").trim()) return;
    console.log("[debug] fetchYoutubeSearch called:", cardIndex, card?.title);
    setCardYoutubeLoading((prev) => ({ ...prev, [cardIndex]: true }));
    try {
      const res = await postKbo({
        action: "youtube_search",
        query: card.title,
        date: selectedDate,
      });
      setCardYoutubeResults((prev) => ({
        ...prev,
        [cardIndex]: Array.isArray(res?.items) ? res.items : [],
      }));
    } catch {
      setCardYoutubeResults((prev) => ({ ...prev, [cardIndex]: [] }));
    } finally {
      setCardYoutubeLoading((prev) => ({ ...prev, [cardIndex]: false }));
    }
  }, []);

  useEffect(() => {
    if (!cards.length) return;
    console.log(
      "[debug] cards changed:",
      cards.length,
      cards.map((c) => c.title)
    );
    console.log("[debug] youtube search dispatch count:", cards.length);
    cards.forEach((c, idx) => {
      const cleanTitle = String(c.title || c.game || "")
        .replace(/\[경기\s*\d*\]\s*/g, "")
        .trim();
      const title = cleanTitle;
      if (!title) return;
      // title이 비어있는 카드가 있어도 검색은 최대한 수행
      fetchYoutubeSearch(idx, { ...c, title }, targetDate);
    });
  }, [cards, fetchYoutubeSearch, targetDate]);

  useEffect(() => {
    console.log("[youtube] results:", cardYoutubeResults);
  }, [cardYoutubeResults]);

  const samsungGames = useMemo(() => {
    return (Array.isArray(games) ? games : []).filter(
      (g) => g?.home_team?.includes("삼성") || g?.away_team?.includes("삼성")
    );
  }, [games]);

  const targetGames = showAll ? games : samsungGames;

  const gamesData = useMemo(() => {
    // Claude로 보내는 데이터는 너무 크지 않게 최소 형태만
    return (Array.isArray(targetGames) ? targetGames : []).map((g) => ({
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
  }, [targetGames]);

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    setGamesError(null);
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
      return list;
    } catch (e) {
      setGamesError(e instanceof Error ? e.message : String(e));
      setGames([]);
      return [];
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
      console.log(
        "[debug] parsed cards:",
        JSON.stringify(parsed.map((c) => ({ title: c.title, hotIssue: c.hot })))
      );
      setCards(parsed);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [gamesData]);

  const runAiAnalysis = useCallback(async () => {
    setAiError(null);
    setAiRaw("");
    setCards([]);
    const list = await loadGames();
    const filtered = showAll
      ? list
      : (Array.isArray(list) ? list : []).filter(
          (g) => g?.home_team?.includes("삼성") || g?.away_team?.includes("삼성")
        );
    const minimal = (Array.isArray(filtered) ? filtered : []).map((g) => ({
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
    if (minimal.length === 0) return;
    setAiBusy(true);
    try {
      const res = await postKbo({
        action: "ai_highlight_analysis",
        games: minimal,
      });
      const text = String(res?.text || "");
      setAiRaw(text);
      const parsed = parseClaudeBlocks(text);
      console.log(
        "[debug] parsed cards:",
        JSON.stringify(parsed.map((c) => ({ title: c.title, hotIssue: c.hot })))
      );
      setCards(parsed);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [loadGames, showAll]);

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
          onClick={runAiAnalysis}
        >
          {loadingGames || aiBusy ? "AI 분석 실행 중…" : "AI 분석 실행"}
        </button>
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          style={{
            background: showAll ? "#ef4444" : "#374151",
            color: "#fff",
            border: "none",
            padding: "4px 12px",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
            opacity: loadingGames || aiBusy ? 0.7 : 1,
          }}
          disabled={loadingGames || aiBusy}
        >
          {showAll ? "삼성 경기만" : "모든 경기 분석"}
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
            {cards.map((c, idx) => {
              const searchQuery = naverSearchQueryFromCard(c.title, c.game);
              const naverUrl = searchQuery
                ? `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${encodeURIComponent(searchQuery)}`
                : `https://sports.naver.com/baseball/schedule/index`;
              return (
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
                      color: "#4ade80",
                      fontSize: 13,
                      fontWeight: "bold",
                      marginBottom: 8,
                      background: "#1a3a2a",
                      padding: "4px 10px",
                      borderRadius: 6,
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

                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="muted"
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      영상 분석
                    </span>
                    <button
                      type="button"
                      disabled={!String(c.title || "").trim() || cardYoutubeLoading[idx]}
                      onClick={() =>
                        fetchYoutubeSearch(idx, c, targetDate)
                      }
                      style={{
                        padding: "3px 10px",
                        background: "#b91c1c",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        fontSize: 11,
                        cursor: String(c.title || "").trim()
                          ? "pointer"
                          : "not-allowed",
                        opacity: cardYoutubeLoading[idx] ? 0.7 : 1,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cardYoutubeLoading[idx]
                        ? "YouTube 검색 중…"
                        : "영상 찾기"}
                    </button>
                  </div>

                  {cardYoutubeLoading[idx] &&
                  !(cardYoutubeResults[idx]?.length > 0) ? (
                    <div
                      className="muted"
                      style={{ marginTop: 6, fontSize: 12 }}
                    >
                      YouTube에서 하이라이트 영상을 찾는 중…
                    </div>
                  ) : null}

                  {(cardYoutubeResults[idx] || []).length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {(cardYoutubeResults[idx] || []).map((item) => (
                        <div
                          key={`${idx}-${item.videoId}`}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            padding: 8,
                            background: "rgba(0,0,0,0.2)",
                            borderRadius: 8,
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          {item.thumbnail ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ flexShrink: 0, display: "inline-block" }}
                            >
                              <img
                                src={item.thumbnail}
                                alt=""
                                width={120}
                                height={68}
                                style={{
                                  objectFit: "cover",
                                  borderRadius: 4,
                                  display: "block",
                                }}
                                loading="lazy"
                              />
                            </a>
                          ) : (
                            <div
                              style={{
                                width: 120,
                                height: 68,
                                background: "#333",
                                borderRadius: 4,
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                lineHeight: 1.35,
                                marginBottom: 4,
                              }}
                            >
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "#60a5fa",
                                  textDecoration: "none",
                                  fontSize: 13,
                                }}
                              >
                                {item.title}
                              </a>
                            </div>
                            <div className="muted" style={{ marginBottom: 6 }}>
                              {item.channelTitle}
                              {item.publishedAt ? (
                                <span style={{ marginLeft: 8, opacity: 0.85 }}>
                                  ·{" "}
                                  {new Date(
                                    item.publishedAt
                                  ).toLocaleDateString("ko-KR", {
                                    timeZone: "Asia/Seoul",
                                  })}
                                </span>
                              ) : null}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                className="ghost"
                                style={{ padding: "2px 8px", fontSize: 11 }}
                                onClick={() => copyText(item.url)}
                              >
                                URL 복사
                              </button>
                              <button
                                type="button"
                                style={{
                                  padding: "2px 8px",
                                  fontSize: 11,
                                  background: "#1d4ed8",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: 4,
                                  cursor: "pointer",
                                }}
                                onClick={() =>
                                  setCardUrl((prev) => ({
                                    ...prev,
                                    [idx]: item.url,
                                  }))
                                }
                              >
                                ⬇️ 다운로드
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <a
                    href={naverUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      padding: "4px 10px",
                      background: "#03C75A",
                      color: "#fff",
                      borderRadius: 6,
                      fontSize: 12,
                      textDecoration: "none",
                      marginBottom: 8,
                    }}
                  >
                    🔍 네이버 야구에서 찾기
                  </a>

                  <div
                    style={{ display: "flex", gap: 6, marginTop: 6 }}
                  >
                    <input
                      type="text"
                      placeholder="영상 URL 붙여넣기 (유튜브/네이버)"
                      value={cardUrl[idx] || ""}
                      onChange={(e) =>
                        setCardUrl((prev) => ({
                          ...prev,
                          [idx]: e.target.value,
                        }))
                      }
                      style={{
                        flex: 1,
                        padding: "4px 8px",
                        fontSize: 12,
                        background: "#1e1e1e",
                        color: "#fff",
                        border: "1px solid #444",
                        borderRadius: 4,
                      }}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const url = cardUrl[idx];
                        if (!url?.trim()) return;
                        setCardDownloadError((prev) => {
                          const next = { ...prev };
                          delete next[idx];
                          return next;
                        });
                        setCardDownloading((prev) => ({
                          ...prev,
                          [idx]: true,
                        }));
                        setCardDownloaded((prev) => ({ ...prev, [idx]: false }));
                        setCardLocalPath((prev) => {
                          const next = { ...prev };
                          delete next[idx];
                          return next;
                        });
                        try {
                          const localRes = await fetch(
                            "http://localhost:3838/download",
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ url: url.trim() }),
                            }
                          );
                          const localData = await localRes.json();
                          console.log(
                            "[download] response:",
                            JSON.stringify(localData)
                          );
                          if (!localRes.ok || localData?.ok === false) {
                            throw new Error(
                              localData?.error ||
                                `로컬 서버 오류 (HTTP ${localRes.status})`
                            );
                          }
                          if (localData?.localPath) {
                            setCardDownloaded((prev) => ({ ...prev, [idx]: true }));
                            setCardLocalPath((prev) => ({
                              ...prev,
                              [idx]: localData.localPath,
                            }));
                          } else {
                            throw new Error("로컬 다운로드 결과(localPath)가 없습니다.");
                          }
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : String(e);
                          setCardDownloadError((prev) => ({
                            ...prev,
                            [idx]:
                              /fetch/i.test(msg) ||
                              /ECONNREFUSED/i.test(msg) ||
                              /Failed to fetch/i.test(msg)
                                ? "로컬 서버가 켜져있지 않습니다. 서버시작.bat을 실행해주세요."
                                : msg,
                          }));
                        } finally {
                          setCardDownloading((prev) => ({
                            ...prev,
                            [idx]: false,
                          }));
                        }
                      }}
                      style={{
                        padding: "4px 10px",
                        background: "#2563eb",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        fontSize: 12,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cardDownloading[idx]
                        ? "⏳ 다운로드 중..."
                        : "⬇️ 다운로드"}
                    </button>
                  </div>

                  {cardDownloaded[idx] ? (
                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                      ✅ 다운로드 완료
                    </div>
                  ) : null}

                  {cardDownloaded[idx] && String(cardJobId[idx] || "").trim() === "" ? (
                    <button
                      type="button"
                      style={{
                        marginTop: 8,
                        padding: "4px 10px",
                        background: "#111827",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: "pointer",
                        opacity: cardUploading[idx] ? 0.7 : 1,
                      }}
                      disabled={cardUploading[idx] || !cardLocalPath[idx]}
                      onClick={async () => {
                        const localPath = String(cardLocalPath[idx] || "").trim();
                        if (!localPath) return;
                        setCardUploading((prev) => ({ ...prev, [idx]: true }));
                        try {
                          const upRes = await fetch("http://localhost:3838/upload", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ localPath }),
                          });
                          const upData = await upRes.json();
                          if (!upRes.ok || upData?.ok === false) {
                            throw new Error(
                              upData?.error || `로컬 업로드 오류 (HTTP ${upRes.status})`
                            );
                          }
                          if (upData?.jobId) {
                            setCardJobId((prev) => ({ ...prev, [idx]: upData.jobId }));
                          }
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : String(e);
                          setCardDownloadError((prev) => ({
                            ...prev,
                            [idx]:
                              /fetch/i.test(msg) ||
                              /ECONNREFUSED/i.test(msg) ||
                              /Failed to fetch/i.test(msg)
                                ? "로컬 서버가 켜져있지 않습니다. 서버시작.bat을 실행해주세요."
                                : msg,
                          }));
                        } finally {
                          setCardUploading((prev) => ({ ...prev, [idx]: false }));
                        }
                      }}
                    >
                      {cardUploading[idx] ? "☁️ 업로드 중..." : "☁️ S3 업로드"}
                    </button>
                  ) : null}

                  {cardDownloadError[idx] ? (
                    <pre
                      className="result-error-light"
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {cardDownloadError[idx]}
                    </pre>
                  ) : null}

                  {String(cardJobId[idx] || "").trim() ? (
                  <button
                    type="button"
                    className="ghost"
                    style={{ marginTop: 8 }}
                    disabled={aiBusy}
                    onClick={async () => {
                      const jobId = String(cardJobId[idx] || "").trim();
                      if (!jobId) return;
                      setWhisperByCard((prev) => ({
                        ...prev,
                        [idx]: {
                          ...prev[idx],
                          loading: true,
                          error: null,
                        },
                      }));
                      try {
                        const res = await postKbo({
                          action: "whisper_analyze",
                          jobId,
                        });
                        setWhisperByCard((prev) => ({
                          ...prev,
                          [idx]: {
                            loading: false,
                            segments: Array.isArray(res?.segments)
                              ? res.segments
                              : [],
                            text: String(res?.text || ""),
                            error: null,
                          },
                        }));
                      } catch (e) {
                        setWhisperByCard((prev) => ({
                          ...prev,
                          [idx]: {
                            ...prev[idx],
                            loading: false,
                            error:
                              e instanceof Error ? e.message : String(e),
                          },
                        }));
                      }
                    }}
                  >
                    {whisperByCard[idx]?.loading
                      ? "음성 분석 중…"
                      : "🎙️ 음성 분석"}
                  </button>
                  ) : null}

                  {whisperByCard[idx]?.error ? (
                    <pre
                      className="result-error-light"
                      style={{
                        marginTop: 8,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {whisperByCard[idx].error}
                    </pre>
                  ) : null}

                  {Array.isArray(whisperByCard[idx]?.segments) &&
                  whisperByCard[idx].segments.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginBottom: 6 }}
                      >
                        구간 타임스탬프 (클릭 시 복사)
                      </div>
                      <ul
                        style={{
                          margin: 0,
                          padding: 0,
                          listStyle: "none",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          maxHeight: 280,
                          overflowY: "auto",
                        }}
                      >
                        {whisperByCard[idx].segments.map((seg, si) => {
                          const start = seg?.start ?? 0;
                          const end = seg?.end ?? 0;
                          const line = `[${formatTimestampSec(start)} – ${formatTimestampSec(end)}] ${String(seg?.text || "").trim()}`;
                          return (
                            <li key={si}>
                              <button
                                type="button"
                                className="ghost"
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  whiteSpace: "pre-wrap",
                                  fontSize: 12,
                                  lineHeight: 1.45,
                                }}
                                onClick={() => copyText(line)}
                              >
                                {line}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                </div>
              </div>
              );
            })}
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

