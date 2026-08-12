# s-op-gungi
s&amp;op gungi

## Cloudflare Pages

This is a static HTML site. Use these settings when connecting the GitHub repository to Cloudflare Pages:

- Framework preset: None
- Build command: leave blank
- Build output directory: `public`
- Production branch: `main`

The `public/_redirects` file rewrites `/` to `SOP_LATEST.html`, so the Pages root URL opens the latest SOP page.

Cloudflare 화면에는 아래처럼 입력하세요.

- Framework preset: `None`
- Build command: 비워두기
- Build output directory: `public`
- Root directory: 비워두기
- Production branch: `main`

## Live release

Cloudflare에 로그인된 터미널에서는 아래 명령으로 운영 Pages 배포를 실행합니다.

```bash
npm run release:live
```

처음 실행하는 환경이면 먼저 Cloudflare 로그인이 필요합니다.

```bash
npx wrangler login
```

## Shared dashboard data (엑셀 업로드 결과 공유)

업로드한 엑셀 파싱 결과는 예전에는 업로드한 사람의 `localStorage`에만 저장돼서, 다른 사람이 사이트를 열면
코드에 내장된 예시 데이터가 보였습니다(특히 PSI 탭은 월 헤더·수치가 통째로 달랐음).

지금은 **관리자 모드에서 업로드하면 파싱 결과가 gzip 압축돼 Cloudflare KV에 저장**되고, 모든 열람자가 이걸 받아서 봅니다.

- API: `/api/dashboard-data` (KV 키 `dashboard:live`)
- 저장은 관리자만 가능 (`x-admin-password` 헤더, Pages secret `ADMIN_PASSWORD`)
- 압축률은 실측 약 9.5배 (1MB JSON → 111KB)

### 운영 방법

1. 상단 `관리자 모드` 버튼으로 로그인
2. 엑셀 업로드 → 상태 문구에 `🔗 공유 저장 완료 (NNN KB)` 가 뜨면 공유된 것
3. 이미 올려둔 데이터를 재업로드 없이 공유하려면 `🔗 데이터 공유` 버튼

관리자 모드가 아닌 상태로 업로드하면 `⚠ 이 브라우저에만 저장됨` 이라고 표시되고 공유되지 않습니다.

열람자가 페이지를 열면 서버 공유본과 자기 localStorage 중 **`uploaded_ts`가 더 최신인 쪽**을 씁니다.
둘 다 없으면 `⚠ 공유된 이번 달 데이터가 없습니다 · 아래 수치는 코드에 내장된 예시값입니다` 배너가 뜹니다.

## 폰트

`vendor/PretendardVariable.woff2` 를 self-host 합니다. 예전에는 `Apple SD Gothic Neo`/`맑은 고딕` 시스템 폰트에
의존해서 Mac·Windows·기타 OS 열람자마다 글자폭이 달라지고 표 정렬이 틀어졌습니다.
Chart.js 기본 폰트와 캔버스에 직접 그리는 배지 폰트(`UI_FONT_STACK`)도 같은 스택으로 통일했습니다.

## Shared live inputs

PSI 입고수량 조정, PSI Action Log, 회의록, 담당자 조치의견은 Cloudflare Pages Function `/api/shared-state`를 통해 공용 저장할 수 있습니다.

Cloudflare Pages 프로젝트 설정에서 아래 둘 중 하나를 바인딩하세요.

- 권장: KV namespace를 만들고 Pages 변수/바인딩에서 이름을 `SOP_STATE`로 연결
- 대안: D1 database를 만들고 Pages 변수/바인딩에서 이름을 `DB`로 연결

바인딩 후 재배포하면 여러 사용자가 같은 PSI 조정값과 회의록을 볼 수 있습니다. 저장소 바인딩이 없으면 기존처럼 각 브라우저의 localStorage만 사용합니다.

### KV binding checklist

Cloudflare 대시보드에서 설정할 때는 아래 값을 정확히 맞추세요.

1. Workers & Pages > `s-op-gungi` Pages 프로젝트 선택
2. Settings > Bindings > Add > KV namespace
3. Variable name: `SOP_STATE`
4. KV namespace: 저장용 KV namespace 선택
5. Save
6. Deployments에서 최신 배포를 다시 배포

확인은 브라우저에서 아래 URL을 열어 JSON이 나오는지 보면 됩니다.

```text
https://<your-pages-domain>/api/shared-state
```

`Missing Cloudflare binding`이 나오면 `SOP_STATE` 바인딩이 Production 환경에 적용되지 않았거나, 재배포가 아직 안 된 상태입니다.

### Terminal copy note

터미널에서 `Ctrl+C`는 복사가 아니라 실행 중인 명령 중단입니다. 복사는 `Ctrl+Shift+C`, 붙여넣기는 `Ctrl+Shift+V`를 사용하세요.

실수로 서버를 끄는 것을 잠깐 막으려면 현재 터미널에서 아래를 실행합니다.

```bash
stty intr undef
```

다시 `Ctrl+C`를 복구하려면 아래를 실행합니다.

```bash
stty intr ^C
```
