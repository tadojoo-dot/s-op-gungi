# 건기식 S&OP 대시보드 — 코드 구조 가이드

> 목적: 이 파일은 매 세션 시작 시 자동으로 읽힙니다. `SOP_LATEST.html`(단일 파일, 인라인 `<script>` 하나에 전체 JS)을
> 처음부터 다시 탐색하지 않도록, 구조·함수 위치·이번 세션에서 발견한 함정을 미리 정리해둔 지도입니다.
> **줄 번호는 편집 때마다 바뀌므로 여기 적지 않습니다 — 함수명으로 Grep해서 찾으세요.**

## 🔴 세션 시작 시 먼저 읽을 것
**`NEXT.md`** — 지금 어디까지 됐고 다음에 뭘 해야 하는지, 사용자 대기 항목이 뭔지 정리돼 있다.
작업을 끝내면 `NEXT.md`도 같이 갱신할 것. 상세 이력은 `WORK_LOG.md`.

## 파일 (리포 루트 기준 — 예전 `dashboard\` 하위 구조 아님)
- 대시보드 본체: `SOP_LATEST.html` (단일 파일, 인라인 script 1개)
- **배포본: `public/SOP_LATEST.html` — 루트 파일의 별도 복사본이지 심볼릭 링크가 아님.**
  Cloudflare Pages는 `public/`만 배포하므로 루트를 고치면 **반드시** `cp SOP_LATEST.html public/SOP_LATEST.html` 로 동기화할 것.
  `vendor/`와 `public/vendor/`도 같은 관계.
- 디자인 토큰(색상/타이포): `DESIGN_SYSTEM.md` (내용/로직 없음, 스타일만)
- 로컬 라이브러리: `vendor/` (xlsx.full.min.js, chart.umd.min.js, chartjs-plugin-datalabels.min.js, PretendardVariable.woff2)
- Pages Functions: `functions/api/shared-state.js`(회의록/PSI조정 등 작은 입력값), `functions/api/dashboard-data.js`(업로드 파싱결과 전체)
- 원본 엑셀: 매달 새 파일 업로드용 (예: `26년 7월 건기식 Aging 리포트 260708 v1.xlsx`). `.gitignore`로 커밋 제외됨.
## 사용자가 "엑셀 올렸으니 배포해줘"라고 하면 → `npm run deploy`
이게 사용자의 기본 운영 방식이다 (웹 업로드 대신 리포에 파일을 떨구는 쪽을 선호함).

```bash
npm run deploy          # 최신 .xlsx 자동 탐색 → KV 반영 → 필요시 코드 push
```

`tools/deploy.mjs` → `tools/lib/publish.mjs`. 데이터만 하려면 `npm run publish:data`.
관리자 비밀번호는 gitignore된 `.env.local`의 `ADMIN_PASSWORD` 또는 환경변수에서 읽는다.

**⚠️ 배포 자체로는 숫자가 안 바뀐다.** 배포는 `public/` 파일만 올리고 숫자는 KV(`dashboard:live`)에 있다.
엑셀은 `.gitignore`라 커밋도 안 된다. 그래서 `npm run deploy`가 두 가지를 다 하는 것 —
`git push`만 하면 데이터는 그대로다.

**파서를 따로 구현하지 말 것.** `tools/lib/publish.mjs`는 `vendor/xlsx.full.min.js`와
`SOP_LATEST.html`의 인라인 스크립트를 vm에 올리고 `FileReader`를 스텁해서
**실제 `handleUpload()`를 그대로 호출**한다. 별도 파서를 쓰면 브라우저 업로드와 숫자가 반드시 어긋난다.
파일은 `readFileSync(p).toString('binary')`(latin1) — 브라우저 `FileReader.readAsBinaryString`와 동일.

코드만 배포: `npm run deploy -- --code-only` (또는 `main`에 push → Cloudflare 자동 배포).

