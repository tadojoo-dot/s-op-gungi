# Work Log

## 2026-08-12

### 증상: 다른 사람이 보면 화면이 다르고 PSI 탭이 깨짐

배포 문제가 아니었음. 라이브 파일과 로컬 파일이 md5까지 동일했고 vendor 에셋도 정상.

원인은 **업로드 데이터가 업로드한 사람의 localStorage(`sopDash_v11`)에만 있었던 것.**
Cloudflare KV에 공유되던 건 `SHARED_STATE_FIXED_KEYS`(회의록/PSI 조정/Action Log/판매계획 셀 수정)뿐이라,
다른 사람은 `UPLOADED=null` 상태로 코드에 내장된 예시 데이터(`PSI`, `MATRIX`, `CH_AMT`, `TREND_DATA`, `SENS_PLAN`)를 봤음.

PSI 탭이 특히 심했던 이유 4가지:

1. 내장 `PSI`는 24행뿐이고 다이소 통합/하위 품목이 없음
2. `monthRealLabels`가 없어 `renderPSI`의 월 헤더가 위치키 그대로 `6월~9월`로 표시 (실제는 8~11월)
3. `sourceMonthlyPsi`가 없어 `calcPsiMonth`가 정확값 대신 비율 추정 폴백(`buy6*0.8`, `plan6*1.03`)으로 계산
4. `getSalesPlanData()`가 null이라 "다음달 판매계획 기준" 재고일수가 대부분 `산출불가`

여기에 KV에서 내려온 공유 PSI 조정값(`DAI-9`, `DAI-33`, `DAI-35`, `DAI-36`)은 내장 PSI에 없는 자재코드라
Action Log에만 남고 표에는 반영되지 않았음.

### 조치 1 — 업로드 데이터 KV 공유

- 신규 Pages Function `functions/api/dashboard-data.js` (KV 키 `dashboard:live`)
  - `GET` 페이로드 / `GET ?meta=1` 메타만 / `PUT` 저장(관리자) / `DELETE`(관리자)
  - 관리자 인증은 `x-admin-password` 헤더 (본문이 바이너리라 body에 못 넣음)
  - 메타(`uploaded_ts`/`uploaded_at`/`base_label`)는 `x-sop-*` 헤더로 전달, 한글 때문에 전 구간 URI 인코딩
  - 상한 20MB (KV 값 상한 25MB 아래), KV 없으면 D1에 base64로 폴백
- 클라이언트: `packDashboardData`/`unpackDashboardData`(gzip), `saveDashboardData`, `loadSharedDashboardData`,
  `shareCurrentDataNow`, `noticeIfNoData`
- `handleUpload`에 `result.uploaded_ts=Date.now()` 추가 — `uploaded_at`은 `toLocaleString`이라 비교 불가였음
- 최신본 판정: 서버 공유본 vs 로컬 `uploaded_ts` 비교, 더 최신인 쪽 채택.
  타임스탬프 없는 구버전 로컬본은 공유본이 이김.
- 부팅 순서: `loadSharedDashboardData`/`loadSharedState`를 **await** 하도록 변경.
  기존엔 `runStep`이 async 함수를 await 없이 호출해서 데모 데이터가 먼저 그려지고 나중에 덮이는 경합이 있었음.
  `BOOT_RENDER_DONE` 플래그로 `refreshSharedStateViews`의 조기 부분 렌더도 차단.
- 관리자 모드가 아닌 채로 업로드하면 `⚠ 이 브라우저에만 저장됨` 경고.
- 로컬·서버 둘 다 데이터가 없으면 내장 예시값이 그려진다는 사실을 배너로 명시(`noticeIfNoData`).
- 압축률 실측 9.5배 (1,051,603B JSON → 111,145B gzip).

### 조치 2 — 웹폰트 self-host

- `vendor/PretendardVariable.woff2` (2.0MB, variable). static 5개 웨이트(400/600/700/800/900)면 3.8MB라 variable이 더 작음.
- `body` 폰트 스택 앞에 `'Pretendard Variable'` 추가.
- `UI_FONT_STACK` 상수 신설. Chart.js 기본 폰트(`Chart.defaults.font.family`)와
  캔버스 배지 `ctx.font` 6곳이 각각 `Apple SD Gothic Neo` / **`Arial`**(한글 글리프 없음)로 갈려 있던 것을 통일.

### 조치 3 — "숫자가 다르면 안 된다" 재점검에서 추가로 나온 2건

데이터 전달만 맞추는 걸로는 부족했고, 화면 숫자가 갈리는 경로가 2개 더 있었음.

