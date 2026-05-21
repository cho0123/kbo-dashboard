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
  const [imageUrl, setImageUrl] = useState("");

  // 프롬프트
  const [generatedPrompt, setGeneratedPrompt] = useState(null);

  // 대본/나레이션
  const [script, setScript] = useState("");
  const [scriptBusy, setScriptBusy] = useState(false);
  const [voiceId, setVoiceId] = useState("m3gJBS8OofDJfycyA2Ip");
  const [narrationBusy, setNarrationBusy] = useState(false);
  const [narrationUrl, setNarrationUrl] = useState("");

  const [error, setError] = useState("");

  const [reviewBusy, setReviewBusy] = useState(false);
  const [imagePrompts, setImagePrompts] = useState([]);
  const [videoCopied, setVideoCopied] = useState({});
  const [prosKeyword, setProsKeyword] = useState("");
  const [consKeyword, setConsKeyword] = useState("");
  const [customImageConcept, setCustomImageConcept] = useState("");
  const [customImagePrompt, setCustomImagePrompt] = useState("");
  const [customImageCopied, setCustomImageCopied] = useState(false);

  // Higgsfield 프롬프트 자동생성
  const handleGeneratePrompt = () => {
    if (!productName.trim()) {
      setError("제품명을 입력해주세요.");
      return;
    }
    setError("");

    // 스타일A: 클로즈업 회전
    const promptA = `Hyper Motion preset. 9:16 vertical video. 8 seconds.
Product: ${productName} (${category})
Style A - Close-up rotation: Slow cinematic 360° rotation of the product on clean minimal background. Soft studio lighting. Product fills most of the frame. No people, no faces, no hands, no text, no audio. Professional product photography motion.`;

    // 스타일B: 생활공간 줌인
    const promptB = `Hyper Motion preset. 9:16 vertical video. 8 seconds.
Product: ${productName} (${category})
Style B - Lifestyle zoom: Product placed in natural lifestyle setting (${
      category === "화장품"
        ? "bathroom counter"
        : category === "식품"
          ? "kitchen table"
          : category === "전자제품"
            ? "desk workspace"
            : "living space"
    }). Slow cinematic zoom-in. Warm natural lighting. No people, no faces, no hands, no text, no audio.`;

    setGeneratedPrompt({ a: promptA, b: promptB });
  };

  // 장단점 자동생성
  const handleGenerateReview = async () => {
    if (!productName.trim()) {
      setError("제품명을 입력해주세요.");
      return;
    }
    setError("");
    setReviewBusy(true);
    try {
      const res = await postKbo({
        action: "generate_product_review_info",
        productName,
        category,
        rating,
        prosKeyword,
        consKeyword,
      });
      if (res?.ok === false) throw new Error(res.error || "자동생성 실패");
      if (res?.pros) setPros(res.pros);
      if (res?.cons) setCons(res.cons);
      if (res?.summary) setSummary(res.summary);
    } catch (e) {
      setError(e.message);
    } finally {
      setReviewBusy(false);
    }
  };

  // 이미지 프롬프트 생성
  const handleGenerateImagePrompts = () => {
    if (!productName.trim()) {
      setError("제품명을 입력해주세요.");
      return;
    }
    setError("");

    const categoryContextMap = {
      전자제품: ["책상 위에 놓인", "손에 들고 있는", "충전 중인", "깔끔한 흰 배경의"],
      식품: ["식탁 위에 놓인", "그릇에 담긴", "손으로 들고 있는", "깔끔한 흰 배경의"],
      생활용품: [
        "집 안 생활공간에 놓인",
        "사용 중인 모습의",
        "손에 들고 있는",
        "깔끔한 흰 배경의",
      ],
      화장품: ["욕실 세면대 위의", "손에 올려진", "화장대 위의", "깔끔한 흰 배경의"],
      기타: ["생활공간에 놓인", "손에 들고 있는", "사용 중인 모습의", "깔끔한 흰 배경의"],
    };

    const contexts = categoryContextMap[category] || categoryContextMap["기타"];
    const prompts = contexts.map((ctx, i) => ({
      id: i,
      label: ctx,
      prompt: `Product photography. ${ctx} ${productName}. 9:16 vertical format. Clean, professional, high quality. Soft natural lighting. No people, no faces, no hands. Minimal background. Korean consumer product style. Shot for YouTube Shorts thumbnail.`,
    }));
    setImagePrompts(prompts);
  };

  // 영상 프롬프트 복사
  const handleCopyVideoPrompt = async (key, text) => {
    await navigator.clipboard.writeText(text);
    setVideoCopied((prev) => ({ ...prev, [key]: true }));
    setTimeout(
      () => setVideoCopied((prev) => ({ ...prev, [key]: false })),
      2000
    );
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
          <label>좋았던 점 키워드</label>
          <input
            type="text"
            value={prosKeyword}
            onChange={(e) => setProsKeyword(e.target.value)}
            placeholder="예: 가격, 소용량, 휴대하기 편함"
            style={{ width: "100%" }}
          />
        </div>
        <div className="preset-field">
          <label>아쉬운 점 키워드</label>
          <input
            type="text"
            value={consKeyword}
            onChange={(e) => setConsKeyword(e.target.value)}
            placeholder="예: 향기 강함, 뚜껑 불편"
            style={{ width: "100%" }}
          />
        </div>

        <button
          type="button"
          className="primary primary-fill"
          onClick={handleGenerateReview}
          disabled={reviewBusy}
          style={{ marginTop: 8 }}
        >
          {reviewBusy ? "자동생성 중..." : "✨ 장단점 AI 자동생성"}
        </button>

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
          <label>제품 이미지 URL</label>
          <input
            type="text"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://..."
            style={{ width: "100%" }}
          />
        </div>

        <button
          type="button"
          className="primary primary-fill"
          onClick={handleGeneratePrompt}
        >
          📋 Higgsfield 영상 프롬프트 생성 (8초×2개)
        </button>

        {generatedPrompt?.a && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>
              🎬 스타일A - 클로즈업 회전
            </div>
            <textarea
              readOnly
              value={generatedPrompt.a}
              rows={4}
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
            <button
              type="button"
              className="primary"
              onClick={() => handleCopyVideoPrompt("a", generatedPrompt.a)}
              style={{ marginTop: 4 }}
            >
              {videoCopied.a ? "✅ 복사됨!" : "📋 스타일A 복사"}
            </button>
          </div>
        )}

        {generatedPrompt?.b && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>
              🎬 스타일B - 라이프스타일 줌인
            </div>
            <textarea
              readOnly
              value={generatedPrompt.b}
              rows={4}
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
            <button
              type="button"
              className="primary"
              onClick={() => handleCopyVideoPrompt("b", generatedPrompt.b)}
              style={{ marginTop: 4 }}
            >
              {videoCopied.b ? "✅ 복사됨!" : "📋 스타일B 복사"}
            </button>
          </div>
        )}
      </div>

      <div className="section" style={{ marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 14 }}>
          🖼️ 이미지 프롬프트 생성 (Higgsfield)
        </div>
        <button
          type="button"
          className="primary primary-fill"
          onClick={handleGenerateImagePrompts}
        >
          🖼️ 이미지 프롬프트 생성
        </button>

        {imagePrompts.length > 0 && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {imagePrompts.map((p) => (
              <div
                key={p.id}
                style={{
                  background: "#1a1a2e",
                  borderRadius: 6,
                  padding: 8,
                }}
              >
                <div style={{ fontSize: 12, color: "#aaa", marginBottom: 4 }}>
                  📸 {p.label}
                </div>
                <textarea
                  readOnly
                  value={p.prompt}
                  rows={3}
                  style={{
                    width: "100%",
                    fontSize: 11,
                    background: "#111",
                    color: "#ccc",
                    border: "1px solid #333",
                    borderRadius: 4,
                    padding: 6,
                  }}
                />
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(p.prompt);
                    setImagePrompts((prev) =>
                      prev.map((x) =>
                        x.id === p.id ? { ...x, copied: true } : x
                      )
                    );
                    setTimeout(
                      () =>
                        setImagePrompts((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, copied: false } : x
                          )
                        ),
                      2000
                    );
                  }}
                  style={{ marginTop: 4 }}
                >
                  {p.copied ? "✅ 복사됨!" : "📋 복사"}
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            marginTop: 12,
            borderTop: "1px solid #333",
            paddingTop: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>
            ✏️ 직접 컨셉 입력
          </div>
          <input
            type="text"
            value={customImageConcept}
            onChange={(e) => setCustomImageConcept(e.target.value)}
            placeholder="예: 욕실 선반 위에 다른 제품들과 함께"
            style={{ width: "100%", marginBottom: 6 }}
          />
          <button
            type="button"
            className="primary primary-fill"
            onClick={() => {
              if (!customImageConcept.trim()) return;
              const prompt = `Product photography. ${customImageConcept} ${productName}. 9:16 vertical format. Clean, professional, high quality. Soft natural lighting. No people, no faces, no hands. Korean consumer product style. Shot for YouTube Shorts thumbnail.`;
              setCustomImagePrompt(prompt);
            }}
          >
            📋 커스텀 프롬프트 생성
          </button>

          {customImagePrompt && (
            <div style={{ marginTop: 8 }}>
              <textarea
                readOnly
                value={customImagePrompt}
                rows={3}
                style={{
                  width: "100%",
                  fontSize: 11,
                  background: "#111",
                  color: "#ccc",
                  border: "1px solid #333",
                  borderRadius: 4,
                  padding: 6,
                }}
              />
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(customImagePrompt);
                  setCustomImageCopied(true);
                  setTimeout(() => setCustomImageCopied(false), 2000);
                }}
                style={{ marginTop: 4 }}
              >
                {customImageCopied ? "✅ 복사됨!" : "📋 복사"}
              </button>
            </div>
          )}
        </div>
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
