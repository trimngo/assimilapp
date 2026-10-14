// Pass original L001 and L015 MP3s. Native pauses/stalls are simulated; Bluetooth hardware is not.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {preparedDialogue} from '../dist/course-data.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=process.argv.slice(2);if(files.length!==2||files.some(path=>!fs.existsSync(path)))throw new Error('Pass original L001 and L015 MP3 paths.');
const index=JSON.parse(fs.readFileSync('dist/course-index.json'));
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1200,height:800}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const playing=()=>page.waitForFunction(()=>!document.getElementById('player').paused&&document.getElementById('player').readyState>=2);
const lesson=async n=>{await page.locator('#lesson').fill(String(n));await page.locator('#lesson').dispatchEvent('change');await page.waitForFunction(n=>document.getElementById('mini-title').textContent===`L${String(n).padStart(3,'0')}-LESSON.mp3`&&document.getElementById('player').readyState>=1,n);await page.locator('#step-dots button').nth(1).click();};
const seek=time=>page.locator('#player').evaluate((p,t)=>p.currentTime=t,time);
const details=async()=>{if(!await page.locator('#copy-audio-details').isVisible())await page.locator('#audio-options > summary').click();await page.locator('#copy-audio-details').click();return page.locator('#audio-details').textContent();};
try{
  await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8767/dist/');await page.waitForFunction(()=>!document.getElementById('file-input').disabled);
  await menu('library');await page.locator('#file-input').setInputFiles(files);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('2 stored'));await menu('study');
  await lesson(15);await page.locator('#step-dots button').nth(1).click();await page.locator('#start-blind').click();await playing();
  await page.evaluate(()=>{const p=document.getElementById('player');window.pauses=0;window.loads=0;p.addEventListener('pause',()=>window.pauses++);p.addEventListener('loadedmetadata',()=>window.loads++);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Use fallback');}}});});
  const end=preparedDialogue(index.lessons[14],true).end;await seek(end);
  await page.waitForFunction(()=>document.getElementById('blind-status').textContent==='Listen 2 of 2…'&&!document.getElementById('player').paused&&document.getElementById('player').currentTime<1);
  assert.equal(await page.evaluate(()=>window.pauses),0,'Same-file second listen must not release the output session.');
  console.log('Lesson 15 rewinds for listen 2 without pausing or reloading the output.');
  // Reproduce the screenshot: second listen is actually paused near the start, with no MediaError.
  await page.locator('#player').evaluate(p=>p.pause());await page.waitForFunction(()=>document.getElementById('play-status').textContent.includes('Playback was interrupted'));
  assert.equal(await page.locator('#player').evaluate(p=>p.error),null);const interruptedPosition=await page.locator('#player').evaluate(p=>p.currentTime);
  assert.match(await details(),/Listen completed: 1/);assert.match(await details(),/unexpected pause/);
  await page.locator('#playback-toggle').click();await playing();assert.equal(await page.evaluate(()=>window.loads),1);assert((await page.locator('#player').evaluate(p=>p.currentTime))>=interruptedPosition-.05);
  assert.equal(await page.locator('#blind-status').textContent(),'Listen 2 of 2…');
  console.log('Unrequested native pause is reported; Play reloads the audio and resumes the second listen in place.');
  // Intentional Pause stays paused; normal Play does not reload or trigger automatic recovery.
  await page.locator('#playback-toggle').click();await page.waitForTimeout(500);assert(await page.locator('#player').evaluate(p=>p.paused));
  const loads=await page.evaluate(()=>window.loads);await page.locator('#playback-toggle').click();await playing();assert.equal(await page.evaluate(()=>window.loads),loads);
  await seek(end);await page.waitForFunction(()=>document.getElementById('blind-status').textContent.startsWith('Both listens complete'));assert(await page.locator('#player').evaluate(p=>p.paused));
  console.log('Intentional pause remains paused, and the final listen stops at the dialogue before exercises.');
  await lesson(1);await page.locator('#start-blind').click();await playing();await seek(index.lessons[0].audio.dialogue.end+.2);await page.waitForTimeout(350);assert(!await page.locator('#player').evaluate(p=>p.paused));
  const fullListen=preparedDialogue(index.lessons[0],true);await seek(fullListen.end);await page.waitForFunction(()=>document.getElementById('blind-status').textContent==='Listen 2 of 2…'&&document.getElementById('player').currentTime<1);await seek(fullListen.end);await page.waitForFunction(()=>document.getElementById('blind-status').textContent.startsWith('Both listens complete'));
  console.log('Fast and slow readings, including the title, remain included in both listens.');
  await lesson(15);await page.locator('#start-blind').click();await playing();await seek(10);await page.waitForFunction(()=>!document.getElementById('player').seeking);
  await page.locator('#player').evaluate(p=>{const frozen=p.currentTime;Object.defineProperty(p,'currentTime',{configurable:true,get:()=>frozen,set:()=>{}});const load=p.load.bind(p);p.load=()=>{delete p.currentTime;p.load=load;return load();};window.frozen=frozen;});
  await page.waitForFunction(()=>document.getElementById('play-status').textContent.includes('Audio stopped advancing'),null,{timeout:12000});assert(await page.locator('#player').evaluate(p=>p.paused));assert.match(await details(),/clock stalled/);
  await page.locator('#playback-toggle').click();await playing();assert(Math.abs((await page.locator('#player').evaluate(p=>p.currentTime))-await page.evaluate(()=>window.frozen))<1);
  console.log('A frozen native clock is detected, and Play reconnects at the displayed position.');
  await page.locator('#playback-toggle').click();await page.locator('#player').evaluate(p=>{const play=p.play.bind(p);p.play=()=>{p.play=play;return Promise.reject(new DOMException('Interrupted by audio output','AbortError'));};});await page.locator('#playback-toggle').click();await page.waitForFunction(()=>document.getElementById('play-status').textContent.includes('Audio could not start'));assert.match(await details(),/AbortError: Interrupted by audio output/);
  await page.locator('#playback-toggle').click();await playing();console.log('Interrupted play promises are shown and recover through an explicit Play tap.');
  await page.locator('#playback-toggle').click();await page.locator('#player').evaluate(p=>{const play=p.play.bind(p);p.play=()=>{p.play=play;return new Promise(()=>{});};});await page.locator('#playback-toggle').click();await page.waitForFunction(()=>document.getElementById('play-status').textContent.includes('Audio could not start'),null,{timeout:15000});assert.match(await details(),/within 12 seconds/);await page.locator('#playback-toggle').click();await playing();
  console.log('A play request that never resolves times out and can be retried.');
  await page.locator('#step-dots button').nth(4).click();await page.locator('#sentence-next').click();await page.locator('#sentence-play').click();await playing();await page.locator('#player').evaluate(p=>p.pause());
  const holdMetadata=()=>page.locator('#player').evaluate(p=>{window.heldMetadata=false;p.addEventListener('loadedmetadata',event=>{event.stopImmediatePropagation();window.heldMetadata=true;setTimeout(()=>p.dispatchEvent(new Event('loadedmetadata')),600);},{capture:true,once:true});});
  await holdMetadata();await page.locator('#sentence-play').click();await page.waitForFunction(()=>window.heldMetadata);
  await page.locator('#playback-position').evaluate(input=>{input.value='25';input.dispatchEvent(new Event('input',{bubbles:true}));});await playing();await page.waitForFunction(()=>document.getElementById('audio-reconnect-status').textContent.startsWith('Audio reconnected'));
  assert(Math.abs(await page.locator('#player').evaluate(p=>p.currentTime)-25)<1);assert.match(await page.locator('#sentence-status').textContent(),/^Sentence 2 /);
  console.log('A seek during delayed reconnect takes precedence over the saved offset and preserves sentence selection.');
  await page.locator('#playback-toggle').click();await holdMetadata();await page.locator('#reconnect-audio').click();await page.waitForFunction(()=>window.heldMetadata);await page.locator('#step-dots button').nth(1).click();await page.waitForFunction(()=>document.getElementById('audio-reconnect-status').textContent==='Audio reconnect canceled.');assert(await page.locator('#player').evaluate(p=>p.paused));
  console.log('Changing steps cancels a pending reconnect without starting audio in the new step.');
  await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('file-input').disabled);assert.equal(await page.locator('#lesson').inputValue(),'15');await page.locator('#start-blind').click();await playing();assert.deepEqual(errors,[]);
  console.log('Offline reload retains the imported recordings and lesson and loads the recovery code.');
}finally{await context.close();await browser.close();}
