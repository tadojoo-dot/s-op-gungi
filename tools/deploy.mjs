#!/usr/bin/env node
// 엑셀을 여기에 올려두고 이 명령 하나만 실행하면 운영 사이트에 반영된다.
//
//   npm run deploy                       리포에서 가장 최근 엑셀(.xlsx/.xlsm)을 자동으로 찾아 반영
//   npm run deploy -- 파일.xlsx           특정 파일 지정
//   npm run deploy -- --code-only        엑셀 없이 코드 변경만 배포
//   npm run deploy -- --data-only        코드 배포 없이 데이터만 반영
//   npm run deploy -- --dry-run          아무것도 올리지 않고 파싱 결과만 확인
//   npm run deploy -- --prev=파일.xlsx    품목군 전월대비 표의 전월 파일을 직접 지정
//                                        (기본: 리포에서 기준월이 한 달 앞선 Aging 파일 → 없으면 라이브 KV의 직전 달)
//   npm run deploy -- --rebuild-risk     월별 Risk 이력을 과거월까지 **다시 계산해서 덮는다**
//                                        (평소 과거월은 얼려 둔다 — 회의에 나간 숫자가 안 바뀌게)
//   npm run deploy -- --force-shrink     Risk 이력 개월 수가 줄어도 진행 (기본은 중단)
//
// 코드 배포 인증 우선순위:
//   1) Cloudflare API 토큰/Wrangler OAuth → Pages 직접 배포
//   2) 직접 인증이 없으면 origin/main 쓰기 권한 확인 → GitHub 연동 자동배포
// 어느 경로도 준비되지 않으면 KV 데이터를 쓰기 전에 중단해 반쪽 배포를 막는다.
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ROOT, LIVE_BASE, readPassword, readLocalEnv, readCloudflareAuth, findLatestExcel, findStdCostExcel, findPriceOverrideExcel,
  findPrevAgingExcels, readPrevMonths, readLivePkgSnapshot, readSalesPlanTarget, agingYearMonth, parseExcel, publishParsed, summarize,
  readRepoRiskHistory, writeRepoRiskHistory, readLiveRiskHistory, mergeRiskHistories, readPrevRiskSnapshots,
  RISK_HISTORY_FILE
} from './lib/publish.mjs';

const args = process.argv.slice(2);
const has = f => args.includes(f);
const flagValue = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const base = String(flagValue('--base', LIVE_BASE)).replace(/\/$/, '');
const dryRun = has('--dry-run');
const rebuildRisk = has('--rebuild-risk');
const forceShrink = has('--force-shrink');
const dataOnly = has('--data-only');
const codeOnly = has('--code-only');
const checkAuth = has('--check-auth');
const PAGES_PROJECT = 's-op-gungi';
const GIT_DEPLOY_REMOTE = 'origin';
const GIT_DEPLOY_BRANCH = 'main';
const PAGES_ACCOUNT_ID = readLocalEnv('CLOUDFLARE_ACCOUNT_ID') || '14c780e41fc86dde4101283fb427b14e';
const WRANGLER_VERSION = '4.110.0';

const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');
const step = (n, total, title) => console.log(`\n[${n}/${total}] ${title}`);
const say = (...m) => console.log('      ' + m.join(' '));

