# 건기식 S&OP 대시보드 — 코드 구조 가이드

> 목적: 이 파일은 매 세션 시작 시 자동으로 읽힙니다. `SOP_LATEST.html`(단일 파일, 인라인 `<script>` 하나에 전체 JS)을
> 처음부터 다시 탐색하지 않도록, 구조·함수 위치·이번 세션에서 발견한 함정을 미리 정리해둔 지도입니다.
> **줄 번호는 편집 때마다 바뀌므로 여기 적지 않습니다 — 함수명으로 Grep해서 찾으세요.**

## 파일
- 대시보드 본체: `dashboard\SOP_LATEST.html` (단일 파일, 인라인 script 1개)
- 디자인 토큰(색상/타이포): `dashboard\DESIGN_SYSTEM.md` (내용/로직 없음, 스타일만)
- 로컬 라이브러리: `dashboard\vendor\` (xlsx.full.min.js, chart.umd.min.js, chartjs-plugin-datalabels.min.js)
- 원본 엑셀: 이 폴더(`3.건기식 S&OP회의\`)에 매달 새 파일 업로드용으로 저장됨 (예: `26년 7월 건기식 Aging 리포트 260708 v1.xlsx`)

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
| ③ 월별 판매계획 대비 실적(탭에 박힌 바차트) | `renderChAchieve` (canvas id `chAcc`) — 배지: `monthDiffLabelPlugin` |
| ③ 오차 기여 TOP10 / 판매계획 보정 대상 리스트 | `renderInsightTables`, `renderHT` |
| 보정 대상 리스트 → 품목클릭 팝업(바차트) | `openPlanAdjustModal` (canvas id `planAdjustTrendChart`) — 배지: `modalDiffLabelPlugin`. **SKU상세팝업과 다른 별도 모달**임에 유의 |
| 정렬 토글(오름↔내림) 공통 로직 | `nextSortState`, `sortValue`, `compareSortRows` — 여러 표(오차TOP10, 보정리스트)가 공유 |

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
