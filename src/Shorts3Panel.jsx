import { useCallback, useRef, useState } from "react";
import { postKbo } from "./api.js";

const POLL_MS = 1500;
const POLL_MAX_MS = 45 * 60 * 1000;
const MAX_SEGMENTS = 10;

const CROP_OPTIONS = [
  { id: "left", label: "좌측" },
  { id: "center", label: "중앙" },
  { id: "right", label: "우측" },
];

function emptySegment() {
  return { start: "", end: "" };
}

export default function Shorts3Panel() {
  const [url, setUrl] = useState("");
  const [segments, setSegments] = useState([
    emptySegment(),
    emptySegment(),
  ]);
  const [cropPosition, setCropPosition] = useState("center");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const cancelRef = useRef(false);

  const addSegment = useCallback(() => {
    setSegments((s) => (s.length >= MAX_SEGMENTS ? s : [...s, emptySegment()]));
  }, []);

  const removeSegment = useCallback((idx) => {
    setSegments((s) => (s.length <= 2 ? s : s.filter((_, i) => i !== idx)));
  }, []);

  const handleTimeChange = (segIndex, field, rawVal) => {
    const digits = rawVal.replace(/\D/g, "").slice(0, 6);
    let formatted = digits;
    if (digits.length > 4) {
      formatted =
        digits.slice(0, 2) + ":" + digits.slice(2, 4) + ":" + digits.slice(4);
    } else if (digits.length > 2) {
      formatted = digits.slice(0, 2) + ":" + digits.slice(2);
    }
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === segIndex ? { ...seg, [field]: formatted } : seg
      )
    );
  };

  const onGenerate = async () => {
    cancelRef.current = false;
    setError(null);
    setDownloadUrl(null);
    setProgress(0);
    const u = String(url || "").trim();
    if (!u) {
      setError(new Error("유튜브 URL을 입력하세요."));
      return;
    }
    for (let i = 0; i < segments.length; i++) {
      const { start, end } = segments[i];
      if (!String(start).trim() || !String(end).trim()) {
        setError(new Error(`구간 ${i + 1}: 시작·종료 시간을 모두 입력하세요.`));
        return;
      }
    }

    try {
      setStatus("encoding");
      setMessage("작업 요청 중…");
      const res = await postKbo({
        action: "highlight_video_create",
        url: u,
        segments: segments.map((s) => ({
          start: String(s.start).trim(),
          end: String(s.end).trim(),
        })),
        cropPosition,
      });
      const jobId = res?.jobId;
      if (!jobId) throw new Error("jobId 없음");

      setMessage("서버 인코딩 중… (상태 폴링)");
      const started = Date.now();

      while (Date.now() - started < POLL_MAX_MS) {
        if (cancelRef.current) {
          setStatus("idle");
          setMessage("취소됨");
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        const pollRes = await fetch(
          `/api/video-encode?jobId=${encodeURIComponent(jobId)}`
        );
        const pollText = await pollRes.text();
        let data;
        try {
          data = JSON.parse(pollText);
        } catch {
          throw new Error(pollText || "폴링 응답 오류");
        }
        if (typeof data.progress === "number") {
          setProgress(Math.min(99, Math.max(0, data.progress)));
        }
        if (data.state === "unknown") continue;
        if (data.state === "done" && data.downloadUrl) {
          setDownloadUrl(data.downloadUrl);
          setProgress(100);
          setStatus("done");
          setMessage("완료 — 아래에서 mp4를 저장하세요.");
          return;
        }
        if (data.state === "error") {
          throw new Error(data.error || "인코딩 실패");
        }
      }
      throw new Error("인코딩 시간 초과");
    } catch (e) {
      if (cancelRef.current) {
        setStatus("idle");
        setMessage("취소됨");
        return;
      }
      setStatus("error");
      setError(e instanceof Error ? e : new Error(String(e)));
      setMessage("");
    }
  };

  const busy = status === "encoding";

  return (
    <div className="section soft">
      <div className="section-title">3. 쇼츠-하이라이트</div>
      <p className="muted" style={{ marginTop: 6 }}>
        유튜브 URL과 구간(HH:MM:SS)을 지정하면 9:16(1080×1920)으로 합성된 mp4를
        만듭니다.
      </p>

      <div style={{ marginTop: 14, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
          유튜브 URL
        </div>
        <input
          type="url"
          className="input-wide"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          style={{ width: "100%", boxSizing: "border-box", padding: 10 }}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div className="muted" style={{ fontWeight: 700 }}>
            구간 설정 (최대 {MAX_SEGMENTS}개)
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy || segments.length >= MAX_SEGMENTS}
            onClick={addSegment}
          >
            + 구간 추가
          </button>
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {segments.map((seg, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                flexDirection: "row",
                flexWrap: "nowrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span className="muted" style={{ minWidth: 40, flexShrink: 0 }}>
                #{index + 1}
              </span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="00:00:00"
                maxLength={8}
                value={seg.start}
                onChange={(e) =>
                  handleTimeChange(index, "start", e.target.value)
                }
                disabled={busy}
                style={{
                  padding: 8,
                  width: 120,
                  boxSizing: "border-box",
                }}
              />
              <span className="muted">~</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="00:00:00"
                maxLength={8}
                value={seg.end}
                onChange={(e) =>
                  handleTimeChange(index, "end", e.target.value)
                }
                disabled={busy}
                style={{
                  padding: 8,
                  width: 120,
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                className="ghost"
                disabled={busy || segments.length <= 2}
                onClick={() => removeSegment(index)}
                title="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          크롭 위치 (가로 영상 기준 세로 9:16)
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CROP_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={
                cropPosition === o.id ? "primary primary-fill" : "primary"
              }
              disabled={busy}
              onClick={() => setCropPosition(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="primary primary-fill"
          disabled={busy}
          onClick={onGenerate}
        >
          {busy ? "처리 중…" : "영상 생성"}
        </button>
        {busy ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            취소
          </button>
        ) : null}
      </div>

      {busy ? (
        <div style={{ marginTop: 16 }}>
          <div className="video-export-progress-wrap">
            <div className="video-export-progress-bar">
              <div
                className="video-export-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              {progress}%
            </div>
          </div>
          <p className="video-export-message">{message}</p>
        </div>
      ) : message ? (
        <div className="muted" style={{ marginTop: 12 }}>
          {message}
        </div>
      ) : null}

      {error ? (
        <pre className="result-error-light" style={{ marginTop: 12 }}>
          {error.message}
        </pre>
      ) : null}

      {downloadUrl ? (
        <div style={{ marginTop: 16 }}>
          <a
            className="primary primary-fill"
            href={downloadUrl}
            download="highlight.mp4"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              borderRadius: 8,
              textDecoration: "none",
              color: "#0b1a14",
              fontWeight: 800,
            }}
          >
            mp4 다운로드
          </a>
        </div>
      ) : null}
    </div>
  );
}
