// Pass L011. Deliberately delays native media events as Safari can do while seeking.
import fs from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),file=process.argv[2];if(!file||!fs.existsSync(file))throw new Error('Pass L011-LESSON.mp3.');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{for(const fault of ['late seeking','late seeking after seeked','late play','stuck seeking']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();await context.addInitScript(()=>localStorage.setItem('german-study-audio-mode','native'));
  try{
    await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8773/dist/');await page.waitForFunction(()=>!document.getElementById('file-input').disabled);
    await page.locator('#app-menu summary').click();await page.locator('[data-tab=library]').click();await page.locator('#file-input').setInputFiles(file);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('1 stored'));await page.locator('#app-menu summary').click();await page.locator('[data-tab=study]').click();await page.locator('#lesson').fill('11');await page.locator('#lesson').dispatchEvent('change');await page.locator('#step-dots button').nth(4).click();await page.waitForFunction(()=>document.getElementById('player').readyState>=1);
    if(await page.locator('#shadow-options').count())await page.locator('#shadow-options > summary').click();
    await page.locator('#sentence-controls > details:has(#sentence-auto) > summary').click();await page.locator('#timing-editor > summary').click();await page.locator('#timing-text').fill('6, 6.5\n7, 8.5');await page.locator('#save-timings').click();await page.waitForFunction(()=>document.querySelectorAll('#shadow-sentences button').length===2);await page.locator('#shadow-sentences button').nth(1).click();await page.locator('[data-shadow-stage="2"]').click();
    await page.locator('#player').evaluate((p,fault)=>{
      if(fault==='late seeking'){
        p.addEventListener('seeking',event=>{event.stopImmediatePropagation();setTimeout(()=>{p.dispatchEvent(new Event('seeking'));p.dispatchEvent(new Event('seeked'));},400);},{capture:true,once:true});
        p.addEventListener('seeked',event=>event.stopImmediatePropagation(),{capture:true,once:true});
      }else if(fault==='late seeking after seeked')p.addEventListener('seeking',event=>{event.stopImmediatePropagation();setTimeout(()=>p.dispatchEvent(new Event('seeking')),400);},{capture:true,once:true});
      else if(fault==='late play')p.addEventListener('play',event=>{event.stopImmediatePropagation();setTimeout(()=>p.dispatchEvent(new Event('play')),400);},{capture:true,once:true});
      else Object.defineProperty(p,'seeking',{configurable:true,get:()=>true});
    },fault);
    await page.locator('#shadow-pass-play').click();await page.waitForFunction(()=>!document.getElementById('player').paused);
    await page.waitForFunction(()=>document.getElementById('player').paused||document.getElementById('player').currentTime>8.8,null,{timeout:6000});
    const result=await page.locator('#player').evaluate(p=>({paused:p.paused,time:p.currentTime,status:document.getElementById('play-status').textContent}));console.log(fault,result);
    if(!process.env.EXPECT_OLD_FAILURE){assert(result.paused);assert(Math.abs(result.time-8.5)<.03);assert.match(result.status,/complete/);}
  }finally{await context.close();}
}}finally{await browser.close();}
