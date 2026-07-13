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
