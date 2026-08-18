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
function listExcels(dir = ROOT) {
  const skip = new Set(['node_modules', '.git', '.wrangler', 'public', 'vendor', 'tools']);
  const hits = [];
  (function walk(d, depth) {
    if (depth > 2) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.xlsx?$/i.test(e.name) && !e.name.startsWith('~$')) {
        hits.push({ path: full, name: e.name, mtime: fs.statSync(full).mtimeMs });
      }
    }
  })(dir, 0);
  return hits.sort((a, b) => b.mtime - a.mtime);
}

// ⚠ 예전에는 "가장 최근 .xlsx"를 그냥 집었는데, 리포에 결산 파일·점검 파일을 같이 올려두면
//    엉뚱한 파일을 월간 데이터로 파싱해 대시보드가 통째로 깨진다. 이제 이름으로 종류를 가린다.
const AGING_RE = /aging|재고\s*aging|건기식/i;
const STDCOST_RE = /재고자산\s*결산|자재수불/i;
const OVERRIDE_RE = /이관\s*점검|횡성공장/i;

// ⚠ "가장 최근에 수정된 Aging 파일"로 집으면 안 된다 — 지난달 파일을 고쳐서 다시 올리면
//    그게 최신이 되어 **지난달 데이터가 당월로 발행된다**. 2026-08-18에 실제로 그렇게 될 뻔했다
//    (26/7 파일의 채널 수식을 고치자 mtime이 26/8 파일보다 최신이 됨).
//    파일명 기준월이 가장 늦은 것을 고르고, 같은 달 안에서만 mtime으로 고른다(v1.1 vs v1.4).
export function findLatestExcel(dir = ROOT) {
  const all = listExcels(dir)
    .filter(f => AGING_RE.test(f.name) && !STDCOST_RE.test(f.name) && !OVERRIDE_RE.test(f.name));
  if (!all.length) return null;
  const keyed = all.map(f => ({ ...f, key: agingMonthKey(f.name) })).filter(f => f.key !== null);
  if (!keyed.length) return all[0];   // 파일명에 기준월이 없으면 옛 동작(mtime 최신)
  const maxKey = Math.max(...keyed.map(f => f.key));
  return keyed.filter(f => f.key === maxKey).sort((a, b) => b.mtime - a.mtime)[0];
}

// 표준원가 원본(재고자산 결산 파일). 없으면 null → 기존 재고금액 방식으로 폴백한다.
export function findStdCostExcel(dir = ROOT) {
  return listExcels(dir).find(f => STDCOST_RE.test(f.name)) || null;
}

// 품목별 단가 정정표(횡성공장 이관 점검 파일). 없으면 null → 표준원가만 쓴다.
export function findPriceOverrideExcel(dir = ROOT) {
  return listExcels(dir).find(f => OVERRIDE_RE.test(f.name)) || null;
}

