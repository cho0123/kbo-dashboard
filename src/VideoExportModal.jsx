import { useEffect, useRef } from "react";
import { useVideoExport } from "./hooks/useVideoExport.js";

export default function VideoExportModal({
  isOpen,
  onClose,
  slides,
  preset,
  shortsType,
  exportSession,
}) {
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

  const musicLabel =
    preset?.music_name && String(preset.music_name).trim()
      ? String(preset.music_name).trim()
      : null;
  const hasPresetMusic =
    preset?.music_s3_key && String(preset.music_s3_key).trim();

  useEffect(() => {
    if (!isOpen) {
      lastSessionRef.current = -1;
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
          };
    exportVideo(slides, mergedPreset, shortsType || "shorts1").catch(
      () => {}
    );
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

        {hasPresetMusic ? (
          <p className="muted" style={{ marginBottom: 14, fontSize: 14 }}>
            음원:{" "}
            <strong style={{ color: "#00FF94" }}>
              {musicLabel || "라이브러리 음원"}
            </strong>{" "}
            적용 중
          </p>
        ) : (
          <p className="muted" style={{ marginBottom: 14, fontSize: 14 }}>
            배경 음악 없음 (프리셋에서 음원을 선택하면 적용됩니다)
          </p>
        )}

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
