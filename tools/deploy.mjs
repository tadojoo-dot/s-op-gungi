#!/usr/bin/env node
// 엑셀을 여기에 올려두고 이 명령 하나만 실행하면 운영 사이트에 반영된다.
//
//   npm run deploy                       리포에서 가장 최근 엑셀을 자동으로 찾아 반영
//   npm run deploy -- 파일.xlsx           특정 파일 지정
//   npm run deploy -- --code-only        엑셀 없이 코드 변경만 배포
//   npm run deploy -- --data-only        코드 배포 없이 데이터만 반영
//   npm run deploy -- --dry-run          아무것도 올리지 않고 파싱 결과만 확인
//   npm run deploy -- --prev=파일.xlsx    품목군 전월대비 표의 전월 파일을 직접 지정
//                                        (기본: 리포에서 기준월이 한 달 앞선 Aging 파일 → 없으면 라이브 KV의 직전 달)
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ROOT, LIVE_BASE, readPassword, findLatestExcel, findStdCostExcel, findPriceOverrideExcel,
  findPrevAgingExcel, readPrevPkgSnapshot, readLivePkgSnapshot, agingYearMonth, parseExcel, publishParsed, summarize
} from './lib/publish.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const flagValue = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const base = String(flagValue('--base', LIVE_BASE)).replace(/\/$/, '');
const dryRun = has('--dry-run');
const dataOnly = has('--data-only');
const codeOnly = has('--code-only');

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');
const step = (n, total, title) => console.log(`\n[${n}/${total}] ${title}`);
const say = (...m) => console.log('      ' + m.join(' '));

let failed = false;
const total = codeOnly ? 2 : dataOnly ? 2 : 3;
let n = 0;

