#!/usr/bin/env node
// 데이터만 반영하는 얇은 CLI. 보통은 `npm run deploy` 를 쓰면 된다.
//   ADMIN_PASSWORD=xxx node tools/publish-data.mjs <파일.xlsx> [--base URL] [--dry-run]
import fs from 'fs';
import path from 'path';
import { ROOT, LIVE_BASE, readPassword, findLatestExcel, parseExcel, publishParsed, summarize } from './lib/publish.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--base');
const base = String(i >= 0 ? args[i + 1] : LIVE_BASE).replace(/\/$/, '');
const dryRun = args.includes('--dry-run');
const explicit = args.find(a => /\.xlsx?$/i.test(a));
const target = explicit ? path.resolve(ROOT, explicit) : findLatestExcel()?.path;

if (!target || !fs.existsSync(target)) {
  console.error('엑셀 파일을 찾지 못했습니다.');
  console.error('사용법: ADMIN_PASSWORD=xxx node tools/publish-data.mjs <파일.xlsx> [--base URL] [--dry-run]');
  process.exit(1);
}

console.log(`파싱: ${path.relative(ROOT, target)}`);
const browser = parseExcel(target, base);
const s = summarize(browser.uploaded);
if (browser.missing) console.log(`  ⚠ 읽지 못한 시트: ${browser.missing}`);
console.log(`  기준일 ${s.baseLabel} · PSI ${s.psiRows}행 · 판매계획 ${s.salesPlanSkus}품목 · 월 헤더 ${Object.values(s.monthLabels).join(' / ')}`);

if (dryRun) { console.log('\n--dry-run: 올리지 않고 종료합니다.'); process.exit(0); }

console.log(`\n공유 저장: ${base}/api/dashboard-data`);
const res = await publishParsed(browser, { base, password: readPassword() });
console.log(`완료 · ${Math.round(res.size / 1024).toLocaleString('ko-KR')}KB (${res.enc})`);
console.log(res.verified
  ? '검증 통과 · 되받은 데이터가 올린 것과 바이트 단위로 동일합니다.'
  : '⚠ 검증 실패 · 되받은 데이터가 다릅니다. 사이트에서 직접 확인하세요.');
process.exit(res.verified ? 0 : 1);
