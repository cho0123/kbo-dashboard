import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postKbo } from "./api.js";

/** Presigned PUT — 업로드 진행률(0~100), Content-Type 미설정(SigV4 권장) */
function putPresignedWithProgress(url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((100 * e.loaded) / e.total));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            `S3 업로드 실패 HTTP ${xhr.status}${xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : ""}`
          )
        );
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("S3 업로드 네트워크 오류"))
    );
    xhr.open("PUT", url);
    xhr.send(body);
  });
}

const POLL_MS = 1500;
const POLL_MAX_MS = 45 * 60 * 1000;
const MAX_SEGMENTS = 10;

const VIDEO_ACCEPT =
  ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo";

const CROP_OPTIONS = [
  { id: "left", label: "좌측" },
  { id: "center", label: "중앙" },
  { id: "right", label: "우측" },
];

function emptySegment() {
  return { start: "", end: "" };
}

/** 재생 시각(초) → HH:MM:SS */
function secondsToHhMmSs(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map((n) => String(n).padStart(2, "0")).join(":");
}

/** HH:MM:SS 또는 MM:SS 등 → 초; 불가 시 null */
function parseHhMmSsToSeconds(t) {
  const s = String(t || "").trim();
  if (!s) return null;
  const parts = s.split(":").map((p) => p.trim());
  const nums = parts.map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : NaN;
  });
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) {
    const [h, m, sec] = nums;
    if (m >= 60 || sec >= 60) return null;
    return h * 3600 + m * 60 + sec;
  }
  if (parts.length === 2) {
    const [m, sec] = nums;
    if (sec >= 60) return null;
    return m * 60 + sec;
  }
  if (parts.length === 1) return nums[0];
  return null;
}

