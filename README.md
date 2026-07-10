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

## Shared live inputs

PSI 입고수량 조정, PSI Action Log, 회의록, 담당자 조치의견은 Cloudflare Pages Function `/api/shared-state`를 통해 공용 저장할 수 있습니다.

Cloudflare Pages 프로젝트 설정에서 아래 둘 중 하나를 바인딩하세요.

- 권장: KV namespace를 만들고 Pages 변수/바인딩에서 이름을 `SOP_STATE`로 연결
- 대안: D1 database를 만들고 Pages 변수/바인딩에서 이름을 `DB`로 연결

바인딩 후 재배포하면 여러 사용자가 같은 PSI 조정값과 회의록을 볼 수 있습니다. 저장소 바인딩이 없으면 기존처럼 각 브라우저의 localStorage만 사용합니다.
