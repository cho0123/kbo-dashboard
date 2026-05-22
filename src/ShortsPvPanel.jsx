import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { postKbo } from "./api.js";
import ShortsPresetPicker from "./ShortsPresetPicker.jsx";
import { loadSvgLogo, teamKeyword, drawStandingsSlide } from "./shorts1IntroStandingsDraw.js";
import { loadPlayerImage, loadDefaultPlayerImage, drawableShorts4Portrait } from "./shorts4PlayerImage.js";
import {
  drawPvIntroSlide,
  drawPvPitcherSlide,
  drawPvBatterSlide,
  drawPvStatsSlide,
  drawPvTimelineSlide,
} from "./shortsPvSlideDraw.js";

const SHORTS_EXPORT_W = 1080;
const SHORTS_EXPORT_H = 1920;

const KBO_TEAMS = [
  { keyword: "삼성", label: "삼성 라이온즈" },
  { keyword: "LG", label: "LG 트윈스" },
  { keyword: "KT", label: "KT 위즈" },
  { keyword: "SSG", label: "SSG 랜더스" },
  { keyword: "NC", label: "NC 다이노스" },
  { keyword: "두산", label: "두산 베어스" },
  { keyword: "KIA", label: "KIA 타이거즈" },
  { keyword: "롯데", label: "롯데 자이언츠" },
  { keyword: "한화", label: "한화 이글스" },
  { keyword: "키움", label: "키움 히어로즈" },
];

// 캔버스 서브컴포넌트
const ShortsCanvas = forwardRef(function ShortsCanvas({ renderSlide, w, h }, ref) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (ref) ref.current = canvasRef.current;
  }, [ref]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderSlide) return;
    const ctx = canvas.getContext("2d");
    renderSlide(ctx, canvas);
  }, [renderSlide]);
  const PREVIEW_H = 400;
  const PREVIEW_W = Math.round(PREVIEW_H * (w / h));
  return (
    <div className="shorts-capture-wrap">
      <canvas
        ref={canvasRef}
        width={w}
        height={h}
        style={{ width: PREVIEW_W, height: PREVIEW_H, display: "block" }}
        className="slide-card"
      />
    </div>
  );
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

