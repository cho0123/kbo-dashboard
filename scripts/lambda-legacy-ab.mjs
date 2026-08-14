/**
 * lambda 배포 전/후 회귀 A/B — 옛 형식 meta 로 렌더한 결과가 같은지 본다.
 *
 * 왜 필요한가: 2026-08-12 자막 개편 배포에서, captions 가 없는 옛 meta.json 을
 * 새 lambda 가 자막 없이 렌더해 구간 자막이 조용히 사라졌다. 단위테스트는
 * 통과했고 새 형식 렌더도 정상이라 배포 전에 못 잡았다. 그래서 "옛 형식으로
 * 실제 렌더해서 배포 전 버전과 바이트 단위로 같은가"를 절차에 넣는다.
 *
 * 사용법 (lambda 배포 '전'에 기준 버전을 하나 publish 해 두고 돌린다):
 *   node scripts/lambda-legacy-ab.mjs --baseline 3
 *   node scripts/lambda-legacy-ab.mjs --baseline 3 --keep     (잡 남겨두기)
 *
 * 기준(baseline) 버전과 $LATEST 에 같은 meta 를 태워 output.mp4 해시를 비교한다.
 * ffmpeg/ffprobe 는 저장소 루트의 것을 쓴다. AWS 자격증명이 있어야 한다.
 */
import { execSync, spawnSync } from "child_process";
import { randomUUID, createHash } from "crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG = join(ROOT, "ffmpeg.exe");
const BUCKET = process.env.S3_VIDEO_BUCKET || "kbo-video-export";
const REGION = process.env.KBO_AWS_REGION || "ap-northeast-2";
const FUNC = process.env.LAMBDA_VIDEO_ENCODER || "kbo-video-encoder";

const args = process.argv.slice(2);
const baseline = (() => {
  const i = args.indexOf("--baseline");
  return i >= 0 ? String(args[i + 1] || "").trim() : "";
})();
const keep = args.includes("--keep");
if (!baseline) {
  console.error(
    "사용법: node scripts/lambda-legacy-ab.mjs --baseline <버전번호>\n" +
      "  배포 전에 aws lambda publish-version 으로 찍어 둔 번호를 넣는다."
  );
  process.exit(2);
}

const sh = (c) => execSync(c, { encoding: "utf8", maxBuffer: 3e7 });
const W = mkdtempSync(join(tmpdir(), "kbo-ab-"));

/** 회귀 케이스: 구간 자막 text/text2 + 전역 자막 + 홀드 2초 (2026-08-12 사고 재현) */
const legacySegment = (start, end, holdSec) => ({
  start, end, startMs: 0, endMs: 0, cropOffset: 0,
  text: "구간 자막 1", text2: "구간 자막 2",
  textY: 85, textY2: 78,
  textColor: "#ffffff", textColor2: "#ffd400",
  textSize: 48, textSize2: 40,
  textOpacity: 1, textOpacity2: 1,
  textFont: "NotoSansKR-Bold.ttf", textFont2: "NotoSansKR-Bold.ttf",
  textShadow: true, textShadow2: false,
  narration: "", holdSec,
});
const LEGACY_META = {
  type: "highlight", sourceUpload: true,
  segments: [legacySegment("00:00", "00:05", 2), legacySegment("00:05", "00:10", 0)],
  coverBox: { enabled: false, x: 50, y: 50, width: 20, height: 10 },
  muteOriginal: false,
  musicOptions: { volume: 0.8, startTime: 0, fadeOutDuration: 2 },
  topText: "상단 제목", topTextColor: "#ffffff", topTextSize: 72,
  topTextOpacity: 1, topTextFont: "NotoSansKR-Bold.ttf", topTextShadow: true,
  team: "삼성", layout: "kbo", videoScaleY: 100, videoOffsetY: 50,
  topBarColor: null, bottomBarColor: null,
  globalText1: "전역 자막 하나", globalText1Y: 49,
  globalText1Color: "#ffffff", globalText1Size: 88, globalText1Font: "NotoSansKR-Bold.ttf",
  globalText2: "전역 자막 둘", globalText2Y: 57,
  globalText2Color: "#00d1ff", globalText2Size: 52, globalText2Font: "NotoSansKR-Bold.ttf",
};