**(1) ③ 판매계획 오차 분석 탭의 월 드롭다운이 사람마다 달랐음**

`chAchieveMonth`는 HTML에 `<option value="5월" selected>`로 박혀 있고,
데이터 최신월로 자동 전환하는 코드는 **`handleUpload` 안에만** 있었음.
→ 업로드한 사람은 7월(최신월) 오차분석을, 다른 열람자와 새로고침한 본인은 **5월**을 봤음. 완전히 다른 숫자.
→ `syncAchieveMonthToData()`로 분리하고 업로드·`loadFromStorage`·`loadSharedDashboardData` 세 경로 모두에서 호출.

**(2) 업로드한 사람만 JSON을 안 거친 원본 객체를 보고 있었음**

`UPLOADED=result`로 파서 원본을 그대로 잡고 있어서, JSON을 거쳐 받는 다른 열람자와
`NaN`/`Infinity` → `null`, `undefined` 키 소실, `-0` → `0` 만큼 값이 갈릴 수 있었음
(0으로 나누는 계산이 있는 `rate6`, `dp`, `dr` 등이 실제 위험 지점).
→ `UPLOADED=JSON.parse(JSON.stringify(result))`로 업로드 직후부터 모두 같은 정규화본을 쓰게 맞춤.
구조적으로 차이가 날 수 없게 만든 것이라 파서를 나중에 고쳐도 안전함.

참고: `monthSlider`(Sensing M+N)는 HTML 기본값 0 = 부팅 렌더 `renderSensing(0)`이라 원래 일치했음.

### 조치 4 — 엑셀 → KV 업로드 CLI (`tools/publish-data.mjs`)

사용자가 "리포에 엑셀 올린 다음 배포해달라고 하겠다"고 해서 만듦.
**배포로는 데이터가 안 올라간다** — 배포는 `public/` 파일만 올리고 숫자는 KV에 있으며, 엑셀은 `.gitignore` 대상.
그래서 파싱 후 KV에 직접 PUT하는 CLI가 별도로 필요했음.

- `npm run publish:data -- <파일.xlsx>` / `ADMIN_PASSWORD` 환경변수 또는 gitignore된 `.env.local`
- **파서를 새로 구현하지 않았음.** `vendor/xlsx.full.min.js` + `SOP_LATEST.html`의 인라인 스크립트를
  vm에 로드하고, `FileReader`를 스텁해서 **실제 `handleUpload()`를 그대로 호출**한다.
  별도 파서를 짜면 브라우저 업로드와 숫자가 반드시 어긋나므로 이 구조를 유지할 것.
- `fs.readFileSync(p).toString('binary')`(latin1) = 브라우저 `FileReader.readAsBinaryString` 출력과 동일.
- 업로드 후 다시 GET해서 바이트 일치를 자동 검증하고, 다르면 exit 1.
- 검증: 합성 엑셀(PSI 12행)로 로컬 wrangler 상대 실전 실행 성공.
  월 라벨을 헤더에서 `8~12월`로 정확히 읽었고(PSI 시트 함정 구간), gzip 업로드 → 되받기 바이트 일치 확인.

### 남은 이슈 (이번에 안 건드림)

- `body{min-width:1280px}` — 좁은 화면에서 가로 스크롤/레이아웃 깨짐. 사용자가 이번엔 제외하기로 함.
- 관리자가 데이터를 새로 공유해도 열려 있는 다른 사람 탭은 자동 갱신되지 않음 (새로고침 필요).
- 스냅샷은 여전히 IndexedDB 로컬 전용이라 공유되지 않음.

### 검증

- `functions/api/dashboard-data.js`: 로컬 wrangler pages dev + KV 바인딩으로 17개 API 테스트 통과
  (권한 403, 빈 상태 404, gzip 왕복 바이트 일치, 한글 메타 헤더 왕복, DELETE).
- `SOP_LATEST.html`: CLAUDE.md의 Node 재현 하네스로 21개 클라이언트 테스트 통과
  (신규 방문자 공유본 수신, `monthRealLabels`/`sourceMonthlyPsi`/`sales_plan` 보존,
  `getPSIData()`가 내장 데모 대신 공유본 반환, 최신본 판정, 비관리자 차단, 폰트 스택).
- **숫자 동일성 테스트 12개 통과** (`numtest.mjs`): 관리자 샌드박스와 열람자 샌드박스를 각각 독립
  localStorage/DOM으로 띄우고, 0 나눗셈·NaN·undefined·-0을 일부러 섞은 300행 데이터셋으로
  `UPLOADED` 직렬화 바이트 일치, `calcPsiMonth`/`getUnitPrice` 실계산 **7,200셀** 일치,
  월 드롭다운 일치, 열람자 새로고침 후 일치, 재업로드 후 재일치까지 확인.