## 데이터가 어디 사는지 — ⚠️ 여러 사람이 보는 사이트임을 잊지 말 것
| 저장소 | 내용 | 공유됨? |
|---|---|---|
| `localStorage['sopDash_v11']` | 엑셀 파싱 결과(`UPLOADED`) 로컬 캐시 | ❌ 브라우저 전용 |
| KV `dashboard:live` (`/api/dashboard-data`) | 엑셀 파싱 결과 gzip — **모든 열람자가 보는 실체** | ✅ |
| KV `live` (`/api/shared-state`) | 회의록, 담당의견, PSI 조정값, Action Log, 판매계획 셀 수정 | ✅ (256KB 상한) |
| KV `archive:YYYY-MM` | 월별 보관본 | ✅ |
| IndexedDB `sopDashSnapDB` | 시점 스냅샷 | ❌ 브라우저 전용 |

**새 기능이 "내 화면에선 되는데 남들은 안 보인다"면 거의 항상 localStorage에만 쓰고 KV에 안 올린 것이다.**
`UPLOADED`가 null이면 `getPSIData()`/`getMx()` 등이 코드 내장 예시 데이터(`const PSI`, `MATRIX`, `CH_AMT`, `TREND_DATA`,
`SENS_PLAN`)로 폴백한다 — 조용히 그럴듯한 가짜 숫자가 나오므로 디버깅 때 제일 먼저 의심할 것.
내장 `PSI`에는 `monthRealLabels`/`sourceMonthlyPsi`/다이소 품목이 없어서 PSI 탭이 특히 크게 어긋난다.

## 숫자가 사람마다 달라지는 함정 두 가지 (2026-08-12에 실제로 터짐)
1. **데이터에 따라 UI 컨트롤을 프로그램으로 바꾸는 코드는 업로드 경로에만 두면 안 된다.**
   `chAchieveMonth`(③탭 월 선택)는 HTML 기본값이 `5월`인데 최신월 자동전환이 `handleUpload` 안에만 있어서,
   업로드한 사람은 7월을, 나머지는 5월을 봤다. 지금은 `syncAchieveMonthToData()`로 빼서
   업로드·`loadFromStorage`·`loadSharedDashboardData` 세 경로에서 모두 호출한다. 비슷한 걸 추가하면 같이 챙길 것.
2. **`UPLOADED`는 항상 JSON 정규화본이어야 한다.** 업로드 직후 `UPLOADED=JSON.parse(JSON.stringify(result))`.
   파서 원본을 그대로 잡으면 업로드한 사람만 `NaN`/`Infinity`/`undefined`를 보고,
   JSON을 거쳐 받는 다른 열람자는 `null`/키 소실을 봐서 숫자가 갈린다 (0으로 나누는 `rate6`/`dp`/`dr`이 실제 위험 지점).

## 폰트 — 열람자 OS별 편차 방지
`vendor/PretendardVariable.woff2` self-host. 새로 텍스트를 그릴 때:
- CSS는 `body` 스택 상속을 쓸 것
- **캔버스 `ctx.font`와 Chart.js 폰트는 반드시 `UI_FONT_STACK` 상수를 쓸 것.**
  `Arial`이나 `'Apple SD Gothic Neo'`를 직접 박으면 한글이 OS 폴백으로 갈려 열람자마다 글자폭이 달라진다.

## 전체 흐름
1. 사용자가 엑셀 업로드 → `handleUpload(file)` → `FileReader.readAsBinaryString` → `XLSX.read(...,{type:'binary'})`
2. 각 시트를 `parseXxx(ws)` 함수들이 파싱 → `result` 객체에 모아 `UPLOADED` 전역변수에 저장
3. `saveToStorage(result)` → `localStorage`(`sopDash_v11`)에 JSON 저장 (용량 초과 시 `monthly_mx`/`monthly_mx_delivery` 제외하고 재시도)
4. 전체 `render*()` 함수 재실행으로 화면 갱신
5. 다음 방문 시 `loadFromStorage()`가 localStorage에서 복원 (재업로드 안 해도 마지막 상태 유지, 단 코드가 바뀌면 재업로드 필요)

## 시트별 파싱 함수 — ⚠️ 중요 함정 포함

