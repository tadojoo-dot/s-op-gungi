# Work Log

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
