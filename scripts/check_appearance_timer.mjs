// Run from the repository root with Playwright installed and dist/ served locally.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file=process.argv[2];
if(!file||!fs.existsSync(file))throw new Error('Pass the original L001-LESSON.mp3 path as the first argument.');
fs.mkdirSync('work',{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark',hasTouch:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const stateIs=s=>page.waitForFunction(s=>document.getElementById('step-timer').dataset.state===s,s);
const state=()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('german-study',1);r.onsuccess=()=>resolve(r.result);});const r=db.transaction('state').objectStore('state').get('step-timer');const s=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));db.close();return s;});
const colors=()=>page.locator('#step-timer').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));
const hold=async ms=>{const b=await page.locator('#step-timer').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(ms);await page.mouse.up();};
const touchHold=async()=>{const b=await page.locator('#step-timer').boundingBox(),cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});await page.waitForTimeout(750);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();};
try{
await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8765/dist/');await page.waitForFunction(()=>!document.getElementById('step-timer').disabled);
assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await stateIs('running');assert.equal((await colors()).bg,'rgb(32, 69, 45)');
for(const width of [390,360,320]){await page.setViewportSize({width,height:844});assert((await page.locator('.top-bar').boundingBox()).height<=63);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
await menu('settings');await page.locator('#theme-mode').selectOption('light');assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
await page.emulateMedia({colorScheme:'dark'});assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
await page.locator('#theme-mode').selectOption('system');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
await page.locator('#theme-mode').selectOption('dark');await page.locator('#duration-0').fill('.1');await page.locator('#timer-settings-form button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('timer-settings-status').textContent.startsWith('Timer lengths saved'));
await page.locator('#return-study').click();await stateIs('running');
await menu('library');await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('1 stored'));await page.locator('#return-study').click();
await page.locator('#player').evaluate(p=>p.play());
await stateIs('overtime');await page.waitForTimeout(1300);assert.match(await page.locator('#timer-time').textContent(),/^\+00:0[12]/);assert.equal((await colors()).bg,'rgb(85, 39, 35)');assert.equal(await page.locator('#player').evaluate(p=>p.paused),false);assert.equal(await page.locator('#lesson').inputValue(),'1');
assert((await state()).current.deadline!==null);const first=await page.locator('#timer-time').textContent();await page.waitForTimeout(1200);assert.notEqual(await page.locator('#timer-time').textContent(),first);
console.log('Device theme, explicit appearance choice, unchanged 320px toolbar, and running red +overtime with uninterrupted audio passed.');
await page.locator('#step-timer').tap();await stateIs('paused');assert.equal((await colors()).bg,'rgb(48, 58, 53)');const paused=(await state()).current.remainingMs;assert(paused<0);const label=await page.locator('#timer-time').textContent();await page.waitForTimeout(1100);assert.equal(await page.locator('#timer-time').textContent(),label);
await menu('settings');await page.locator('#return-study').click();await stateIs('paused');
await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('step-timer').disabled);await stateIs('paused');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal((await state()).current.remainingMs,paused);
await page.locator('#step-timer').tap();await stateIs('overtime');assert((await state()).current.deadline!==null);await page.waitForTimeout(1100);assert.notEqual(await page.locator('#timer-time').textContent(),label);await page.locator('#step-timer').tap();await stateIs('paused');
await touchHold();await stateIs('running');assert.match(await page.locator('#timer-time').textContent(),/^00:0[56]/);await page.waitForTimeout(100);await stateIs('running'); // release must not immediately pause it
await page.locator('#step-timer').tap();await stateIs('paused');await hold(150);await stateIs('running'); // short press resumes
await hold(750);await stateIs('paused'); // long hold while running pauses; cannot reset
console.log('Paused overtime freezes, stays gray across offline reload, resumes its overtime, and long press restarts only when paused.');
await hold(750);await stateIs('running');await stateIs('overtime');await menu('settings');let saved=await state();assert(saved.current.remainingMs<0);assert(saved.current.resumeOnStudy);assert.equal(saved.current.deadline,null);await page.locator('#return-study').click();await stateIs('overtime');
const activeDeadline=(await state()).current.deadline;await page.reload();await page.waitForFunction(()=>!document.getElementById('step-timer').disabled);await stateIs('overtime');assert.equal((await state()).current.deadline,activeDeadline);console.log('Menu navigation pauses and resumes overtime; active overtime also survives offline reload.');
await page.screenshot({path:'work/appearance370-dark.png'});assert.deepEqual(errors,[]);
}finally{await context.close();await browser.close();}