// 일부 Codespaces/제한 실행 환경에서는 Node의 spawnSync/execFileSync가
// 자식 프로세스가 정상 종료된 뒤에도 EPERM을 반환한다. 배포/진단 명령을
// 비동기 spawn으로 통일해 그 환경에서도 실제 종료 코드만 판정한다.
function runFile(command, commandArgs, { env = process.env, inherit = false, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;

    if (!inherit) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.on('error', error => {
      if (timer) clearTimeout(timer);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0 && !timedOut) {
        resolve({ stdout, stderr });
        return;
      }
      const reason = timedOut
        ? `${command} 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`
        : `${command} 종료 코드 ${code ?? '없음'}${signal ? ` (${signal})` : ''}`;
      const error = new Error(reason);
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function pagesWorkingTreeStatus() {
  const result = await runFile('git', [
    'status', '--porcelain', '--',
    'public', 'functions', 'wrangler.toml', 'index.html', 'SOP_LATEST.html'
  ]);
  return result.stdout.trim();
}

async function verifyGitDeployRoute() {
  const dirty = await pagesWorkingTreeStatus();
  if (dirty) {
    throw new Error(
      'GitHub 자동배포로 전환할 수 있지만 Pages 변경이 아직 커밋되지 않았습니다.\n' +
      '먼저 public/SOP_LATEST.html 등 화면 변경을 커밋한 뒤 다시 실행하세요.\n' + dirty
    );
  }
  const branch = (await runFile('git', ['branch', '--show-current'])).stdout.trim();
  if (branch !== GIT_DEPLOY_BRANCH) {
    throw new Error(`현재 브랜치가 ${branch || '(분리 HEAD)'}입니다. 자동배포 브랜치 ${GIT_DEPLOY_BRANCH}에서 실행하세요.`);
  }
  const remote = (await runFile('git', ['remote', 'get-url', GIT_DEPLOY_REMOTE])).stdout.trim();
  if (!remote) throw new Error(`${GIT_DEPLOY_REMOTE} 원격 저장소가 없습니다.`);
  await runFile('git', ['push', '--dry-run', GIT_DEPLOY_REMOTE, GIT_DEPLOY_BRANCH], { timeoutMs: 60000 });
  say(`GitHub 자동배포 사전 확인 통과 (${GIT_DEPLOY_REMOTE}/${GIT_DEPLOY_BRANCH})`);
  return { kind: 'git', remote: GIT_DEPLOY_REMOTE, branch: GIT_DEPLOY_BRANCH, url: remote };
}

function scrubAuthOutput(value, token = '') {
  let text = String(value || '').trim();
  if (token) text = text.split(token).join('[REDACTED_TOKEN]');
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

async function verifyCloudflareAuth() {
  const auth = readCloudflareAuth();
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: PAGES_ACCOUNT_ID
  };
  if (auth.token) env.CLOUDFLARE_API_TOKEN = auth.token;
  else delete env.CLOUDFLARE_API_TOKEN;
  try {
    const result = await runFile('npx', [
      '--yes', 'wrangler@' + WRANGLER_VERSION,
      'whoami'
    ], { env, timeoutMs: 60000 });
    say(`Cloudflare 인증 검증 통과 (${auth.token ? auth.source : 'Wrangler OAuth'})`);
    const detail = scrubAuthOutput(`${result.stdout}\n${result.stderr}`, auth.token);
    if (detail) detail.split('\n').slice(-3).forEach(line => say(line));
    return;
  } catch (error) {
    const hint = auth.token
      ? `읽은 토큰(${auth.source})이 Cloudflare에서 거부됐습니다. 토큰의 Pages 편집 권한, 계정 ID(${PAGES_ACCOUNT_ID}), 만료/삭제 여부를 확인하세요.`
      : '토큰을 찾지 못했고 Wrangler OAuth 인증도 실패했습니다. CLOUDFLARE_API_TOKEN을 .env.local/.env/.dev.vars에 넣거나 npx wrangler login을 실행하세요.';
    const detail = scrubAuthOutput(`${error.stderr || ''}\n${error.stdout || ''}`, auth.token);
    throw new Error(`Cloudflare 인증 사전 확인 실패.\n인증 안내: ${hint}${detail ? `\nWrangler 응답: ${detail.slice(-1200)}` : ''}`);
  }
}

if (checkAuth) {
  const auth = readCloudflareAuth();
  console.log(`토큰 탐색 결과: ${auth.token ? '인식됨' : auth.reason === 'placeholder' ? '예시값/플레이스홀더만 발견됨' : '없음'}`);
  console.log(`인증 출처: ${auth.source}`);
  if (auth.name) console.log(`변수명: ${auth.name}`);
  try {
    await verifyCloudflareAuth();
    console.log('인증 상태: 사용 가능 (Cloudflare Pages 직접 배포)');
    process.exit(0);
  } catch (cloudflareError) {
    console.log(`Cloudflare 직접 인증: 사용 불가\n${cloudflareError.message || cloudflareError}`);
    try {
      await verifyGitDeployRoute();
      console.log('인증 상태: 사용 가능 (GitHub 연동 자동배포 대체 경로)');
      process.exit(0);
    } catch (gitError) {
      console.error(`인증 상태: 사용 불가\nGitHub 경로: ${gitError.message || gitError}`);
      process.exit(1);
    }
  }
}

async function deployPagesDirect() {
  const auth = readCloudflareAuth();
  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: PAGES_ACCOUNT_ID
  };
  if (auth.token) {
    env.CLOUDFLARE_API_TOKEN = auth.token;
    say(`Cloudflare 인증 확인 (${auth.source})`);
  } else {
    // API 토큰이 없어도 Wrangler 로그인/OAuth 캐시가 있으면 배포할 수 있다.
    // 여기서 자체 중단하면 실제 인증 상태를 확인할 기회조차 사라진다.
    delete env.CLOUDFLARE_API_TOKEN;
    say('API 토큰 환경변수 없음 · Wrangler 로그인/OAuth 인증으로 시도합니다');
  }
  say(`Cloudflare Pages 직접 배포 시작 (${PAGES_PROJECT})`);
  try {
    await runFile('npx', [
      '--yes', `wrangler@${WRANGLER_VERSION}`,
      'pages', 'deploy', 'public',
      '--project-name', PAGES_PROJECT,
      '--branch', 'main',
      '--commit-dirty=true'
    ], { env, inherit: true });
  } catch (error) {
    const hint = auth.token
      ? '발견된 API 토큰이 유효한지, Pages 편집 권한과 계정 ID를 확인하세요.'
      : 'CLOUDFLARE_API_TOKEN을 프로세스 환경변수/.env.local/.env/.dev.vars에 넣거나, 먼저 npx wrangler login을 실행하세요.';
    throw new Error(`${error.message || error}\n인증 안내: ${hint}`);
  }
}

async function deployPagesViaGit(route) {
  const aheadRaw = (await runFile('git', [
    'rev-list', '--count', `${route.remote}/${route.branch}..HEAD`
  ])).stdout.trim();
  const ahead = Number(aheadRaw) || 0;
  say(`GitHub 자동배포 시작 (${route.remote}/${route.branch} · 새 커밋 ${ahead.toLocaleString('ko-KR')}개)`);
  await runFile('git', ['push', route.remote, route.branch], { inherit: true });
}

let failed = false;
let codeDeployRoute = null;
const total = codeOnly ? 2 : dataOnly ? 2 : 3;
let n = 0;

// 전체 배포는 데이터(KV)를 먼저 쓰므로, 코드 배포 인증을 먼저 확인한다.
// 이 가드가 없으면 데이터만 성공하고 코드만 실패하는 반쪽 배포가 된다.
if (!dryRun && !dataOnly) {
  try {
    await verifyCloudflareAuth();
    codeDeployRoute = { kind: 'cloudflare' };
  } catch (cloudflareError) {
    say('Cloudflare 직접 인증을 사용할 수 없어 GitHub 자동배포 경로를 확인합니다');
    try {
      codeDeployRoute = await verifyGitDeployRoute();
    } catch (gitError) {
      console.error('\n❌ 코드 배포 사전 확인 실패. 데이터는 아직 변경하지 않았습니다.');
      console.error('Cloudflare 경로: ' + (cloudflareError.message || cloudflareError));
      console.error('GitHub 경로: ' + (gitError.message || gitError));
      process.exit(1);
    }
  }
}

// ── 1. 데이터 반영 ─────────────────────────────────────────────────────────
if (!codeOnly) {
  step(++n, total, '엑셀 찾기');
  const explicit = args.find(a => /\.(?:xlsx?|xlsm)$/i.test(a));
  const found = explicit
    ? { path: path.resolve(ROOT, explicit), mtime: fs.existsSync(path.resolve(ROOT, explicit)) ? fs.statSync(path.resolve(ROOT, explicit)).mtimeMs : 0 }
    : findLatestExcel();

  if (!found || !fs.existsSync(found.path)) {
    console.error('      엑셀 파일을 찾지 못했습니다.');
    console.error('      이 폴더에 .xlsx/.xlsm 파일을 올린 뒤 다시 실행하거나, 코드만 배포하려면 --code-only 를 붙이세요.');
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
  const prevPaths = prevFile
    ? [path.resolve(ROOT, prevFile)]
    : findPrevAgingExcels(found.path).map(f => f.path);
  let prevSalesTarget = null;
  for (const prevPath of prevPaths) {
    try {
      prevSalesTarget = readSalesPlanTarget(prevPath, base);
      if (prevSalesTarget) {
        const ym = Object.keys(prevSalesTarget).sort().find(k => k.endsWith('.08'));
        say(`사업계획 목표 보강 원본: ${path.relative(ROOT, prevPath)}${ym ? ` · 8월 ${prevSalesTarget[ym].toFixed(1)}억` : ''}`);
        break;
      }
    } catch (e) {
      say(`⚠ 직전 리포트 사업계획 목표 확인 실패(${String(e.message || e).slice(0, 80)})`);
    }
  }
  let prevPkg = null;
  let prevMonthRecords = [];
  if (prevPaths.length) {
    say(`과거 Aging 원본: ${prevPaths.map(p => path.relative(ROOT, p)).join(', ')}`);
    try {
      // ⚠ 한 파일이 여러 달을 담는다 — 26/7 파일은 기초재고=6/1, 현재고=7/8이다.
      //    3번째 인자(당월 기준월)로 당월 이후를 걸러내고, 4번째(생산처 맵 소스)는 반드시 **당월 파일**이다
      //    (다이소 마스터의 생산처 지정이 달마다 바뀌어, 각 달 마스터를 쓰면 이관이 증감으로 잡힌다).
      const months = readPrevMonths(prevPaths, base, agingYearMonth(path.basename(found.path)), found.path);
      months.forEach(m => say(
        `과거월 ${m.yearmonth} (${m.label} · ${m.sheet} 시트) ${m.total.a.toFixed(2)}억` +
        (m.bySrc ? ` · ${Object.entries(m.bySrc).map(([k, v]) => `${k} ${v.total.a.toFixed(2)}`).join(' / ')}` : '')
      ));
      // Risk 이력은 **모든 과거월**을 쓴다(품목군 카드는 바로 앞 달 하나만).
      //   어느 파일의 어느 시트가 그 달을 대표하는지 여기서 이미 정해졌으므로 그 결정을 그대로 넘긴다.
      prevMonthRecords = months.map(m => ({ yearmonth: m.yearmonth, sheet: m.sheet, file: m.file, label: m.label }));
      // 품목군 전월대비 카드는 **바로 앞 달** 하나만 쓴다(readPrevMonths가 최신순으로 준다).
      prevPkg = months[0] || null;
      if (prevPkg) prevPkg.months = months.map(m => m.month);
      else say('⚠ 과거 파일에서 품목군 집계를 얻지 못했습니다 — 전월대비 표는 표시되지 않습니다');
    } catch (e) {
      say(`⚠ 과거 파일 파싱 실패(${String(e.message || e).slice(0, 80)}) — 전월대비 표만 생략합니다`);
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

  // ── 월별 Risk 이력 3중 저장 ────────────────────────────────────────────
  // 1차 리포 JSON(원본) ∪ 2차 라이브 KV ∪ 과거 파일 재계산 → 합쳐서 실어 준다.
  // ⚠ KV는 반드시 **발행 전에** 읽는다. 올린 뒤엔 당월로 덮여 있다.
  let riskHistory = null;
  {
    const repoHist = readRepoRiskHistory();          // 깨져 있으면 여기서 throw → 덮어쓰기 사고 방지
    if (repoHist) say(`Risk 이력(리포): ${Object.keys(repoHist).sort().join(', ')}`);
    const live = await readLiveRiskHistory(base);
    if (!live.ok) {
      // ⚠ 조용히 넘어가면 빈 이력으로 KV를 덮는다. 여기서 멈춘다.
      console.error(`      ❌ Risk 이력을 지키기 위해 중단합니다 — ${live.reason}`);
      console.error('         네트워크를 확인한 뒤 다시 실행하세요. (이력을 포기하고 진행하려면 --rebuild-risk)');
      if (!rebuildRisk) process.exit(1);
    }
    if (live.history) say(`Risk 이력(라이브): ${Object.keys(live.history).sort().join(', ')}`);
    else if (live.reason) say(`Risk 이력(라이브): ${live.reason}`);

    // 과거월은 이미 있으면 얼려 둔다. 없는 달만, 또는 --rebuild-risk면 전부 다시 계산한다.
    let fileHist = null;
    if (prevMonthRecords.length) {
      const known = new Set(Object.keys(mergeRiskHistories(repoHist, live.history) || {}));
      const todo = rebuildRisk ? prevMonthRecords : prevMonthRecords.filter(m => !known.has(m.yearmonth));
      if (todo.length) {
        say(`과거월 Risk 계산: ${todo.map(m => `${m.yearmonth}(${m.sheet})`).join(', ')}`);
        const got = readPrevRiskSnapshots(todo, prevPaths, base,
          stdFound && fs.existsSync(stdFound.path) ? stdFound.path : null,
          ovFound && fs.existsSync(ovFound.path) ? ovFound.path : null);
        Object.entries(got).forEach(([ym, snap]) => {
          if (!snap) { say(`⚠ ${ym} Risk 계산 실패 — 그 달은 건너뜁니다`); return; }
          say(`  ${ym} ${snap.label} · ${snap.meta.riskCount}건 / ${snap.meta.riskAmtCost.toFixed(1)}백만(원가)`);
        });
        fileHist = Object.fromEntries(Object.entries(got).filter(([, v]) => v));
      } else {
        say('과거월 Risk는 이미 얼려 둔 값을 씁니다 (다시 계산하려면 --rebuild-risk)');
      }
    }
    riskHistory = mergeRiskHistories(repoHist, live.history, fileHist);
    say(`Risk 이력 반영: ${riskHistory ? Object.keys(riskHistory).sort().join(', ') : '(없음 — 이번 발행부터 쌓입니다)'}`);
  }

  step(++n, total, '데이터 반영');
  const browser = parseExcel(
    found.path, base,
    stdFound && fs.existsSync(stdFound.path) ? stdFound.path : null,
    ovFound && fs.existsSync(ovFound.path) ? ovFound.path : null,
    prevPkg,
    { riskHistory, rebuildRisk },
    prevSalesTarget
  );
  const s = summarize(browser.uploaded);
  if (browser.stdCost) say(`표준원가 ${browser.stdCost.mats.toLocaleString('ko-KR')}개 자재 적용 (${browser.stdCost.sheet})`);
  if (browser.priceOverride) say(`단가 정정표 ${browser.priceOverride.mats.toLocaleString('ko-KR')}개 품목 우선 적용 (${browser.priceOverride.sheet})`);
  say(`기준일 ${s.baseLabel} · PSI ${s.psiRows.toLocaleString('ko-KR')}행 · 판매계획 ${s.salesPlanSkus.toLocaleString('ko-KR')}품목`);
  say(`PSI 월 헤더 ${Object.values(s.monthLabels).join(' / ') || '(없음)'}`);
  if (browser.uploaded.month_options) {
    say(`①탭 월 선택 ${browser.uploaded.month_options.map(o => `${o.label}${o.current ? '(당월)' : ''}`).join(' / ')}`);
  }
  if (browser.uploaded.pkg_prev) {
    const c = browser.uploaded.pkg_snapshot, p = browser.uploaded.pkg_prev;
    say(`품목군 전월대비 ${p.label} ${p.total.a.toFixed(2)}억 → ${c.label} ${c.total.a.toFixed(2)}억 (${(c.total.a - p.total.a >= 0 ? '+' : '') + (c.total.a - p.total.a).toFixed(2)}억)`);
  } else if (prevPkg) {
    say('⚠ 전월 스냅샷이 당월과 같은 기준월이라 버렸습니다 — 전월대비 표는 표시되지 않습니다');
  }
  if (browser.missing) say(`⚠ 읽지 못한 시트: ${browser.missing} — 해당 화면은 이전 값이 남습니다`);
  browser.parserNotes.filter(t => /없음|오류|불일치|누락/.test(t)).forEach(t => say('⚠', t));
  // 추이 보정은 사고가 아니라 정상 동작이라 ⚠ 없이 보여준다 — 다만 숫자가 바뀌므로 반드시 눈에 띄어야 한다.
  browser.parserNotes.filter(t => /보정/.test(t)).forEach(t => say(t));

  // ── Risk 이력: 축소 가드 + 1차 저장소(리포 JSON)에 기록 ────────────────
  {
    const out = browser.uploaded.risk_history || null;
    const before = riskHistory ? Object.keys(riskHistory).length : 0;
    const after = out ? Object.keys(out).length : 0;
    if (after < before && !forceShrink) {
      // ⚠ 이력이 줄어드는 정상 경로는 없다. 병합 버그이거나 이어받기가 끊긴 것이다.
      console.error(`      ❌ Risk 이력이 ${before}개월 → ${after}개월로 줄었습니다. 덮어쓰지 않고 중단합니다.`);
      console.error(`         남아 있는 원본: ${path.relative(ROOT, RISK_HISTORY_FILE)} · 의도한 축소라면 --force-shrink`);
      process.exit(1);
    }
    if (out) {
      const months = Object.keys(out).sort();
      say(`Risk 이력 ${after}개월 (${months.join(', ')})`);
      months.forEach(ym => {
        const sn = out[ym];
        say(`  ${ym} ${sn.label || ''} · ${sn.meta?.riskCount ?? '?'}건 / ${(sn.meta?.riskAmtCost ?? 0).toFixed(1)}백만(원가)${ym === browser.uploaded.base_yearmonth ? ' ← 당월(매번 갱신)' : ' (동결)'}`);
      });
      if (!dryRun) {
        const f = writeRepoRiskHistory(out);
        if (f) say(`원본 저장: ${path.relative(ROOT, f)} — **커밋해 두세요**. KV가 비어도 여기서 복원됩니다`);
      } else {
        say(`--dry-run: ${path.relative(ROOT, RISK_HISTORY_FILE)} 도 쓰지 않습니다`);
      }
    } else {
      say('⚠ Risk 이력이 비어 있습니다 — 월별 Risk 추적 표는 표시되지 않습니다');
    }
  }

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

    const liveMatches = liveHtml && md5(liveHtml) === md5(localHtml);
    const pagesDirty = await pagesWorkingTreeStatus();

    if (liveMatches && !pagesDirty) {
      say('변경 없음 · 라이브가 이미 최신입니다');
    } else if (dryRun) {
      if (pagesDirty) say('미커밋 Pages 변경 감지 · --dry-run이라 배포 생략');
      else say('라이브와 코드가 다름 · --dry-run이라 배포 생략');
    } else {
      try {
        // GitHub 자동 배포는 커밋/푸시 상태에 의존하고, 미커밋 변경은 조용히 누락될 수 있다.
        // Pages API 직접 배포는 현재 public/Functions 작업트리를 그대로 올린다.
        if (codeDeployRoute?.kind === 'git') await deployPagesViaGit(codeDeployRoute);
        else await deployPagesDirect();
      } catch (e) {
        say(`코드 배포 실패(${codeDeployRoute?.kind === 'git' ? 'GitHub 자동배포' : 'Cloudflare 직접배포'}): ${e.message || e}`);
        failed = true;
      }

      if (!failed) {
        process.stdout.write('      배포 검증');
        let live = false;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 15000));
          process.stdout.write('.');
          try {
            const res = await fetch(base + '/', { cache: 'no-store' });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            if (md5(buf) === md5(localHtml)) { live = true; break; }
          } catch (e) { /* 배포 중 일시적 실패는 무시 */ }
        }
        console.log(live ? ' 완료' : ' 시간 초과');
        if (!live) { say('⚠ 배포 응답은 받았지만 라이브 검증에 실패했습니다.'); failed = true; }
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
