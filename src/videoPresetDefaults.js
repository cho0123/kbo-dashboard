/** Firestore video_presets 및 FFmpeg 폴백용 기본 슬라이드 초(쇼츠 타입별) */

export const SLIDE_KEYS_SHORTS1 = [
  "intro",
  "summary",
  "game_detail",
  "outro",
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
  game_detail: 2.0,
  outro: 2.0,
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

/** 쇼츠3은 outro 슬라이드 없음 */
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
      { key: "summary", label: "결과 요약" },
      { key: "game_detail", label: "경기 상세" },
      { key: "outro", label: "결과 요약 - 끝" },
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
