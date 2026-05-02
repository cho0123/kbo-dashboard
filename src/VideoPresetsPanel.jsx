import { useCallback, useEffect, useMemo, useState } from "react";
import { postKbo } from "./api.js";
import {
  defaultSlidesForType,
  mergeSlides,
  slideFieldDefs,
  slideFrameCountForKey,
} from "./videoPresetDefaults.js";

const SHORTS_TYPES = [
  { id: "shorts1", label: "쇼츠1" },
  { id: "shorts2", label: "쇼츠2" },
  { id: "shorts3", label: "쇼츠3" },
];

export default function VideoPresetsPanel() {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [filterTab, setFilterTab] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [shortsType, setShortsType] = useState("shorts1");
  const [slides, setSlides] = useState(() => defaultSlidesForType("shorts1"));
  const [transition, setTransition] = useState(0.2);
  const [music, setMusic] = useState("");
  const [saveErr, setSaveErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await postKbo({ action: "video_presets_list" });
      setPresets(Array.isArray(res?.presets) ? res.presets : []);
    } catch (e) {
      setListError(e?.message || String(e));
      setPresets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const filtered = useMemo(() => {
    if (filterTab === "all") return presets;
    return presets.filter((p) => p.shorts_type === filterTab);
  }, [presets, filterTab]);

  const openNew = () => {
    setEditingId(null);
    setName("");
    setShortsType("shorts1");
    setSlides(defaultSlidesForType("shorts1"));
    setTransition(0.2);
    setMusic("");
    setSaveErr(null);
    setFormOpen(true);
  };

  const openEdit = (p) => {
    setEditingId(p.id);
    setName(p.name || "");
    const st = p.shorts_type || "shorts1";
    setShortsType(st);
    setSlides(mergeSlides(st, p.slides));
    setTransition(Number.isFinite(Number(p.transition)) ? Number(p.transition) : 0.2);
    setMusic(p.music != null ? String(p.music) : "");
    setSaveErr(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setSaveErr(null);
  };

  const onShortsTypeChange = (next) => {
    setShortsType(next);
    setSlides((prev) => mergeSlides(next, prev));
  };

  const onSave = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      await postKbo({
        action: "video_presets_save",
        id: editingId || undefined,
        name,
        shorts_type: shortsType,
        slides,
        transition,
        music: music.trim() || null,
      });
      await loadList();
      closeForm();
    } catch (e) {
      setSaveErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!editingId) return;
    if (!window.confirm("이 프리셋을 삭제할까요?")) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await postKbo({ action: "video_presets_delete", id: editingId });
      await loadList();
      closeForm();
    } catch (e) {
      setSaveErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const slideRows = slideFieldDefs(shortsType);

  const estimatedVideoSec = useMemo(() => {
    const keys = slideRows.map((r) => r.key);
    const n = keys.length;
    let sumD = 0;
    for (const k of keys) {
      const v = Number(slides[k]);
      const d = Number.isFinite(v) ? Math.max(0, v) : 0;
      const frames = slideFrameCountForKey(shortsType, k);
      sumD += d * frames;
    }
    const Tf = Number(transition);
    const t = Number.isFinite(Tf) ? Math.max(0, Tf) : 0;
    if (n <= 1) return sumD;
    return Math.max(0, sumD - n * t);
  }, [slideRows, slides, transition, shortsType]);

  const estimatedHumanApprox = useMemo(() => {
    const est = estimatedVideoSec;
    const minPart = Math.floor(est / 60);
    const secPart = Math.round((est - minPart * 60) * 10) / 10;
    if (minPart === 0) return `${secPart}초`;
    return `${minPart}분 ${secPart}초`;
  }, [estimatedVideoSec]);

  return (
    <div className="result-page video-presets-page">
      <div className="result-hero-title">⚙️ 영상 프리셋 설정</div>
      <p className="muted" style={{ marginTop: 6 }}>
        Firestore <code>video_presets</code>에 저장됩니다. 음악은 메모만 저장합니다.
      </p>

      <div className="preset-filter-tabs" role="tablist">
        {["all", "shorts1", "shorts2", "shorts3"].map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filterTab === key}
            className={`preset-tab ${filterTab === key ? "active" : ""}`}
            onClick={() => setFilterTab(key)}
          >
            {key === "all"
              ? "전체"
              : key === "shorts1"
                ? "쇼츠1"
                : key === "shorts2"
                  ? "쇼츠2"
                  : "쇼츠3"}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="primary primary-fill" onClick={openNew}>
          새 프리셋 추가
        </button>
        <button type="button" className="ghost" onClick={() => loadList()} disabled={loading}>
          목록 새로고침
        </button>
      </div>

      {listError ? <pre className="result-error-light">{listError}</pre> : null}
      {loading ? <div className="muted" style={{ marginTop: 12 }}>불러오는 중…</div> : null}

      <div className="preset-card-grid">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="preset-card"
            role="button"
            tabIndex={0}
            onClick={() => openEdit(p)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openEdit(p);
              }
            }}
          >
            <div className="preset-card-title">{p.name || "(이름 없음)"}</div>
            <div className="preset-card-badge">{p.shorts_type}</div>
            <div className="preset-card-meta muted">
              전환 {Number.isFinite(Number(p.transition)) ? p.transition : "—"}초
              {p.music ? ` · 🎵 ${String(p.music).slice(0, 40)}` : ""}
            </div>
          </div>
        ))}
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="muted" style={{ marginTop: 16 }}>
          표시할 프리셋이 없습니다. 필터를 바꾸거나 새로 추가하세요.
        </div>
      ) : null}

      {formOpen ? (
        <div className="preset-modal-overlay" role="presentation" onClick={closeForm}>
          <div
            className="preset-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preset-form-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="preset-form-title" className="preset-modal-title">
              {editingId ? "프리셋 편집" : "새 프리셋"}
            </h2>

            <label className="preset-field">
              <span>프리셋 이름</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 쇼츠1 - BGM_A"
              />
            </label>

            <label className="preset-field">
              <span>쇼츠 타입</span>
              <select value={shortsType} onChange={(e) => onShortsTypeChange(e.target.value)}>
                {SHORTS_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="preset-slide-grid">
              {slideRows.map(({ key, label }) => (
                <label key={key} className="preset-field preset-slide-field">
                  <span>
                    {label} <small className="muted">(초)</small>
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={slides[key] ?? ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setSlides((s) => ({
                        ...s,
                        [key]: Number.isFinite(v) ? v : 0,
                      }));
                    }}
                  />
                </label>
              ))}
            </div>

            <label className="preset-field">
              <span>
                전환 효과 <small className="muted">(초)</small>
              </span>
              <input
                type="number"
                step="0.05"
                min="0"
                value={transition}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setTransition(Number.isFinite(v) ? v : 0);
                }}
              />
            </label>

            <p
              style={{
                margin: "4px 0 10px",
                fontSize: 14,
                color: "#00FF94",
                fontWeight: "500",
              }}
            >
              예상 영상 길이: {estimatedVideoSec.toFixed(1)}초 (약 {estimatedHumanApprox})
            </p>

            <label className="preset-field">
              <span>음악 (메모)</span>
              <input
                type="text"
                value={music}
                onChange={(e) => setMusic(e.target.value)}
                placeholder="파일 연결 예정 — 메모만 저장"
              />
            </label>

            {saveErr ? <pre className="result-error-light">{saveErr}</pre> : null}

            <div className="preset-modal-actions">
              <button type="button" className="primary primary-fill" disabled={saving} onClick={onSave}>
                {saving ? "저장 중…" : "저장"}
              </button>
              <button type="button" className="ghost" disabled={saving} onClick={closeForm}>
                취소
              </button>
              {editingId ? (
                <button type="button" className="danger-outline" disabled={saving} onClick={onDelete}>
                  삭제
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