- 하네스 스크립트: scratchpad `apitest.mjs`, `clienttest.mjs`, `numtest.mjs`.

### 검증 못 한 것

실제 엑셀(`.gitignore` 제외)이 리포에 없어서 **진짜 원본 데이터로는 端to端 확인을 못 했음.**
배포 후 관리자로 실제 엑셀을 올린 뒤, 시크릿 창으로 같은 URL을 열어 PSI 탭 월 헤더와
몇 개 품목 숫자를 눈으로 대조하는 절차가 한 번 필요함.

## 2026-07-13

### Cloudflare Pages / KV

- 운영 사이트: `https://s-op-gungi.pages.dev`
- Cloudflare 계정 ID: `14c780e41fc86dde4101283fb427b14e`
- Pages 프로젝트: `s-op-gungi`
- KV binding name: `SOP_STATE`
- 실제 KV namespace ID: `05ce4e26ad784fde95ecad137c60b2ee`
- 기존 문제였던 `Missing Cloudflare binding`은 `wrangler.toml`의 잘못된 KV ID 때문에 발생했고, 실제 ID로 수정 후 운영 배포 완료.

### 배포 방법

- 운영 배포 명령:

```bash
npm run release:live
```

- `package.json`에 Cloudflare 계정 ID와 Pages 프로젝트명을 고정해둠.
- Cloudflare 로그인이 필요한 새 환경에서는 먼저 실행:

```bash
npx wrangler login
```

### 공유 상태 저장

- API: `/api/shared-state`
- `live` 키는 현재 회의 입력 상태 저장용.
- 월별 보관본은 `archive:YYYY-MM` 키로 저장.
- 보관 목록은 `archive:index` 키로 관리.
- 2026-07 S&OP 보관본 생성 완료.

### 월별 S&OP 보관 흐름

- 회의록 탭 상단에 기능 추가:
  - `현재 월 보관`
  - `과거 보관본 조회`
  - `새 달 시작`
- 권장 운영:
  - 회의 종료 후 `현재 월 보관`
  - 다음 달 시작 전 `새 달 시작`
  - 과거 회의는 드롭다운에서 조회

### 관리자 모드

- 기본은 읽기 전용.
- 상단 `관리자 모드` 버튼에서 비밀번호 입력 후 수정 가능.
- Cloudflare Pages secret 이름: `ADMIN_PASSWORD`
- 실제 비밀번호 값은 GitHub 문서에 기록하지 않음. Cloudflare Pages secret에서 관리.
- 비밀번호 없는 저장 API 요청은 403으로 차단됨.
- 관리자 모드에서만 가능한 작업:
  - 회의록 수정
  - 담당 의견 수정
  - PSI 입고 조정
  - 월별 보관
  - 새 달 시작
  - 스냅샷 저장/불러오기/삭제

### PSI 계산 변경

- PSI 재고일수 기준을 전체 월에 대해 다음 기준으로 통일:

```text
해당 월 재고일수 = 해당 월 기말재고 / 다음 월 판매계획 수량 * 30
```

- 예:

```text
8월 재고일수 = 8월 기말재고 / 9월 판매계획 수량 * 30
```

- 적용 범위:
  - 일반 PSI 품목
  - 다이소 통합 품목
  - 다이소 원본 하위 품목
  - 판매계획 기준 재고일수
  - 진척율/보조 기준 재고일수
  - 정렬
  - 위험/정상 집계
  - 판매 증감 시뮬레이션

### 다이소 통합 PSI

- 다이소 품목은 `다이소마스터` 기준으로 하위 자재를 통합코드에 합산.
- 공급 시트가 있으면 다이소 입고는 공급 시트 기준으로 반영.
- 통합 품목의 진척율 기준 예상 재고도 공급 반영 입고 기준으로 재계산하도록 수정.

### PSI 입력 UX

- PSI 입고 조정 입력 후 `Enter`를 누르면 즉시 반영.
- 입력칸 밖을 클릭해도 기존처럼 반영.

### 주의

- 최신 엑셀을 업로드하지 않으면 내장 기본 데이터 또는 이전 로컬 데이터 기준으로 보일 수 있음.
- 업로드 데이터는 브라우저 localStorage에 저장되고, 회의록/PSI 조정/의견은 Cloudflare KV에 저장됨.
- 배포 버전 URL은 확인용이고, 평소 공유/사용 주소는 운영 URL `https://s-op-gungi.pages.dev`만 사용.