// 파일명에서 기준월을 뽑는다: "26년 8월 건기식 Aging 리포트 260813 v1.4.xlsx" → 2608
function agingMonthKey(name) {
  const m = String(name).match(/(\d{2})\s*년\s*(\d{1,2})\s*월/);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

// 전월 Aging 파일. 품목군별 전월대비 표에만 쓰이고, 없으면 그 표만 숨긴다(무회귀).
// ⚠ "두 번째로 최근인 Aging 파일"로 집으면 안 된다 — 같은 달 v1.1/v1.4가 같이 있으면 그걸 전월로 오인한다.
//    파일명의 기준월이 현재 파일보다 앞선 것 중 가장 최근(=가장 가까운 달)을 고른다.
export function findPrevAgingExcel(currentPath, dir = ROOT) {
  const curKey = agingMonthKey(path.basename(currentPath));
  const cands = listExcels(dir)
    .filter(f => AGING_RE.test(f.name) && !STDCOST_RE.test(f.name) && !OVERRIDE_RE.test(f.name))
    .filter(f => path.resolve(f.path) !== path.resolve(currentPath))
    .map(f => ({ ...f, key: agingMonthKey(f.name) }))
    .filter(f => f.key !== null);
  if (curKey === null) return null;
  const earlier = cands.filter(f => f.key < curKey).sort((a, b) => b.key - a.key || b.mtime - a.mtime);
  return earlier[0] || null;
}

// 파일명 기준월을 대시보드와 같은 표기('2026.08')로 바꾼다. 원장 시트의 base_yearmonth와 직접 비교하려는 것.
export function agingYearMonth(name) {
  const k = agingMonthKey(name);
  return k === null ? null : `${2000 + Math.floor(k / 100)}.${String(k % 100).padStart(2, '0')}`;
}

// 전월 파일에서 품목군 스냅샷만 뽑는다. 파서는 새로 쓰지 않고 대시보드의 parseInventory/buildPkgSnapshot을 그대로 쓴다.
// 표준원가/정정표는 넘기지 않는다 — 재고 Aging 금액은 원장 시트 금액을 그대로 쓰는 업무 기준이라
// 두 달이 같은 방식으로 계산된다(2026-08-13 사용자 결정).
//
// ⚠ 전월 파일에서 무조건 '기초재고'를 집으면 안 된다 (2026-08-18에 실제로 어긋났다).
//   26/7 파일의 기초재고는 6/1 스냅샷이라, 8월분과 맞대면 두 달이 벌어지고 62.20억이 나온다.
//   그런데 같은 파일의 '현황' 시트 트렌드(=①탭 KPI 카드·트렌드 차트의 원천)는 7월을 52.40억으로 잡고 있고,
//   그게 7월 회의자료에 나간 숫자다. 한 화면 안에서 7월 값이 둘로 갈린다.
//   → 전월 파일 안의 원장 시트 중 **당월보다 앞서면서 가장 최근인 달**을 고른다.
//     26/7 파일: 기초재고 2026.06 / 현재고 2026.07 → 현재고(7/8, 52.40억) ✅ 트렌드 차트와 일치
//     26/8 파일이 전월이 될 때: 기초재고 2026.08 / 현재고 2026.08 → 동률이면 기초재고 ✅ (월초 기준 유지)
//   파일이 계속 쌓여도 이 규칙만으로 맞는다 — 파일명이 아니라 시트가 스스로 밝힌 기준월로 고르기 때문.
// srcMasterPath: 생산처(향남/횡성) 지정을 읽어올 파일. ⚠ **당월 파일을 넘겨야 한다.**
//   '다이소 마스터'의 생산처 지정은 달마다 바뀌어(26/7→26/8에 22개 코드) 각 달의 마스터를 각각 쓰면
//   이관 자체가 재고 증감으로 잡힌다. 안 넘기면 생산처 분해 없이(bySrc 없음) 스냅샷을 만든다.
export function readPrevPkgSnapshot(prevPath, base = LIVE_BASE, curYearMonth = null, srcMasterPath = null) {
  const browser = createBrowser(base);
  browser.sandbox.__prevBin = fs.readFileSync(prevPath).toString('binary');
  browser.sandbox.__curYm = curYearMonth || null;
  browser.sandbox.__srcBin = srcMasterPath && fs.existsSync(srcMasterPath)
    ? fs.readFileSync(srcMasterPath).toString('binary') : null;
  const snap = browser.run(`(function(){
    const wb=XLSX.read(__prevBin,{type:'binary'});
    const refSheet=findSheetName(wb,'기준정보');
    const pkgMap=refSheet?parsePkgGroupMap(wb.Sheets[refSheet]):null;
    // 우선순위가 아니라 '후보'다 — 실제 선택은 아래 기준월 비교가 한다. 동률이면 앞의 것(기초재고)이 이긴다.
    const cands=['기초재고','현재고']
      .map(n=>{const s=findSheetName(wb,n); return s?{sheet:s,ym:parseBaseYearMonth(wb.Sheets[s])||''}:null;})
      .filter(Boolean);
    if(!cands.length) return null;
    const usable=cands.filter(c=>c.ym&&(!__curYm||c.ym<__curYm));
    // 기준월을 못 읽거나 전부 당월 이후면 옛 동작(기초재고 우선) 그대로 — 무회귀.
    const pick=usable.length
      ? usable.reduce((best,c)=>(c.ym>best.ym?c:best),usable[0])
      : cands[0];
    // 생산처 맵은 **당월 파일**의 다이소 마스터에서 온다 — 양쪽 달을 같은 기준으로 묶기 위해서다.
    let srcMap=null;
    if(__srcBin){
      const cw=XLSX.read(__srcBin,{type:'binary'});
      const dm=cw.SheetNames.find(n=>String(n).replace(/\s/g,'')==='다이소마스터');
      if(dm) srcMap=parseDaisoMasterSheet(cw.Sheets[dm]).plantByMaterial;
    }
    const ws=wb.Sheets[pick.sheet];
    const p=parseInventory(ws,pkgMap,srcMap);
    const snap=buildPkgSnapshot(p.pkgAgg,parseBaseLabel(ws),parseBaseYearMonth(ws),p.pkgAggBySrc);
    if(!snap) return null;
    snap.sheet=pick.sheet;
    snap.srcFrom=__srcBin?'당월 마스터':'(생산처 분해 없음)';
    snap.candidates=cands.map(c=>c.sheet+'('+(c.ym||'기준월 미상')+')');
    return JSON.parse(JSON.stringify(snap));
  })()`);
  return snap && snap.byPkg && Object.keys(snap.byPkg).length ? snap : null;
}

// 전월 파일이 없을 때의 폴백: 지금 라이브(KV)에 올라가 있는 달의 품목군 스냅샷을 그대로 전월로 쓴다.
// 9월 파일을 올리는 시점에 라이브는 8월이므로 자연스럽게 전월이 된다 — 옛 엑셀을 계속 안 들고 있어도 된다.
// ⚠ 반드시 publishParsed(새 데이터 업로드) 전에 호출할 것. 올린 뒤엔 라이브가 당월로 덮여 있다.
export async function readLivePkgSnapshot(base = LIVE_BASE) {
  const b = createBrowser(base);
  const got = await b.run('loadSharedDashboardData()');
  if (!got) return null;
  const snap = b.run('UPLOADED&&UPLOADED.pkg_snapshot');
  if (!snap || !snap.byPkg || !Object.keys(snap.byPkg).length) return null;
  return JSON.parse(b.run('JSON.stringify(UPLOADED.pkg_snapshot)'));
}

// 이관 점검 파일에서 ②PSI 시트를 찾아 { byMat:{mat:{cost,sales}}, mats } 를 만든다.
export function readPriceOverride(browser, xlsxPath) {
  browser.sandbox.__ovBin = fs.readFileSync(xlsxPath).toString('binary');
  return browser.run(`(function(){
    const wb=XLSX.read(__ovBin,{type:'binary'});
    for(const n of wb.SheetNames){
      const r=parsePriceOverrideSheet(wb.Sheets[n]);
      if(r){ r.sheet=n; return r; }
    }
    return null;
  })()`);
}

// 결산 파일에서 자재수불 시트를 찾아 { byMat, mats, lines } 를 만든다.
// 파싱 로직은 대시보드의 parseStdCostSheet를 그대로 쓴다 — 브라우저와 숫자가 어긋나지 않게.
export function readStdCost(browser, xlsxPath) {
  browser.sandbox.__stdBin = fs.readFileSync(xlsxPath).toString('binary');
  return browser.run(`(function(){
    const wb=XLSX.read(__stdBin,{type:'binary'});
    const n=wb.SheetNames.find(s=>String(s).replace(/\\s/g,'').includes('자재수불')&&!String(s).includes('피벗'));
    if(!n) return null;
    const r=parseStdCostSheet(wb.Sheets[n]);
    if(r) r.sheet=n;
    return r;
  })()`);
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

export function parseExcel(xlsxPath, base = LIVE_BASE, stdCostPath = null, overridePath = null, prevPkg = null) {
  const browser = createBrowser(base);
  const { sandbox, run, els } = browser;
  // 전월 품목군 스냅샷 — handleUpload이 result.pkg_prev로 실어 KV까지 같이 올라간다.
  // 같은 달 스냅샷이면 handleUpload 안에서 버려진다(base_yearmonth 비교).
  if (prevPkg) {
    sandbox.__prevPkg = prevPkg;
    run('PKG_PREV_INPUT=__prevPkg;');
  }
  // 단가 소스를 먼저 실어야 한다 — parseInventory가 재고금액을 계산할 때 이미 있어야 하기 때문.
  // 우선순위: 정정표(이관점검) > 결산 표준원가 > 현재고 시트 금액.
  let stdCost = null, priceOverride = null;
  if (overridePath) {
    priceOverride = readPriceOverride(browser, overridePath);
    if (priceOverride) {
      sandbox.__ov = priceOverride;
      run('PRICE_OVERRIDE_INPUT=__ov;');
    }
  }
  if (stdCostPath) {
    stdCost = readStdCost(browser, stdCostPath);
    if (stdCost) {
      sandbox.__std = stdCost;
      run('STD_COST_INPUT=__std;');
    }
  }
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
  return { ...browser, uploaded, status: raw, missing, parserNotes, stdCost, priceOverride };
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