export default function Shorts3Panel() {
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

  const videoInputRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  /** idle | uploading | done */
  const [uploadPhase, setUploadPhase] = useState("idle");
  const [previewUrl, setPreviewUrl] = useState(null);
  /** 미리보기에서 시작/종료 시각을 넣을 구간 인덱스 */
  const [previewSegmentIndex, setPreviewSegmentIndex] = useState(0);
  const previewVideoRef = useRef(null);

  const [savedFiles, setSavedFiles] = useState([]);
  const [savedFilesLoading, setSavedFilesLoading] = useState(false);
  const [savedFilesError, setSavedFilesError] = useState(null);

  const refreshSavedFiles = useCallback(async () => {
    setSavedFilesLoading(true);
    setSavedFilesError(null);
    try {
      const res = await postKbo({ action: "highlight_list" });
      setSavedFiles(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setSavedFilesError(e instanceof Error ? e.message : String(e));
      setSavedFiles([]);
    } finally {
      setSavedFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSavedFiles();
  }, [refreshSavedFiles]);

  const segmentTotalSec = useMemo(() => {
    let sum = 0;
    for (const seg of segments) {
      const st = String(seg.start || "").trim();
      const en = String(seg.end || "").trim();
      if (!st || !en) continue;
      const a = parseHhMmSsToSeconds(st);
      const b = parseHhMmSsToSeconds(en);
      if (a == null || b == null) continue;
      if (b <= a) continue;
      sum += b - a;
    }
    return sum;
  }, [segments]);

  const segmentTotalWarnStyle = useMemo(() => {
    if (segmentTotalSec > 300) return { color: "#ff6b8a" };
    if (segmentTotalSec > 60) return { color: "#ffb347" };
    return {};
  }, [segmentTotalSec]);

  const addSegment = useCallback(() => {
    setSegments((s) => (s.length >= MAX_SEGMENTS ? s : [...s, emptySegment()]));
  }, []);

  const removeSegment = useCallback((idx) => {
    setSegments((s) => (s.length <= 2 ? s : s.filter((_, i) => i !== idx)));
  }, []);

  useEffect(() => {
    setPreviewSegmentIndex((i) =>
      Math.min(i, Math.max(0, segments.length - 1))
    );
  }, [segments.length]);

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

  const onVideoFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setVideoFile(f);
    setJobId(null);
    setUploadPhase("idle");
    setUploadProgress(0);
    setPreviewUrl(null);
    setError(null);
  };

  const resetUploadState = useCallback(() => {
    setJobId(null);
    setUploadPhase("idle");
    setUploadProgress(0);
    setPreviewUrl(null);
    setVideoFile(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
    setDownloadUrl(null);
    setStatus("idle");
    setMessage("");
    setProgress(0);
    setError(null);
  }, []);

  const applyVideoTimeToSegment = useCallback((field) => {
    const el = previewVideoRef.current;
    if (!el) return;
    const hms = secondsToHhMmSs(el.currentTime);
    setSegments((prev) =>
      prev.map((seg, i) =>
        i === previewSegmentIndex ? { ...seg, [field]: hms } : seg
      )
    );
  }, [previewSegmentIndex]);

  const onDeleteSource = async () => {
    if (!jobId) return;
    if (
      !window.confirm(
        "S3에 올린 원본 파일을 삭제하고 처음부터 다시 진행합니다. 계속할까요?"
      )
    ) {
      return;
    }
    setError(null);
    try {
      await postKbo({ action: "highlight_delete", jobId });
      resetUploadState();
      setMessage("");
      await refreshSavedFiles();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const onLoadSavedJob = async (id) => {
    setError(null);
    setJobId(id);
    setUploadPhase("done");
    setVideoFile(null);
    if (videoInputRef.current) videoInputRef.current.value = "";
    setDownloadUrl(null);
    setStatus("idle");
    setProgress(0);
    await fetchPreviewUrl(id);
    setMessage(
      "저장된 원본을 불러왔습니다. 구간을 입력한 뒤 영상 생성을 누르세요."
    );
  };

  const onDeleteSavedJob = async (id) => {
    if (!window.confirm("S3에서 이 원본 파일을 삭제할까요?")) return;
    setError(null);
    try {
      await postKbo({ action: "highlight_delete", jobId: id });
      if (jobId === id) {
        resetUploadState();
        setMessage("");
      }
      await refreshSavedFiles();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const fetchPreviewUrl = async (id) => {
    try {
      const pr = await postKbo({ action: "highlight_preview", jobId: id });
      const url = pr?.previewUrl || pr?.url;
      if (url) setPreviewUrl(url);
    } catch (e) {
      console.warn("[highlight_preview]", e);
      setPreviewUrl(null);
    }
  };

  const onUploadSource = async () => {
    if (!videoFile) {
      window.alert("영상 파일(mp4 / mov / avi)을 선택하세요.");
      return;
    }
    const lower = String(videoFile.name || "").toLowerCase();
    const ok =
      lower.endsWith(".mp4") ||
      lower.endsWith(".mov") ||
      lower.endsWith(".avi");
    if (!ok) {
      window.alert("mp4, mov, avi 파일만 업로드할 수 있습니다.");
      return;
    }

    setError(null);
    setUploadPhase("uploading");
    setUploadProgress(0);
    setJobId(null);
    try {
      const prep = await postKbo({ action: "highlight_upload" });
      const putUrl = prep?.presignedPutUrl;
      const id = prep?.jobId;
      if (!putUrl || !id) throw new Error("highlight_upload 응답 오류");
      setJobId(id);
      await putPresignedWithProgress(putUrl, videoFile, setUploadProgress);
      setUploadPhase("done");
      setMessage("원본 업로드 완료 — 구간을 입력한 뒤 영상 생성을 누르세요.");
      await fetchPreviewUrl(id);
      await refreshSavedFiles();
    } catch (e) {
      setUploadPhase("idle");
      setUploadProgress(0);
      setJobId(null);
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  const onGenerate = async () => {
    cancelRef.current = false;
    setError(null);
    setDownloadUrl(null);
    setProgress(0);

    if (!jobId || uploadPhase !== "done") {
      setError(
        new Error("먼저 원본 영상을 선택하고 S3 업로드를 완료하세요.")
      );
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
        jobId,
        segments: segments.map((s) => ({
          start: String(s.start).trim(),
          end: String(s.end).trim(),
        })),
        cropPosition,
      });
      if (!res?.jobId) throw new Error("jobId 없음");

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
  const uploading = uploadPhase === "uploading";

  return (
    <div className="section soft">
      <div className="section-title">3. 쇼츠-하이라이트</div>
      <p className="muted" style={{ marginTop: 6 }}>
        로컬 원본 영상(mp4/mov/avi)을 업로드하고 구간(HH:MM:SS)을 지정하면
        9:16(1080×1920)으로 합성된 mp4를 만듭니다.
      </p>

      <div style={{ marginTop: 16, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          저장된 파일 목록
        </div>
        {savedFilesLoading ? (
          <div className="muted" style={{ fontSize: 14 }}>
            목록 불러오는 중…
          </div>
        ) : savedFilesError ? (
          <div className="muted" style={{ fontSize: 13, color: "#ffb347" }}>
            {savedFilesError}
          </div>
        ) : savedFiles.length === 0 ? (
          <div className="muted" style={{ fontSize: 14 }}>
            저장된 원본이 없습니다.
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {savedFiles.map((row) => {
              const jid = row.jobId || "";
              const shortName = jid.slice(0, 8) || "—";
              const when = row.lastModified
                ? new Date(row.lastModified).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                    dateStyle: "short",
                    timeStyle: "medium",
                  })
                : "—";
              return (
                <li
                  key={jid}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{shortName}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {when}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {typeof row.size === "number"
                      ? `${Math.round(row.size / 1024)} KB`
                      : ""}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 8,
                      marginLeft: "auto",
                    }}
                  >
                    <button
                      type="button"
                      className="primary"
                      disabled={busy || uploading}
                      onClick={() => onLoadSavedJob(jid)}
                    >
                      불러오기
                    </button>
                    <button
                      type="button"
                      disabled={busy || uploading}
                      onClick={() => onDeleteSavedJob(jid)}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid rgba(255, 107, 138, 0.55)",
                        background:
                          "linear-gradient(135deg, rgba(180,40,70,0.55), rgba(120,24,48,0.75))",
                        color: "#ffd0dc",
                        fontWeight: 700,
                        fontFamily: "inherit",
                        cursor:
                          busy || uploading ? "not-allowed" : "pointer",
                        opacity: busy || uploading ? 0.55 : 1,
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 14, maxWidth: 720 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
          원본 영상 파일
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            ref={videoInputRef}
            type="file"
            accept={VIDEO_ACCEPT}
            style={{ display: "none" }}
            onChange={onVideoFileChange}
          />
          <button
            type="button"
            className="primary"
            disabled={busy || uploading}
            onClick={() => videoInputRef.current?.click()}
          >
            파일 선택
          </button>
          <span className="muted" style={{ fontSize: 13, maxWidth: 280 }}>
            {videoFile
              ? `${videoFile.name} (${Math.round(videoFile.size / 1024)} KB)`
              : "선택 없음 — mp4 · mov · avi"}
          </span>
          <button
            type="button"
            className="primary primary-fill"
            disabled={busy || uploading || !videoFile}
            onClick={onUploadSource}
          >
            {uploading ? "업로드 중…" : "S3에 업로드"}
          </button>
        </div>

        {uploading ? (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>
              업로드 진행
            </div>
            <div className="video-export-progress-wrap">
              <div className="video-export-progress-bar">
                <div
                  className="video-export-progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {uploadProgress}%
              </div>
            </div>
          </div>
        ) : uploadPhase === "done" ? (
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span className="muted" style={{ fontWeight: 700 }}>
              업로드 완료 (jobId 저장됨)
            </span>
            <button
              type="button"
              className="ghost"
              disabled={busy || uploading}
              onClick={onDeleteSource}
            >
              파일 삭제
            </button>
          </div>
        ) : null}
      </div>

      {uploadPhase === "done" && previewUrl ? (
        <div style={{ marginTop: 16, maxWidth: 720 }}>
          <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
            원본 미리보기
          </div>
          <video
            ref={previewVideoRef}
            src={previewUrl}
            controls
            playsInline
            style={{
              width: "100%",
              maxHeight: 360,
              borderRadius: 8,
              background: "#000",
            }}
          />
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              적용 구간
              <select
                value={previewSegmentIndex}
                onChange={(e) =>
                  setPreviewSegmentIndex(Number(e.target.value) || 0)
                }
                disabled={busy || uploading}
                style={{ padding: 6 }}
              >
                {segments.map((_, i) => (
                  <option key={i} value={i}>
                    #{i + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="primary"
              disabled={busy || uploading}
              onClick={() => applyVideoTimeToSegment("start")}
            >
              ▶ 시작점 설정
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || uploading}
              onClick={() => applyVideoTimeToSegment("end")}
            >
              ⏹ 종료점 설정
            </button>
          </div>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            재생 위치의 시간을 HH:MM:SS로 선택한 구간에 반영합니다.
          </p>
        </div>
      ) : null}

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
            disabled={busy || uploading}
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
                disabled={busy || uploading}
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
                disabled={busy || uploading}
                style={{
                  padding: 8,
                  width: 120,
                  boxSizing: "border-box",
                }}
              />
              <button
                type="button"
                className="ghost"
                disabled={busy || uploading || segments.length <= 2}
                onClick={() => removeSegment(index)}
                title="삭제"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 15,
            fontWeight: 700,
            ...segmentTotalWarnStyle,
          }}
        >
          총 구간 합계: {secondsToHhMmSs(segmentTotalSec)} (
          {Math.floor(segmentTotalSec)}초)
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>
          크롭 위치 (가로 영상 기준 세로 9:16)
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CROP_OPTIONS.map((o) => {
            const active = cropPosition === o.id;
            return (
              <button
                key={o.id}
                type="button"
                disabled={busy || uploading}
                onClick={() => setCropPosition(o.id)}
                style={{
                  background: active ? "#0a8f6a" : "#13c79a",
                  border: active
                    ? "2px solid #fff"
                    : "2px solid transparent",
                  fontWeight: active ? "bold" : "normal",
                  color: "#0b1a14",
                  padding: "10px 18px",
                  borderRadius: 8,
                  cursor: busy || uploading ? "not-allowed" : "pointer",
                  opacity: busy || uploading ? 0.65 : 1,
                }}
              >
                {o.label}
              </button>
            );
          })}
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
          disabled={busy || uploading || uploadPhase !== "done"}
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
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
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
          <button
            type="button"
            className="primary"
            disabled={busy || uploading || uploadPhase !== "done" || !jobId}
            onClick={() => {
              setError(null);
              onGenerate();
            }}
          >
            다시 생성
          </button>
        </div>
      ) : null}
    </div>
  );
}