### `parseInventory(ws)` — 현재고 시트
- 컬럼: B=자재, F=배치, **I=가용/J=가용금액, K=품질검사/L=검사금액, N=보류재고/O=보류금액**
- **수량/금액은 항상 I+K+N, J+L+O 합산** (가용만 쓰면 안 됨 — 2026-07-08에 이 버그로 "3개월↓ 리포트가 3개인데 실제 12개" 이슈 발생/수정함)
- 결과: `matrix[채널][Aging구간] = {q,a,s:[...]}`, sku 객체는 `{m,n,q,av,qc,hd,a,t,r,chRemMo}`

### `parsePSISheet(ws)` — PSI 시트 ⚠️⚠️ 가장 까다로운 시트
- **시트 범위가 `B2`부터 시작** (`ws['!ref']` 확인). SheetJS `sheet_to_json({header:1})`은 범위의 시작 행/열을 기준으로 배열 인덱스를 매김.
  → `rows[idx]`가 Excel 몇 행인지, `row[idx]`가 Excel 몇 열인지 **하드코딩으로 추측하지 말 것**. 절대 다시 겪지 말아야 할 실수:
    - 열: idx=0 → 컬럼 B (A 아님). `avg3=row[4]`(F열), `inv=row[8]`(J열), `plan6=row[10]`(L열) 등은 이미 검증된 값.
    - 행: `rows[0]`은 Excel **2행**부터 시작 (1행 아님!). 헤더 행(자재코드/월블록 헤더가 같이 있는 행, 실제 Excel 5행)을 찾으려면 **반드시** 코드에 이미 있는 `headerRow=rows.findIndex(row=>row[0]==='자재코드')`를 재사용할 것. `rows[4]`처럼 행 번호를 직접 하드코딩하면 한 칸씩 밀려서 조용히 틀린 값이 들어감 (2026-07-08에 이 실수로 monthRealLabels가 전부 폴백값으로 나가는 버그 발생/수정함).
- **월 블록(L/AB/AM/AW/BG 열, row5 헤더텍스트 '7월'~'11월')은 매달 사용자가 수동으로 밀어서 갱신함** (이번달=L, 다음달엔 L이 다음 월이 됨). 절대 특정 컬럼을 특정 캘린더월이라고 가정하지 말 것.
- `sourceMonthlyPsi` 객체 키(`'6월'~'10월'`)는 **위치 식별자**(1~5번째 블록)이지 실제 캘린더월이 아님. 실제 월 텍스트가 필요하면 같이 붙어있는 `monthRealLabels`(같은 시트 헤더에서 동적으로 읽음)를 사용할 것.
- **다이소 통합 SKU 경로(`mergeDaisoIntegratedPSI`)는 별도 row 객체를 새로 만들기 때문에, `sourceMonthlyPsi`/`monthRealLabels`를 명시적으로 다시 실어줘야 함** — 안 그러면 통합 SKU만 조용히 폴백값(예: "26/6" 고정 라벨)으로 깨짐. 이미 한 번 이 버그가 났었음(raw PSI 수정 후 daiso 경로에 반영 누락).
- PSI = **가용재고만** 사용 (Aging 리포트와 다른 개념, 판매 가능 재고 관점 — 절대 가용+품질+보류로 바꾸지 말 것. 사용자가 명시적으로 확인한 업무 규칙).

### `parseHitSheet(ws)` — 오차율 분석 시트 ⚠ 구획(섹션) 주의
- **2026-08 파일부터 월 헤더 위에 구획 라벨 행이 생겼다**: `[매출금액]`(B) / `[순매출]`(AG) / `[수량]`(AU).
  월 컬럼이 24개 → 60개로 늘었고, **같은 월 헤더가 구획마다 반복된다.**
- 파서는 구획 라벨 행을 찾아 `sectionByCol[]`을 만들고, `[수량]`은 별도 맵에, `[순매출]`은 **건너뛴다**(사용자가 화면에서 안 쓴다고 명시).
  라벨 행이 없는 옛 파일은 전 구간을 금액으로 본다(무회귀).
