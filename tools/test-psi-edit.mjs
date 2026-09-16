// Real browser regression: node tools/test-psi-edit.mjs [workbook.xlsm]
// Requires Playwright + Chromium. Optional PSI_PLAYWRIGHT_MODULE points to an isolated install.
// All browser requests (including writes) stay on the local fixture server; no live state is edited.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {parseExcel, findLatestExcel, ROOT} from './lib/publish.mjs';
const {chromium}=await import(process.env.PSI_PLAYWRIGHT_MODULE||'playwright');
const workbook=process.argv[2]||findLatestExcel()?.path;
assert(workbook,'Supply an Aging workbook containing DAI-5.');
const {uploaded}=parseExcel(workbook);
assert(uploaded.psi.some(d=>d.mat==='DAI-5'));
const html=process.env.PSI_TEST_HTML_URL
  ?Buffer.from(await (await fetch(process.env.PSI_TEST_HTML_URL)).arrayBuffer())
  :await readFile(ROOT+'/SOP_LATEST.html');
let shared={sopPsiSimBuy_v1:'{}',sopPsiActionLog_v1:'[]'}, putCount=0, failSave=false;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('cache-control','no-store');
  if(url.pathname==='/api/dashboard-data'){
    res.setHeader('content-type','application/json');
    res.setHeader('x-sop-uploaded-ts',String(uploaded.uploaded_ts));
    res.end(JSON.stringify(uploaded));return;
  }
  if(url.pathname==='/api/shared-state'){
    res.setHeader('content-type','application/json');
    if(req.method==='PUT'){
      let raw='';for await(const part of req)raw+=part;
      if(failSave){res.writeHead(503);res.end('{"error":"test failure"}');return;}
      shared=JSON.parse(raw).state;putCount++;
      res.end('{"ok":true}');return;
    }
    res.end(JSON.stringify(url.searchParams.has('archives')?{archives:[]}:{state:shared}));return;
  }
  if(url.pathname==='/'){
    res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;
  }
  if(!/^\/vendor\/[\w.-]+$/.test(url.pathname)){res.writeHead(404);res.end();return;}
  try{
    res.setHeader('content-type',url.pathname.endsWith('.js')?'application/javascript':'font/woff2');
    res.end(await readFile(ROOT+url.pathname));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const errors=[];
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await context.addInitScript(()=>sessionStorage.setItem('sopAdminPassword','local-test-only'));
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  const url='http://127.0.0.1:'+server.address().port;
  await page.goto(url);
  await page.waitForFunction(()=>BOOT_RENDER_DONE);
  await page.locator('.tab[data-page="1"]').click();
  await page.locator('#favg3').selectOption('');
  assert.equal(await page.locator('#psiWrap input').count(),0,'No focusable input inside the large table');
  assert.equal(await page.locator('.psi-buy-input').count(),1,'Only one independent numeric editor');
  const trigger=(mat,mo)=>page.locator('.psi-buy-trigger').and(page.locator(`[data-mat="${mat}"][data-mo="${mo}"]`));
  const input=page.locator('#psiBuyEditorInput');
  const dialog=page.locator('#psiBuyEditor');
  async function open(mat,mo){
    await trigger(mat,mo).click();
    assert(await dialog.isVisible());
    assert.equal(await page.evaluate(()=>document.activeElement.id),'psiBuyEditorInput');
    assert((await page.locator('#psiBuyEditorDescription').textContent()).includes(mat));
  }
  async function edit(mat,mo,value,button=false){
    await open(mat,mo);
    await input.fill(String(value));
    if(button)await dialog.locator('button[type=submit]').click();
    else await input.press('Enter');
    await page.waitForFunction(()=>!document.querySelector('#psiBuyEditor').open);
    assert.equal(await trigger(mat,mo).textContent(),value.toLocaleString('ko-KR'));
  }
  // Actual focus + first keystrokes: typing itself must not mutate the PSI table.
  await open('DAI-5','8월');
  assert.equal(await page.locator('#psiBuyEditorTitle').textContent(),'11월 입고계획 수정');
  await page.evaluate(()=>{
    window.psiTestMutations=0;
    window.psiTestObserver=new MutationObserver(records=>window.psiTestMutations+=records.length);
    window.psiTestObserver.observe(document.getElementById('psiWrap'),{childList:true,attributes:true,subtree:true,characterData:true});
  });
  await page.keyboard.type('123456',{delay:25});
  assert.equal(await input.inputValue(),'123456');
  assert.equal(await page.evaluate(()=>window.psiTestMutations),0);
  await page.evaluate(()=>window.psiTestObserver.disconnect());
  await input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').textContent.includes('공유 저장 완료'));
  assert.equal(JSON.parse(shared.sopPsiSimBuy_v1)['DAI-5']['2026-11'],123456);
  const originalLog=JSON.parse(shared.sopPsiActionLog_v1).find(a=>a.key==='DAI-5|2026-11');
  assert(originalLog&&!originalLog.ts.includes('미기록'),'Preserve edit time through log reconciliation');
  console.log('PASS first keyboard input, no table mutation while typing, November storage and log');

  for(const [mo,val] of [['7월',165432],['8월',134567],['9월',45678],['10월',56789],['6월',120321]])await edit('DAI-5',mo,val,mo==='9월');
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').textContent.includes('공유 저장 완료'));
  const rowData=uploaded.psi.find(d=>d.mat==='DAI-5');
  const positions=['6월','7월','8월','9월','10월'];
  const quantities=[120321,165432,134567,45678,56789];
  let end=Number(rowData.monthlyPsi['6월'].begin);
  const expected=positions.map((mo,i)=>end+=quantities[i]-Number(rowData.monthlyPsi[mo].plan));
  const ends=await page.evaluate(()=>[11,15,19,23,27].map(i=>Number(document.querySelector('#psiWrap tr[data-mat="DAI-5"]').cells[i].textContent.replace(/,/g,''))));
  assert.deepEqual(ends,expected);
  console.log('PASS all five months, future stock chain, Enter and Save button');

  await open('DAI-5','8월');await input.fill('999');await input.press('Escape');
  assert.equal(await trigger('DAI-5','8월').textContent(),'134,567');
  await open('DAI-5','8월');await input.fill('abc');await input.press('Enter');
  assert(await dialog.isVisible());await dialog.getByText('취소',{exact:true}).click();
  assert.equal(await trigger('DAI-5','8월').textContent(),'134,567');
  // Blank cell padding must not open the unrelated product detail popup.
  await trigger('DAI-5','8월').locator('..').click({position:{x:3,y:10}});
  assert.equal(await page.locator('#skuDetailModal').isVisible(),false);
  console.log('PASS cancel, invalid input, cell padding click');

  // Clearing the editor and pressing Enter must restore the original plan,
  // including removing the shared override rather than saving a zero.
  await open('DAI-5','8월');
  await input.fill('');
  await input.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').textContent.includes('공유 저장 완료'));
  assert.equal(await trigger('DAI-5','8월').textContent(),Number(rowData.monthlyPsi['8월'].buy).toLocaleString('ko-KR'));
  assert.equal(JSON.parse(shared.sopPsiSimBuy_v1)['DAI-5']?.['2026-11'],undefined);
  console.log('PASS blank input resets to original and deletes shared override');

  // Previously, a second refresh queued during the 220ms summary timer was lost.
  await page.evaluate(async()=>{
    schedulePsiBuyUiRefresh('DAI-5','8월');
    await new Promise(requestAnimationFrame);
    setPsiSimBuyVal('DAI-5','8월',140000);
    schedulePsiBuyUiRefresh('DAI-5','8월');
  });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>psiPendingRefreshMats.size),0);
  const currentEnd=await page.locator('#psiWrap tr[data-mat="DAI-5"] td').nth(19).textContent();
  assert.equal(Number(currentEnd.replace(/,/g,'')),expected[2]+140000-134567);
  await edit('DAI-5','8월',134567);
  console.log('PASS rapid repeated refresh during summary timer');

  const normal=uploaded.psi.find(d=>!d.isDaisoIntegrated&&d.pkg!=='다이소 통합');
  await edit(normal.mat,'8월',87654);
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').textContent.includes('공유 저장 완료'));
  assert.equal(JSON.parse(shared.sopPsiSimBuy_v1)[normal.mat]['2026-11'],87654);
  await page.reload();await page.waitForFunction(()=>BOOT_RENDER_DONE);
  await page.locator('.tab[data-page="1"]').click();
  await page.locator('#favg3').selectOption('');
  assert.equal(await trigger('DAI-5','8월').textContent(),'134,567');
  // A fresh browser context must restore from the mock shared server, not localStorage.
  const fresh=await browser.newContext();
  await fresh.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const other=await fresh.newPage();await other.goto(url);await other.waitForFunction(()=>BOOT_RENDER_DONE);
  assert.equal(await other.locator('.psi-buy-trigger[data-mat="DAI-5"][data-mo="8월"]').textContent(),'134,567');
  assert(await other.locator('.psi-buy-trigger[data-mat="DAI-5"][data-mo="8월"]').isDisabled());
  await fresh.close();
  console.log('PASS general SKU, reload, shared restore in fresh read-only browser');

  failSave=true;await edit('DAI-5','8월',150000);
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').classList.contains('error'));
  failSave=false;await edit('DAI-5','8월',134567);
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').textContent.includes('공유 저장 완료'));
  await trigger('DAI-5','8월').locator('..').locator('.psi-buy-reset').click();
  await page.waitForFunction(()=>document.querySelector('#psiBuySaveStatus').textContent.includes('공유 저장 완료'));
  assert.equal(JSON.parse(shared.sopPsiSimBuy_v1)['DAI-5']['2026-11'],undefined);
  assert.equal(await trigger('DAI-5','8월').textContent(),Number(rowData.monthlyPsi['8월'].buy).toLocaleString('ko-KR'));
  await page.locator('#fplant').selectOption('향남');
  assert.equal(await trigger('DAI-5','8월').count(),0,'Plant-scoped allocations remain read-only');
  await page.locator('#fplant').selectOption('');
  await page.locator('#psiUnitCostBtn').click();
  assert.equal(await page.locator('#psiWrap .psi-buy-trigger').count(),0);
  await page.locator('#psiUnitQtyBtn').click();
  await open('DAI-5','8월');
  if(process.env.PSI_TEST_SCREENSHOT)await page.screenshot({path:process.env.PSI_TEST_SCREENSHOT});
  assert.deepEqual(errors,[]);
  console.log('PASS save failure/retry, reset, plant and amount read-only modes');
  console.log(`PASS browser regression complete (${uploaded.psi.length} SKUs, ${putCount} local mock saves, no production writes)`);
}finally{
  if(browser)await browser.close();
  server.close();
}
