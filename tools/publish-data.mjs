#!/usr/bin/env node
// 엑셀을 파싱해서 운영 사이트의 공유 저장소(Cloudflare KV)에 바로 올린다.
// 브라우저에서 업로드하는 것과 숫자가 1원도 달라지면 안 되므로, 파서를 새로 쓰지 않고
// SOP_LATEST.html 안의 handleUpload()를 Node에서 그대로 실행한다.
//
//   ADMIN_PASSWORD=xxx node tools/publish-data.mjs "26년 8월 건기식 Aging 리포트.xlsx"
//   node tools/publish-data.mjs report.xlsx --base http://127.0.0.1:8788   (로컬 테스트)
//   node tools/publish-data.mjs report.xlsx --dry-run                      (올리지 않고 파싱만)
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : def;
};
const dryRun = args.includes('--dry-run');
const base = String(flag('--base', 'https://s-op-gungi.pages.dev')).replace(/\/$/, '');
const xlsxPath = args.find(a => /\.xlsx?$/i.test(a));

if (!xlsxPath) {
  console.error('사용법: ADMIN_PASSWORD=xxx node tools/publish-data.mjs <파일.xlsx> [--base URL] [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(xlsxPath)) {
  console.error(`파일이 없습니다: ${xlsxPath}`);
  process.exit(1);
}

// 비밀번호: 환경변수 우선, 없으면 .env.local (gitignore됨)의 ADMIN_PASSWORD=... 한 줄
function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const envFile = path.join(ROOT, '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*ADMIN_PASSWORD\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}

// ── 브라우저 흉내 ──────────────────────────────────────────────────────────
const store = new Map();
const localStorageStub = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i],
  get length() { return store.size; }
};
const mkEl = () => ({
  textContent: '', title: '', value: '', style: {}, dataset: {},
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  querySelectorAll: () => [], appendChild() {}, addEventListener() {},
  getContext: () => null, disabled: false
});
const els = new Map([['uploadStatus', mkEl()], ['chAchieveMonth', mkEl()], ['monthSlider', { ...mkEl(), value: '0' }]]);
const documentStub = {
  getElementById: id => els.get(id) || null,
  querySelectorAll: sel => (sel.includes('uploadStatus') ? [els.get('uploadStatus')] : []),
  querySelector: () => null,
  body: { classList: { toggle() {} } },
  addEventListener() {}, createElement: () => mkEl()
};
// FileReader 스텁: handleUpload을 원본 그대로 돌리기 위한 최소 구현
class FileReaderStub {
  readAsBinaryString(file) { this.onload({ target: { result: file.__binaryString } }); }
}

const sandbox = {
  console, document: documentStub, localStorage: localStorageStub, sessionStorage: localStorageStub,
  FileReader: FileReaderStub, Response, Request, Headers, Blob, TextEncoder, TextDecoder,
  CompressionStream, DecompressionStream, URL, btoa, atob, setTimeout, clearTimeout,
  alert: () => {}, prompt: () => null, addEventListener() {},
  Chart: { defaults: { font: {} } },
  // 상대경로 fetch를 대상 사이트로 돌린다
  fetch: (u, o) => fetch(String(u).startsWith('/') ? base + u : u, o)
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 실제 SheetJS와 실제 대시보드 스크립트를 그대로 로드
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/xlsx.full.min.js'), 'utf8'), sandbox);
const html = fs.readFileSync(path.join(ROOT, 'SOP_LATEST.html'), 'utf8');
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
if (!inline) { console.error('SOP_LATEST.html에서 인라인 script를 찾지 못했습니다.'); process.exit(1); }
vm.runInContext(inline[1], sandbox);

const run = code => vm.runInContext(code, sandbox);
// 렌더는 실제 DOM이 필요하므로 끈다. 파싱/저장 로직만 원본 그대로 쓴다.
run('renderAllScreens=()=>{};');
// 업로드 중 자동 공유는 끄고(관리자 아님 상태), 파싱이 끝난 뒤 이 스크립트가 직접 올린다.
run('ADMIN_PASSWORD="";');

// ── 파싱: 브라우저와 동일하게 binary string으로 넘긴다 ──────────────────────
console.log(`파싱: ${xlsxPath}`);
const binaryString = fs.readFileSync(xlsxPath).toString('binary');
sandbox.__file = { name: path.basename(xlsxPath), __binaryString: binaryString };
run('handleUpload(__file)');

const status = els.get('uploadStatus').textContent;
const uploaded = run('UPLOADED');
if (!uploaded || String(status).includes('❌')) {
  console.error(`\n파싱 실패: ${status}`);
  process.exit(1);
}
console.log(status);
console.log(`  기준일 ${uploaded.base_label || '?'} · PSI ${uploaded.psi?.length ?? 0}행 · ` +
  `판매계획 ${Object.keys(uploaded.sales_plan || {}).length}품목 · 월 라벨 ${JSON.stringify(uploaded.psi?.[0]?.monthRealLabels || {})}`);

if (dryRun) { console.log('\n--dry-run: 업로드하지 않고 종료합니다.'); process.exit(0); }

// ── 업로드: 브라우저와 같은 saveDashboardData() 경로 ────────────────────────
const password = readPassword();
if (!password) {
  console.error('\nADMIN_PASSWORD가 없습니다. 아래 중 하나로 지정하세요.');
  console.error('  ADMIN_PASSWORD=xxx node tools/publish-data.mjs <파일>');
  console.error('  또는 리포 루트에 .env.local 파일을 만들고  ADMIN_PASSWORD=xxx  한 줄 (gitignore됨)');
  process.exit(1);
}
sandbox.__pw = password;
run('ADMIN_PASSWORD=__pw;');
console.log(`\n공유 저장: ${base}/api/dashboard-data`);
try {
  const res = await run('saveDashboardData(UPLOADED)');
  console.log(`완료 · ${Math.round(res.size / 1024).toLocaleString('ko-KR')}KB (${res.enc})`);
} catch (e) {
  console.error(`실패: ${e.message}`);
  process.exit(1);
}

// ── 검증: 올린 것을 다시 받아 숫자가 같은지 확인 ────────────────────────────
const check = await fetch(`${base}/api/dashboard-data?meta=1`).then(r => r.json());
const before = run('JSON.stringify(UPLOADED)');
run('UPLOADED=null; __reloaded=false;');
const gotBack = await run('loadSharedDashboardData()');
const after = run('JSON.stringify(UPLOADED)');
console.log(`검증 · 서버 메타 ${JSON.stringify({ base_label: check.base_label, size: check.size })}`);
console.log(gotBack && before === after
  ? '검증 통과 · 되받은 데이터가 올린 것과 바이트 단위로 동일합니다.'
  : '⚠ 검증 실패 · 되받은 데이터가 다릅니다. 사이트에서 직접 확인하세요.');
process.exit(gotBack && before === after ? 0 : 1);
