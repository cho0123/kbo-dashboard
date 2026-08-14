/**
 * 옛 draft 마이그레이션 게이트.
 *
 * 왜 필요한가: 2026-08-14 자막 개편 2차 배포에서, 옛 draft 를 편집기로 불러오면
 * 자막이 사라지고 자동저장이 원문을 덮어써 영구 소실되는 사고가 났다.
 * lambda A/B 게이트는 렌더 출력만 보므로 이 층을 잡지 못했다.
 * 프론트 데이터 구조를 바꿀 때마다 이 검사를 돌린다.
 *
 *   node scripts/test-draft-migration.mjs
 *
 * draft 복원 경로를 그대로 재현한다:
 *   emptySegment() 뼈대 → 옛 draft 를 덮어씀 → migrateSegmentCaptions
 * 실제 소스에서 함수를 추출해 쓰므로 구현이 바뀌면 여기서 바로 드러난다.
 */
import { readFileSync } from "fs";
import { transformSync } from "esbuild";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/Shorts3Panel.jsx"), "utf8").replace(/\r\n/g, "\n");

/**
 * 컴포넌트 앞의 모듈 레벨 코드를 통째로 실행한다.
 * 선언을 하나씩 뽑으면 화살표 함수·다중 라인 상수에서 자꾸 어긋나므로,
 * esbuild 로 JSX 를 걷어낸 뒤 `function Shorts3Panel(` 직전까지를 쓴다.
 * 실제 소스 그대로라 구현이 바뀌면 여기서 바로 드러난다.
 */
const jsxFree = transformSync(src, { loader: "jsx", format: "esm" }).code;
const componentAt = jsxFree.indexOf("function Shorts3Panel(");
if (componentAt < 0) throw new Error("Shorts3Panel 컴포넌트 시작점을 찾지 못했습니다");
const head = jsxFree.slice(0, componentAt);

// import 로 들어온 이름들(LAYOUT_TYPES 등)은 모듈 로드 중에도 쓰이므로
// 그냥 지우면 안 된다. 아무 접근에도 견디는 스텁으로 바꿔 끼운다.
const importedNames = new Set();
for (const m of head.matchAll(/^import\s+([\s\S]*?)\s+from\s+["'][^"']+["'];?$/gm)) {
  const clause = m[1];
  const braced = clause.match(/\{([^}]*)\}/);
  if (braced) {
    for (const piece of braced[1].split(",")) {
      const n = piece.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) importedNames.add(n);
    }
  }
  const def = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
  if (/^[A-Za-z_$][\w$]*$/.test(def)) importedNames.add(def);
}
const stubPrelude =
  `const __mk = () => new Proxy(function () {}, {\n` +
  `  get: (t, k) => (k === Symbol.toPrimitive || k === "toString" ? () => "" : __mk()),\n` +
  `  apply: () => __mk(), construct: () => __mk(),\n` +
  `});\n` +
  [...importedNames].map((n) => `const ${n} = __mk();`).join("\n") +
  "\n";

const moduleCode =
  stubPrelude +
  head
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "")
    .replace(/^import\s+["'][^"']+["'];?$/gm, "")
    .replace(/^export\s+/gm, "")
    // 잘린 지점 앞에 남은 `export default` 같은 꼬리를 정리
    .replace(/export\s+default\s*$/, "");

const NEEDED = ["normalizeCaption", "migrateSegmentCaptions", "emptySegment"];
const M = new Function(
  `${moduleCode}\nreturn { ${NEEDED.join(", ")} };`
)();
for (const n of NEEDED) {
  if (typeof M[n] !== "function") throw new Error(`${n} 을 가져오지 못했습니다`);
}

let fail = 0;
const ok = (cond, msg, extra) => {
  console.log(`${cond ? "OK  " : "FAIL"}  ${msg}`);
  if (!cond) {
    fail++;
    if (extra !== undefined) console.log(`        ${JSON.stringify(extra)}`);
  }
};

/** 편집기의 draft 복원과 같은 절차 */
const restore = (draftSeg) =>
  M.migrateSegmentCaptions({
    ...M.emptySegment(),
    ...(draftSeg && typeof draftSeg === "object" ? draftSeg : {}),
  });

/* ── 개편 전 형식 draft (실제로 저장돼 있던 모양) ── */
const legacySeg = {
  start: "00:00:00", end: "00:00:05", startMs: 0, endMs: 0, cropOffset: 0,
  text: "옛 draft 자막 1", text2: "옛 draft 자막 2",
  textY: 85, textY2: 76,
  textColor: "#ffffff", textColor2: "#ffd400",
  textSize: 48, textSize2: 40,
  textOpacity: 1, textOpacity2: 0.8,
  textFont: "NotoSansKR-Bold.ttf", textFont2: "BlackHanSans-Regular.ttf",
  textShadow: true, textShadow2: false,
  narration: "", narrationDuration: null, holdSec: 0, autoHold: true,
};

