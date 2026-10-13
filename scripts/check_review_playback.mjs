// Serve dist/ locally and pass the original L010, L011, L012 and L013 recordings.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs';import assert from 'node:assert/strict';
const files=process.argv.slice(2);if(files.length!==4||files.some(file=>!fs.existsSync(file)))throw new Error('Pass original L010, L011, L012 and L013 MP3 paths in order.');
const index=JSON.parse(fs.readFileSync('dist/course-index.json'));
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:800,height:1100},hasTouch:true,isMobile:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const lesson=async n=>{await page.locator('#lesson').fill(String(n));await page.locator('#lesson').dispatchEvent('change');await page.waitForFunction(n=>document.getElementById('mini-title').textContent===`L${String(n).padStart(3,'0')}-LESSON.mp3`&&document.getElementById('player').readyState>=1,n);};
const state=()=>page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('german-study',1);r.onsuccess=()=>resolve(r.result);});const course=await new Promise(resolve=>{const r=db.transaction('state').objectStore('state').get('course');r.onsuccess=()=>resolve(r.result);});db.close();return course;});
try{
await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8765/dist/');await page.waitForFunction(()=>!document.getElementById('file-input').disabled);await menu('library');await page.locator('#file-input').setInputFiles(files);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('4 stored'));await menu('study');await lesson(10);await page.locator('#step-dots button').nth(4).click();
// A browser can drop a seek-complete event when the audio source changes.
await page.evaluate(()=>{window.dropSeeked=true;document.getElementById('player').addEventListener('seeked',event=>{if(window.dropSeeked)event.stopImmediatePropagation();},true);});
await page.locator('#sentence-play').click();await page.waitForFunction(()=>!document.getElementById('player').paused&&!document.getElementById('player').seeking);await lesson(13);
// Simulate delayed media notifications while audio keeps playing on its native clock.
await page.evaluate(()=>{window.dropTimeupdate=true;window.samples=[];const p=document.getElementById('player');p.addEventListener('timeupdate',event=>{if(window.dropTimeupdate)event.stopImmediatePropagation();},true);window.sampleTimer=setInterval(()=>window.samples.push({file:document.getElementById('mini-title').textContent,time:p.currentTime}),50);});
const before=await state();await page.locator('#start-review').click();
for(const n of [10,11,12]){
 await page.waitForFunction(n=>document.getElementById('mini-title').textContent===`L${String(n).padStart(3,'0')}-LESSON.mp3`&&!document.getElementById('player').paused,n,{timeout:20000});
 await page.locator('#player').evaluate(p=>p.playbackRate=4);
 await page.waitForFunction(()=>document.getElementById('player').currentTime>2);
 // Visible position must keep updating even when timeupdate/seeked are missing.
 await page.waitForFunction(()=>Math.abs(Number(document.getElementById('playback-position').value)-document.getElementById('player').currentTime)<.5&&Number(document.getElementById('playback-position').value)>1);
 await page.waitForFunction(()=>{const p=document.getElementById('player'),parts=document.getElementById('mini-time').textContent.split(' / ')[0].split(':').map(Number);return Math.abs(parts[0]*60+parts[1]-p.currentTime)<1.3&&parts[0]*60+parts[1]>1;});assert.equal(await page.locator('#playback-toggle').textContent(),'Pause');assert.equal(await page.locator('#play-status').textContent(),`Reviewing lesson ${n}`);
 if(n<12)await page.waitForFunction(n=>document.getElementById('mini-title').textContent===`L${String(n+1).padStart(3,'0')}-LESSON.mp3`,n,{timeout:20000});
 else await page.waitForFunction(()=>document.getElementById('play-status').textContent.includes('Review complete'),null,{timeout:20000});
}
await page.evaluate(()=>clearInterval(window.sampleTimer));const samples=await page.evaluate(()=>window.samples);
for(const n of [10,11,12]){const observed=samples.filter(s=>s.file===`L${String(n).padStart(3,'0')}-LESSON.mp3`);assert(observed.length);const end=index.lessons[n-1].audio.dialogue.end;assert(Math.max(...observed.map(s=>s.time))<=end+.4,`Lesson ${n} continued beyond its dialogue`);}
assert(await page.locator('#player').evaluate(p=>p.paused));assert.equal(await page.locator('#lesson').inputValue(),'13');assert.deepEqual((await state())?.segments,before?.segments);console.log('Review for lesson 13 plays lessons 10–12 and stops before exercises, despite missing seeked/timeupdate events.');
// Main controls and compact controls share the same actual playback position.
await page.evaluate(()=>{window.dropSeeked=false;window.dropTimeupdate=false;});await page.locator('#step-dots button').nth(3).click();await page.waitForFunction(()=>document.getElementById('mini-title').textContent==='L013-LESSON.mp3'&&document.getElementById('player').readyState>=1);
 await page.locator('#playback-position').evaluate(e=>{e.value='8';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(()=>Math.abs(document.getElementById('player').currentTime-8)<.1);await page.locator('#playback-toggle').click();await page.waitForFunction(()=>!document.getElementById('player').paused);await page.waitForFunction(()=>Number(document.getElementById('playback-position').value)>9);await page.locator('#playback-toggle').click();assert(await page.locator('#player').evaluate(p=>p.paused));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('App-owned Play/Pause and seek control track real audio time.');
await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('file-input').disabled);assert.equal(await page.locator('#lesson').inputValue(),'13');assert.deepEqual(errors,[]);console.log('Offline reload retains imported recordings and lesson position.');
}catch(error){console.log('Playback at failure:',await page.evaluate(()=>({time:document.getElementById('player').currentTime,paused:document.getElementById('player').paused,title:document.getElementById('mini-title').textContent,status:document.getElementById('play-status').textContent})));throw error;}
finally{await context.close();await browser.close();}
