/** Firestore video_presets 및 FFmpeg 폴백용 기본 슬라이드 초(쇼츠 타입별) */

export const SLIDE_KEYS_SHORTS1 = [
  "intro",
  "summary",
  "summary_last",
  "game_detail",
  "standings",
];
export const SLIDE_KEYS_SHORTS3 = ["intro", "summary", "game_detail", "standings"];
export const SLIDE_KEYS_SHORTS2 = [
  "intro",
  "game_preview_p1",
  "game_preview_p2",
  "game_preview_p3",
  "game_preview_p4",
  "game_preview_p5",
  "standings",
];

export const DEFAULT_DURATION_SHORTS1 = {
  intro: 3.0,
  summary: 2.5,
  summary_last: 3.0,
  game_detail: 2.0,
  standings: 3.5,
};

export const DEFAULT_DURATION_SHORTS2 = {
  intro: 4.0,
  game_preview_p1: 1.5,
  game_preview_p2: 1.5,
  game_preview_p3: 1.5,
  game_preview_p4: 1.5,
  game_preview_p5: 2.0,
  standings: 4.0,
};

/** 쇼츠3: summary_last 구분 없음(쇼츠1 전용) */
export const DEFAULT_DURATION_SHORTS3 = {
  intro: 3.0,
  summary: 2.5,
  game_detail: 2.0,
  standings: 3.5,
};

export function defaultSlidesForType(shortsType) {
  switch (shortsType) {
    case "shorts1":
      return { ...DEFAULT_DURATION_SHORTS1 };
    case "shorts2":
      return { ...DEFAULT_DURATION_SHORTS2 };
    case "shorts3":
    default:
      return { ...DEFAULT_DURATION_SHORTS3 };
  }
}

/** 프리셋 키당 실제 이미지(슬라이드) 장수 — 예상 영상 길이 합산용 */
export function slideFrameCountForKey(shortsType, key) {
  if (shortsType === "shorts1") {
    const m = {
      intro: 1,
      summary: 4,
      summary_last: 1,
      game_detail: 10,
      standings: 1,
    };
    return m[key] ?? 1;
  }
  if (shortsType === "shorts2") {
    const m = {
      intro: 1,
      game_preview_p1: 1,
      game_preview_p2: 1,
      game_preview_p3: 1,
      game_preview_p4: 1,
      game_preview_p5: 1,
      standings: 1,
    };
    return m[key] ?? 1;
  }
  if (shortsType === "shorts3") {
    const m = {
      intro: 1,
      summary: 1,
      game_detail: 10,
      standings: 1,
    };
    return m[key] ?? 1;
  }
  return 1;
}

export function slideFieldDefs(shortsType) {
  if (shortsType === "shorts2") {
    return [
      { key: "intro", label: "인트로" },
      { key: "game_preview_p1", label: "경기 예고 P1" },
      { key: "game_preview_p2", label: "경기 예고 P2" },
      { key: "game_preview_p3", label: "경기 예고 P3" },
      { key: "game_preview_p4", label: "경기 예고 P4" },
      { key: "game_preview_p5", label: "경기 예고 P5" },
      { key: "standings", label: "순위" },
    ];
  }
  if (shortsType === "shorts1") {
    return [
      { key: "intro", label: "인트로" },
      { key: "summary", label: "경기결과 1~4장" },
      { key: "summary_last", label: "경기결과 마지막(5번째)장" },
      { key: "game_detail", label: "경기 상세" },
      { key: "standings", label: "순위" },
    ];
  }
  return [
    { key: "intro", label: "인트로" },
    { key: "summary", label: "결과 요약" },
    { key: "game_detail", label: "경기 상세" },
    { key: "standings", label: "순위" },
  ];
}

export function mergeSlides(shortsType, existing) {
  const base = defaultSlidesForType(shortsType);
  const ex = existing && typeof existing === "object" ? existing : {};
  const out = { ...base };
  for (const k of Object.keys(out)) {
    const n = Number(ex[k]);
    if (Number.isFinite(n)) out[k] = n;
  }
  for (const k of Object.keys(ex)) {
    const n = Number(ex[k]);
    if (!(k in out) && Number.isFinite(n)) out[k] = n;
  }
  return out;
}
