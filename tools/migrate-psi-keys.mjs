#!/usr/bin/env node
// 일회성 마이그레이션: PSI 입고 조정값·Action Log의 위치 키('6월'=첫 번째 월 블록)를
// 실제 캘린더월('2026-07')로 바꾼다. 월 블록은 새 엑셀을 올릴 때마다 한 칸씩 밀리므로,
// 위치 키로 두면 지난달 조정값이 이번 달 입고로 적용된다.
//
//   node tools/migrate-psi-keys.mjs --base-ym 2026-07 [--dry-run] [--base URL]
//
// --base-ym 은 "지금 KV에 있는 조정값이 만들어질 때 화면에 로드돼 있던 엑셀의 기준월"이다.
// 위치 키 0번('6월')이 그 달을 가리킨다.
import { LIVE_BASE, readPassword } from './lib/publish.mjs';

const args = process.argv.slice(2);
const val = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const dryRun = args.includes('--dry-run');
const base = String(val('--base', LIVE_BASE)).replace(/\/$/, '');
const baseYm = String(val('--base-ym', ''));

if (!/^\d{4}-\d{2}$/.test(baseYm)) {
  console.error('--base-ym 을 YYYY-MM 형식으로 지정하세요. 예: --base-ym 2026-07');
  console.error('(지금 KV의 조정값이 만들어질 때 로드돼 있던 엑셀의 기준월)');
  process.exit(1);
}

const POS_KEYS = ['6월', '7월', '8월', '9월', '10월'];   // SOP_LATEST.html 의 PSI_COVERAGE_MONTH_KEYS
const isPosKey = k => /^\d{1,2}월$/.test(k);
const [by, bm] = baseYm.split('-').map(Number);
function posToYm(pos) {
  const idx = POS_KEYS.indexOf(pos);
  if (idx < 0) return null;
  const total = by * 12 + (bm - 1) + idx;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const res = await fetch(`${base}/api/shared-state`, { cache: 'no-store' });
if (!res.ok) { console.error(`shared-state 읽기 실패: HTTP ${res.status}`); process.exit(1); }
const state = (await res.json()).state || {};

const BUY_KEY = 'sopPsiSimBuy_v1';
const LOG_KEY = 'sopPsiActionLog_v1';
const parse = (k, d) => { try { return JSON.parse(state[k] || ''); } catch (e) { return d; } };

// ── 조정값 ────────────────────────────────────────────────────────────────
const buy = parse(BUY_KEY, {});
const newBuy = {};
let converted = 0, kept = 0, unknown = 0;
console.log(`기준월 ${baseYm} → 위치 키 매핑: ${POS_KEYS.map(p => `${p}=${posToYm(p)}`).join(', ')}\n`);
console.log('=== PSI 입고 조정값 ===');
for (const [mat, months] of Object.entries(buy)) {
  if (!months || typeof months !== 'object') continue;
  for (const [k, v] of Object.entries(months)) {
    let target = k;
    if (isPosKey(k)) {
      const ym = posToYm(k);
      if (!ym) { console.log(`  ${mat.padEnd(9)} ${k.padEnd(5)} → 알 수 없는 위치 키, 그대로 둠`); unknown++; target = k; }
      else { console.log(`  ${mat.padEnd(9)} ${k.padEnd(5)} → ${ym}   ${String(v).padStart(8)}`); target = ym; converted++; }
    } else { kept++; }
    (newBuy[mat] = newBuy[mat] || {})[target] = v;
  }
}
console.log(`  변환 ${converted}건 · 이미 실제 월 ${kept}건 · 미상 ${unknown}건`);

// ── Action Log ────────────────────────────────────────────────────────────
const log = parse(LOG_KEY, []);
let logConverted = 0;
const newLog = (Array.isArray(log) ? log : []).map(e => {
  if (!e || !isPosKey(String(e.mo || ''))) return e;
  const ym = posToYm(e.mo);
  if (!ym) return e;
  logConverted++;
  return { ...e, ym, key: `${e.mat}|${ym}` };
});
console.log(`\n=== Action Log ===\n  ${logConverted}건 키 변환 (mat|위치키 → mat|실제월)`);

if (dryRun) { console.log('\n--dry-run: 저장하지 않고 종료합니다.'); process.exit(0); }

const password = readPassword();
if (!password) { console.error('\nADMIN_PASSWORD 가 없습니다 (.env.local 또는 환경변수).'); process.exit(1); }

const put = await fetch(`${base}/api/shared-state`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    state: { ...state, [BUY_KEY]: JSON.stringify(newBuy), [LOG_KEY]: JSON.stringify(newLog) },
    adminPassword: password
  })
});
if (!put.ok) { console.error(`\n저장 실패: HTTP ${put.status} ${await put.text().catch(() => '')}`); process.exit(1); }

const check = JSON.parse(((await (await fetch(`${base}/api/shared-state`, { cache: 'no-store' })).json()).state || {})[BUY_KEY] || '{}');
const stillPos = Object.values(check).some(m => Object.keys(m || {}).some(isPosKey));
console.log(stillPos ? '\n⚠ 저장 후에도 위치 키가 남아 있습니다.' : '\n저장 완료 · 되읽기 확인: 위치 키 없음');
process.exit(stillPos ? 1 : 0);
