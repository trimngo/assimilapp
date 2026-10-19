// Real local book/audio imports; migration fixtures never leave this browser.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {STEP_ORDER} from '../dist/study-steps.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=process.argv.slice(2);if(files.length!==2||files.some(p=>!fs.existsSync(p)))throw new Error('Pass PDF part 1 and L011-LESSON.mp3.');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const ready=()=>page.waitForFunction(()=>!document.getElementById('file-input').disabled&&!document.getElementById('step-timer').disabled);
const shadow=()=>page.getByRole('button',{name:'Step 7: Shadowing',exact:true}).click();
const attach=()=>page.evaluate(async()=>{
 window.engine=(await import('./audio-engine.js')).getAudioEngine(document.getElementById('player'));
 window.readState=async key=>{const db=await new Promise(resolve=>{const req=indexedDB.open('german-study',1);req.onsuccess=()=>resolve(req.result);});return new Promise((resolve,reject)=>{const tx=db.transaction('state'),req=tx.objectStore('state').get(key);tx.oncomplete=()=>{db.close();resolve(req.result);};tx.onerror=()=>reject(tx.error);});};
});
const shadowReady=()=>page.waitForFunction(()=>document.querySelector('.sentence-row')?.dataset.takeKey&&document.querySelector('#sentence-list canvas'));
const snapshot=()=>page.evaluate(async()=>({progress:await readState('progress'),timer:await readState('step-timer'),course:await readState('course')}));
const restore=async backup=>{await page.locator('#restore').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Progress restored'));await page.evaluate(()=>document.getElementById('notice').textContent='');};
const expectedDurations=[11,12,13,14,16,17,15,18];
try{
 await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8786/dist/');await ready();await attach();
 assert.deepEqual(await page.locator('#step-dots button').evaluateAll(buttons=>buttons.map(b=>b.getAttribute('aria-label'))),['Step 1: Review','Step 2: Blind listening','Step 3: Understand','Step 4: Read along','Step 5: Exercises','Step 6: Write','Step 7: Shadowing','Step 8: Recall']);
 await menu('settings');assert.deepEqual(await page.locator('.duration-row input').evaluateAll(inputs=>inputs.map(i=>Number(i.value))),[5,3,7,5,8,5,10,2]);
 await menu('library');await page.locator('#file-input').setInputFiles(files);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('2 stored'),null,{timeout:90000});
 const seeded=await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const req=indexedDB.open('german-study',1);req.onsuccess=()=>resolve(req.result);}),files=await new Promise(resolve=>{const req=db.transaction('files').objectStore('files').getAll();req.onsuccess=()=>resolve(req.result);}),audio=files.find(f=>f.kind==='audio');
  const spans=[{start:7,end:7.8},{start:9,end:9.8},{start:11,end:11.8}],practice={spans,selected:[0,2],repeat:true,repeatDelay:3,language:'en',index:1,time:9.25,completed:false};
  const course={books:{},segments:{[audio.id]:spans},segmentMode:{[audio.id]:'custom'},shadowing:{},practice:{[`11:${audio.id}`]:practice},rate:.9},progress={lesson:11,step:4,tracks:{11:audio.id},completions:{completed:[9,10],days:{'2026-10-18':[10]}}},timer={durations:[11,12,13,14,15,16,17,18],current:{lesson:11,step:4,remainingMs:123000,deadline:null,resumeOnStudy:false,notified:false}};
  await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');for(const [key,value] of Object.entries({course,progress,'step-timer':timer}))tx.objectStore('state').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  const {VoiceStore}=await import('./voice-store.js'),scope=JSON.stringify(['german',11,audio.sha256||audio.id]);await new VoiceStore().save({scope,spans,slots:['saved-voice-1','saved-voice-2','saved-voice-3']},{key:'saved-voice-1',scope,blob:new Blob(['unchanged voice take'],{type:'audio/webm'}),type:'audio/webm',createdAt:1,duration:1});return {audioId:audio.id,spans,practice};
 });
 await page.reload();await ready();await attach();let saved=await snapshot();assert.equal(saved.progress.step,6);assert.deepEqual(saved.progress.stepOrder,STEP_ORDER);assert.deepEqual(saved.timer.durations,expectedDurations);assert.equal(saved.timer.current.step,6);assert.equal(saved.timer.current.remainingMs,123000);assert.equal(saved.timer.current.deadline,null);assert.deepEqual(saved.course.segments[seeded.audioId],seeded.spans);assert.deepEqual(saved.course.practice[`11:${seeded.audioId}`],seeded.practice);assert.deepEqual(saved.progress.completions.completed,[9,10]);
 await menu('study');await shadowReady();assert.equal(await page.locator('#step-count').textContent(),'STEP 7 OF 8');assert.equal(await page.locator('#timer-time').textContent(),'02:03');assert.equal(await page.locator('.sentence-row').first().getAttribute('data-take-key'),'saved-voice-1');assert(await page.locator('.sentence-mine').first().isEnabled());
 await page.reload();await ready();await attach();await shadowReady();saved=await snapshot();assert.equal(saved.progress.step,6);assert.deepEqual(saved.timer.durations,expectedDurations);assert.equal(saved.timer.current.remainingMs,123000);
 console.log('Legacy Shadowing resumes at step 7; custom durations, paused countdown, completions, timings, selections and voice-take identity survive repeated reloads.');
 await menu('library');await page.locator('details:has(#export) > summary').click();const downloading=page.waitForEvent('download');await page.locator('#export').click();const backup=JSON.parse(fs.readFileSync(await (await downloading).path()));assert.equal(backup.version,3);assert.deepEqual(backup.stepOrder,STEP_ORDER);assert.equal(backup.step,6);assert.deepEqual(backup.timer.durations,expectedDurations);
 const legacy={...backup,version:2,step:4,timer:{durations:[11,12,13,14,15,16,17,18]}};delete legacy.stepOrder;
 for(const [oldStep,newStep] of [[4,6],[5,4],[6,5]]){await restore({...legacy,step:oldStep});saved=await snapshot();assert.equal(saved.progress.step,newStep);assert.deepEqual(saved.timer.durations,expectedDurations);assert.deepEqual(saved.course.segments[seeded.audioId],seeded.spans);}
 await restore(backup);saved=await snapshot();assert.equal(saved.progress.step,6);assert.deepEqual(saved.timer.durations,expectedDurations);
 // Version 1 backups without timers keep the existing timer settings.
 const v1={...legacy,version:1,step:6};delete v1.timer;await restore(v1);saved=await snapshot();assert.equal(saved.progress.step,5);assert.deepEqual(saved.timer.durations,expectedDurations);
 console.log('New backups round-trip, and version 1/2 backups restore the matching activity and timer lengths.');
 await menu('study');await page.getByRole('button',{name:'Step 4: Read along',exact:true}).click();
 for(const [name,step] of [['Exercises',4],['Write',5],['Shadowing',6],['Recall',7]]){
  await page.locator('#next').click();assert.equal(await page.locator('#step-title').textContent(),name);assert.equal(await page.locator('#step-count').textContent(),`STEP ${step+1} OF 8`);
  if(['Exercises','Write'].includes(name)){
   assert(await page.locator('#shadow-simple').isHidden());assert(await page.locator('#book-card').isVisible());assert(await page.locator('#playback-controls').isVisible());
   await page.waitForFunction(()=>engine.readyState>=1);await page.locator('#playback-position').fill('40');await page.locator('#playback-toggle').click();await page.waitForFunction(()=>!engine.paused&&engine.currentTime>40.1);assert.equal(await page.evaluate(()=>engine._playbackEnd),null);await page.locator('#playback-toggle').click();
  }else if(name==='Shadowing'){await shadowReady();assert(await page.locator('#shadow-simple').isVisible());assert.deepEqual(await page.locator('.sentence-check').evaluateAll(es=>es.flatMap((e,i)=>e.checked?[i]:[])),[0,2]);assert(await page.locator('#shadow-loop').isChecked());assert(await page.locator('[name=shadow-language][value=en]').isChecked());assert.equal(await page.locator('#shadow-repeat-delay').inputValue(),'3');}
  else{assert(await page.locator('#shadow-simple').isHidden());assert(await page.locator('#recall-controls').isVisible());assert.equal(await page.locator('#next').textContent(),'Finish lesson →');}
 }
 await page.locator('#previous').click();await shadowReady();assert.equal(await page.locator('#step-title').textContent(),'Shadowing');await menu('settings');assert.deepEqual(await page.locator('.duration-row label').allTextContents(),['Review','Blind listening','Understand','Read along','Exercises','Write','Shadowing','Recall']);await page.locator('#timer-defaults').click();await page.waitForFunction(()=>document.getElementById('timer-settings-status').textContent==='Suggested timer lengths restored.');assert.deepEqual(await page.locator('.duration-row input').evaluateAll(es=>es.map(e=>Number(e.value))),[5,3,7,5,8,5,10,2]);await menu('study');
 await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await ready();await attach();await shadowReady();assert.equal(await page.locator('#step-title').textContent(),'Shadowing');assert.equal((await snapshot()).progress.step,6);assert(await page.locator('.sentence-mine').first().isEnabled());assert.equal(await page.locator('#shadow-repeat-delay').inputValue(),'3');
 await page.getByRole('button',{name:'Step 8: Recall',exact:true}).click();await page.locator('#next').click();await page.waitForFunction(()=>document.getElementById('lesson').value==='12');saved=await snapshot();assert.equal(saved.progress.step,0);assert(saved.progress.completions.completed.includes(11));assert.deepEqual(saved.progress.stepOrder,STEP_ORDER);assert.deepEqual(errors,[]);
 console.log('Next/Back follow the new order; Exercises/Write retain full audio and pages, Shadowing/Recall retain their controls, and offline reopening and Finish lesson work.');
}finally{await context.close();await browser.close();}
