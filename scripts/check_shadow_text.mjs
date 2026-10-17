// Pass the original first PDF part, L010, L011 and L058 MP3s, and optionally the verified full book.
import fs from 'node:fs';import assert from 'node:assert/strict';
import {preparedSentences} from '../dist/course-data.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const [book,...rest]=process.argv.slice(2),files=[book,...rest.slice(0,3)],fullBook=rest[3];
if(files.length!==4||files.some(path=>!path||!fs.existsSync(path)))throw new Error('Pass PDF part 1, L010, L011, L058, and optionally the full PDF.');
const index=JSON.parse(fs.readFileSync('dist/course-index.json'));
fs.mkdirSync('work/shadow-text',{recursive:true});
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,colorScheme:'dark'}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const menu=async tab=>{await page.locator('#app-menu summary').click();await page.locator(`[data-tab=${tab}]`).click();};
const lesson=async n=>{await page.locator('#lesson').fill(String(n));await page.locator('#lesson').dispatchEvent('change');await page.waitForFunction(n=>document.getElementById('mini-title').textContent===`L${String(n).padStart(3,'0')}-LESSON.mp3`&&document.getElementById('player').readyState>=1,n);await page.locator('#step-dots button').nth(4).click();if(!await page.locator('#shadow-options').evaluate(e=>e.open))await page.locator('#shadow-options > summary').click();};
const waitText=()=>page.waitForFunction(()=>document.querySelectorAll('.sentence-row').length>0&&![...document.querySelectorAll('#sentence-list .note')].some(p=>p.textContent==='Loading sentence…'));
const row=n=>page.locator('.sentence-row').nth(n-1);
const playing=()=>page.waitForFunction(()=>!document.getElementById('player').paused);
try{
  await page.goto(process.env.STUDY_URL||'http://127.0.0.1:8767/dist/');await page.waitForFunction(()=>!document.getElementById('file-input').disabled);await menu('library');await page.locator('#file-input').setInputFiles(files);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('4 stored'),null,{timeout:90000});await menu('study');await lesson(11);await waitText();
  assert.equal(await page.locator('.sentence-row').count(),8);assert.equal(await page.locator('#sentence-list canvas').count(),8);assert.equal(await page.locator('.sentence-check').count(),8);assert.equal(await page.locator('.sentence-edit').count(),8);
  assert.equal(await page.locator('#sentence-list').evaluate(e=>!!e.closest('details')),false);
  await page.locator('#shadow-edit-sentence').selectOption('1');await page.locator('#shadow-individual-repeat').click();await page.waitForFunction(()=>document.getElementById('player').paused&&document.getElementById('play-status').textContent.startsWith('Sentence '));
  const cuts=preparedSentences(index.lessons[10]);assert(Math.abs(await page.locator('#player').evaluate(p=>p.currentTime)-cuts[1].end)<.03);assert.match(await page.locator('#sentence-status').textContent(),/^Sentence 2 of 8/);
  await page.locator('#shadow-individual-play').click();await playing();await page.waitForFunction(end=>document.getElementById('player').currentTime>end+.3,cuts[1].end);assert(!await page.locator('#player').evaluate(p=>p.paused));assert.match(await page.locator('#sentence-status').textContent(),/^Sentence 2 of 8/);await page.locator('#shadow-individual-play').click();assert(await page.locator('#player').evaluate(p=>p.paused));
  console.log('Advanced single-sentence mode shows all eight excerpts; its individual Repeat is bounded and free Play/Pause retains selection.');
  await row(1).scrollIntoViewIfNeeded();await page.screenshot({path:'work/shadow-text/phone-dark.png'});
  for(const size of [{width:320,height:740},{width:1200,height:800}]){await page.setViewportSize(size);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));for(const n of [1,8]){const text=await row(n).locator('canvas').boundingBox(),buttons=await page.locator('#shadow-individual-controls .backup-actions').boundingBox();assert(buttons.y>=text.y+text.height);assert(buttons.x>=0&&buttons.x+buttons.width<=size.width);}}
  await row(1).scrollIntoViewIfNeeded();await page.screenshot({path:'work/shadow-text/tablet-dark.png'});console.log('Narrow phone and tablet landscape layouts keep the controls after the text and fit the screen.');
  await lesson(10);await waitText();await page.locator('#shadow-edit-sentence').selectOption('1');await page.locator('#edit-sentence-mode').click();
  const customStart=preparedSentences(index.lessons[9])[1].start+.1,customEnd=customStart+.7;await page.locator('#timing-start').fill(customStart.toFixed(2));await page.locator('#timing-end').fill(customEnd.toFixed(2));await page.locator('#save-sentence').click();await waitText();
  await page.locator('#shadow-edit-sentence').selectOption('1');await page.locator('#shadow-individual-repeat').click();await page.waitForFunction(()=>document.getElementById('player').paused&&document.getElementById('play-status').textContent.startsWith('Sentence '));assert(Math.abs(await page.locator('#player').evaluate(p=>p.currentTime)-customEnd)<.03);
  console.log('Per-sentence buttons use saved custom timing edits.');
  await lesson(58);await waitText();assert(await page.locator('#sentence-list .note').filter({hasText:'Import 301-600.pdf'}).count()>0);assert.equal(await page.locator('#sentence-list canvas').count(),0);console.log('A missing PDF part is identified without showing text from the preceding lesson.');
  await lesson(11);await waitText();
  await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='App available offline');await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('file-input').disabled);if(!await page.locator('#shadow-options').evaluate(e=>e.open))await page.locator('#shadow-options > summary').click();await waitText();assert.equal(await page.locator('#sentence-list canvas').count(),8);await page.locator('#shadow-edit-sentence').selectOption('7');await page.locator('#shadow-individual-repeat').click();await page.waitForFunction(()=>document.getElementById('player').paused&&document.getElementById('play-status').textContent.startsWith('Sentence '));assert(Math.abs(await page.locator('#player').evaluate(p=>p.currentTime)-cuts[7].end)<.03);assert.deepEqual(errors,[]);console.log('Offline reload renders all sentence text from the stored PDF and plays the selected cut.');
  if(fullBook){
    await context.setOffline(false);await menu('library');await page.locator('#file-input').setInputFiles(fullBook);await page.waitForFunction(()=>document.getElementById('import-status').textContent.startsWith('1 stored'),null,{timeout:120000});await menu('study');await lesson(58);await waitText();assert.equal(await page.locator('#sentence-list .note').filter({hasText:'Import '}).count(),0);assert(await page.locator('#sentence-list canvas[data-global-page="303"]').count()>0);console.log('The full unsplit book resolves sentence excerpts after the old PDF split using global page numbers.');
  }
}finally{await context.close();await browser.close();}
