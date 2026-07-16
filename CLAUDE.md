# KBO 대시보드

KBO 데이터로 유튜브/틱톡 쇼츠를 만드는 도구. 캔버스로 슬라이드를 그려 영상으로 뽑는다.

- 대시보드: github.com/cho0123/kbo-dashboard → kbo-dashboard.netlify.app
- 크롤러: github.com/cho0123/kbo-project (별도 저장소)
- 스택: React(Vite) + Netlify Functions + Firebase Firestore + AWS Lambda/S3

## ⚠️ 로컬 테스트가 불가능하다 — 이게 모든 것의 전제

API로 데이터를 가져오는 구조라 **로컬에서는 데이터를 못 받아온다. 즉 로컬 확인이 안 된다.**
유일한 확인 경로:

```
수정 → commit → push → Netlify 자동 배포 → kbo-dashboard.netlify.app 에서 눈으로 확인
```

따라서:

- **push = 배포 = 운영 반영.** 깨진 코드를 push하면 사이트가 그대로 깨진다. 완충 지대가 없다.
- **확인 한 번 = 배포 한 번.** 추측으로 고치고 "되는지 볼까요"는 하지 않는다. 확신이 설 때 push한다.
- **`npm run build`가 로컬에서 가능한 유일한 검증이다.** push 전 반드시 통과시킨다.
  문법 오류·import 깨짐은 여기서 잡힌다. 통과했다고 화면이 맞다는 뜻은 아니다.
  (집 PC에서는 이 build가 크래시한다 — 아래 참조. 그때는 `node --check` / esbuild 파싱으로 대체하되,
  그건 **문법만** 본다. TDZ·잘못된 훅 순서 같은 런타임 오류는 못 잡는다.)

### 로직이 들어간 변경은 배포 후 클로드가 직접 확인한다

상수·폰트·좌표·색만 바꾼 경우는 **하지 않는다** — 사장님이 보는 게 빠르고 정확하다.
그러나 조건문·훅·API 연동 등 **동작이 들어간 변경**은 배포 후 클로드가 브라우저로
`kbo-dashboard.netlify.app`을 열어 확인한다. 문법 검사로는 못 잡는 층이 있기 때문이다.

  실제 사례(2026-07-17): VS 스탯 자동 입력 useEffect를 `detailGame`(const) 선언보다 앞에 두어
  의존성 배열이 렌더 중 평가될 때 ReferenceError(TDZ)로 패널이 죽었다.
  `node --check`와 esbuild 파싱은 통과했다 — 문법은 정상이고 실행할 때만 터지는 오류였다.

  **단, 이 페이지는 무거워서 스크린샷이 자주 타임아웃(30초)된다.** 패널을 연 뒤에는 거의 실패한다.
  캔버스 슬라이드는 스크린샷으로만 보이므로, 확인이 안 되면 매달리지 말고 사장님께 부탁할 것.
  `read_console_messages`(에러 확인)와 `get_page_text`는 가벼우니 그건 먼저 써볼 만하다.
  배포된 함수를 node로 직접 POST 호출하는 게 API 확인엔 훨씬 싸고 확실하다.

## ⚠️ 코드 변경 규칙 — 가장 중요

테스트도 lint도 없고 **로컬 확인도 안 된다.** 변경이 다른 기능을 깨뜨려도 배포 후 눈으로
볼 때까지 아무도 모른다. 공유 모듈을 잘못 건드리면 쇼츠 전체가 한꺼번에 깨진다. 그러므로:

1. **요청받은 것만 고친다.** 범위 밖 파일은 건드리지 않는다. 지나가다 발견한 문제는
   고치지 말고 말로 보고한다.
2. **임의 리팩터링·정리·포맷팅 금지.** "김에 정리했습니다"는 하지 않는다.
3. **공유 모듈은 수정 전에 반드시 먼저 묻는다** (아래 위험 지도).
4. **공유 함수의 시그니처와 기존 동작을 바꾸지 않는다.** 새 인자가 필요하면 기본값을 주어
   기존 호출부가 손대지 않아도 똑같이 동작하게 한다.