// ── 1. 데이터 반영 ─────────────────────────────────────────────────────────
if (!codeOnly) {
  step(++n, total, '엑셀 찾기');
  const explicit = args.find(a => /\.xlsx?$/i.test(a));
  const found = explicit
    ? { path: path.resolve(ROOT, explicit), mtime: fs.existsSync(path.resolve(ROOT, explicit)) ? fs.statSync(path.resolve(ROOT, explicit)).mtimeMs : 0 }
    : findLatestExcel();

  if (!found || !fs.existsSync(found.path)) {
    console.error('      엑셀 파일을 찾지 못했습니다.');
    console.error('      이 폴더에 .xlsx 파일을 올린 뒤 다시 실행하거나, 코드만 배포하려면 --code-only 를 붙이세요.');
    process.exit(1);
  }
  const mins = Math.round((Date.now() - found.mtime) / 60000);
  say(path.relative(ROOT, found.path), `(${mins < 1 ? '방금' : mins < 60 ? mins + '분 전' : Math.round(mins / 60) + '시간 전'} 수정)`);

  // 표준원가(재고자산 결산 파일)는 있으면 쓰고 없으면 넘어간다 — 없으면 재고금액이 옛 기준(보류분 누락)이 된다.
  const stdFile = args.find(a => /--std=/.test(a))?.split('=')[1];
  const stdFound = stdFile ? { path: path.resolve(ROOT, stdFile) } : findStdCostExcel();
  if (stdFound && fs.existsSync(stdFound.path)) say(`표준원가 원본: ${path.relative(ROOT, stdFound.path)}`);
  else say('⚠ 재고자산 결산 파일을 찾지 못했습니다 — 재고금액은 현재고 시트 금액 기준(보류재고 금액 누락)으로 계산됩니다');
  const ovFile = args.find(a => /--override=/.test(a))?.split('=')[1];
  const ovFound = ovFile ? { path: path.resolve(ROOT, ovFile) } : findPriceOverrideExcel();
  if (ovFound && fs.existsSync(ovFound.path)) say(`단가 정정표: ${path.relative(ROOT, ovFound.path)}`);

  // 전월 Aging 파일 — 품목군별 전월대비 표에만 쓴다. 없으면 그 표만 안 보인다(나머지는 무영향).
  const prevFile = args.find(a => /--prev=/.test(a))?.split('=')[1];
  const prevFound = prevFile ? { path: path.resolve(ROOT, prevFile) } : findPrevAgingExcel(found.path);
  let prevPkg = null;
  if (prevFound && fs.existsSync(prevFound.path)) {
    say(`전월 Aging 원본: ${path.relative(ROOT, prevFound.path)} (품목군 전월대비용)`);
    try {
      // 당월 기준월을 넘겨야 전월 파일 안에서 '당월보다 앞선 가장 최근 원장'을 고를 수 있다.
      // (26/7 파일은 기초재고가 6/1이라 그냥 두면 두 달이 벌어진다 — publish.mjs의 주석 참고)
      // 4번째 인자는 생산처 맵 소스 — 반드시 **당월 파일**이다(마스터의 생산처 지정이 달마다 바뀐다).
      prevPkg = readPrevPkgSnapshot(prevFound.path, base, agingYearMonth(path.basename(found.path)), found.path);
      if (prevPkg) {
        say(`전월 원장 시트 ${prevPkg.sheet}${prevPkg.candidates ? ` (후보: ${prevPkg.candidates.join(' / ')})` : ''}`);
        if (prevPkg.bySrc) say(`전월 생산처 분해 ${Object.entries(prevPkg.bySrc).map(([k, v]) => `${k} ${v.total.a.toFixed(2)}억`).join(' / ')} (${prevPkg.srcFrom})`);
        say(`전월 기준일 ${prevPkg.label} · 품목군 ${Object.keys(prevPkg.byPkg).length}개 · 합계 ${prevPkg.total.a.toFixed(2)}억`);
      }
      else say('⚠ 전월 파일에서 품목군 집계를 얻지 못했습니다 — 전월대비 표는 표시되지 않습니다');
    } catch (e) {
      say(`⚠ 전월 파일 파싱 실패(${String(e.message || e).slice(0, 80)}) — 전월대비 표만 생략합니다`);
    }
  }
  if (!prevPkg) {
    // 옛 엑셀을 안 들고 있어도 되게, 지금 라이브에 올라가 있는 달을 전월로 쓴다 (업로드 전에 읽어야 함)
    try {
      prevPkg = await readLivePkgSnapshot(base);
      if (prevPkg) say(`전월 스냅샷을 라이브에서 가져왔습니다 (${prevPkg.yearmonth} 기준일 ${prevPkg.label} · ${prevPkg.total.a.toFixed(2)}억)`);
      else say('⚠ 전월 Aging 파일도 라이브 스냅샷도 없습니다 — 품목군 전월대비 표는 표시되지 않습니다');
    } catch (e) {
      say(`⚠ 라이브 스냅샷 확인 실패(${String(e.message || e).slice(0, 60)}) — 전월대비 표만 생략합니다`);
    }
  }

  step(++n, total, '데이터 반영');
  const browser = parseExcel(
    found.path, base,
    stdFound && fs.existsSync(stdFound.path) ? stdFound.path : null,
    ovFound && fs.existsSync(ovFound.path) ? ovFound.path : null,
    prevPkg
  );
  const s = summarize(browser.uploaded);
  if (browser.stdCost) say(`표준원가 ${browser.stdCost.mats.toLocaleString('ko-KR')}개 자재 적용 (${browser.stdCost.sheet})`);
  if (browser.priceOverride) say(`단가 정정표 ${browser.priceOverride.mats.toLocaleString('ko-KR')}개 품목 우선 적용 (${browser.priceOverride.sheet})`);
  say(`기준일 ${s.baseLabel} · PSI ${s.psiRows.toLocaleString('ko-KR')}행 · 판매계획 ${s.salesPlanSkus.toLocaleString('ko-KR')}품목`);
  say(`PSI 월 헤더 ${Object.values(s.monthLabels).join(' / ') || '(없음)'}`);
  if (browser.uploaded.pkg_prev) {
    const c = browser.uploaded.pkg_snapshot, p = browser.uploaded.pkg_prev;
    say(`품목군 전월대비 ${p.label} ${p.total.a.toFixed(2)}억 → ${c.label} ${c.total.a.toFixed(2)}억 (${(c.total.a - p.total.a >= 0 ? '+' : '') + (c.total.a - p.total.a).toFixed(2)}억)`);
  } else if (prevPkg) {
    say('⚠ 전월 스냅샷이 당월과 같은 기준월이라 버렸습니다 — 전월대비 표는 표시되지 않습니다');
  }
  if (browser.missing) say(`⚠ 읽지 못한 시트: ${browser.missing} — 해당 화면은 이전 값이 남습니다`);
  browser.parserNotes.filter(t => /없음|오류|불일치|누락/.test(t)).forEach(t => say('⚠', t));

  if (dryRun) {
    say('--dry-run: 올리지 않고 종료합니다.');
  } else {
    try {
      const res = await publishParsed(browser, { base, password: readPassword() });
      say(`업로드 ${Math.round(res.size / 1024).toLocaleString('ko-KR')}KB (${res.enc}) → ${base}/api/dashboard-data`);
      if (res.verified) say('검증 통과 · 되받은 데이터가 올린 것과 바이트 단위로 동일');
      else { say('⚠ 검증 실패 · 되받은 데이터가 다릅니다'); failed = true; }
    } catch (e) {
      String(e.message || e).split('\n').forEach(l => say(l));
      process.exit(1);
    }
  }
}

