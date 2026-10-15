// Pass PDF part 1 and L011-LESSON.mp3. Uses actual decoded audio, edited cuts and PDF.
import fs from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=process.argv.slice(2);if(files.length!==2||files.some(p=>!fs.existsSync(p)))throw new Error('Pass PDF part 1 and L011-LESSON.mp3.');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:600,height:800},hasTouch:true}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>localStorage.setItem('german-study-audio-mode','compatibility'));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const attach=()=>page.evaluate(async()=>window.engine=(await import('./audio-engine.js')).getAudioEngine(document.getElementById('player')));
const state=()=>page.evaluate(()=>({time:engine.currentTime,paused:engine.paused,backend:engine.backend,end:engine._playbackEnd}));
const ready=()=>page.waitForFunction(()=>!document.getElementById('file-input').disabled);
const stopped=()=>page.waitForFunction(()=>engine.paused&&document.getElementById('play-status').textContent.includes('complete'));
const spans=[{start:6,end:6.45},{start:6.55,end:7},{start:7.1,end:7.55}];
const assertStage=(sentence,stage)=>page.waitForFunction(({sentence,stage})=>document.getElementById('shadow-sentence-status').textContent===`Learn sentence ${sentence} of 3`&&document.querySelector('[data-shadow-stage][aria-pressed="true"]')?.dataset.shadowStage===String(stage),{sentence,stage});
const passes=[[0,0,true],[0,0,false],[1,1,true],[1,1,false],[0,1,true],[0,1,false],[2,2,true],[2,2,false],[0,2,true],[0,2,false]];
try{
  await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8773/dist/');await ready();await attach();await menu('library');await page.locator('#file-input').setInputFiles(files);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('2 stored'),null,{timeout:90000});await menu('study');await page.locator('#lesson').fill('11');await page.locator('#lesson').dispatchEvent('change');await page.locator('#step-dots button').nth(4).click();assert.equal(await page.locator('#shadow-mode').inputValue(),'cumulative');await page.waitForFunction(()=>engine.readyState>=1&&document.getElementById('mini-title').textContent==='L011-LESSON.mp3');
  assert.equal(await page.locator('#shadow-sentences button').count(),8);assert.equal(await page.locator('[data-shadow-stage]:visible').count(),2);await page.locator('#shadow-sentence-next').click();assert.equal(await page.locator('#shadow-sentence-status').textContent(),'Learn sentence 2 of 8');assert.equal(await page.locator('[data-shadow-stage]:visible').count(),4);await page.locator('[data-shadow-stage="3"]').click();assert(await page.locator('#book-card').isHidden());await page.locator('#shadow-sentence-back').click();assert.equal(await page.locator('#shadow-sentence-status').textContent(),'Learn sentence 1 of 8');assert.equal(await page.locator('[data-shadow-stage="0"]').getAttribute('aria-pressed'),'true');
  console.log('The outer navigation has eight learning sentences; sentence 1 has two stages and sentence 2 has four grouped stages.');
  await page.locator('#sentence-controls > details:has(#sentence-auto) > summary').click();await page.locator('#timing-editor > summary').click();await page.locator('#timing-text').fill(spans.map(s=>`${s.start}, ${s.end}`).join('\n'));await page.locator('#save-timings').click();await page.waitForFunction(()=>document.querySelectorAll('#shadow-sentences button').length===3);await assertStage(1,0);
  for(const mode of ['compatibility','native']){
    if(mode==='native'){await page.locator('#audio-options > summary').click();await page.locator('#audio-mode').selectOption(mode);await page.waitForFunction(()=>engine.backend==='native'&&!document.getElementById('audio-mode').disabled);}
    await page.locator('#shadow-pass-restart').click();
    for(let i=0;i<passes.length;i++){
      const [first,last,text]=passes[i];await assertStage(last+1,i<2?i:(i-2)%4);assert.equal(await page.locator('#shadow-sentences [aria-current=step]').textContent(),String(last+1));assert.doesNotMatch(await page.locator('#cumulative-controls').textContent(),/Pass \d+ of/);
      assert.equal(await page.locator('#sentence-list').isVisible(),text);assert.equal(await page.locator('#book-card').isVisible(),text);
      if(text){await page.waitForFunction(()=>document.querySelector('#sentence-list canvas'));assert.equal(await page.locator('.sentence-row:visible').count(),last-first+1);}
      await page.locator('#shadow-pass-play').click();await page.waitForFunction(()=>!engine.paused);const playing=await state();assert(playing.time>=spans[first].start&&playing.time<spans[last].end);assert.equal(playing.end,spans[last].end);
      if(mode==='compatibility'&&i===0){
        // Block page callbacks past the cut: the output clock must still stop exactly there.
        const blocked=await page.evaluate(()=>{const until=performance.now()+1100;while(performance.now()<until){}return {time:engine.currentTime,clock:engine.context.currentTime};});assert.equal(blocked.time,spans[last].end);
      }
      await stopped();assert(Math.abs((await state()).time-spans[last].end)<.03);if(i<passes.length-1)await page.locator('#shadow-pass-next').click();
    }
    assert.match(await page.locator('#play-status').textContent(),/Whole dialogue complete without text/);assert(await page.locator('#shadow-pass-next').isDisabled());
    console.log(`${mode}: all 10 passes play audio, use the edited ranges and stop; text is hidden in all five without-text passes.`);
    await page.locator('#shadow-pass-restart').click();await page.locator('.sentence-row-play').first().click();await page.waitForFunction(()=>engine.paused&&document.getElementById('play-status').textContent.startsWith('Sentence complete'));assert(Math.abs((await state()).time-6.45)<.03);
    await page.locator('#playback-toggle').click();await page.waitForFunction(()=>engine.currentTime>6.7);assert.equal((await state()).end,null);await page.locator('#playback-toggle').click();
    await page.locator('.sentence-row-repeat').first().click();await page.waitForFunction(()=>engine.paused&&document.getElementById('play-status').textContent.startsWith('Sentence complete'));assert(Math.abs((await state()).time-6.45)<.03);
  }
  await page.locator('#shadow-sentences button').nth(1).click();await page.locator('[data-shadow-stage="2"]').click();await assertStage(2,2);fs.mkdirSync('work/nested-shadowing',{recursive:true});await page.locator('#cumulative-controls').screenshot({path:'work/nested-shadowing/tablet.png'});
  await page.locator('#audio-mode').selectOption('compatibility');await page.waitForFunction(()=>engine.backend==='compatibility'&&!document.getElementById('audio-mode').disabled);
  await page.locator('#shadow-pass-play').click();await page.waitForFunction(()=>!engine.paused);await page.locator('#reconnect-audio').click();await stopped();assert(Math.abs((await state()).time-7)<.03);
  await page.locator('#shadow-pass-play').click();await page.waitForFunction(()=>!engine.paused);await page.locator('#playback-position').fill('5');assert.equal((await state()).end,null);await page.waitForFunction(()=>engine.currentTime>7.2);await page.locator('#playback-toggle').click();await assertStage(2,2);
  console.log('Reconnect retains the cumulative endpoint; freely scrubbing releases it without changing the selected practice pass.');
  await menu('library');await page.locator('details:has(#export) > summary').click();const downloading=page.waitForEvent('download');await page.locator('#export').click();const download=await downloading,backup=JSON.parse(fs.readFileSync(await download.path()));assert.equal(backup.course.shadowing[0].position,4);assert.deepEqual(backup.course.segments[0].timings,spans);
  await menu('study');await page.locator('#shadow-pass-restart').click();await menu('library');await page.locator('#restore').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.getElementById('notice').textContent.startsWith('Progress restored'));await menu('study');await assertStage(2,2);
  for(const [step,title] of [[5,'Exercises'],[6,'Write']]){await page.locator('#step-dots button').nth(step).click();assert.equal(await page.locator('#step-title').textContent(),title);assert(await page.locator('#playback-controls').isVisible());await page.locator('#playback-position').fill('40');await page.locator('#playback-toggle').click();await page.waitForFunction(()=>engine.currentTime>40.2);assert.equal((await state()).end,null);await page.locator('#playback-toggle').click();}
  await page.locator('#step-dots button').nth(4).click();await page.locator('#shadow-pass-next').click();assert(await page.locator('#book-card').isHidden());await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await ready();await attach();await assertStage(2,3);assert(await page.locator('#sentence-list').isHidden());assert(await page.locator('#book-card').isHidden());await page.locator('#shadow-pass-play').click();await stopped();assert.equal((await state()).time,7);
  await page.setViewportSize({width:320,height:700});await page.locator('#cumulative-controls').screenshot({path:'work/nested-shadowing/phone.png'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('Shadowing position and edited timings survive backup/restore and offline reopening; Exercises and Write expose audio; controls fit 320px.');
}catch(error){console.log(await state(),await page.locator('#play-status').textContent(),await page.locator('#shadow-pass-status').textContent());throw error;}
finally{await context.close();await browser.close();}