5. 좌표·폰트·색 수정은 **해당 슬라이드에만** 적용되는지 확인한다. 공용 그리기 함수를 고치면
   다른 쇼츠 레이아웃이 조용히 틀어진다.
6. push 전 `npm run build` 통과. 공유 모듈을 건드렸다면 배포 후 **그것을 쓰는 모든 쇼츠**를 확인한다.

## 위험 지도 — 공유 모듈

| 모듈 | 제공 | 쓰는 곳 |
|---|---|---|
| `shorts1IntroStandingsDraw.js` | `teamKeyword`, `loadSvgLogo`, `drawStandingsSlide` | App, 쇼츠2·4·5, PV — **거의 전부** |
| `shortsBaseballDecor.js` | `drawBaseballBackground` | 쇼츠1·2·4·5, PV |
| `shorts4PlayerImage.js` | `drawableShorts4Portrait`, `loadPlayerImage` | 쇼츠4, PV |
| `shorts4SlideDraw.js` | `getTeamStrongColor` | **쇼츠2가 가져다 쓴다** |
| `api.js` | `postKbo`, `seoulToday` | 모든 패널 |

**함정:**
- `shorts1IntroStandingsDraw.js`는 이름만 shorts1이고 실제로는 공용 유틸 모음이다.
  "쇼츠1 파일이니 쇼츠1만 영향"이라고 생각하면 전부 깨진다.
- `shorts2 → shorts4` 역방향 의존이 있다. **쇼츠4 수정 시 쇼츠2 프리뷰를 확인한다.**

파일이 크다(`kbo-api.mjs` 9,244줄 / `shorts4SlideDraw.js` 1,771줄 / `Shorts3Panel.jsx` 280KB).
전체를 읽지 말고 grep으로 해당 함수만 찾아 들어갈 것.

## 환경

| | |
|---|---|
| 집 PC | `E:\짱구코딩작업\유튜브_컨텐츠관련\kbo_project\kbo-dashboard` |
| 회사 PC | `C:\Users\USER\kbo-dashboard\kbo-dashboard` |

집/회사를 오가며 작업한다. **시작할 때 `git pull`, 끝낼 때 `git push`.**
마지막 작업 PC가 어디였든 반대편은 뒤처져 있는 게 정상이다. pull부터 한다.

```bash
npm run build          # push 전 필수 — 로컬에서 가능한 유일한 검증
npm run local-server   # 로컬 다운로드 서버 (포트 3838) — 서버시작.bat
```

**집 PC에서 `npm run build`가 크래시한다** (미해결). Node v24.11.1 + vite 6.4.2,
`310 modules transformed` 직후 exit `0xC0000409`(스택 버퍼 오버런). 코드 문제가 아니다 —
아무 수정 없이 원본으로도 동일하게 죽는다. `ROLLUP_SKIP_NODEJS_NATIVE=1`도 무효.
`node_modules/@rollup`에 win32-x64-gnu와 msvc 바이너리가 **둘 다** 깔려 있는 게 유력한 용의자.
Netlify 빌드는 정상이다. 회사 PC에서도 그런지는 미확인.

### 배포 사이트 ↔ 로컬 서버 구조 (코드만 봐선 모름)

영상 다운로드는 **배포된 사이트가 내 PC의 로컬 서버를 직접 호출**해서 동작한다.
`local-server.js`의 CORS가 `https://kbo-dashboard.netlify.app`을 허용하고 있다.

```
브라우저에서 kbo-dashboard.netlify.app 열기  →  다운로드 버튼  →  localhost:3838  →  내 PC에 저장
```

그래서 로컬 dev 서버를 띄울 필요가 없고, 다운로드에 `.env`도 필요 없다.
`process.env`는 `videoEncodeAwsClients()`(S3 인코딩)에서만 쓴다 — 다운로드 경로와 무관하다.
`ffmpeg.exe`/`yt-dlp.exe`를 쓰는 **로컬 전용** 기능이라 클라우드로 옮길 수 없다.

