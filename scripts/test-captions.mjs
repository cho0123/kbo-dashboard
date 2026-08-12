/**
 * 자막(captions) drawtext 단위테스트 — 필터체인 문자열 비교.
 *
 *   node scripts/test-captions.mjs
 *
 * 핵심은 "회귀 안전": 구형식(text/text2)과 동등한 자막
 * (전체 구간 표시 · 가운데 정렬 · 개행 없음)이면 생성되는 필터체인이
 * 개편 전과 문자 하나까지 같아야 한다. 아래 기대 문자열은 개편 전(main@b9aa461)
 * lambda/index.mjs 의 출력을 그대로 받아 적은 것이다.
 */
import assert from "node:assert/strict";
import {
  buildHighlightDrawtextOnlyVfByLayout,
  buildHighlightSegmentVfByLayout,
  captionEnableExpr,
  captionXExpr,
  captionDrawtextFilter,
  normalizeSegmentCaptions,
} from "../lambda/index.mjs";

const FONT = "/var/task/fonts/NotoSansKR-Bold.ttf";

/** 구형식과 동등한 자막 한 개 */
function cap(over = {}) {
  return {
    text: "가나다",
    textFile: "/tmp/a.txt",
    fontPath: FONT,
    size: 48,
    color: "#ffffff",
    opacity: 1,
    x: 50,
    y: 85,
    shadow: false,
    startSec: 0,
    endSec: null,
    ...over,
  };
}

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`OK    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${e.message.split("\n").join("\n      ")}`);
  }
}

// ── 1. 회귀: 구형식과 동등한 자막 → 개편 전과 같은 문자열 ──────────────────

test("kbo · 자막2개(두번째 그림자) + 상단제목 = 개편 전과 동일", () => {
  const got = buildHighlightDrawtextOnlyVfByLayout("kbo", {
    layout: "kbo",
    topTextFile: "/tmp/hi_top.txt",
    topFontPath: FONT,
    topFontSize: 72,
    topColor: "#ffffff",
    topOpacity: 1,
    topShadow: false,
    captionDraws: [
      cap({ textFile: "/tmp/hi_bottom_0.txt", y: 85 }),
      cap({
        textFile: "/tmp/hi_bottom_0_2.txt",
        size: 60,
        color: "#ffe066",
        opacity: 0.8,
        y: 90,
        shadow: true,
      }),
    ],
  });
  assert.equal(
    got,
    "drawtext=fontfile=/var/task/fonts/NotoSansKR-Bold.ttf:textfile=/tmp/hi_bottom_0.txt:fontsize=48:fontcolor=0xffffff@1:x=(w-text_w)/2:y=h*85/100," +
      "drawtext=fontfile=/var/task/fonts/NotoSansKR-Bold.ttf:textfile=/tmp/hi_bottom_0_2.txt:fontsize=60:fontcolor=0xffe066@0.8:x=(w-text_w)/2:y=h*90/100:shadowx=1:shadowy=1:shadowcolor=black@0.6," +
      "drawtext=fontfile=/var/task/fonts/NotoSansKR-Bold.ttf:textfile=/tmp/hi_top.txt:fontsize=72:fontcolor=0xffffff@1:x=(w-text_w)/2:y=h*0.105"
  );
});

test("topbottom · 자막 y 는 1920 기준 절대 px (14% → 269)", () => {
  const got = buildHighlightDrawtextOnlyVfByLayout("topbottom", {
    layout: "topbottom",
    captionDraws: [cap({ y: 14 })],
  });
  assert.equal(
    got,
    "drawtext=fontfile=/var/task/fonts/NotoSansKR-Bold.ttf:textfile=/tmp/a.txt:fontsize=48:fontcolor=0xffffff@1:x=(w-text_w)/2:y=269"
  );
});

test("자막이 없으면 drawtext 도 없다", () => {
  assert.equal(
    buildHighlightDrawtextOnlyVfByLayout("fullscreen", {
      layout: "fullscreen",
      captionDraws: [],
    }),
    ""
  );
});

test("자막 없는 구간의 vf 는 crop/scale/tpad 만 (holdSec=0 → tpad 없음)", () => {
  const base = { cw: 1080, ih: 1080, cx: 0, videoScaleY: 100, videoOffsetY: 50 };
  assert.equal(
    buildHighlightSegmentVfByLayout("fullscreen", {
      ...base,
      holdSec: 0,
      captionDraws: [],
    }),
    "crop=1080:1080:0:0,scale=1080:1920:flags=lanczos,format=yuv420p,fps=30"
  );
  assert.equal(
    buildHighlightSegmentVfByLayout("fullscreen", {
      ...base,
      holdSec: 1.2,
      captionDraws: [],
    }),
    "crop=1080:1080:0:0,scale=1080:1920:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=1.2,fps=30"
  );
});

// ── 2. 가로 위치 ────────────────────────────────────────────────────────

test("x=50 은 기존 하드코딩과 같은 문자열", () => {
  assert.equal(captionXExpr(50), "(w-text_w)/2");
});

test("x 는 (w-text_w) 비율 — 0=왼쪽 끝 · 100=오른쪽 끝", () => {
  assert.equal(captionXExpr(0), "(w-text_w)*0/100");
  assert.equal(captionXExpr(25), "(w-text_w)*25/100");
  assert.equal(captionXExpr(100), "(w-text_w)*100/100");
});