- ⚠ **구획을 안 보고 "같은 월이면 첫 컬럼 우선"에만 기대면, 열 순서가 바뀌는 순간 순매출/수량을 조용히 금액으로 읽는다.**
- 결과: `hit`(금액, 억원) + `hit.qty`(수량, 개). 계산식은 동일(WAPE)해서 내부 `aggregate()`를 두 번 호출한다.
- 금액 행에는 같은 `월|채널|자재`의 실측 수량이 `qtyPlan`/`qtyActual`로 붙는다.
  화면의 금액/수량 토글(`insightUnit`/`htUnit`)은 `realQty()` → 없으면 기존 `qtyFromAmountM()`(금액÷단가 추정, `~` 표시) 순서로 폴백.
- **수량 판매계획(AU~BF)은 2026-08 시점에 비어 있다.** `hit.qty.hasPlan=false`이고 수량 오차율은 `null`(산출불가).
  나중에 그 열을 채우면 코드 수정 없이 자동으로 산출된다.

### `parseSalesPlanSheet(ws)` — 판매계획(SF) 시트
- 시트 범위가 `A1`부터 시작 (PSI와 다르게 오프셋 없음, `rows[N]`=Excel `(N+1)`행 표준 인덱싱).
- 실적(I~AF, 25/1~26/12): **row35(`rows[34]`)에서 실제 년월 헤더를 동적으로 읽음** (`parseYearMonthCell` — "2026.07" 같은 float를 연/월로 파싱). 고정 24개월, 안 밀림(검증됨).
- 계획금액(AG~AK)/단가(AL~AP)/계획수량(AQ~AU)은 **5칸씩 롤링** (PSI 월블록과 동일 패턴, 이번달=AG/AL/AQ). 단가는 AL열(이번달 기준) 고정 참조.
- `skuSp.monthly[i]`, `skuSp.planQty[i]` 등은 위치 기반이라 그 자체로는 문제 없음 — 문제는 이 값을 "26/6" 같은 라벨과 매칭할 때(PSI 쪽) 위치와 실제월을 헷갈리는 것.

## 렌더 함수 지도 (기능 → 함수명, Grep으로 찾기)
| 화면/기능 | 함수 |
|---|---|
| ① 재고 Aging 매트릭스 + 드릴다운 | `renderMatrix`, `drilldown`, `_renderDDTbody` |
| 📡 Aging Sensing (M+N 예측) | `renderSensing`, `projectSensingInventory`, `computeSensInbound`(PSI 입고, 원가단가 기준) |
| SKU 상세 팝업(라인차트, 실적vs계획) | `renderSkuDetailModal` — 배지: `diffVal`/`diffPos` 3번째 dataset |
| ② PSI 시뮬레이션 탭 | `renderPSI`, `_renderPsiTbody`, `calcPsiMonth` (건드리지 말 것 — 사용자가 최소화 지시) |
| ② PSI 표 필터 (0건 진단 포함) | `PSI_FILTERS`, `applyPsiFilters`, `psiViewRows`, `diagnosePsiEmpty` — 필터 조건은 **`applyPsiFilters` 한 곳에만** 있어야 함. 인라인으로 복사하면 0건 진단이 실제 화면과 어긋난다 |
| ② PSI 다이소 플랜트별 분해 | `buildPlantScopedPsiRows`, `decorateDaisoComponentRows`, `psiIntegratedSigByMonth` — 아래 "플랜트 분해 규칙" 참고 |
| ② PSI 표 수량/원가/매출 토글 | `psiUnitMode`, `getPsiPriceMap`, `fmtPsiCell`, `setPsiUnitMode` |
| ③ 월별 판매계획 대비 실적(탭에 박힌 바차트) | `renderChAchieve` (canvas id `chAcc`) — 배지: `monthDiffLabelPlugin` |
| ③ 오차 기여 TOP10 / 판매계획 보정 대상 리스트 | `renderInsightTables`, `renderHT` |
| 보정 대상 리스트 → 품목클릭 팝업(바차트) | `openPlanAdjustModal` (canvas id `planAdjustTrendChart`) — 배지: `modalDiffLabelPlugin`. **SKU상세팝업과 다른 별도 모달**임에 유의 |
| 정렬 토글(오름↔내림) 공통 로직 | `nextSortState`, `sortValue`, `compareSortRows` — 여러 표(오차TOP10, 보정리스트)가 공유 |

