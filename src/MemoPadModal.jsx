import { useEffect, useState } from "react";

const KEY_PROGRAM = "kbo_memo_program";
const KEY_CONTENT = "kbo_memo_content";

function readMemo(key) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeMemo(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export default function MemoPadModal({ open, onClose }) {
  const [programText, setProgramText] = useState(() => readMemo(KEY_PROGRAM));
  const [contentText, setContentText] = useState(() => readMemo(KEY_CONTENT));
  const [narrowTab, setNarrowTab] = useState("program");

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onProgramChange = (v) => {
    setProgramText(v);
    writeMemo(KEY_PROGRAM, v);
  };

  const onContentChange = (v) => {
    setContentText(v);
    writeMemo(KEY_CONTENT, v);
  };

  const memoTextareaProps = {
    className: "memo-textarea",
    spellCheck: false,
    placeholder: "자유롭게 메모하세요. 입력 시 자동 저장됩니다.",
  };

  return (
    <div
      className="preset-modal-overlay memo-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="memo-pad-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="preset-modal memo-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="memo-modal-head">
          <h2 id="memo-pad-title" className="memo-modal-title">
            메모장
          </h2>
          <button
            type="button"
            className="memo-modal-close"
            aria-label="닫기"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="memo-dual" aria-label="메모 영역">
          <div className="memo-pane">
            <div className="memo-pane-title">프로그램 메모</div>
            <textarea
              {...memoTextareaProps}
              value={programText}
              onChange={(e) => onProgramChange(e.target.value)}
              aria-label="프로그램 메모"
            />
          </div>
          <div className="memo-pane">
            <div className="memo-pane-title">콘텐츠 메모</div>
            <textarea
              {...memoTextareaProps}
              value={contentText}
              onChange={(e) => onContentChange(e.target.value)}
              aria-label="콘텐츠 메모"
            />
          </div>
        </div>

        <div className="memo-tabbed">
          <div className="mini-tabs" role="tablist" aria-label="메모 종류">
            <button
              type="button"
              role="tab"
              aria-selected={narrowTab === "program"}
              className={`mini-tab ${narrowTab === "program" ? "active" : ""}`}
              onClick={() => setNarrowTab("program")}
            >
              프로그램 메모
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={narrowTab === "content"}
              className={`mini-tab ${narrowTab === "content" ? "active" : ""}`}
              onClick={() => setNarrowTab("content")}
            >
              콘텐츠 메모
            </button>
          </div>
          {narrowTab === "program" ? (
            <textarea
              {...memoTextareaProps}
              value={programText}
              onChange={(e) => onProgramChange(e.target.value)}
              aria-label="프로그램 메모"
            />
          ) : (
            <textarea
              {...memoTextareaProps}
              value={contentText}
              onChange={(e) => onContentChange(e.target.value)}
              aria-label="콘텐츠 메모"
            />
          )}
        </div>
      </div>
    </div>
  );
}