// ── 2. 코드 배포 (바뀐 게 있을 때만) ────────────────────────────────────────
if (!dataOnly) {
  step(++n, total, '코드 배포');
  const localHtml = fs.readFileSync(path.join(ROOT, 'public/SOP_LATEST.html'));
  const rootHtml = fs.readFileSync(path.join(ROOT, 'SOP_LATEST.html'));
  if (md5(localHtml) !== md5(rootHtml)) {
    say('⚠ SOP_LATEST.html 과 public/SOP_LATEST.html 이 다릅니다. 먼저 동기화하세요:');
    say('    cp SOP_LATEST.html public/SOP_LATEST.html');
    failed = true;
  } else {
    let liveHtml = null;
    try { liveHtml = Buffer.from(await fetch(base + '/', { cache: 'no-store' }).then(r => r.arrayBuffer())); }
    catch (e) { say('라이브 확인 실패:', e.message); }

    if (liveHtml && md5(liveHtml) === md5(localHtml)) {
      say('변경 없음 · 라이브가 이미 최신입니다');
    } else if (dryRun) {
      say('--dry-run: 코드 배포 생략');
    } else {
      const dirty = git('status', '--porcelain');
      const unpushed = git('log', 'origin/main..HEAD', '--oneline');
      if (dirty) {
        say('커밋되지 않은 변경이 있습니다. 코드 배포는 건너뜁니다:');
        dirty.split('\n').slice(0, 8).forEach(l => say('   ', l));
      } else if (unpushed) {
        say(`푸시할 커밋 ${unpushed.split('\n').length}개 → Cloudflare 자동 배포`);
        git('push', 'origin', 'main');
        process.stdout.write('      배포 대기');
        let live = false;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 15000));
          process.stdout.write('.');
          try {
            const buf = Buffer.from(await fetch(base + '/', { cache: 'no-store' }).then(r => r.arrayBuffer()));
            if (md5(buf) === md5(localHtml)) { live = true; break; }
          } catch (e) { /* 배포 중 일시적 실패는 무시 */ }
        }
        console.log(live ? ' 완료' : ' 시간 초과');
        if (!live) { say('⚠ 아직 라이브에 반영되지 않았습니다. 잠시 후 사이트를 확인하세요.'); failed = true; }
      } else {
        say('로컬 코드가 라이브와 다르지만 커밋된 변경이 없습니다. 확인이 필요합니다.');
        failed = true;
      }
    }
  }
}

// ── 3. 마무리 ──────────────────────────────────────────────────────────────
console.log(failed ? '\n일부 단계가 실패했습니다. 위 메시지를 확인하세요.' : `\n완료 · ${base}`);
if (!failed && !dryRun && !codeOnly) {
  console.log('사이트를 보고 있던 사람은 새로고침해야 새 숫자가 보입니다.');
}
process.exit(failed ? 1 : 0);