`.env`는 gitignore라 git으로 오가지 않는다. PC마다 따로 둔다(`.env.example` 참조).
`.gitignore`의 `kbo-dashboard-repo/`, `kbo-project/`는 의도적으로 둔 로컬 클론이다. 건드리지 말 것.

## 데이터 구조 — 코드만 봐선 모르는 것

| | 보존 기간 | 팀명 |
|---|---|---|
| `schedule` | 과거 3일 + 미래 7일 | 짧은 형태 — `"삼성"` |
| `games` | 시즌 전체 | 풀네임 — `"삼성 라이온즈"` |

`kbo-api.mjs`의 `TEAM_ALIAS_TO_FULL`이 약칭↔풀네임을 정규화한다. canonical은 풀네임.

`matchup_preview`는 `schedule`만 본다 → **오래된 날짜는 조회되지 않는다(의도된 동작).**
games 폴백이 있었으나 필요 없어져서 되돌렸다(`abdd96d`). 되살리지 말 것.

## 네이버 선수 API (2026-07-17 확인)

경로는 `/players/kbo/{playerId}/...` 계열이다. 기존 코드가 쓰는
`/statistics/players/{id}/seasons`와 **다른 계열**이며, 후자 경로에 없는 리소스를 붙이면 403이 난다.
403을 IP 차단으로 오해하지 말 것 — 집 PC에서도 정상 호출된다.

```
GET https://api-gw.sports.naver.com/players/kbo/{playerId}/playerend-record
    헤더: Referer: https://m.sports.naver.com  (+ User-Agent) — NAVER_M_SPORTS_FETCH_HEADERS 사용

  result.playerType   "hitter" | "pitcher"
  result.basicRecord  시즌 성적 + 순위        ← JSON 문자열, 두 번 파싱해야 함
  result.record       최근 10경기 (딱 10개)   ← JSON 문자열
  result.vsTeam       상대팀별 시즌 성적       ← JSON 문자열

GET .../players/kbo/{playerId}/vs-player-stats?vsPlayerId={상대선수ID}&playerType=hitter
GET .../players/kbo/{playerId}/vs-player-contents?playerType=hitter   ← 상대 선수 목록(드롭다운용)
```

`vsTeam.vsteam[]` 필드 — **투수 쪽이 슬라이드8·9 VS 스탯 수동 입력 9칸과 1:1로 대응한다.**

| 수동 입력칸 | API | | 타자 vsTeam |
|---|---|---|---|
| ERA / 승 / 패 | `era` / `w` / `l` | | `ab`, `hit`, `hr` |
| 이닝 / 투구수 | `inn` / `pit` | | `hra`, `obp`, `slg`, `ops` |
| 탈삼진 / 피안타 / 피홈런 / 실점 | `kk` / `hit` / `hr` / `r` | | `rbi`, `pa`, `run` |
| (덤) | `whip`, `er`, `bbhp` | | |

주의:
- `inn`은 `"11 1/3"` 같은 **문자열**이다. 표시엔 그대로 쓰고 계산 시에만 파싱.
- 맞대결이 없으면 값이 `"-"`다. 팀 목록엔 9개 팀이 다 나오되 값만 비는 형태 — 정상 상태이지
  오류가 아니다. (예: 원태인은 2026시즌 롯데와 맞대결 없음)
- **연도 파라미터가 통하지 않는다.** `?year=` / `?season=` / `?seasonId=` 모두 무시되고
  현재 시즌만 온다. 경로에 연도를 넣으면(`/playerend-record/2025`) 403. 과거 시즌 `vsTeam`은
  이 경로로 가져올 수 없다.
- `vs-player-contents`의 팀 목록에 **teamName이 빈 블록이 섞여 있다.**
  `"LG".includes("")`가 true라 `includes`로 팀을 찾으면 빈 블록이 먼저 걸린다. 반드시 걸러낼 것.
