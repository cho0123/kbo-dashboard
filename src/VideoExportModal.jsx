import { useEffect, useRef, useState } from "react";
import { useVideoExport } from "./hooks/useVideoExport.js";

export default function VideoExportModal({
  isOpen,
  onClose,
  slides,
  preset,
  shortsType,
  exportSession,
}) {
  const [musicFile, setMusicFile] = useState(null);
  const lastSessionRef = useRef(-1);
  const {
    status,
    progress,
    message,
    error,
    cancel,
    exportVideo,
    triggerDownload,
    downloadUrl,
    revokeDownloadUrl,
  } = useVideoExport();

  useEffect(() => {
    if (!isOpen) {
      lastSessionRef.current = -1;
      setMusicFile(null);
      revokeDownloadUrl();
      return;
    }
    if (!slides?.length || !exportSession) return;
    if (lastSessionRef.current === exportSession) return;
    lastSessionRef.current = exportSession;
    const mergedPreset =
      preset && typeof preset === "object"
        ? preset
        : {
            shorts_type: shortsType || "shorts1",
            slides: {},
            transition: 0.2,
            music: null,
          };
    exportVideo(slides, mergedPreset, null).catch(() => {});
  }, [
    isOpen,
    slides,
    preset,
    shortsType,
    exportSession,
    exportVideo,
    revokeDownloadUrl,
  ]);

  const handleClose = () => {
    if (status === "encoding") {
      cancel();
    }
    revokeDownloadUrl();
    lastSessionRef.current = -1;
    onClose?.();
  };

  const reencodeWithMusic = () => {
    revokeDownloadUrl();
    const mergedPreset =
      preset && typeof preset === "object"
        ? preset
        : {
            shorts_type: shortsType || "shorts1",
            slides: {},
            transition: 0.2,
            music: null,
          };
    exportVideo(slides, mergedPreset, musicFile).catch(() => {});
  };

  const title =
    status === "done" ? "영상 완료" : "영상 생성 중";

  if (!isOpen) return null;

  return (
    <div
      className="preset-modal-overlay video-export-overlay"
      role="presentation"
      onClick={() => {
        if (status === "encoding") return;
        handleClose();
      }}
    >
      <div
        className="preset-modal video-export-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="preset-modal-title">{title}</h2>

        <label className="preset-field">
          <span>배경 음악 (선택)</span>
          <input
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.aac"
            onChange={(e) => setMusicFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="ghost"
          style={{ marginBottom: 12 }}
          onClick={reencodeWithMusic}
          disabled={status === "encoding"}
        >
          선택한 음악으로 다시 인코딩
        </button>

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

        {error ? (
          <pre className="result-error-light video-export-error">
            {error.message || String(error)}
          </pre>
        ) : null}

        <div className="preset-modal-actions video-export-actions">
          {status === "encoding" && (
            <button type="button" className="danger-outline" onClick={cancel}>
              취소
            </button>
          )}
          <button
            type="button"
            className="primary primary-fill"
            disabled={status !== "done" || !downloadUrl}
            onClick={() => triggerDownload()}
          >
            다운로드
          </button>
          <button
            type="button"
            className="ghost"
            disabled={status === "encoding"}
            onClick={handleClose}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
