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