- playerId는 **이미 로드된 시즌 목록에서 찾으면 추가 호출이 0회다.**
  `seasonPitcherStats` / `seasonHitterStats`(matchup_preview가 이미 fetch)에 `playerId`와
  `teamName`이 들어 있다. `search/players`를 새로 부를 필요가 없다.

### 표본 크기 — 기준 선정 시 반드시 고려 (2026-07-17 실측)

| 데이터 | 표본 | 판단 |
|---|---|---|
| `vsTeam` (타자 vs 팀, 이번시즌) | **23~40타수** | 시즌 16경기라 충분. 합산 불필요 |
| `vsTeam` (투수 vs 팀, 이번시즌) | 5~18이닝 | VS 스탯 자동 입력에 사용 중 |
| `vs-player-stats` (타자 vs 투수, 이번시즌) | **2~5타수** | 매우 작음. 최소 타수 필터 필수 |
| `vs-player-stats` 3시즌 합산 | 3~14타수 | 합쳐도 작다 |

`vs-player-stats`의 `seasonStats`는 **"맞대결이 있었던 최근 3개 시즌"**이다 — 최근 3년이 아니다.
연속이 아닐 수 있고(예: 2019/2020/2021), 5년 전 데이터가 딸려오므로 합산은 권하지 않는다.

실측 예 — KT@LG, 소형준 상대 LG 라인업:
`vsTeam`(vs KT) 오스틴 40타수 18안타 .450 / `vs-player-stats`(vs 소형준) 오스틴 4타수 4안타.
둘 다 오스틴이 1위였다 — **VS 팀과 VS 투수는 같은 선수를 뽑는 경우가 잦다.**

## 슬라이드10·11 설계 (진행 중, 2026-07-17)

한 슬라이드 = 한 팀. 10=기준팀, 11=상대팀. 세 구역:

```
상단   VS {상대팀} 상대전적 1위 타자 — 스탯 자세히   (vsTeam, 이번시즌)
중간   VS {상대 선발} 상대전적 1위 타자 — 간략히     (vs-player-stats, 이번시즌)
하단   [화이트 투명 박스] 직전경기 베스트 선수        ← 구현 완료
```

- **상단·중간이 같은 선수여도 그대로 둔다.** 중복이 아니라 같은 선수의 다른 각도이며
  ("KT에 강한데 오늘 선발에겐 더 강하다") 사실에도 맞다. 2위로 내리면 "저 선수가 더 강한데
  2위를 킬러라고 소개하는" 거짓말이 된다. 중간을 간략히 두는 이유가 이것이다.
- **타율만 쓰지 말고 타수·안타를 같이 표기한다.** `4타수 4안타 (1.000)`.
  표본이 작아도 정직해지고, 시청자가 스스로 판단할 수 있다.
- 최소 타수 필터 필요 — 2타수 1안타 .500이 4타수 3안타 .750을 이기면 안 된다.
- 현재 상태: 상단·중간은 **타이틀만** 그려져 있다(뼈대). 선수 데이터 미연결.

### 막고 있는 것: matchup_preview가 이미 21~26초

`matchup_preview`는 **그날 5경기를 전부** 만드는데 패널은 선택한 1경기만 쓴다.
여기에 타자 데이터를 넣으면 경기당 38회(상단 9 + 중간 10, ×2팀) × 5경기 = **190회**가 되어
확실히 터진다. 간헐적으로 HTML 오류(타임아웃 추정)가 이미 관측된다.

→ **선택된 1경기만 조회하는 별도 액션으로 빼야 한다.** 지금 들어간 투수 VS 스탯도
같은 구조 문제를 갖고 있으나 경기당 2회(총 10회)라 드러나지 않았을 뿐이다.

## 저장소 함정

`kbo-dashboard`가 상위 `kbo_project`에 gitlink로 등록돼 있으나 `.gitmodules`가 없다.
서브모듈로 동작하지 않으므로 두 저장소를 각각 pull 한다.

---
완료 작업 목록은 여기 적지 않는다 — `git log`가 정확하고 문서는 낡는다.
git이 기록 못 하는 것만 적는다: 결정의 이유, 환경, 구조 지식.
