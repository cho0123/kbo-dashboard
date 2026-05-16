import { useCallback, useEffect, useRef, useState } from "react";

const LOCAL_SERVER = "http://localhost:3838";

const VIDEO_ACCEPT =
  ".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo";

function basename(filePath) {
  const s = String(filePath || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function formatSizeMb(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function newClipId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `clip_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatTimeDigitsInput(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 6);
  const len = digits.length;
  if (len <= 2) return digits;
  if (len <= 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`;
}

function formatSecondsToTimeInput(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function resolvePreviewSrcForFile(file, streamPath) {
  const pathFromProp =
    typeof streamPath === "string" ? streamPath.trim() : "";
  const pathFromFile =
    file && typeof file.path === "string" ? file.path.trim() : "";
  const diskPath = pathFromProp || pathFromFile;
  if (diskPath) {
    return {
      src: `${LOCAL_SERVER}/stream?path=${encodeURIComponent(diskPath)}`,
      isBlob: false,
    };
  }
  if (file) {
    return { src: URL.createObjectURL(file), isBlob: true };
  }
  return { src: null, isBlob: false };
}

function isAllowedVideoFile(file) {
  if (!file) return false;
  const lower = String(file.name || "").toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".avi")
  );
}

function stripMp4Ext(name) {
  return String(name || "")
    .trim()
    .replace(/\.mp4$/i, "");
}

function collectUsedOutputStems(clips) {
  const used = new Set();
  for (const c of clips) {
    const stem = stripMp4Ext(c.label || basename(c.clipPath));
    if (stem) used.add(stem.toLowerCase());
  }
  return used;
}

function resolveUniqueOutputName(rawName, clips) {
  const used = collectUsedOutputStems(clips);
  const base = stripMp4Ext(rawName);

  if (!base) {
    let n = 1;
    while (used.has(`clip_${n}`.toLowerCase())) n += 1;
    return `clip_${n}`;
  }

  if (!used.has(base.toLowerCase())) return base;

  let n = 1;
  while (used.has(`clip_${base}_${n}`.toLowerCase())) n += 1;
  return `clip_${base}_${n}`;
}

async function postJson(path, body) {
  const res = await fetch(`${LOCAL_SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(String(data?.error || data?.message || `HTTP ${res.status}`));
  }
  return data;
}

async function postClipFormData({ videoFile, startTime, endTime, outputName }) {
  const fd = new FormData();
  fd.append("file", videoFile, videoFile.name);
  fd.append("startTime", startTime);
  fd.append("endTime", endTime);
  if (outputName) fd.append("outputName", outputName);

  const res = await fetch(`${LOCAL_SERVER}/clip`, {
    method: "POST",
    body: fd,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || data?.ok === false) {
    throw new Error(String(data?.error || data?.message || `HTTP ${res.status}`));
  }
  return data;
}

const fieldStyle = { width: "100%", boxSizing: "border-box", marginTop: 4 };
const rowStyle = { display: "grid", gap: 10, marginTop: 10 };
const labelStyle = { display: "block", fontWeight: 700, fontSize: 13 };

export default function VideoPrep({ onJobReady, streamPath }) {
  const videoInputRef = useRef(null);
  const previewVideoRef = useRef(null);
  const previewBlobUrlRef = useRef(null);
  const [videoFile, setVideoFile] = useState(null);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [clipName, setClipName] = useState("");
  const [clips, setClips] = useState([]);
  const [clipBusy, setClipBusy] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [error, setError] = useState(null);

  const clearPreviewBlob = useCallback(() => {
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
  }, []);

  const applyPreviewFile = useCallback(
    (f) => {
      clearPreviewBlob();
      const { src, isBlob } = resolvePreviewSrcForFile(f, streamPath);
      if (isBlob && src) previewBlobUrlRef.current = src;
      setPreviewSrc(src);
    },
    [clearPreviewBlob, streamPath]
  );

  useEffect(() => () => clearPreviewBlob(), [clearPreviewBlob]);

  useEffect(() => {
    if (videoFile) applyPreviewFile(videoFile);
  }, [streamPath, videoFile, applyPreviewFile]);

  const onVideoFileChange = useCallback(
    (e) => {
      const f = e.target.files?.[0] ?? null;
      setVideoFile(f);
      applyPreviewFile(f);
      setError(null);
    },
    [applyPreviewFile]
  );

  const applyCurrentTimeToStart = useCallback(() => {
    const v = previewVideoRef.current;
    if (!v) return;
    setStartTime(formatTimeDigitsInput(formatSecondsToTimeInput(v.currentTime)));
  }, []);

  const applyCurrentTimeToEnd = useCallback(() => {
    const v = previewVideoRef.current;
    if (!v) return;
    setEndTime(formatTimeDigitsInput(formatSecondsToTimeInput(v.currentTime)));
  }, []);

  const handleCut = useCallback(async () => {
    if (!videoFile) {
      setError("영상 파일(mp4 / mov / avi)을 선택하세요.");
      return;
    }
    if (!isAllowedVideoFile(videoFile)) {
      setError("mp4, mov, avi 파일만 사용할 수 있습니다.");
      return;
    }

    const start = startTime.trim();
    const end = endTime.trim();
    if (!start || !end) {
      setError("시작·종료 시간을 모두 입력하세요.");
      return;
    }

    setClipBusy(true);
    setError(null);
    try {
      const outputName = resolveUniqueOutputName(clipName, clips);
      const data = await postClipFormData({
        videoFile,
        startTime: start,
        endTime: end,
        outputName,
      });
      const label = outputName || basename(data.clipPath) || `clip_${clips.length + 1}`;
      setClips((prev) => [
        ...prev,
        {
          id: newClipId(),
          clipPath: data.clipPath,
          size: data.size,
          label,
        },
      ]);
      setVideoFile(null);
      clearPreviewBlob();
      setPreviewSrc(null);
      if (videoInputRef.current) videoInputRef.current.value = "";
      setStartTime("");
      setEndTime("");
      setClipName("");
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setClipBusy(false);
    }
  }, [videoFile, startTime, endTime, clipName, clips, clearPreviewBlob]);

  const removeClip = useCallback((id) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const moveClip = useCallback((index, delta) => {
    setClips((prev) => {
      const next = prev.slice();
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[j];
      next[j] = tmp;
      return next;
    });
  }, []);

  const handleMergeUpload = useCallback(async () => {
    if (clips.length < 2) return;

    setMergeBusy(true);
    setError(null);
    try {
      const data = await postJson("/merge-upload", {
        clips: clips.map((c) => c.clipPath),
      });
      const jobId = data.jobId;
      window.alert(`업로드 완료! JobId: ${jobId}`);
      if (typeof onJobReady === "function") {
        onJobReady(jobId);
      }
      setClips([]);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setMergeBusy(false);
    }
  }, [clips, onJobReady]);

  const rowBusy = clipBusy || mergeBusy;

  return (
    <div className="section soft video-prep">
      <div className="section-title">영상 클립 준비</div>
      <div className="muted" style={{ fontSize: 13 }}>
        로컬 서버({LOCAL_SERVER})에서 ffmpeg로 구간 자르기 · 합치기 · S3 업로드
      </div>

      <div style={{ ...rowStyle, marginTop: 14 }}>
        <div className="muted" style={labelStyle}>
          1. 클립 추가
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            ref={videoInputRef}
            type="file"
            accept={VIDEO_ACCEPT}
            style={{ display: "none" }}
            onChange={onVideoFileChange}
            disabled={rowBusy}
          />
          <button
            type="button"
            className="primary"
            disabled={rowBusy}
            onClick={() => videoInputRef.current?.click()}
            style={{ flex: "0 0 auto", padding: "8px 12px" }}
          >
            파일 선택
          </button>
          <span
            className="muted"
            style={{
              fontSize: 12,
              flex: "1 1 140px",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={
              videoFile
                ? `${videoFile.name} (${Math.round(videoFile.size / 1024)} KB)`
                : ""
            }
          >
            {videoFile
              ? `${videoFile.name} (${Math.round(videoFile.size / 1024)} KB)`
              : "선택 없음 — mp4 · mov · avi"}
          </span>
        </div>

        {previewSrc ? (
          <div style={{ marginTop: 10 }}>
            <video
              ref={previewVideoRef}
              src={previewSrc}
              controls
              preload="metadata"
              style={{
                width: "100%",
                maxHeight: 280,
                borderRadius: 8,
                background: "#000",
              }}
            />
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                type="button"
                className="primary"
                disabled={rowBusy}
                onClick={applyCurrentTimeToStart}
                style={{ flex: "0 0 auto", padding: "8px 12px" }}
              >
                ▶ 시작점 설정
              </button>
              <button
                type="button"
                className="primary"
                disabled={rowBusy}
                onClick={applyCurrentTimeToEnd}
                style={{ flex: "0 0 auto", padding: "8px 12px" }}
              >
                ⏹ 종료점 설정
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="muted" style={labelStyle}>
            시작 시간
            <input
              type="text"
              value={startTime}
              onChange={(e) => setStartTime(formatTimeDigitsInput(e.target.value))}
              disabled={rowBusy}
              placeholder="00:00:00"
              maxLength={8}
              style={fieldStyle}
            />
          </label>
          <label className="muted" style={labelStyle}>
            종료 시간
            <input
              type="text"
              value={endTime}
              onChange={(e) => setEndTime(formatTimeDigitsInput(e.target.value))}
              disabled={rowBusy}
              placeholder="00:00:10"
              maxLength={8}
              style={fieldStyle}
            />
          </label>
        </div>

        <label className="muted" style={labelStyle}>
          클립 이름 (선택)
          <input
            type="text"
            value={clipName}
            onChange={(e) => setClipName(e.target.value)}
            disabled={rowBusy}
            placeholder="clip_1"
            style={fieldStyle}
          />
        </label>

        <button
          type="button"
          className="primary primary-fill"
          onClick={() => void handleCut()}
          disabled={rowBusy || !videoFile}
        >
          {clipBusy ? "처리중..." : "자르기"}
        </button>
      </div>

      <div style={{ ...rowStyle, marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
        <div className="muted" style={labelStyle}>
          2. 클립 목록 ({clips.length}개)
        </div>

        {clips.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>
            추가된 클립이 없습니다
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {clips.map((c, i) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "10px 12px",
                  background: "rgba(0,0,0,0.04)",
                  borderRadius: 8,
                  border: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                <span style={{ fontWeight: 800, minWidth: 24 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.label}</div>
                  <div className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                    {basename(c.clipPath)} · {formatSizeMb(c.size)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="primary" disabled={rowBusy || i === 0} onClick={() => moveClip(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={rowBusy || i === clips.length - 1}
                    onClick={() => moveClip(i, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="primary" disabled={rowBusy} onClick={() => removeClip(c.id)}>
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ ...rowStyle, marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
        <div className="muted" style={labelStyle}>
          3. 합치기 + 업로드
        </div>
        <button
          type="button"
          className="primary primary-fill"
          onClick={() => void handleMergeUpload()}
          disabled={rowBusy || clips.length < 2}
        >
          {mergeBusy ? "업로드 중..." : "합치기 + S3 업로드"}
        </button>
        {clips.length < 2 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            클립 2개 이상 필요합니다.
          </div>
        ) : null}
      </div>

      {error ? <pre className="result-error-light" style={{ marginTop: 12 }}>{error}</pre> : null}
    </div>
  );
}
