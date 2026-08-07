import { useEffect, useMemo, useRef, useState } from "react";
import { postKbo } from "./api.js";
import {
  VOICE_OPTIONS,
  NARRATION_LEAD_IN_SEC,
  NARRATION_TAIL_SEC,
  narrationCacheKey,
  measureAudioDurationSec,
} from "./Shorts3Panel.jsx";

/**
 * 대본 길이 계산 — 영상 편집보다 앞 단계.
 *
 * 지금까지는 영상을 먼저 뽑고 나레이션을 나중에 붙여 길이가 안 맞는 만큼 홀드로
 * 메웠다. 순서를 뒤집기 위해, 대본 단계에서 문장별 TTS 길이를 먼저 재고 그에 맞는
 * 클립 길이를 제안한다. 이 화면은 "측정"까지만 한다 — 편집기로 넘기는 자동 매핑은
 * 다음 단계다.
 *
 * 상수(리드인·테일)와 캐시 키·길이 측정은 편집기 것을 그대로 import 해서 쓴다.
 * 여기서 숫자를 다시 적으면 두 화면이 조용히 갈라진다.
 */

const SCRIPT_JOB_STORAGE_KEY = "kbo_script_length_job";
const SCRIPT_DRAFT_STORAGE_KEY = "kbo_script_length_draft";