console.log("=== 옛 draft 복원 — 자막이 유지되는가 ===");
{
  const got = restore(legacySeg);
  ok(got.captions.length === 2, `자막 개수 2개 (${got.captions.length})`, got.captions);
  ok(
    got.captions.map((c) => c.text).join(" | ") === "옛 draft 자막 1 | 옛 draft 자막 2",
    "텍스트 원문 유지",
    got.captions.map((c) => c.text)
  );
  const [c1, c2] = got.captions;
  ok(c1.y === 85 && c2.y === 76, `세로 위치 85 / 76 (${c1?.y} / ${c2?.y})`);
  ok(c1.color === "#ffffff" && c2.color === "#ffd400", `색 유지 (${c1?.color} / ${c2?.color})`);
  ok(c1.size === 48 && c2.size === 40, `크기 유지 (${c1?.size} / ${c2?.size})`);
  ok(c1.opacity === 1 && c2.opacity === 0.8, `투명도 유지 (${c1?.opacity} / ${c2?.opacity})`);
  ok(
    c1.font === "NotoSansKR-Bold.ttf" && c2.font === "BlackHanSans-Regular.ttf",
    `폰트 유지 (${c1?.font} / ${c2?.font})`
  );
  ok(c1.shadow === true && c2.shadow === false, `그림자 유지 (${c1?.shadow} / ${c2?.shadow})`);
  ok(
    got.captions.every((c) => c.startSec === 0 && (c.endSec === null || c.endSec === undefined)),
    "전체 구간 표시(start 0 · end 없음) — 기존 렌더와 같아야 한다"
  );
  ok(got.captions.every((c) => c.x === 50), "가운데 정렬(x=50)");
}

console.log("\n=== ⚠ 원본 필드가 남아 있는가 (자동저장 덮어쓰기 대비) ===");
{
  const got = restore(legacySeg);
  ok(got.text === "옛 draft 자막 1", `text 보존 (${JSON.stringify(got.text)})`);
  ok(got.text2 === "옛 draft 자막 2", `text2 보존 (${JSON.stringify(got.text2)})`);
  for (const k of [
    "textY", "textY2", "textColor", "textColor2", "textSize", "textSize2",
    "textOpacity", "textOpacity2", "textFont", "textFont2", "textShadow", "textShadow2",
  ]) {
    ok(got[k] === legacySeg[k], `${k} 보존 (${JSON.stringify(got[k])})`);
  }
  ok(got.start === "00:00:00" && got.end === "00:00:05", "구간 시각 보존");
  ok(got.holdSec === 0 && got.autoHold === true, "홀드 설정 보존");
}

console.log("\n=== 멱등성 — 여러 번 열어도 같은 결과 ===");
{
  const once = restore(legacySeg);
  const twice = M.migrateSegmentCaptions(once);
  const thrice = M.migrateSegmentCaptions(twice);
  ok(JSON.stringify(once) === JSON.stringify(twice), "1회 == 2회");
  ok(JSON.stringify(twice) === JSON.stringify(thrice), "2회 == 3회");
  ok(twice.text === "옛 draft 자막 1", "반복해도 원본 필드 유지");
}

console.log("\n=== 새 형식이 이미 있으면 그쪽이 우선 ===");
{
  const got = restore({
    ...legacySeg,
    captions: [{ text: "새 자막", y: 30, x: 10, startSec: 1, endSec: 3 }],
  });
  ok(got.captions.length === 1, `자막 1개 (${got.captions.length})`);
  ok(got.captions[0].text === "새 자막", "새 형식 텍스트 사용");
  ok(got.captions[0].startSec === 1 && got.captions[0].endSec === 3, "시간 범위 유지");
  ok(got.text === "옛 draft 자막 1", "이 경우에도 옛 필드는 지우지 않는다");
}

console.log("\n=== 경계 ===");
{
  ok(restore({}).captions.length === 0, "빈 구간 → 자막 0개");
  ok(restore({ text: "", text2: "   " }).captions.length === 0, "공백만 → 자막 0개");
  ok(
    restore({ text: "", text2: "둘만" }).captions.map((c) => c.text).join() === "둘만",
    "text2 만 있어도 변환"
  );
  ok(
    restore({ text: "하나만", text2: "" }).captions.map((c) => c.text).join() === "하나만",
    "text 만 있어도 변환"
  );
  const many = restore({
    captions: Array.from({ length: 20 }, (_, i) => ({ text: `자막 ${i}` })),
  });
  ok(many.captions.length <= 8, `상한 적용 (${many.captions.length}개)`);
  ok(M.migrateSegmentCaptions(null).captions.length === 0, "null 이어도 터지지 않는다");
}

console.log("\n=== 회귀 재현 — 뼈대가 빈 captions 를 깔아도 새어 나가지 않는가 ===");
{
  // 이번 사고의 정확한 재현: 뼈대(captions: [])가 먼저, 옛 draft 가 나중
  const merged = { ...M.emptySegment(), ...legacySeg };
  ok(Array.isArray(merged.captions) && merged.captions.length === 0, "복원 직전 상태에 빈 captions 존재 (사고 조건)");
  const got = M.migrateSegmentCaptions(merged);
  ok(got.captions.length === 2, `그래도 자막 2개로 변환 (${got.captions.length})`);
}

console.log(`\n${fail === 0 ? "전부 통과" : `${fail}건 실패`}`);
process.exit(fail === 0 ? 0 : 1);
