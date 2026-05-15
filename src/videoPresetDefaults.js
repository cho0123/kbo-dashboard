/** Firestore video_presets 및 FFmpeg 폴백용 기본 슬라이드 초(쇼츠 타입별) */

export const SLIDE_KEYS_SHORTS1 = [
  "intro",
  "summary",
  "summary_last",
  "game_detail",
  "standings",
];
export const SLIDE_KEYS_SHORTS4 = [
  "intro",
  "game_preview",
  "game_preview_last",
  "starter_step1",
  "starter_step2",
  "starter_step3",
  "hot_player_step1",
  "hot_player_step2",
  "hot_player_step3",
  "home_lineup_step1",
  "home_lineup_step2",
  "home_lineup_step3",
  "away_lineup_step1",
  "away_lineup_step2",
  "away_lineup_step3",
  "standings",
];
export const SLIDE_KEYS_SHORTS2 = [
  "intro",
  "game_preview",
  "game_preview_last",
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
  game_preview: 1.5,
  game_preview_last: 2.0,
  standings: 4.0,
};

/** 쇼츠4: 인트로 + 프리뷰5p + 선발3 + 핫플레이어3 + 라인업6 + 순위 (19장 캡처) */
export const DEFAULT_DURATION_SHORTS4 = {
  intro: 4.0,
  game_preview: 1.5,
  game_preview_last: 2.0,
  starter_step1: 1.5,
  starter_step2: 1.5,
  starter_step3: 2.5,
  hot_player_step1: 1.5,
  hot_player_step2: 1.5,
  hot_player_step3: 2.5,
  home_lineup_step1: 1.5,
  home_lineup_step2: 1.5,
  home_lineup_step3: 2.5,
  away_lineup_step1: 1.5,
  away_lineup_step2: 1.5,
  away_lineup_step3: 2.5,
  standings: 4.0,
};

/** 쇼츠3 전용(영상 프리셋 UI에는 없으나 API·인코딩에서 shorts_type 구분용) */
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
    case "shorts4":
      return { ...DEFAULT_DURATION_SHORTS4 };
    case "shorts3":
      return { ...DEFAULT_DURATION_SHORTS3 };
    default:
      return { ...DEFAULT_DURATION_SHORTS4 };
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
      game_preview: 20,
      game_preview_last: 5,
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
  if (shortsType === "shorts4") {
    const m = {
      intro: 1,
      game_preview: 4,
      game_preview_last: 1,
      starter_step1: 1,
      starter_step2: 1,
      starter_step3: 1,
      hot_player_step1: 1,
      hot_player_step2: 1,
      hot_player_step3: 1,
      home_lineup_step1: 1,
      home_lineup_step2: 1,
      home_lineup_step3: 1,
      away_lineup_step1: 1,
      away_lineup_step2: 1,
      away_lineup_step3: 1,
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
      { key: "game_preview", label: "경기별 (1~4번째장)" },
      { key: "game_preview_last", label: "경기별 마지막장" },
      { key: "standings", label: "팀순위" },
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
  if (shortsType === "shorts4") {
    return [
      { key: "intro", label: "인트로" },
      { key: "game_preview", label: "경기 프리뷰 (1~4페이지)" },
      { key: "game_preview_last", label: "경기 프리뷰 (5페이지)" },
      { key: "starter_step1", label: "선발 투수 (1단계)" },
      { key: "starter_step2", label: "선발 투수 (2단계)" },
      { key: "starter_step3", label: "선발 투수 (3단계)" },
      { key: "hot_player_step1", label: "핫플레이어 (1단계)" },
      { key: "hot_player_step2", label: "핫플레이어 (2단계)" },
      { key: "hot_player_step3", label: "핫플레이어 (3단계)" },
      { key: "home_lineup_step1", label: "홈 라인업 (1단계)" },
      { key: "home_lineup_step2", label: "홈 라인업 (2단계)" },
      { key: "home_lineup_step3", label: "홈 라인업 (3단계)" },
      { key: "away_lineup_step1", label: "원정 라인업 (1단계)" },
      { key: "away_lineup_step2", label: "원정 라인업 (2단계)" },
      { key: "away_lineup_step3", label: "원정 라인업 (3단계)" },
      { key: "standings", label: "팀순위" },
    ];
  }
  if (shortsType === "shorts3") {
    return [
      { key: "intro", label: "인트로" },
      { key: "summary", label: "결과 요약" },
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
  const ex =
    existing && typeof existing === "object" ? { ...existing } : {};
  if (
    (shortsType === "shorts2" || shortsType === "shorts4") &&
    ex &&
    typeof ex === "object"
  ) {
    if (!Number.isFinite(Number(ex.game_preview))) {
      for (const k of [
        "game_preview_p1",
        "game_preview_p2",
        "game_preview_p3",
        "game_preview_p4",
      ]) {
        const n = Number(ex[k]);
        if (Number.isFinite(n)) {
          ex.game_preview = n;
          break;
        }
      }
    }
    if (
      !Number.isFinite(Number(ex.game_preview_last)) &&
      Number.isFinite(Number(ex.game_preview_p5))
    ) {
      ex.game_preview_last = Number(ex.game_preview_p5);
    }
  }
  if (shortsType === "shorts4" && ex && typeof ex === "object") {
    if (!Number.isFinite(Number(ex.game_preview)) && Number.isFinite(Number(ex.summary))) {
      ex.game_preview = Number(ex.summary);
    }
    if (
      !Number.isFinite(Number(ex.game_preview_last)) &&
      Number.isFinite(Number(ex.game_detail))
    ) {
      ex.game_preview_last = Number(ex.game_detail);
    }
    const gd = Number(ex.game_detail);
    const hl = Number(ex.home_lineup);
    if (Number.isFinite(hl)) {
      for (const k of ["home_lineup_step1", "home_lineup_step2", "home_lineup_step3"]) {
        if (!Number.isFinite(Number(ex[k]))) ex[k] = hl;
      }
    } else if (Number.isFinite(gd)) {
      for (const k of ["home_lineup_step1", "home_lineup_step2", "home_lineup_step3"]) {
        if (!Number.isFinite(Number(ex[k]))) ex[k] = gd;
      }
    }
    const al = Number(ex.away_lineup);
    if (Number.isFinite(al)) {
      for (const k of ["away_lineup_step1", "away_lineup_step2", "away_lineup_step3"]) {
        if (!Number.isFinite(Number(ex[k]))) ex[k] = al;
      }
    } else if (Number.isFinite(gd)) {
      for (const k of ["away_lineup_step1", "away_lineup_step2", "away_lineup_step3"]) {
        if (!Number.isFinite(Number(ex[k]))) ex[k] = gd;
      }
    }
    const st = Number(ex.starter);
    if (Number.isFinite(st)) {
      for (const k of ["starter_step1", "starter_step2", "starter_step3"]) {
        if (!Number.isFinite(Number(ex[k]))) ex[k] = st;
      }
    }
    const hp = Number(ex.hot_player);
    if (Number.isFinite(hp)) {
      for (const k of ["hot_player_step1", "hot_player_step2", "hot_player_step3"]) {
        if (!Number.isFinite(Number(ex[k]))) ex[k] = hp;
      }
    }
  }
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
