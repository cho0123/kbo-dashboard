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
  const [musicVolume, setMusicVolume] = useState(0.8);
  const [musicStartTime, setMusicStartTime] = useState(0);
  const [musicFadeOut, setMusicFadeOut] = useState(2);
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
      setMusicVolume(0.8);
      setMusicStartTime(0);
      setMusicFadeOut(2);
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
    exportVideo(slides, mergedPreset, null, shortsType || "shorts1").catch(
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
    exportVideo(slides, mergedPreset, musicFile, shortsType || "shorts1", {
      volume: musicVolume,
      startTime: Number(musicStartTime) || 0,
      fadeOutDuration: musicFadeOut,
    }).catch(() => {});
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

        <label className="preset-field">
          <span>
            음악 볼륨 ({musicVolume.toFixed(2)})
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={musicVolume}
            onChange={(e) =>
              setMusicVolume(Number(e.target.value))
            }
          />
        </label>

        <label className="preset-field">
          <span>음악 시작 위치 (초, 원본 파일 기준)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={musicStartTime}
            onChange={(e) =>
              setMusicStartTime(
                Math.max(0, Number(e.target.value) || 0)
              )
            }
          />
        </label>

        <label className="preset-field">
          <span>
            끝 페이드아웃 길이 ({musicFadeOut.toFixed(1)}초, 0~5)
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={musicFadeOut}
            onChange={(e) =>
              setMusicFadeOut(Number(e.target.value))
            }
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
