// Run from the repository root with Playwright installed and dist/ served locally.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {preparedSentences} from '../dist/course-data.js';
const index=JSON.parse(fs.readFileSync('dist/course-index.json')),spans=preparedSentences(index.lessons[9]);
const file=process.argv[2];
if(!file||!fs.existsSync(file))throw new Error('Pass the original L010-LESSON.mp3 path as the first argument.');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const seek=async time=>{await page.locator('#player').evaluate((p,t)=>p.currentTime=t,time);await page.waitForFunction(()=>!document.getElementById('player').seeking);};
const nativePlay=()=>page.locator('#player').evaluate(p=>p.play());
const pause=()=>page.locator('#player').evaluate(p=>p.pause());
const time=()=>page.locator('#player').evaluate(p=>p.currentTime);
const selected=()=>page.locator('#sentence-status').textContent();
const assertSelected=async n=>assert.match(await selected(),new RegExp(`^Sentence ${n} of`));
const save=async()=>{await page.locator('#save-sentence').click();await page.waitForFunction(()=>document.getElementById('timing-edit-status').textContent.startsWith('Sentence timings saved'));};
try {
await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8765/dist/');await page.waitForFunction(()=>!document.getElementById('file-input').disabled);
assert.equal(await page.locator('#app-version').textContent(),`v${JSON.parse(fs.readFileSync('dist/version.json')).version}`);
await menu('library');await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('1 stored'));
await menu('study');await page.locator('#lesson').fill('10');await page.locator('#lesson').dispatchEvent('change');await page.locator('#step-dots button').nth(4).click();await assertSelected(1);
await page.waitForFunction(()=>document.getElementById('player').readyState>=1);
await page.locator('#audio-options > summary').click();await page.locator('#sentence-timing-options > summary').click();
// Reproduce an oversized first cut, shorten it, then reclaim the gap for sentence 2.
const split=+(spans[0].start+1).toFixed(2),earlier=+(split+.1).toFixed(2),end=+(earlier+.8).toFixed(2);
await page.locator('#timing-end').fill(String(split));await save();
await page.locator('#sentence-next').click();await assertSelected(2);
await seek(earlier);await nativePlay();await page.waitForTimeout(200);await pause();await assertSelected(2);
assert.equal(Number(await page.locator('#timing-start').inputValue()),+spans[1].start.toFixed(2));
await seek(earlier);await page.locator('#timing-start-playhead').click();await page.locator('#timing-end').fill(String(end));await save();await assertSelected(2);
console.log('Lesson 10: shortened first cut, sought into its freed gap, and saved an earlier start for sentence 2 without changing selection.');
// Repeat and preview finish naturally; seeking to the end now intentionally cancels a boundary.
await page.locator('#sentence-play').click();assert(Math.abs(await time()-earlier)<.35);
await page.waitForFunction(()=>document.getElementById('player').paused&&document.getElementById('play-status').textContent.startsWith('Your turn'));
assert(Math.abs(await time()-end)<.03);await assertSelected(2);
await nativePlay();await page.waitForTimeout(1100);assert(await time()>end+.8);await assertSelected(2);await pause();
// Pausing then resuming with Play releases the bound, starting at precisely the paused location.
await page.locator('#sentence-play').click();await page.waitForTimeout(150);await pause();const paused=await time();await nativePlay();await page.waitForTimeout(1000);assert(await time()>paused+.85);assert(await time()>end);await assertSelected(2);await pause();
console.log('Repeat stops at saved end. Native Play resumes freely, including after a manual pause.');
// Scrub both forward and backward during bounded playback; nothing snaps or selects another sentence.
for(const target of [spans[2].end+1,0]){
 await page.locator('#sentence-play').click();await seek(target);await page.waitForTimeout(250);
 assert(await time()>=target&&await time()<target+.6);assert.equal(await page.locator('#player').evaluate(p=>p.paused),false);await assertSelected(2);await pause();
}
await seek(0);await nativePlay();await page.waitForTimeout(200);assert(await time()<.5);await assertSelected(2);await pause();
console.log('Scrubbing during Repeat releases the boundary; Play at the title starts at zero without snapping.');
await page.locator('#timing-end').fill(String(+(end-.1).toFixed(2)));await page.locator('#preview-sentence').click();
await page.waitForFunction(()=>document.getElementById('timing-edit-status').textContent.startsWith('Preview complete'));
assert(Math.abs(await time()-(end-.1))<.03);await assertSelected(2);
await page.locator('#preview-sentence').click();await seek(spans[3].start);await page.waitForTimeout(250);assert(await time()>spans[3].start);assert.equal(await page.locator('#player').evaluate(p=>p.paused),false);await assertSelected(2);await pause();
await page.locator('#reset-sentence-edit').click();
console.log('Preview bounds only its draft cut; scrubbing also releases Preview without losing its selected sentence.');
// Mini-player parity.
await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>!document.getElementById('mini-player').hidden);
await page.locator('#mini-repeat').click();await page.waitForFunction(()=>document.getElementById('player').paused&&document.getElementById('play-status').textContent.startsWith('Your turn'));
await page.locator('#mini-play').click();await page.waitForTimeout(1000);assert(await time()>end+.8);await assertSelected(2);await pause();
console.log('Compact Play and Repeat use the same free/bounded behavior.');
// Opt-in sequential automatic continuation remains; scrubbing cancels the queued gap.
await page.locator('#sentence-controls > details:has(#sentence-auto) > summary').click();await page.locator('#sentence-auto').check();
await page.locator('#sentence-play').click();await page.waitForFunction(()=>document.getElementById('player').paused&&document.getElementById('play-status').textContent.startsWith('Your turn'));
await seek(0);await page.waitForTimeout(1500);await assertSelected(2);assert.equal(await page.locator('#player').evaluate(p=>p.paused),true);
await page.locator('#sentence-play').click();await page.waitForFunction(()=>document.getElementById('sentence-status').textContent.startsWith('Sentence 3')&&!document.getElementById('player').paused);await pause();await page.locator('#sentence-auto').uncheck();
console.log('Scrubbing cancels queued automatic continuation; explicit automatic practice still advances sequentially.');
await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await page.waitForSelector('#shadow-mode',{state:'attached'});
await page.locator('#sentence-next').click();await page.locator('#audio-options > summary').click();await page.locator('#sentence-timing-options > summary').click();
assert.equal(Number(await page.locator('#timing-start').inputValue()),earlier);assert.equal(Number(await page.locator('#timing-end').inputValue()),end);assert.equal(await page.locator('#lesson').inputValue(),'10');assert.deepEqual(errors,[]);
console.log('Corrected timings, imported MP3 and lesson progress survive offline restart.');
}finally{await context.close();await browser.close();}
