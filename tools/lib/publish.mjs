// 엑셀 파싱 + 공유 저장소(KV) 반영의 공용 구현.
// 브라우저 업로드와 숫자가 1원도 달라지면 안 되므로 파서를 새로 쓰지 않고,
// SOP_LATEST.html 안의 handleUpload()를 Node에서 그대로 실행한다.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIVE_BASE = 'https://s-op-gungi.pages.dev';

// 관리자 비밀번호: 환경변수 우선, 없으면 gitignore된 .env.local의 ADMIN_PASSWORD=... 한 줄
export function readPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const envFile = path.join(ROOT, '.env.local');
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*ADMIN_PASSWORD\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^['"]|['"]$/g, '');
  }
  return '';
}

// 리포 안에서 가장 최근에 수정된 엑셀을 찾는다 (드래그해서 떨군 파일을 자동으로 집기 위함)
export function findLatestExcel(dir = ROOT) {
  const skip = new Set(['node_modules', '.git', '.wrangler', 'public', 'vendor', 'tools']);
  const hits = [];
  (function walk(d, depth) {
    if (depth > 2) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.xlsx?$/i.test(e.name) && !e.name.startsWith('~$')) {
        hits.push({ path: full, mtime: fs.statSync(full).mtimeMs });
      }
    }
  })(dir, 0);
  return hits.sort((a, b) => b.mtime - a.mtime)[0] || null;
}

// ── 브라우저 흉내 ──────────────────────────────────────────────────────────
function createBrowser(base) {
  const store = new Map();
  const localStorage = {
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
  const els = new Map([
    ['uploadStatus', mkEl()], ['chAchieveMonth', mkEl()], ['monthSlider', { ...mkEl(), value: '0' }]
  ]);
  // handleUpload을 원본 그대로 돌리기 위한 최소 FileReader
  class FileReaderStub {
    readAsBinaryString(file) { this.onload({ target: { result: file.__binaryString } }); }
  }
  // 대시보드 스크립트의 console.info/warn은 CLI 출력에 그대로 새면 지저분하므로 모아뒀다가 정리해서 보여준다
  const logs = [];
  const capture = kind => (...m) => logs.push({ kind, text: m.map(x => (typeof x === 'string' ? x : String(x))).join(' ') });
  const sandbox = {
    console: { log: capture('log'), info: capture('info'), warn: capture('warn'), error: capture('error') },
    __logs: logs,
    document: {
      getElementById: id => els.get(id) || null,
      querySelectorAll: sel => (sel.includes('uploadStatus') ? [els.get('uploadStatus')] : []),
      querySelector: () => null,
      body: { classList: { toggle() {} } },
      addEventListener() {}, createElement: () => mkEl()
    },
    localStorage, sessionStorage: localStorage, FileReader: FileReaderStub,
    Response, Request, Headers, Blob, TextEncoder, TextDecoder,
    CompressionStream, DecompressionStream, URL, btoa, atob, setTimeout, clearTimeout,
    alert: () => {}, prompt: () => null, addEventListener() {},
    Chart: { defaults: { font: {} } },
    fetch: (u, o) => fetch(String(u).startsWith('/') ? base + u : u, o)
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/xlsx.full.min.js'), 'utf8'), sandbox);
  const html = fs.readFileSync(path.join(ROOT, 'SOP_LATEST.html'), 'utf8');
  const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/);
  if (!inline) throw new Error('SOP_LATEST.html에서 인라인 script를 찾지 못했습니다.');
  vm.runInContext(inline[1], sandbox);

  const run = code => vm.runInContext(code, sandbox);
  run('renderAllScreens=()=>{};');   // 실제 DOM이 필요한 렌더는 끈다
  run('ADMIN_PASSWORD="";');          // 업로드 중 자동 공유는 끄고 아래에서 직접 올린다
  return { sandbox, run, els, logs };
}

export function parseExcel(xlsxPath, base = LIVE_BASE) {
  const browser = createBrowser(base);
  const { sandbox, run, els } = browser;
  sandbox.__file = {
    name: path.basename(xlsxPath),
    __binaryString: fs.readFileSync(xlsxPath).toString('binary')  // = FileReader.readAsBinaryString
  };
  run('handleUpload(__file)');
  const raw = String(els.get('uploadStatus').textContent || '');
  const uploaded = run('UPLOADED');
  if (!uploaded || raw.includes('❌')) {
    throw new Error(`파싱 실패: ${raw || '알 수 없는 오류'}`);
  }
  // 상태 문구는 브라우저 UI용이라 CLI에 맞지 않는 안내가 붙어 있다. 시트 누락 경고만 남긴다.
  const missing = raw.match(/누락:\s*([^·]+)/)?.[1].trim() || '';
  // 파서 경고는 handleUpload이 console.info('[SOP upload]', ...) 한 줄로 남긴다
  const parserNotes = (browser.logs.find(l => l.text.startsWith('[SOP upload]'))?.text || '')
    .replace('[SOP upload] ', '').split(' / ').filter(Boolean);
  return { ...browser, uploaded, status: raw, missing, parserNotes };
}

export async function publishParsed(browser, { base = LIVE_BASE, password }) {
  if (!password) {
    throw new Error(
      '관리자 비밀번호가 없습니다.\n' +
      '  리포 루트에 .env.local 파일을 만들고 아래 한 줄을 넣으세요 (git에 안 올라갑니다).\n' +
      '    ADMIN_PASSWORD=비밀번호\n' +
      '  또는  ADMIN_PASSWORD=비밀번호 npm run deploy'
    );
  }
  browser.sandbox.__pw = password;
  browser.run('ADMIN_PASSWORD=__pw;');
  const saved = await browser.run('saveDashboardData(UPLOADED)');

  // 올린 것을 다시 받아 바이트 단위로 같은지 확인
  const before = browser.run('JSON.stringify(UPLOADED)');
  browser.run('UPLOADED=null;');
  const gotBack = await browser.run('loadSharedDashboardData()');
  const after = browser.run('JSON.stringify(UPLOADED)');
  const meta = await fetch(`${base}/api/dashboard-data?meta=1`).then(r => r.json()).catch(() => ({}));
  return { ...saved, verified: Boolean(gotBack) && before === after, meta };
}

export function summarize(uploaded) {
  return {
    baseLabel: uploaded.base_label || '(미상)',
    uploadedAt: uploaded.uploaded_at || '',
    psiRows: uploaded.psi?.length ?? 0,
    salesPlanSkus: Object.keys(uploaded.sales_plan || {}).length,
    monthLabels: uploaded.psi?.[0]?.monthRealLabels || {}
  };
}