export default function ShortsPvPanel() {
  // 모드
  const [pvMode, setPvMode] = useState("pitcher");

  // 팀/선수 선택
  const [pitcherTeam, setPitcherTeam] = useState("");
  const [pvP, setPvP] = useState("");
  const [batterTeam, setBatterTeam] = useState("");
  const [pvB, setPvB] = useState("");
  const [pitcherList, setPitcherList] = useState([]);
  const [batterList, setBatterList] = useState([]);
  const [pvPlayersBusy, setPvPlayersBusy] = useState(false);

  // 데이터
  const [pvStats, setPvStats] = useState({ data: null, error: null });
  const [pvTab, setPvTab] = useState("this");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 슬라이드
  const [slideIdx, setSlideIdx] = useState(0);
  const [capturedSlides, setCapturedSlides] = useState([]);
  const [captureBusy, setCaptureBusy] = useState(false);

  // 선수 사진
  const [pitcherImg, setPitcherImg] = useState(null);
  const [batterImg, setBatterImg] = useState(null);

  // 로고
  const [logosByTeamKey, setLogosByTeamKey] = useState({});

  // refs
  const captureWrapRef = useRef(null);
  const presetPickerRef = useRef(null);

  // 로고 로드
  useEffect(() => {
    const keys = ["삼성","LG","KT","SSG","NC","두산","KIA","롯데","한화","키움"];
    Promise.all(keys.map(k => loadSvgLogo(k).then(img => [k, img])))
      .then(entries => setLogosByTeamKey(Object.fromEntries(entries)));
  }, []);

  // 선수 목록 로드
  const loadPitchers = useCallback(async (team) => {
    if (!team) return;
    setPvPlayersBusy(true);
    try {
      const res = await postKbo({ action: "get_players", team, type: "pitcher", year: 2026 });
      setPitcherList(res?.players || []);
    } finally { setPvPlayersBusy(false); }
  }, []);

  const loadBatters = useCallback(async (team) => {
    if (!team) return;
    setPvPlayersBusy(true);
    try {
      const res = await postKbo({ action: "get_players", team, type: "batter", year: 2026 });
      setBatterList(res?.players || []);
    } finally { setPvPlayersBusy(false); }
  }, []);

  // 선수 사진 로드
  useEffect(() => {
    if (pvP && pitcherTeam) {
      loadPlayerImage(teamKeyword(pitcherTeam), pvP).then(setPitcherImg);
    }
  }, [pvP, pitcherTeam]);

  useEffect(() => {
    if (pvB && batterTeam) {
      loadPlayerImage(teamKeyword(batterTeam), pvB).then(setBatterImg);
    }
  }, [pvB, batterTeam]);

  // 데이터 불러오기
  const onGenerate = async () => {
    if (!pvP || !pvB) { setError("투수와 타자를 선택해주세요."); return; }
    setError("");
    setBusy(true);
    try {
      const res = await postKbo({ action: "pv_batter_stats", pitcher: pvP, batter: pvB });
      if (res?.ok === false) throw new Error(res.error || "데이터 조회 실패");
      setPvStats({ data: res, error: null });
      setSlideIdx(0);
    } catch(e) {
      setError(e.message);
      setPvStats({ data: null, error: e.message });
    } finally { setBusy(false); }
  };

  // 현재 탭 스탯
  const currentStats = useMemo(() => {
    const d = pvStats.data;
    if (!d) return null;
    return pvTab === "this" ? d.thisSeason
      : pvTab === "prev" ? d.prevSeason
      : d.bothSeasons;
  }, [pvStats.data, pvTab]);

  const currentRows = useMemo(() => {
    const d = pvStats.data;
    if (!d) return [];
    return pvTab === "this" ? d.per_game?.thisSeason
      : pvTab === "prev" ? d.per_game?.prevSeason
      : d.per_game?.bothSeasons ?? [];
  }, [pvStats.data, pvTab]);

  // 슬라이드 정의 (6장)
  const slides = useMemo(() => [
    { key: "intro", label: "인트로" },
    { key: "pitcher", label: "투수 프로필" },
    { key: "batter", label: "타자 프로필" },
    { key: "stats", label: "상대전적" },
    { key: "timeline", label: "경기별 기록" },
    { key: "standings", label: "KBO 순위" },
  ], []);

  // 슬라이드 렌더 함수
  const renderSlide = useCallback((ctx, canvas) => {
    const w = SHORTS_EXPORT_W, h = SHORTS_EXPORT_H;
    const slide = slides[slideIdx];
    if (!slide) return;
    switch(slide.key) {
      case "intro":
        drawPvIntroSlide(ctx, w, h, pvP || "투수", pitcherTeam, pvB || "타자", batterTeam, logosByTeamKey);
        break;
      case "pitcher":
        drawPvPitcherSlide(ctx, w, h, pvP || "투수", pitcherTeam, pitcherImg, logosByTeamKey);
        break;
      case "batter":
        drawPvBatterSlide(ctx, w, h, pvB || "타자", batterTeam, batterImg, logosByTeamKey);
        break;
      case "stats":
        drawPvStatsSlide(ctx, w, h, pvP || "투수", pitcherTeam, pvB || "타자", batterTeam, currentStats, logosByTeamKey);
        break;
      case "timeline":
        drawPvTimelineSlide(ctx, w, h, pvP || "투수", pvB || "타자", currentRows);
        break;
      case "standings":
        drawStandingsSlide(ctx, w, h, logosByTeamKey);
        break;
      default: break;
    }
  }, [slideIdx, slides, pvP, pvB, pitcherTeam, batterTeam, pitcherImg, batterImg, currentStats, currentRows, logosByTeamKey]);

  // 슬라이드 캡처
  const captureAllSlides = async () => {
    setCaptureBusy(true);
    const results = [];
    for (let i = 0; i < slides.length; i++) {
      setSlideIdx(i);
      await new Promise(r => setTimeout(r, 300));
      const canvas = captureWrapRef.current?.querySelector("canvas");
      if (canvas) {
        const blob = await canvasToBlob(canvas);
        results.push({ key: slides[i].key, blob });
      }
    }
    setCapturedSlides(results);
    setSlideIdx(0);
    setCaptureBusy(false);
  };

  // ZIP 다운로드
  const downloadZip = async () => {
    if (!capturedSlides.length) return;
    const zip = new JSZip();
    capturedSlides.forEach((s, i) => {
      zip.file(`slide_${String(i+1).padStart(2,"0")}_${s.key}.png`, s.blob);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `pv_${pvP}_vs_${pvB}.zip`);
  };

  return (
    <div className="section soft shorts4-root">
      <div className="section-title">5. 쇼츠-투수VS타자</div>
      <div className="muted">세로 9:16 (1080×1920) PNG / ZIP 다운로드</div>

      {/* 슬라이드 캡처 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="primary"
          style={{ flex: 1 }}
          onClick={captureAllSlides}
          disabled={captureBusy}
        >
          {captureBusy ? "캡처 중..." : "슬라이드 캡처"}
        </button>
        <span className="muted">{capturedSlides.length > 0 ? `${capturedSlides.length}장 캡처됨` : "미캡처"}</span>
      </div>

      {/* 프리셋 */}
      <div className="shorts4-preset-tight" style={{ marginTop: 8 }}>
        <ShortsPresetPicker
          ref={presetPickerRef}
          shortsType="shorts_pv"
          slides={capturedSlides}
          hideVideoButton
          hideCaptureStatus
        />
      </div>

      {/* 영상 생성 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="primary"
          style={{ flex: 1 }}
          onClick={() => presetPickerRef.current?.openVideoExport()}
          disabled={!capturedSlides.length}
        >
          영상 생성
        </button>
        <span className="muted">{capturedSlides.length > 0 ? "캡처됨" : "미캡처"}</span>
      </div>

      {/* 투수기준/타자기준 탭 */}
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button
          type="button"
          className={`primary${pvMode === "pitcher" ? " primary-fill" : ""}`}
          style={{ flex: 1 }}
          onClick={() => setPvMode("pitcher")}
        >
          투수 기준
        </button>
        <button
          type="button"
          className={`primary${pvMode === "batter" ? " primary-fill" : ""}`}
          style={{ flex: 1 }}
          onClick={() => setPvMode("batter")}
        >
          타자 기준
        </button>
      </div>

      {/* 선수 선택 UI */}
      {pvMode === "pitcher" ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="grid-2">
            <select value={pitcherTeam} onChange={e => { setPitcherTeam(e.target.value); setPvP(""); loadPitchers(e.target.value); }} disabled={pvPlayersBusy}>
              <option value="">투수팀 선택</option>
              {KBO_TEAMS.map(t => <option key={t.keyword} value={t.label}>{t.label}</option>)}
            </select>
            <select value={pvP} onChange={e => setPvP(e.target.value)} disabled={!pitcherTeam || pvPlayersBusy}>
              <option value="">투수 선택</option>
              {pitcherList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="grid-2">
            <select value={batterTeam} onChange={e => { setBatterTeam(e.target.value); setPvB(""); loadBatters(e.target.value); }} disabled={pvPlayersBusy}>
              <option value="">타자팀 선택</option>
              {KBO_TEAMS.filter(t => t.label !== pitcherTeam).map(t => <option key={t.keyword} value={t.label}>{t.label}</option>)}
            </select>
            <select value={pvB} onChange={e => setPvB(e.target.value)} disabled={!batterTeam || pvPlayersBusy}>
              <option value="">타자 선택</option>
              {batterList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="grid-2">
            <select value={batterTeam} onChange={e => { setBatterTeam(e.target.value); setPvB(""); loadBatters(e.target.value); }} disabled={pvPlayersBusy}>
              <option value="">타자팀 선택</option>
              {KBO_TEAMS.map(t => <option key={t.keyword} value={t.label}>{t.label}</option>)}
            </select>
            <select value={pvB} onChange={e => setPvB(e.target.value)} disabled={!batterTeam || pvPlayersBusy}>
              <option value="">타자 선택</option>
              {batterList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="grid-2">
            <select value={pitcherTeam} onChange={e => { setPitcherTeam(e.target.value); setPvP(""); loadPitchers(e.target.value); }} disabled={pvPlayersBusy}>
              <option value="">투수팀 선택</option>
              {KBO_TEAMS.filter(t => t.label !== batterTeam).map(t => <option key={t.keyword} value={t.label}>{t.label}</option>)}
            </select>
            <select value={pvP} onChange={e => setPvP(e.target.value)} disabled={!pitcherTeam || pvPlayersBusy}>
              <option value="">투수 선택</option>
              {pitcherList.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* 데이터 불러오기 / ZIP */}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="primary"
          style={{ flex: 1 }}
          disabled={busy || !pvP || !pvB}
          onClick={onGenerate}
        >
          {busy ? "불러오는 중..." : "데이터 불러오기"}
        </button>
        <button
          type="button"
          className="primary primary-fill"
          style={{ flex: 1 }}
          disabled={!capturedSlides.length}
          onClick={downloadZip}
        >
          전체 ZIP 다운로드
        </button>
      </div>

      {error && <div className="result-error-light" style={{ marginTop: 8 }}>{error}</div>}

      {/* 탭 (데이터 로드 후) */}
      {pvStats.data && (
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          {[["this","2026"], ["prev","2025"], ["both","합산"]].map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`primary${pvTab === val ? " primary-fill" : ""}`}
              style={{ flex: 1 }}
              onClick={() => setPvTab(val)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 미리보기 캔버스 */}
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "start" }}>
        <div ref={captureWrapRef} className="shorts-capture-wrap">
          <ShortsCanvas
            renderSlide={renderSlide}
            w={SHORTS_EXPORT_W}
            h={SHORTS_EXPORT_H}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className={`primary${slideIdx === i ? " primary-fill" : ""}`}
              onClick={() => setSlideIdx(i)}
              style={{ fontSize: 13, textAlign: "left", padding: "8px 12px" }}
            >
              {i + 1}. {s.label}
              {capturedSlides[i] ? " ✓" : ""}
            </button>
          ))}
          <button
            type="button"
            className="primary"
            style={{ marginTop: 8, fontSize: 13 }}
            onClick={async () => {
              const canvas = captureWrapRef.current?.querySelector("canvas");
              if (!canvas) return;
              const blob = await canvasToBlob(canvas);
              downloadBlob(blob, `pv_slide_${slideIdx + 1}_${slides[slideIdx]?.key}.png`);
            }}
          >
            📥 현재 슬라이드 PNG
          </button>
        </div>
      </div>
    </div>
  );
}
