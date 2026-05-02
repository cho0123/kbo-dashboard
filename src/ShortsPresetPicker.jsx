import { useCallback, useEffect, useMemo, useState } from "react";
import { postKbo } from "./api.js";
import VideoExportModal from "./VideoExportModal.jsx";

export default function ShortsPresetPicker({ shortsType, slides = [] }) {
  const [list, setList] = useState([]);
  const [sel, setSel] = useState("");
  const [presetObj, setPresetObj] = useState(null);
  const [err, setErr] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSession, setExportSession] = useState(0);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await postKbo({
        action: "video_presets_list",
        shorts_type: shortsType,
      });
      setList(Array.isArray(res?.presets) ? res.presets : []);
    } catch (e) {
      setList([]);
      setErr(e?.message || String(e));
    }
  }, [shortsType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!sel) {
      setPresetObj(null);
      return;
    }
    const p = list.find((x) => x.id === sel) || null;
    setPresetObj(p);
  }, [sel, list]);

  const label =
    shortsType === "shorts1"
      ? "쇼츠1"
      : shortsType === "shorts2"
        ? "쇼츠2"
        : shortsType;

  const captureCount = Array.isArray(slides) ? slides.length : 0;

  const statusLabel = useMemo(() => {
    if (captureCount === 0) return "미캡처";
    return `✅ ${captureCount}장 캡처됨`;
  }, [captureCount]);

  const onVideoClick = () => {
    if (!captureCount) {
      window.alert("먼저 슬라이드를 캡처해주세요");
      return;
    }
    setExportSession((x) => x + 1);
    setExportOpen(true);
  };

  return (
    <>
      <div
        className="shorts-preset-picker"
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        <span className="muted" style={{ fontWeight: 700 }}>
          프리셋 선택 ({label})
        </span>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">— 선택 —</option>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
        <button type="button" className="primary" onClick={onVideoClick}>
          영상 생성
        </button>
        <button type="button" className="ghost" onClick={() => load()} title="목록 새로고침">
          ↻
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          {statusLabel}
        </span>
        {err ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {err}
          </span>
        ) : null}
      </div>

      <VideoExportModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        slides={slides}
        preset={presetObj}
        shortsType={shortsType}
        exportSession={exportSession}
      />
    </>
  );
}