## 다이소 플랜트 분해 규칙 (2026-08-13 확립)

**판매계획·3평판은 통합코드에만 있다.** 하위 코드 중 향남(`7302xxx`)이 실적을 다 갖고,
횡성(`9401xxx`)은 **재고만 있고 계획·실적·3평판·입고가 전부 0**이다(2번째 생산처로 나중에 붙은 코드).
그래서 플랜트별로는 재고일수의 분모가 없다.

채택한 규칙 — **분자만 플랜트 몫으로 바꾸고 분모는 통합 수요를 그대로 쓴다:**
```
플랜트 재고일수 = 플랜트 기말재고 ÷ 통합 다음달 판매계획 × 30
```
- 배분 계수가 없어서 자의성이 없고, **플랜트별 재고일수의 합 = 통합 재고일수**가 정확히 성립(26/8 파일 전건 검증)
- ⚠ **3평판을 재고 비율로 배분하는 방식은 쓰지 말 것.** 분자·분모가 같은 비율로 줄어 모든 플랜트의
  재고일수가 통합과 똑같아진다 — 정보량이 0이 된다. (한 번 검토했다가 기각한 안)
- ⚠ **신호등을 플랜트 단위로 걸지 말 것.** 마그네슘이 향남 46일 / 횡성 103일이라 각각은 기준 미달인데
  합치면 149일로 정상이다. 판정은 항상 통합 기준(`sigByMonth`)으로 한다.
- 진척율·3평판 기준 **보조 열은 플랜트 분해에서 `—`로 비운다** (당월실적·3평판이 통합에만 있어 나눌 수 없음)
- 입고 조정 input은 플랜트 분해에서 잠근다 (조정값을 어느 하위 코드에 귀속할지 정의되지 않음)

구현 통로 두 개 (평소엔 `undefined`라 기존 동작 무영향):
- `d.daysPlanSource` → `psiDaysForRow`가 분모를 다른 행에서 가져오게 함
- `d.sigByMonth` → `calcPsiMonth`가 신호등을 통합 기준으로 판정하게 함

## 확립된 시각 패턴
- **차이(diff) 배지**: 초록(`#33512E`)/빨강(`#D64545`) 배경 + 흰 텍스트 + `ctx.roundRect`로 둥근 모서리. `▲+`/`▼` 접두사. Chart.js `afterDraw` 플러그인으로 캔버스에 직접 그림 (Chart.js datalabels의 `backgroundColor`+`borderRadius` 조합도 동일 효과, `renderSkuDetailModal`의 3번째 dataset 참고).
- 태그/배지 UI는 `.tag g/y/r/gray/b` 클래스 재사용 (녹색/노랑/빨강/회색/파랑).

## 검증 없이 코드 못 믿을 때 — Node 재현 하네스 패턴
브라우저 없이 실제 엑셀로 파싱/렌더를 그대로 재현해서 디버깅 가능. 이번 세션에서 여러 번 씀:
```js
const XLSX = require('vendor/xlsx.full.min.js'); // vm.runInContext로 로드
// SOP_LATEST.html에서 <script>(src 없는 것) 정규식 추출 → vm.runInContext
// document는 존재하는 id만 진짜 객체 반환하는 스텁으로 만들어야 함 (getElementById가 null 반환하는
// 케이스를 못 잡으면 "Cannot read properties of null" 같은 런타임 버그를 놓침)
// 이후 실제 handleUpload/parseXxx 함수를 sandbox에서 직접 호출해 결과 비교
```
scratchpad 폴더에 재사용 가능한 스크립트들 남겨둠(세션마다 새로 만들지만 패턴은 고정): `repro_upload.js`류.

## 업무 규칙 요약 (자세한 건 memory 참고)
- Aging 리포트/Sensing = 가용+품질검사+보류재고 합산 (총 보유재고 관점)
- PSI 시뮬레이션 = 가용재고만 (판매 가능 재고 관점) — 절대 합치지 말 것
- PSI 관련 기능은 최소 변경 원칙 (사용자가 토큰/범위 제한 명시적으로 요청함)
