import { useState } from "react";
import { postKbo } from "./api.js";

// 기존 Shorts3Panel과 동일한 음성 목록 재활용
const VOICE_OPTIONS = [
  { id: "m3gJBS8OofDJfycyA2Ip", label: "남(기본)" },
  { id: "5n5gqmaQi9Ewevrz7bOS", label: "여(차분)" },
  { id: "QPFsEL6IBxlT15xfiD6C", label: "여(발랄)" },
  { id: "iWLjl1zCuqXRkW6494ve", label: "여(아나운서)" },
  { id: "RU7aSi6lT4uQBXMLgDxK", label: "남(저음)" },
];

const CATEGORY_OPTIONS = ["전자제품", "식품", "생활용품", "화장품", "기타"];
const PRESET_OPTIONS = ["Product Review", "UGC", "Unboxing"];
const RATING_OPTIONS = [1, 2, 3, 4, 5];

export default function ShortsProductReviewPanel() {
  // 제품 정보
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("기타");
  const [rating, setRating] = useState(5);
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [summary, setSummary] = useState("");

  // 영상 설정
  const [preset, setPreset] = useState("Product Review");
  const [imageUrl, setImageUrl] = useState("");

  // 프롬프트
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);

  // 대본/나레이션
  const [script, setScript] = useState("");
  const [scriptBusy, setScriptBusy] = useState(false);
  const [voiceId, setVoiceId] = useState("m3gJBS8OofDJfycyA2Ip");
  const [narrationBusy, setNarrationBusy] = useState(false);
  const [narrationUrl, setNarrationUrl] = useState("");

  const [error, setError] = useState("");

  // Higgsfield 프롬프트 자동생성
  const handleGeneratePrompt = () => {
    if (!productName.trim()) {
      setError("제품명을 입력해주세요.");
      return;
    }
    setError("");
    const starStr = "⭐".repeat(rating);
    const prompt = `Marketing Studio "${preset}" preset. 9:16 vertical shorts video.
Product: ${productName} (${category})
Rating: ${starStr} (${rating}/5)
Pros: ${pros}
Cons: ${cons}
Summary: ${summary}
Product image: ${imageUrl || "없음"}
Style: Clean, modern, trustworthy product review for YouTube Shorts. Korean consumer product review style.
No audio. Silent video only. Background video without sound.`;
    setGeneratedPrompt(prompt);
  };

  // 클립보드 복사
  const handleCopyPrompt = async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  // 대본 자동생성 (Claude API via postKbo)
  const handleGenerateScript = async () => {
    if (!productName.trim()) {
      setError("제품명을 입력해주세요.");
      return;
    }
    setError("");
    setScriptBusy(true);
    try {
      const res = await postKbo({
        action: "generate_product_review_script",
        productName,
        category,
        rating,
        pros,
        cons,
        summary,
      });
      if (res?.ok === false) throw new Error(res.error || "대본 생성 실패");
      setScript(res?.script || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setScriptBusy(false);
    }
  };

  // 나레이션 생성 (ElevenLabs via postKbo)
  const handleGenerateNarration = async () => {
    if (!script.trim()) {
      setError("대본을 먼저 생성해주세요.");
      return;
    }
    setError("");
    setNarrationBusy(true);
    try {
      const res = await postKbo({
        action: "elevenlabs_tts",
        jobId: crypto.randomUUID(),
        segIndex: 0,
        text: script,
        voiceId,
        speed: 1.0,
        stability: 0.5,
        style: 0.5,
      });
      if (res?.ok === false) throw new Error(res.error || "나레이션 생성 실패");
      setNarrationUrl(res?.presignedUrl || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setNarrationBusy(false);
    }
  };

  return (
    <div className="section soft">
      <div className="section-title">🛒 쇼츠-제품리뷰</div>

      {/* 제품 정보 */}
      <div className="section" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 14 }}>
          📝 제품 정보
        </div>

        <div className="preset-field">
          <label>제품명</label>
          <input
            type="text"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="예: 아조나 치약 25ml 24개 세트"
            style={{ width: "100%" }}
          />
        </div>

        <div className="preset-field">
          <label>카테고리</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="preset-field">
          <label>별점</label>
          <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {"⭐".repeat(r)} ({r}/5)
              </option>
            ))}
          </select>
        </div>

        <div className="preset-field">
          <label>장점</label>
          <textarea
            value={pros}
            onChange={(e) => setPros(e.target.value)}
            placeholder="예: 가격 대비 품질이 좋음, 휴대하기 편한 소용량"
            rows={3}
            style={{ width: "100%" }}
          />
        </div>

        <div className="preset-field">
          <label>단점</label>
          <textarea
            value={cons}
            onChange={(e) => setCons(e.target.value)}
            placeholder="예: 향이 약간 강함"
            rows={2}
            style={{ width: "100%" }}
          />
        </div>

        <div className="preset-field">
          <label>한줄 총평</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="예: 여행용으로 딱 좋은 가성비 치약 세트!"
            rows={2}
            style={{ width: "100%" }}
          />
        </div>
      </div>

      {/* 영상 설정 */}
      <div className="section" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 14 }}>
          🎬 영상 설정 (Higgsfield)
        </div>

        <div className="preset-field">
          <label>프리셋</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESET_OPTIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="preset-field">
          <label>제품 이미지 URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
            style={{ width: "100%" }}
          />
        </div>

        <button type="button" className="primary primary-fill" onClick={handleGeneratePrompt}>
          📋 Higgsfield 프롬프트 생성
        </button>

        {generatedPrompt && (
          <div style={{ marginTop: 8 }}>
            <textarea
              readOnly
              value={generatedPrompt}
              rows={6}
              style={{
                width: "100%",
                fontSize: 12,
                background: "#1a1a2e",
                color: "#ccc",
                border: "1px solid #444",
                borderRadius: 6,
                padding: 8,
              }}
            />
            <button type="button" className="primary" onClick={handleCopyPrompt} style={{ marginTop: 4 }}>
              {promptCopied ? "✅ 복사됨!" : "📋 클립보드 복사"}
            </button>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              복사 후 Claude 채팅에 붙여넣어 Higgsfield로 영상 생성하세요.
            </div>
          </div>
        )}
      </div>

      {/* 대본 & 나레이션 */}
      <div className="section" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 14 }}>
          🎙️ 대본 & 나레이션
        </div>

        <button
          type="button"
          className="primary primary-fill"
          onClick={handleGenerateScript}
          disabled={scriptBusy}
        >
          {scriptBusy ? "대본 생성 중..." : "✍️ 대본 자동생성 (AI)"}
        </button>

        {script && (
          <div className="preset-field" style={{ marginTop: 8 }}>
            <label>생성된 대본</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={8}
              style={{ width: "100%" }}
            />
          </div>
        )}

        <div className="preset-field" style={{ marginTop: 8 }}>
          <label>음성 선택</label>
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="primary primary-fill"
          onClick={handleGenerateNarration}
          disabled={narrationBusy || !script}
          style={{ marginTop: 8 }}
        >
          {narrationBusy ? "나레이션 생성 중..." : "🔊 나레이션 생성"}
        </button>

        {narrationUrl && (
          <div style={{ marginTop: 8 }}>
            <audio controls src={narrationUrl} style={{ width: "100%" }} />
          </div>
        )}
      </div>

      {error && <div className="result-error-light">{error}</div>}
    </div>
  );
}
