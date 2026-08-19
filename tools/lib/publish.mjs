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

// 당월보다 앞선 Aging 파일 전부(가까운 달 순). ①탭 월 필터가 파일 수만큼 달을 보여주는 데 쓴다.
// 같은 달에 v1.1/v1.4가 있으면 최신 수정본 하나만 남긴다.
export function findPrevAgingExcels(currentPath, dir = ROOT) {
  const curKey = agingMonthKey(path.basename(currentPath));
  if (curKey === null) return [];
  const seen = new Set();
  return listExcels(dir)
    .filter(f => AGING_RE.test(f.name) && !STDCOST_RE.test(f.name) && !OVERRIDE_RE.test(f.name))
    .filter(f => path.resolve(f.path) !== path.resolve(currentPath))
    .map(f => ({ ...f, key: agingMonthKey(f.name) }))
    .filter(f => f.key !== null && f.key < curKey)
    .sort((a, b) => b.key - a.key || b.mtime - a.mtime)
    .filter(f => (seen.has(f.key) ? false : (seen.add(f.key), true)));
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
export function readPrevMonths(prevPaths, base = LIVE_BASE, curYearMonth = null, srcMasterPath = null) {
  const browser = createBrowser(base);
  browser.sandbox.__curYm = curYearMonth || null;
  browser.sandbox.__srcBin = srcMasterPath && fs.existsSync(srcMasterPath)
    ? fs.readFileSync(srcMasterPath).toString('binary') : null;
  browser.sandbox.__bins = (Array.isArray(prevPaths) ? prevPaths : [prevPaths])
    .filter(p => p && fs.existsSync(p))
    .map(p => ({ name: path.basename(p), bin: fs.readFileSync(p).toString('binary') }));
  const months = browser.run(`(function(){
    // 생산처 맵은 **당월 파일**의 다이소 마스터에서 온다 — 두 달을 같은 기준으로 묶기 위해서다.
    let srcMap=null;
    if(__srcBin){
      const cw=XLSX.read(__srcBin,{type:'binary'});
      const dm=cw.SheetNames.find(n=>String(n).replace(/\s/g,'')==='다이소마스터');
      if(dm) srcMap=parseDaisoMasterSheet(cw.Sheets[dm]).plantByMaterial;
    }
    const byYm=new Map();   // 기준월 → 그 달을 대표하는 원장 시트
    __bins.forEach(f=>{
      const wb=XLSX.read(f.bin,{type:'binary'});
      const refSheet=findSheetName(wb,'기준정보');
      const pkgMap=refSheet?parsePkgGroupMap(wb.Sheets[refSheet]):null;
      // ⚠ **파일 하나당 한 달만 쓴다** (2026-08-18 사용자 지시: "6월 날려").
      //   26/7 파일은 기초재고=6/1, 현재고=7/8이라 두 달을 담고 있지만, 6/1은 그 파일이 대표하는 달이 아니다.
      //   그 파일이 말하는 달(= 당월보다 앞서면서 가장 최근인 원장) 하나만 고른다.
      //   동률이면 '기초재고'(월초) 우선 — 당월이 기초재고 기준이라 기준을 맞춘다.
      const cands=['기초재고','현재고']
        .map(n=>{const sheet=findSheetName(wb,n); if(!sheet) return null;
                 const ws=wb.Sheets[sheet]; return {name:n,sheet,ws,ym:parseBaseYearMonth(ws)||''};})
        .filter(c=>c&&c.ym&&(!__curYm||c.ym<__curYm));
      if(!cands.length) return;
      const pick=cands.reduce((best,c)=>(c.ym>best.ym?c:best),cands[0]);
      const prev=byYm.get(pick.ym);
      if(prev&&!(pick.name==='기초재고'&&prev.name!=='기초재고')) return;
      byYm.set(pick.ym,{name:pick.name,sheet:pick.sheet,ym:pick.ym,file:f.name,ws:pick.ws,pkgMap});
    });
    const out=[...byYm.values()].sort((a,b)=>b.ym.localeCompare(a.ym)).map(m=>{
      const p=parseInventory(m.ws,m.pkgMap,srcMap);
      const snap=buildPkgSnapshot(p.pkgAgg,parseBaseLabel(m.ws),m.ym,p.pkgAggBySrc);
      if(!snap) return null;
      snap.sheet=m.sheet; snap.file=m.file;
      snap.srcFrom=__srcBin?'당월 마스터':'(생산처 분해 없음)';
      // ①탭 월 필터용 매트릭스. 과거월 파일도 원장 전체를 갖고 있어 당월과 **똑같은 수준**으로 볼 수 있다
      //   (채널 4개·수량·SKU 드릴다운·생산처 필터 전부). 현황 시트 요약과는 다른 소스다.
      snap.month={
        label:parseBaseLabel(m.ws), yearmonth:m.ym, sheet:m.sheet,
        matrix:p.matrix, matrix_delivery:p.matrix_delivery,
        ch_amt:p.ch_amt, ch_delivery:p.ch_delivery, kpi:p.kpi
      };
      return snap;
    }).filter(x=>x&&x.byPkg&&Object.keys(x.byPkg).length);
    return JSON.parse(JSON.stringify(out));
  })()`);
  return months || [];
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

export function parseExcel(xlsxPath, base = LIVE_BASE, stdCostPath = null, overridePath = null, prevPkg = null, opts = {}) {
  const browser = createBrowser(base);
  const { sandbox, run, els } = browser;
  // 월별 Risk 이력 — 이어받을 이력과 '과거월까지 다시 계산' 여부.
  // ⚠ handleUpload이 UPLOADED를 덮기 전에 읽으므로 반드시 handleUpload **호출 전에** 실어야 한다.
  if (opts.riskHistory) {
    sandbox.__riskHist = opts.riskHistory;
    run('RISK_HISTORY_INPUT=__riskHist;');
  }
  if (opts.rebuildRisk) run('RISK_REBUILD_INPUT=true;');
  // 원장 시트 강제 지정 — 한 파일이 두 달(기초재고/현재고)을 담을 때 어느 달을 볼지 고른다.
  if (opts.inventorySheet) {
    sandbox.__invSheet = String(opts.inventorySheet);
    run('INVENTORY_SHEET_INPUT=__invSheet;');
  }
  // 전월 품목군 스냅샷 — handleUpload이 result.pkg_prev로 실어 KV까지 같이 올라간다.
  // 같은 달 스냅샷이면 handleUpload 안에서 버려진다(base_yearmonth 비교).
  if (prevPkg) {
    sandbox.__prevPkg = prevPkg;
    run('PKG_PREV_INPUT=__prevPkg;');
    // 과거월 매트릭스는 ①탭 월 필터가 쓴다. pkg 스냅샷과 같은 파싱에서 나온 것이라 숫자가 어긋나지 않는다.
    // prevPkg.months가 있으면 여러 달(26/7 파일 하나가 6월·7월 둘을 준다), 없으면 자기 달 하나.
    const months = prevPkg.months || (prevPkg.month ? [prevPkg.month] : null);
    if (months && months.length) {
      sandbox.__prevMonths = months;
      run('PREV_MONTHS_INPUT=__prevMonths;');
    }
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


// ═══════════ 월별 Risk 이력 — 3중 저장 ═══════════════════════════════════
// 1차: 리포에 커밋되는 JSON(data/risk_history.json) — **원본**. git 히스토리가 곧 세대별 백업이다.
// 2차: KV dashboard:live의 risk_history — 화면이 읽는 사본.
// 3차: 아래 가드 — KV 읽기 실패 시 중단 / 달 수 감소 시 중단 / 합집합 병합.
// ⚠ 이력은 "회의에 나간 숫자"다. 조용히 사라지거나 바뀌면 기능 자체가 무의미해진다.
export const RISK_HISTORY_FILE = path.join(ROOT, 'data', 'risk_history.json');

export function readRepoRiskHistory() {
  try {
    if (!fs.existsSync(RISK_HISTORY_FILE)) return null;
    const j = JSON.parse(fs.readFileSync(RISK_HISTORY_FILE, 'utf8'));
    return j && typeof j === 'object' && Object.keys(j).length ? j : null;
  } catch (e) {
    // ⚠ 파일이 깨졌으면 조용히 넘어가지 않는다 — 덮어쓰면 원본이 날아간다.
    throw new Error(`data/risk_history.json 을 읽지 못했습니다: ${e.message}`);
  }
}

export function writeRepoRiskHistory(history) {
  if (!history || !Object.keys(history).length) return null;
  fs.mkdirSync(path.dirname(RISK_HISTORY_FILE), { recursive: true });
  fs.writeFileSync(RISK_HISTORY_FILE, JSON.stringify(history, null, 1) + '\n', 'utf8');
  return RISK_HISTORY_FILE;
}

// 라이브 KV의 risk 이력. ⚠ **반드시 publishParsed 전에** 호출할 것 — 올린 뒤엔 당월로 덮여 있다.
// readLivePkgSnapshot과 달리 **네트워크 실패와 '데이터 없음'을 구분해서** 돌려준다.
// 실패를 null로 뭉개면 빈 이력으로 덮어쓰는 사고가 난다(품목군 스냅샷이 지금 그 구멍이다).
export async function readLiveRiskHistory(base = LIVE_BASE) {
  // ⚠ loadSharedDashboardData()를 그냥 부르면 안 된다 — 그 함수는 **네트워크 실패도 false로 삼킨다**
  //   (`catch(e){console.warn(...);return false;}`). '데이터 없음'과 구분이 안 되므로,
  //   서버가 안 잡히는 상황에서 "이력 없음"으로 오인해 **빈 이력으로 KV를 덮는다**.
  //   그래서 먼저 meta 엔드포인트로 도달 가능성과 데이터 유무를 직접 확인한다.
  let meta;
  try {
    const res = await fetch(`${base}/api/dashboard-data?meta=1`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: `라이브 meta 응답 HTTP ${res.status}`, history: null };
    meta = await res.json();
  } catch (e) {
    return { ok: false, reason: `라이브에 연결하지 못했습니다: ${String(e.message || e).slice(0, 80)}`, history: null };
  }
  if (!meta || !meta.has) return { ok: true, reason: '라이브에 데이터 없음(첫 발행)', history: null };

  const b = createBrowser(base);
  const got = await b.run('loadSharedDashboardData()');
  // 데이터가 **있다고 했는데** 못 읽었다 → 여기서 멈춰야 한다. 이력이 있는데 못 본 상황이다.
  if (!got) return { ok: false, reason: '라이브에 데이터가 있는데 내려받지 못했습니다', history: null };
  const raw = b.run('UPLOADED&&UPLOADED.risk_history?JSON.stringify(UPLOADED.risk_history):""');
  if (!raw) return { ok: true, reason: '라이브에 risk 이력 없음(첫 발행)', history: null };
  try {
    return { ok: true, reason: '', history: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, reason: `라이브 risk 이력 파싱 실패: ${e.message}`, history: null };
  }
}

// 합집합. 같은 달이 양쪽에 있으면 **더 최근에 만든 것**(builtAt)을 남긴다.
export function mergeRiskHistories(...sources) {
  const out = {};
  sources.filter(Boolean).forEach(src => {
    Object.entries(src).forEach(([ym, snap]) => {
      if (!snap || !snap.rows) return;
      const cur = out[ym];
      if (!cur || String(snap.builtAt || '') > String(cur.builtAt || '')) out[ym] = snap;
    });
  });
  return Object.keys(out).length ? out : null;
}

// 과거 Aging 파일에서 그 달의 risk 스냅샷을 뽑는다.
// months = readPrevMonths가 돌려준 [{yearmonth, sheet, file, ...}] — 어느 파일의 어느 시트가
// 그 달을 대표하는지 이미 정해져 있으므로 **그 결정을 그대로 따른다**(①탭 월 필터와 같은 달을 보게).
export function readPrevRiskSnapshots(months, prevPaths, base = LIVE_BASE, stdCostPath = null, overridePath = null) {
  const byName = new Map((prevPaths || []).map(p => [path.basename(p), p]));
  const out = {};
  (months || []).forEach(m => {
    const file = byName.get(m.file);
    if (!file || !fs.existsSync(file)) return;
    try {
      const b = parseExcel(file, base, stdCostPath, overridePath, null, { inventorySheet: m.sheet });
      const hist = b.run('UPLOADED&&UPLOADED.risk_history?JSON.stringify(UPLOADED.risk_history):""');
      if (!hist) return;
      const parsed = JSON.parse(hist);
      const snap = parsed[m.yearmonth];
      // ⚠ 요청한 달이 안 나왔으면 버린다 — 시트 지정이 안 먹어 다른 달이 잡힌 것이다.
      if (snap) out[m.yearmonth] = snap;
    } catch (e) {
      out[m.yearmonth] = null;   // 호출부가 경고를 띄우도록 자리만 남긴다
    }
  });
  return out;
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