/** elevenlabs_tts 가 UUID v4 jobId 를 요구한다. 대본용 작업공간을 따로 하나 만들어 쓴다. */
function loadOrCreateScriptJobId() {
  try {
    const saved = String(localStorage.getItem(SCRIPT_JOB_STORAGE_KEY) || "").trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });
  try {
    localStorage.setItem(SCRIPT_JOB_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

/**
 * 글자 수 기반 TTS 길이 추정(초). **추정치이지 실측이 아니다.**
 * 실측 6문장(15~61자, 속도 1.0, 남(기본))에 최소제곱으로 맞춘 직선이며
 * 그 범위에서 최대 오차는 0.29초였다. 표본이 적으니 참고용으로만 쓴다.
 */
const ESTIMATE_SEC_PER_CHAR = 0.142;
const ESTIMATE_OFFSET_SEC = -0.19;
const ESTIMATE_MIN_SEC = 0.3;
function estimateTtsSeconds(text, speed) {
  const n = String(text ?? "").trim().length;
  if (n === 0) return 0;
  const sp = Number(speed);
  const spd = Number.isFinite(sp) && sp > 0 ? sp : 1;
  const raw = (n * ESTIMATE_SEC_PER_CHAR + ESTIMATE_OFFSET_SEC) / spd;
  return Math.max(ESTIMATE_MIN_SEC, raw);
}

/** 줄바꿈으로 문장 분리. 빈 줄·공백만 있는 줄은 버린다. */
function splitScriptLines(script) {
  return String(script ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** 필요 길이 = 리드인 + TTS + 테일 (편집기 홀드 계산과 같은 근거) */
function requiredSeconds(ttsSec) {
  const n = Number(ttsSec);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return NARRATION_LEAD_IN_SEC + n + NARRATION_TAIL_SEC;
}

/** 제안 클립 길이 = 필요 길이를 올림한 정수 초 */
function suggestedClipSeconds(reqSec) {
  const n = Number(reqSec);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

const fmt = (n, d = 2) =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "-";

export default function ScriptLengthPanel({ onSendToEditor } = {}) {
  const [voiceId, setVoiceId] = useState(VOICE_OPTIONS[0].id);
  const [speed, setSpeed] = useState(1.0);
  const [stability, setStability] = useState(0.5);
  const [style, setStyle] = useState(0.3);
  const [script, setScript] = useState("");
  /** 실측 결과: cacheKey → 초. 화면이 다시 열려도 유지되도록 localStorage 에 같이 저장. */
  const [measuredByKey, setMeasuredByKey] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [savedList, setSavedList] = useState([]);
  const [listOpen, setListOpen] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const jobIdRef = useRef(null);
  if (jobIdRef.current == null) jobIdRef.current = loadOrCreateScriptJobId();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCRIPT_DRAFT_STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.script === "string") setScript(d.script);
      if (VOICE_OPTIONS.some((v) => v.id === d.voiceId)) setVoiceId(d.voiceId);
      if (Number.isFinite(Number(d.speed))) setSpeed(Number(d.speed));
      if (Number.isFinite(Number(d.stability))) setStability(Number(d.stability));
      if (Number.isFinite(Number(d.style))) setStyle(Number(d.style));
      if (d.measuredByKey && typeof d.measuredByKey === "object") {
        setMeasuredByKey(d.measuredByKey);
      }
    } catch (e) {
      console.warn("[script length restore]", e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SCRIPT_DRAFT_STORAGE_KEY,
        JSON.stringify({ script, voiceId, speed, stability, style, measuredByKey })
      );
    } catch (e) {
      console.warn("[script length save]", e);
    }
  }, [script, voiceId, speed, stability, style, measuredByKey]);

  const lines = useMemo(() => splitScriptLines(script), [script]);

  const rows = useMemo(
    () =>
      lines.map((text, i) => {
        const key = narrationCacheKey(text, voiceId, speed, stability, style);
        const measured = Number(measuredByKey[key]);
        const isMeasured = Number.isFinite(measured) && measured > 0;
        const tts = isMeasured ? measured : estimateTtsSeconds(text, speed);
        const req = requiredSeconds(tts);
        return {
          i,
          text,
          key,
          isMeasured,
          tts,
          req,
          clip: suggestedClipSeconds(req),
        };
      }),
    [lines, voiceId, speed, stability, style, measuredByKey]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          tts: a.tts + r.tts,
          req: a.req + r.req,
          clip: a.clip + r.clip,
        }),
        { tts: 0, req: 0, clip: 0 }
      ),
    [rows]
  );

  const pendingCount = rows.filter((r) => !r.isMeasured).length;
  const allMeasured = rows.length > 0 && pendingCount === 0;

  /** 전 문장이 실측됐을 때만 script.json 저장 (localStorage 는 그대로 두고 S3 를 추가) */
  const saveScriptDoc = async (measuredMap) => {
    const lineList = splitScriptLines(script);
    if (lineList.length === 0) return;
    const items = lineList.map((text) => ({
      text,
      durationSec: Number(
        measuredMap[narrationCacheKey(text, voiceId, speed, stability, style)]
      ),
    }));
    if (items.some((it) => !Number.isFinite(it.durationSec) || it.durationSec <= 0)) {
      return; // 추정치가 섞여 있으면 저장하지 않는다
    }
    try {
      await postKbo({
        action: "script_save",
        scriptJobId: jobIdRef.current,
        script,
        voiceId,
        speed,
        stability,
        style,
        items,
      });
      setSavedAt(new Date().toISOString());
    } catch (e) {
      console.warn("[script save]", e);
    }
  };

  const refreshSavedList = async () => {
    setListBusy(true);
    setError(null);
    try {
      const res = await postKbo({ action: "script_list" });
      setSavedList(Array.isArray(res?.items) ? res.items : []);
      setListOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setListBusy(false);
    }
  };

  /** 저장된 측정을 통째로 복원 — 대본·설정·측정표가 그대로 돌아온다 */
  const loadSaved = async (scriptJobId) => {
    setListBusy(true);
    setError(null);
    try {
      const res = await postKbo({ action: "script_list", detail: scriptJobId });
      const d = res?.doc;
      if (!d || !Array.isArray(d.items)) throw new Error("저장된 내용을 읽지 못했습니다.");
      const v = VOICE_OPTIONS.some((o) => o.id === d.voiceId) ? d.voiceId : voiceId;
      const sp = Number.isFinite(Number(d.speed)) ? Number(d.speed) : 1;
      const st = Number.isFinite(Number(d.stability)) ? Number(d.stability) : 0.5;
      const sy = Number.isFinite(Number(d.style)) ? Number(d.style) : 0.3;
      const map = {};
      for (const it of d.items) {
        const t = String(it?.text ?? "").trim();
        const dur = Number(it?.durationSec);
        if (!t || !Number.isFinite(dur) || dur <= 0) continue;
        map[narrationCacheKey(t, v, sp, st, sy)] = dur;
      }
      // 이후 측정·편집기 전송이 이 잡의 mp3 를 쓰도록 작업공간을 옮긴다
      jobIdRef.current = scriptJobId;
      try {
        localStorage.setItem(SCRIPT_JOB_STORAGE_KEY, scriptJobId);
      } catch {
        /* ignore */
      }
      setVoiceId(v);
      setSpeed(sp);
      setStability(st);
      setStyle(sy);
      setScript(typeof d.script === "string" ? d.script : "");
      setMeasuredByKey(map);
      setSavedAt(typeof d.savedAt === "string" ? d.savedAt : null);
      setListOpen(false);
      setProgress(`불러왔습니다 — ${d.sentenceCount || d.items.length}문장`);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setListBusy(false);
    }
  };

  const onMeasure = async () => {
    if (busy || rows.length === 0) return;
    setBusy(true);
    setError(null);
    setProgress("");
    const jobId = jobIdRef.current;
    try {
      // 사이드카에 남은 이전 측정 결과를 먼저 읽는다(새로고침·다른 PC 에서도 유효).
      let entries = {};
      try {
        const res = await postKbo({ action: "narration_cache_list", jobId });
        if (res?.entries && typeof res.entries === "object") entries = res.entries;
      } catch (e) {
        console.warn("[script length cache list]", e);
      }

      const next = { ...measuredByKey };
      const todo = [];
      rows.forEach((r) => {
        if (Number.isFinite(Number(next[r.key])) && Number(next[r.key]) > 0) return;
        const hit = entries[String(r.i)];
        const d = Number(hit?.durationSec);
        if (hit && hit.cacheKey === r.key && hit.hasMp3 === true && d > 0) {
          next[r.key] = d;
          return;
        }
        todo.push(r);
      });

      if (todo.length === 0) {
        setMeasuredByKey(next);
        setProgress(`이미 측정된 문장입니다 (TTS 호출 0회)`);
        return;
      }

      for (let k = 0; k < todo.length; k++) {
        const r = todo[k];
        setProgress(`측정 중… ${k + 1}/${todo.length} (${r.i + 1}번 문장)`);
        const tts = await postKbo({
          action: "elevenlabs_tts",
          jobId,
          segIndex: r.i,
          text: r.text,
          voiceId,
          speed,
          stability,
          style,
        });
        const d = await measureAudioDurationSec(tts?.presignedUrl);
        if (!Number.isFinite(d) || d <= 0) {
          throw new Error(`${r.i + 1}번 문장의 오디오 길이를 재지 못했습니다.`);
        }
        next[r.key] = d;
        setMeasuredByKey({ ...next });
        try {
          await postKbo({
            action: "narration_cache_put",
            jobId,
            segIndex: r.i,
            cacheKey: r.key,
            durationSec: d,
          });
        } catch (e) {
          console.warn("[script length cache put]", e);
        }
      }
      setProgress(`실제 측정 완료 (TTS ${todo.length}회 호출)`);
      // 전 문장이 실측된 시점에만 S3 에 저장한다 — 그때가 데이터가 완결되는 순간이고,
      // 다른 PC 에서 불러왔을 때 바로 편집기로 보낼 수 있는 상태이기 때문.
      await saveScriptDoc(next);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  const resultText = useMemo(() => {
    if (rows.length === 0) return "";
    const voice = VOICE_OPTIONS.find((v) => v.id === voiceId)?.label || voiceId;
    const head = [
      `대본 길이 계산 (${allMeasured ? "실제 측정" : "추정 포함"})`,
      `성우 ${voice} / 속도 ${fmt(speed)} / 안정성 ${fmt(stability)} / 스타일 ${fmt(style)}`,
      `필요 길이 = 리드인 ${fmt(NARRATION_LEAD_IN_SEC)}초 + TTS + 테일 ${fmt(NARRATION_TAIL_SEC)}초`,
      "",
    ];
    const body = rows.map(
      (r) =>
        `${String(r.i + 1).padStart(2, " ")}. 클립 ${r.clip}초 | TTS ${fmt(r.tts)}초${
          r.isMeasured ? "" : "(추정)"
        } | 필요 ${fmt(r.req)}초\n    ${r.text}`
    );
    const tail = [
      "",
      `합계: TTS ${fmt(totals.tts)}초 / 필요 ${fmt(totals.req)}초 / 클립 ${totals.clip}초`,
    ];
    return [...head, ...body, ...tail].join("\n");
  }, [rows, totals, voiceId, speed, stability, style, allMeasured]);

  const onCopy = async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const th = {
    textAlign: "left",
    padding: "6px 8px",
    borderBottom: "1px solid var(--ve-border)",
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
  const td = {
    padding: "6px 8px",
    borderBottom: "1px solid var(--ve-border)",
    verticalAlign: "top",
  };
  const num = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  return (
    <div className="section soft">
      <div className="section-title">대본 길이 계산</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        영상을 뽑기 <b>전에</b> 대본의 문장별 TTS 길이를 재고, 그 길이에 맞는 클립
        길이를 제안합니다. 필요 길이 = 리드인 {fmt(NARRATION_LEAD_IN_SEC)}초 + TTS +
        테일 {fmt(NARRATION_TAIL_SEC)}초 (영상 편집기의 홀드 계산과 같은 기준).
      </p>

      {/* 음성 설정 — 편집기와 동일한 파라미터·기본값 */}
      <div style={{ maxWidth: 480, marginBottom: 14 }}>
        <div className="muted" style={{ fontWeight: 500, marginBottom: 10 }}>
          나레이션 설정
        </div>
        <label className="preset-field">
          <span>음성 선택</span>
          <select
            value={voiceId}
            disabled={busy}
            onChange={(e) => setVoiceId(e.target.value)}
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="preset-field">
          <span>속도 ({fmt(speed)})</span>
          <input
            type="range"
            min={0.7}
            max={1.2}
            step={0.05}
            value={speed}
            disabled={busy}
            onChange={(e) => setSpeed(Number(e.target.value) || 1.0)}
          />
        </label>
        <label className="preset-field">
          <span>
            안정성 (낮을수록 다양 / 높을수록 일관된 톤) ({fmt(stability)})
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={stability}
            disabled={busy}
            onChange={(e) => setStability(Number(e.target.value) || 0)}
          />
        </label>
        <label className="preset-field">
          <span>스타일 (높을수록 더 극적인 표현) ({fmt(style)})</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={style}
            disabled={busy}
            onChange={(e) => setStyle(Number(e.target.value) || 0)}
          />
        </label>
      </div>

      {/* 대본 입력 */}
      <label className="preset-field" style={{ maxWidth: 900 }}>
        <span>대본 (줄바꿈으로 문장 구분 — 빈 줄은 무시됩니다)</span>
        <textarea
          rows={10}
          value={script}
          disabled={busy}
          placeholder={"오늘 경기의 하이라이트를 세 가지로 정리해 드리겠습니다.\n첫째, 선발 투수가 6회를 무실점으로 막았습니다.\n둘째, 4번 타자가 역전 투런 홈런을 터뜨렸습니다."}
          onChange={(e) => setScript(e.target.value)}
          style={{
            width: "100%",
            fontSize: 13,
            lineHeight: 1.6,
            padding: 8,
            borderRadius: 6,
            border: "1px solid var(--ve-border)",
            background: "var(--ve-panel)",
            color: "var(--ve-text)",
            resize: "vertical",
          }}
        />
      </label>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          margin: "10px 0",
        }}
      >
        <button
          type="button"
          className="primary"
          disabled={busy || rows.length === 0}
          title={
            rows.length === 0
              ? "대본을 입력하세요"
              : pendingCount === 0
                ? "모든 문장이 이미 측정되어 있습니다"
                : `${pendingCount}개 문장을 ElevenLabs로 실제 측정합니다`
          }
          onClick={onMeasure}
        >
          🎧 실제 측정
          {pendingCount > 0 ? ` (${pendingCount}문장)` : ""}
        </button>
        <button
          type="button"
          disabled={rows.length === 0}
          title="결과를 텍스트로 복사"
          onClick={onCopy}
        >
          {copied ? "✅ 복사됨" : "📋 결과 복사"}
        </button>
        {onSendToEditor ? (
          <button
            type="button"
            className="primary"
            disabled={busy || rows.length === 0 || !allMeasured}
            title={
              rows.length === 0
                ? "대본을 입력하세요"
                : !allMeasured
                  ? "실제 측정을 먼저 하세요 — 추정치에는 오디오 파일이 없어 넘길 수 없습니다"
                  : "문장별 나레이션과 길이를 영상 편집기 구간에 채웁니다"
            }
            onClick={() =>
              onSendToEditor({
                scriptJobId: jobIdRef.current,
                voiceId,
                speed,
                stability,
                style,
                items: rows.map((r) => ({
                  text: r.text,
                  durationSec: r.tts,
                })),
              })
            }
          >
            🎬 편집기로 보내기
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || listBusy}
          title="다른 PC에서 저장한 측정도 불러올 수 있습니다"
          onClick={() => (listOpen ? setListOpen(false) : refreshSavedList())}
        >
          {listBusy ? "불러오는 중…" : "📂 이전 측정 불러오기"}
        </button>
        {progress ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {progress}
          </span>
        ) : null}
        {savedAt ? (
          <span className="muted" style={{ fontSize: 12 }}>
            저장됨 {new Date(savedAt).toLocaleString("ko-KR")}
          </span>
        ) : null}
        {error ? (
          <span style={{ color: "var(--ve-danger, #d33)", fontSize: 12 }}>
            {error.message}
          </span>
        ) : null}
      </div>

      {listOpen ? (
        <div
          style={{
            border: "1px solid var(--ve-border)",
            borderRadius: 6,
            padding: 10,
            marginBottom: 12,
            maxWidth: 900,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            저장된 대본 측정 ({savedList.length}개)
          </div>
          {savedList.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              저장된 측정이 없습니다. 전 문장을 실제 측정하면 자동으로 저장됩니다.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {savedList.map((it) => {
                const voice =
                  VOICE_OPTIONS.find((v) => v.id === it.voiceId)?.label || "";
                const when = it.savedAt
                  ? new Date(it.savedAt).toLocaleString("ko-KR")
                  : "";
                return (
                  <div
                    key={it.scriptJobId}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 13,
                      borderBottom: "1px solid var(--ve-border)",
                      paddingBottom: 6,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {it.title || "(제목 없음)"}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {when} · {it.sentenceCount}문장 · TTS{" "}
                        {fmt(it.totalTtsSec, 1)}초{voice ? ` · ${voice}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={listBusy}
                      onClick={() => loadSaved(it.scriptJobId)}
                    >
                      불러오기
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {rows.length > 0 && !allMeasured ? (
        <div
          style={{
            fontSize: 12,
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--ve-panel)",
            border: "1px solid var(--ve-border)",
            display: "inline-block",
            marginBottom: 10,
          }}
        >
          ⚠️ <b>추정치가 섞여 있습니다.</b> 글자 수 기반 근사(실측 6문장 기준 최대
          오차 약 0.3초)이며 실제 TTS 길이와 다를 수 있습니다. 클립 길이를 확정하기
          전에 <b>실제 측정</b>을 누르세요.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="muted">대본을 입력하면 문장별 길이가 계산됩니다.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 44 }}>번호</th>
                <th style={th}>문장</th>
                <th style={{ ...th, textAlign: "right" }}>TTS 길이</th>
                <th style={{ ...th, textAlign: "right" }}>필요 길이</th>
                <th style={{ ...th, textAlign: "right" }}>제안 클립 길이</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key + r.i}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.i + 1}</td>
                  <td style={{ ...td, minWidth: 260 }}>{r.text}</td>
                  <td style={num}>
                    {fmt(r.tts)}초
                    {r.isMeasured ? (
                      <span
                        title="ElevenLabs 실제 측정값"
                        style={{ color: "var(--ve-text-sub)", marginLeft: 4 }}
                      >
                        실측
                      </span>
                    ) : (
                      <span
                        title="글자 수 기반 추정치 — 실제 측정 전"
                        style={{ color: "var(--ve-warning, #c80)", marginLeft: 4 }}
                      >
                        추정
                      </span>
                    )}
                  </td>
                  <td style={num}>{fmt(r.req)}초</td>
                  <td style={{ ...num, fontWeight: 600 }}>{r.clip}초</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...td, fontWeight: 600 }} colSpan={2}>
                  합계 ({rows.length}문장)
                </td>
                <td style={{ ...num, fontWeight: 600 }}>{fmt(totals.tts)}초</td>
                <td style={{ ...num, fontWeight: 600 }}>{fmt(totals.req)}초</td>
                <td style={{ ...num, fontWeight: 600 }}>{totals.clip}초</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
