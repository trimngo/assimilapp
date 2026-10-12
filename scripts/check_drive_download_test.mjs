// Run from the repository root with Playwright installed and the repository served locally.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs';import assert from 'node:assert/strict';
const [pdf,audio]=process.argv.slice(2);
if(!pdf||!audio)throw new Error('Pass a PDF path and an MP3 path as the first two arguments.');
const pdfBytes=fs.readFileSync(pdf),mp3Bytes=fs.readFileSync(audio);
const probeURL=process.env.PROBE_URL||'http://127.0.0.1:8765/drive-test/';
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
async function run(fallback=false){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 if(fallback)await context.addInitScript(()=>Object.defineProperty(navigator.storage,'getDirectory',{value:undefined}));
 const page=await context.newPage(),errors=[];let mode='pdf',requests=0;page.on('pageerror',e=>errors.push(e.message));
 await context.route(/^https:\/\/drive(?:\.usercontent)?\.google\.com\//,async route=>{
  requests++;assert.equal(route.request().headers()['cookie'],undefined);
  if(mode==='cors'){await route.abort('blockedbyclient');return;}
  if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1200));
  const audio=mode==='audio',body=mode==='html'?Buffer.from('<html>Google Drive confirmation</html>'):audio?mp3Bytes:mode==='pdf'?pdfBytes:pdfBytes.subarray(0,512);
  await route.fulfill({status:200,headers:{'content-type':mode==='html'?'text/html':audio?'audio/mpeg':'application/pdf',...(mode==='cors'?{}:{'access-control-allow-origin':'*'})},body}).catch(()=>{});
 });
 const status=()=>page.locator('#download-status').textContent();
 async function submit(kind='pdf',url='https://drive.google.com/file/d/test_file_123456789/view'){
  await page.locator('#kind').selectOption(kind);await page.locator('#drive-link').fill(url);await page.locator('#download').click();
 }
 async function saved(){return page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('assimil-drive-download-test',1);r.onsuccess=()=>resolve(r.result);});const r=db.transaction('files').objectStore('files').getAll();const v=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));db.close();return v;});}
 async function mainState(){return page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('german-study',1);r.onsuccess=()=>resolve(r.result);});const r=db.transaction('state').objectStore('state').getAll();const v=await new Promise(resolve=>r.onsuccess=()=>resolve(r.result));db.close();return v;});}
 try{
  await page.goto(probeURL);await page.waitForFunction(()=>!document.getElementById('download').disabled);
  await page.evaluate(async()=>{
   const db=await new Promise(resolve=>{const r=indexedDB.open('german-study',1);r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('files',{keyPath:'id'});r.result.createObjectStore('blobs');};r.onsuccess=()=>resolve(r.result);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({lesson:12,step:4,completions:{completed:[1,2],days:{}}},'progress');tx.objectStore('state').put({segments:{saved:[{start:6.25,end:7.85,needsReview:false}]}},'course');tx.oncomplete=resolve;tx.onerror=reject;});db.close();
   if(navigator.storage.getDirectory){const root=await navigator.storage.getDirectory(),f=await root.getFileHandle('main-storage-sentinel',{create:true}),w=await f.createWritable();await w.write('existing media untouched');await w.close();}
   const scope=new URL('../dist/',location.href);await navigator.serviceWorker.register(new URL('sw.js',scope),{scope:scope.href});
  });
  const mainBefore=await mainState();
  await submit('audio','https://drive.google.com/drive/folders/test_folder_123456789');assert.match(await status(),/folder link/);assert.equal(requests,0);
  mode='cors';await submit();await page.waitForFunction(()=>document.getElementById('download-status').textContent.startsWith('The browser could not read'));assert.equal((await saved()).length,0);assert.equal(requests,2);
  mode='html';await submit();await page.waitForFunction(()=>document.getElementById('download-status').textContent.includes('web page instead'));assert.equal((await saved()).length,0);
  mode='wrong';await submit('audio');await page.waitForFunction(()=>document.getElementById('download-status').textContent.includes('not a MP3'));assert.equal((await saved()).length,0);
  mode='pdf';await submit();await page.waitForFunction(()=>document.getElementById('download-status').textContent.startsWith('Download and save passed'),null,{timeout:60000});let files=await saved();assert.equal(files.length,1);assert.equal(files[0].size,pdfBytes.length);assert.equal(files[0].backend,fallback?'idb':'opfs');
  const pdfFile=files[0];mode='slow';await submit();await page.locator('#cancel').click();await page.waitForFunction(()=>document.getElementById('download-status').textContent==='Download cancelled.');assert.deepEqual(await saved(),[pdfFile]);await page.waitForTimeout(1400);
  mode='audio';await submit('audio');await page.waitForFunction(()=>document.getElementById('download-status').textContent.startsWith('Download and save passed'));assert.equal((await saved()).length,2);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='Test page available offline');const mainSW=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(new URL('../dist/',location.href));return r?.scope;});assert.match(mainSW,/\/dist\/$/);
  const requestCount=requests;await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!document.getElementById('download').disabled);await page.waitForFunction(()=>document.getElementById('offline-status').textContent==='Test page available offline');assert.equal((await saved()).length,2);
  await page.locator('[data-kind=pdf]').click();assert.match(await page.locator('#pdf').getAttribute('src'),/^blob:/);assert(await page.locator('#pdf').isVisible());
  await page.locator('[data-kind=audio]').click();await page.waitForFunction(()=>document.getElementById('audio').readyState>=1);assert((await page.locator('#audio').evaluate(p=>p.duration))>60);await page.locator('#audio').evaluate(p=>p.play());await page.waitForTimeout(250);assert((await page.locator('#audio').evaluate(p=>p.currentTime))>0);assert.equal(requests,requestCount);
  await page.locator('#clear').click();await page.waitForFunction(()=>document.getElementById('download-status').textContent.startsWith('Test downloads removed'));assert.equal((await saved()).length,0);assert.deepEqual(await mainState(),mainBefore);
  if(!fallback){const contents=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();return {main:await(await(await root.getFileHandle('main-storage-sentinel')).getFile()).text(),test:Array.fromAsync?await Array.fromAsync((await root.getDirectoryHandle('assimil-drive-download-test')).keys()):[]};});assert.equal(contents.main,'existing media untouched');assert.deepEqual(contents.test,[]);}
  assert.deepEqual(errors,[]);console.log(`${fallback?'IndexedDB':'OPFS'}: Blocked requests/HTML/wrong media rejected; full ${Math.round(pdfBytes.length/1048576)} MB PDF + MP3 saved; cancellation retains previous file; offline preview/playback and cleanup preserve main study data and worker.`);
 }catch(error){console.log('Debug',await status(),await page.locator('#test-log').textContent(),requests);throw error;}finally{await context.close();}
}
try{await run();await run(true);}finally{await browser.close();}