const cleanup = [];
try {
  console.log(`기준 버전 ${FUNC}:${baseline}  vs  $LATEST`);
  console.log("테스트 소스 생성…");
  spawnSync(FFMPEG, ["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=20",
    "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000:duration=20",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest", join(W, "src.mp4")],
    { encoding: "utf8", maxBuffer: 2e7 });

  const jobs = {};
  for (const tag of ["latest", "baseline"]) {
    const id = randomUUID();
    jobs[tag] = id;
    cleanup.push(id);
    sh(`aws s3 cp "${join(W, "src.mp4")}" s3://${BUCKET}/jobs/${id}/source.mp4 --region ${REGION}`);
    writeFileSync(join(W, `meta_${tag}.json`), JSON.stringify(LEGACY_META), "utf8");
    sh(`aws s3 cp "${join(W, `meta_${tag}.json`)}" s3://${BUCKET}/jobs/${id}/meta.json --region ${REGION}`);
    writeFileSync(join(W, `st_${tag}.json`), JSON.stringify({ state: "queued", progress: 5 }), "utf8");
    sh(`aws s3 cp "${join(W, `st_${tag}.json`)}" s3://${BUCKET}/jobs/${id}/status.json --region ${REGION}`);
  }

  const target = { latest: FUNC, baseline: `${FUNC}:${baseline}` };
  for (const tag of ["latest", "baseline"]) {
    const payload = Buffer.from(JSON.stringify({ bucket: BUCKET, jobId: jobs[tag] })).toString("base64");
    sh(`aws lambda invoke --function-name ${target[tag]} --region ${REGION} --invocation-type Event --payload ${payload} "${join(W, `inv_${tag}.json`)}"`);
    console.log(`  ${tag.padEnd(8)} ${target[tag]}  ${jobs[tag]}`);
  }

  console.log("\n렌더 대기…");
  const state = (id) => {
    try {
      return JSON.parse(sh(`aws s3 cp s3://${BUCKET}/jobs/${id}/status.json - --region ${REGION}`)).state;
    } catch {
      return null;
    }
  };
  const started = Date.now();
  for (;;) {
    const st = Object.values(jobs).map(state);
    if (st.every((s) => s === "done" || s === "error")) {
      console.log(`  상태: ${st.join(", ")}`);
      if (st.includes("error")) throw new Error("렌더 실패 — status.json 확인");
      break;
    }
    if (Date.now() - started > 15 * 60 * 1000) throw new Error("렌더 시간 초과");
    execSync("node -e \"setTimeout(()=>{},8000)\"", { stdio: "ignore" });
  }

  const hashes = {};
  for (const [tag, id] of Object.entries(jobs)) {
    const f = join(W, `out_${tag}.mp4`);
    sh(`aws s3 cp s3://${BUCKET}/jobs/${id}/output/output.mp4 "${f}" --region ${REGION}`);
    const buf = readFileSync(f);
    hashes[tag] = { sha: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
  }

  console.log("\n=== 옛 형식 meta A/B ===");
  console.log(`  $LATEST   ${hashes.latest.sha.slice(0, 32)}  ${hashes.latest.bytes} bytes`);
  console.log(`  :${baseline.padEnd(8)} ${hashes.baseline.sha.slice(0, 32)}  ${hashes.baseline.bytes} bytes`);
  const same = hashes.latest.sha === hashes.baseline.sha;
  console.log(`\n${same ? "PASS — byte-identical (회귀 없음)" : "FAIL — 출력이 다르다 (회귀)"}`);
  if (!same) {
    console.log(`  결과물이 남아 있습니다: ${W}`);
    console.log("  두 mp4 를 프레임 비교해 어느 요소가 달라졌는지 확인하세요.");
  }
  process.exitCode = same ? 0 : 1;
  if (!same) cleanup.length = 0; // 실패 시 잡을 남겨 조사할 수 있게
} finally {
  if (!keep) {
    for (const id of cleanup) {
      try {
        sh(`aws s3 rm s3://${BUCKET}/jobs/${id}/ --recursive --region ${REGION}`);
      } catch {
        /* 정리 실패는 무시 */
      }
    }
    try {
      rmSync(W, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  } else {
    console.log(`\n(--keep) 작업 폴더: ${W}`);
  }
}