test("x 가 이상하면 가운데로 떨어진다", () => {
  assert.equal(captionXExpr(undefined), "(w-text_w)/2");
  assert.equal(captionXExpr(-30), "(w-text_w)*0/100");
  assert.equal(captionXExpr(999), "(w-text_w)*100/100");
});

// ── 3. 시간 분할 ────────────────────────────────────────────────────────

test("전체 구간(0~끝) 이면 enable 을 붙이지 않는다", () => {
  assert.equal(captionEnableExpr({ startSec: 0, endSec: null }), "");
  assert.equal(captionEnableExpr({}), "");
});

test("종료만 없으면 gte, 둘 다 있으면 between — 콤마 때문에 반드시 따옴표", () => {
  assert.equal(captionEnableExpr({ startSec: 1.5, endSec: null }), "'gte(t,1.5)'");
  assert.equal(
    captionEnableExpr({ startSec: 1.5, endSec: 3.25 }),
    "'between(t,1.5,3.25)'"
  );
  assert.equal(captionEnableExpr({ startSec: 0, endSec: 2 }), "'between(t,0,2)'");
});

test("시간 분할 자막 3개가 각자 enable 을 갖는다", () => {
  const got = buildHighlightDrawtextOnlyVfByLayout("fullscreen", {
    layout: "fullscreen",
    captionDraws: [
      cap({ textFile: "/tmp/1.txt", startSec: 0, endSec: 1 }),
      cap({ textFile: "/tmp/2.txt", startSec: 1, endSec: 2 }),
      cap({ textFile: "/tmp/3.txt", startSec: 2, endSec: null }),
    ],
  });
  const parts = got.split(",drawtext=");
  assert.equal(parts.length, 3);
  assert.ok(got.includes("enable='between(t,0,1)'"));
  assert.ok(got.includes("enable='between(t,1,2)'"));
  assert.ok(got.includes("enable='gte(t,2)'"));
});

// ── 4. 줄바꿈 ───────────────────────────────────────────────────────────

test("개행이 없으면 line_spacing 을 붙이지 않는다", () => {
  assert.ok(!captionDrawtextFilter(cap(), "h*85/100").includes("line_spacing"));
});

test("개행이 있으면 line_spacing = round(fontsize × 0.25)", () => {
  const got = captionDrawtextFilter(
    cap({ text: "가나다\n라마바", size: 60 }),
    "h*85/100"
  );
  assert.ok(got.endsWith(":line_spacing=15"), got);
  // 텍스트는 파일로 나가므로 필터 문자열에 개행이 섞이지 않는다
  assert.ok(!got.includes("\n"));
});

test("line_spacing 은 y 다음, 그림자 앞에 온다", () => {
  const got = captionDrawtextFilter(
    cap({ text: "가\n나", size: 48, shadow: true }),
    "h*85/100"
  );
  assert.equal(
    got,
    "drawtext=fontfile=/var/task/fonts/NotoSansKR-Bold.ttf:textfile=/tmp/a.txt:fontsize=48:fontcolor=0xffffff@1:x=(w-text_w)/2:y=h*85/100:line_spacing=12:shadowx=1:shadowy=1:shadowcolor=black@0.6"
  );
});

// ── 5. 정규화 ───────────────────────────────────────────────────────────

test("빈 텍스트 항목은 버리고, 앞뒤 공백만 다듬는다", () => {
  const got = normalizeSegmentCaptions({
    captions: [
      { text: "  " },
      { text: "" },
      { text: null },
      { text: "  가나다  " },
    ],
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].text, "가나다");
});

test("문자열 중간 개행은 살아남는다", () => {
  const got = normalizeSegmentCaptions({ captions: [{ text: " 가\n나 " }] });
  assert.equal(got[0].text, "가\n나");
});

test("구간당 8개까지만 통과", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ text: `t${i}` }));
  assert.equal(normalizeSegmentCaptions({ captions: many }).length, 8);
});

test("endSec 은 null(끝까지)과 숫자를 구분한다", () => {
  const got = normalizeSegmentCaptions({
    captions: [
      { text: "a" },
      { text: "b", endSec: null },
      { text: "c", endSec: "" },
      { text: "d", endSec: 2.5 },
      { text: "e", endSec: -3 },
    ],
  });
  assert.deepEqual(
    got.map((c) => c.endSec),
    [null, null, null, 2.5, null]
  );
});

test("captions 가 없으면 빈 배열 (옛 형식이 와도 터지지 않는다)", () => {
  assert.deepEqual(normalizeSegmentCaptions({}), []);
  assert.deepEqual(normalizeSegmentCaptions(null), []);
  assert.deepEqual(normalizeSegmentCaptions({ text: "옛형식" }), []);
});

test("기본값 — x=50 · y=85 · size=48 · 흰색 · 불투명 · 그림자 없음", () => {
  const [c] = normalizeSegmentCaptions({ captions: [{ text: "가" }] });
  assert.deepEqual(
    {
      x: c.x,
      y: c.y,
      size: c.size,
      color: c.color,
      opacity: c.opacity,
      shadow: c.shadow,
      startSec: c.startSec,
      endSec: c.endSec,
    },
    {
      x: 50,
      y: 85,
      size: 48,
      color: "#ffffff",
      opacity: 1,
      shadow: false,
      startSec: 0,
      endSec: null,
    }
  );
});

console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
