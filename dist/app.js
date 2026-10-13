import {setupFloatingUI} from './floating-ui.js';
import {setupOffline} from './updates.js';
import {connectStudy} from './study.js';
import {fingerprintCandidates,matchedSource,matchedAudio,matchedCombinedBook} from './course-data.js';
import {hashFile} from './file-hash.js';
import {connectStepTimer,validateDurations} from './step-timer.js';
import {emptyCompletions,validateCompletions,recordCompletion} from './completions.js';
import {connectProgressView} from './progress-view.js';
import {playbackFailure} from './audio-tools.js';
const $ = id => document.getElementById(id);
setupFloatingUI();
const steps = [
  ['Review','Listen to the previous two or three lessons. Tap Play review to listen to them in order.',''],
  ['Blind listening','Listen to the new lesson twice without looking at the book.','Each listen includes both recorded readings when present. Playback stops after the second listen.'],
  ['Understand','Open the book and read the German, English translation, and notes.',''],
  ['Read along','Play the lesson while following the German text in your book.',''],
  ['Shadowing','Listen to one sentence, then repeat it aloud. After that, speak with the audio—with the text, then without.',''],
  ['Read aloud & exercises','Read the German text aloud, then complete the lesson’s exercises.',''],
  ['Write','Keep your book open and copy the sentences by hand on paper.',''],
  ['Recall','Look at the English and try to say the German from memory.','']
];
let study,stepTimer,progressView,finishingLesson=false;
let db, library = [], progress = {lesson:1,step:0,tracks:{},completions:emptyCompletions()}, audioUrl, bookUrl, saveQueue = Promise.resolve();
let activeAudioId = '', playbackRequest = 0, noticeTimer;
let courseIndex = null;
let layoutProfile;
const size = bytes => bytes < 1048576 ? `${(bytes/1024).toFixed(0)} KB` : `${(bytes/1048576).toFixed(1)} MB`;
function notice(message) { clearTimeout(noticeTimer); $('notice').textContent=message; $('notice').hidden=false; noticeTimer=setTimeout(()=>$('notice').hidden=true,7000); }
function showTab(tab) { if (!['study','progress','library','settings','setup'].includes(tab)) tab='study'; document.body.dataset.view=tab;document.querySelectorAll('.tab').forEach(el=>el.hidden=el.id!==tab); document.querySelectorAll('[data-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab)); $('lesson-controls').hidden=$('step-navigation').hidden=$('step-timer').hidden=tab!=='study';$('return-study').hidden=tab==='study';$('app-menu').open=false; history.replaceState(null,'',`#${tab}`);document.dispatchEvent(new Event('study-navigation')); }
document.querySelectorAll('[data-tab],[data-go]').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab||el.dataset.go)));
function openDB() { return new Promise((resolve,reject)=>{const req=indexedDB.open('german-study',1); req.onupgradeneeded=()=>{const d=req.result; d.createObjectStore('files',{keyPath:'id'}); d.createObjectStore('blobs'); d.createObjectStore('state');}; req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close(); resolve(req.result);}; req.onerror=()=>reject(req.error);}); }
function operation(store, mode, fn) { return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode); let result; try { const req=fn(tx.objectStore(store)); if(req)req.onsuccess=()=>result=req.result; }catch(e){reject(e);return;} tx.oncomplete=()=>resolve(result); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('Storage operation interrupted.'));}); }
const read = (store,key) => operation(store,'readonly',s=>s.get(key));
const write = (store,key,value) => operation(store,'readwrite',s=>s.put(value,key));
async function rootDirectory() { if(!navigator.storage?.getDirectory) return null; try{return await navigator.storage.getDirectory();}catch{return null;} }
async function getFile(meta) { if(meta.backend==='opfs'){const root=await rootDirectory(); if(!root)throw new Error('Stored file storage is unavailable. Reimport this file.');return (await root.getFileHandle(meta.id)).getFile();} const blob=await read('blobs',meta.id); if(!blob)throw new Error('This stored file is missing. Reimport it from your originals.');return blob; }
function fileKind(file) { if(file.type==='application/pdf'||/\.pdf$/i.test(file.name))return 'pdf'; if(file.type.startsWith('audio/')||/\.(mp3|m4a|wav|aac|ogg|flac|aiff|aif)$/i.test(file.name))return 'audio'; return null; }
function lessonFromFilename(name) { const match=name.match(/^(?:L|LESSON[\s_-]*)(\d{1,4})(?=[\s_.-]|$)/i);if(!match)return null;const lesson=Number(match[1]);return lesson>=1&&lesson<=9999?lesson:null; }
function matchRecordings() { let changed=false;for(const file of library.filter(x=>x.kind==='audio').sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))){const lesson=matchedAudio(courseIndex,file)?.number||lessonFromFilename(file.name);if(lesson&&!(lesson in progress.tracks)){progress.tracks[lesson]=file.id;changed=true;}}return changed; }
async function fingerprint(file,meta){
  if(meta.sha256||(meta.kind!=='pdf'&&!fingerprintCandidates(courseIndex,meta.kind,meta.size).length))return false;
  meta.sha256=await hashFile(file);
  return true;
}
async function verifyPendingBooks(){
  const signature=courseIndex?.book.combinedLayoutSignature;
  if(!study||!signature)return;
  for(const meta of library.filter(file=>file.kind==='pdf'&&!matchedSource(courseIndex,file)&&!matchedCombinedBook(courseIndex,file)&&file.checkedBookLayout!==signature)){
    try{
      $('import-status').textContent=`Checking lesson pages in ${meta.name}… Keep the app open.`;
      if(!layoutProfile){
        const response=await fetch('./combined-layout.json');if(!response.ok)throw new Error('Book matching data could not load. Reopen online to finish updating.');
        const profile=await response.json();
        if(profile.courseId!==courseIndex.courseId||profile.layoutSignature!==signature)throw new Error('Book matching data is out of date. Check for updates and reload.');
        layoutProfile=profile;
      }
      meta.verifiedBookLayout=await study.verifyBook(meta,layoutProfile,{onProgress:(page,total)=>{
        if(page===1||page%10===0||page===total)$('import-status').textContent=`Checking book page ${page} of ${total}… Keep the app open.`;
      }});
      meta.checkedBookLayout=signature;delete meta.bookMappingError;
      await operation('files','readwrite',store=>store.put(meta));
      $('import-status').textContent='Full book matched. Lesson pages are ready and saved on this device.';
    }catch(error){
      if(error.name==='BookLayoutMismatch'){
        meta.checkedBookLayout=signature;meta.bookMappingError=error.message;delete meta.verifiedBookLayout;
        await operation('files','readwrite',store=>store.put(meta));
      }
      $('import-status').textContent=error.message;notice(error.message);
    }
  }
}
function contentType(file,kind) { if(file.type)return file.type; if(kind==='pdf')return 'application/pdf'; const ext=file.name.split('.').pop().toLowerCase(); return ({mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac',aiff:'audio/aiff',aif:'audio/aiff'})[ext]||'application/octet-stream'; }
async function storeFile(file) {
  const kind=fileKind(file); if(!kind)throw new Error(`Unsupported file: ${file.name}`); if(file.size===0)throw new Error(`${file.name} is empty.`);
  const existing=library.find(x=>x.name===file.name&&x.size===file.size&&x.modified===file.lastModified);
  if(existing){try{await getFile(existing);return false;}catch{/* Replace a missing file by saving a new copy. */}}
  const meta={id:crypto.randomUUID(),name:file.name,size:file.size,type:contentType(file,kind),kind,modified:file.lastModified};
  await fingerprint(file,meta);
  const duplicate=meta.sha256&&library.find(saved=>saved.sha256===meta.sha256&&saved.kind===kind&&saved.size===meta.size);
  if(duplicate){try{await getFile(duplicate);return false;}catch{/* Save a replacement for unavailable media. */}}
  const root=await rootDirectory();
  if(root){
    let writer;
    try{const handle=await root.getFileHandle(meta.id,{create:true}); if(typeof handle.createWritable!=='function'){await root.removeEntry(meta.id);meta.backend='idb';}else{writer=await handle.createWritable();await file.stream().pipeTo(writer);meta.backend='opfs';await operation('files','readwrite',s=>s.put(meta));}}
    catch(error){try{await root.removeEntry(meta.id);}catch{} throw error;}
  }else meta.backend='idb';
  if(meta.backend==='idb')await new Promise((resolve,reject)=>{const tx=db.transaction(['files','blobs'],'readwrite');tx.objectStore('files').put(meta);tx.objectStore('blobs').put(file,meta.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('File import interrupted.'));});
  if(existing)await deleteFile(existing);
  library.push(meta); return true;
}
async function deleteFile(meta) {
  // Delete metadata after the file operation succeeds, so failed deletion remains visible.
  if(meta.backend==='opfs'){const root=await rootDirectory();if(!root)throw new Error('File storage is unavailable. Try reopening the app.');try{await root.removeEntry(meta.id);}catch(e){if(e.name!=='NotFoundError')throw e;}}
  await new Promise((resolve,reject)=>{const tx=db.transaction(['files','blobs'],'readwrite');tx.objectStore('files').delete(meta.id);tx.objectStore('blobs').delete(meta.id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
  library=library.filter(x=>x.id!==meta.id);for(const lesson of Object.keys(progress.tracks))if(progress.tracks[lesson]===meta.id)delete progress.tracks[lesson];
  if(activeAudioId===meta.id){$('player').pause();$('player').removeAttribute('src');$('player').load();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;activeAudioId='';playbackRequest++;}
  await saveProgress();
}
function saveProgress() { const snapshot=structuredClone(progress);$('save-status').textContent='Saving…';const attempt=saveQueue.then(()=>write('state','progress',snapshot));saveQueue=attempt.catch(()=>{});return attempt.then(()=>$('save-status').textContent='Saved on device').catch(error=>{$('save-status').textContent='Save failed';notice('Could not save your place. Export progress and check device storage.');throw error;}); }
function renderProgress() {
  stepTimer?.update();
  progressView?.update();
  study?.update().catch(e=>notice(e.message));
  $('lesson').value=progress.lesson; $('lesson-back').disabled=progress.lesson<=1;$('lesson-next').disabled=progress.lesson>=9999;
  const title=courseIndex?.lessons.find(lesson=>lesson.number===progress.lesson)?.title;
  $('lesson-title').textContent=title?`${progress.lesson} ${title}`:`Lesson ${progress.lesson}`;
  $('step-count').textContent=`STEP ${progress.step+1} OF ${steps.length}`;$('step-title').textContent=steps[progress.step][0];$('step-instruction').textContent=steps[progress.step][1];$('step-note').textContent=steps[progress.step][2];$('previous').disabled=progress.step===0;$('next').textContent=progress.step===7?'Finish lesson →':'Next step →';
  if(!$('step-dots').children.length)$('step-dots').replaceChildren(...steps.map(([title],i)=>{const b=document.createElement('button');b.setAttribute('aria-label',`Step ${i+1}: ${title}`);b.addEventListener('click',()=>{progress.step=i;renderProgress();saveProgress().catch(()=>{});});return b;}));
  [...$('step-dots').children].forEach((button,i)=>{button.className=i===progress.step?'current':i<progress.step?'past':'';if(i===progress.step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
}
async function changeLesson(value) { const lesson=Number(value);if(!Number.isInteger(lesson)||lesson<1||lesson>9999){$('lesson').value=progress.lesson;notice('Enter a lesson number from 1 to 9999.');return;}if(lesson===progress.lesson)return;progress.lesson=lesson;progress.step=0;renderProgress();window.scrollTo({top:0,behavior:'smooth'});renderAudioOptions();await Promise.all([saveProgress(),loadAudio(progress.tracks[lesson]||'')]); }
$('lesson').addEventListener('change',e=>changeLesson(e.target.value).catch(e=>notice(e.message)));
$('lesson-back').addEventListener('click',()=>changeLesson(progress.lesson-1).catch(e=>notice(e.message)));
$('lesson-next').addEventListener('click',()=>changeLesson(progress.lesson+1).catch(e=>notice(e.message)));
$('previous').addEventListener('click',()=>{progress.step=Math.max(0,progress.step-1);renderProgress();window.scrollTo({top:0,behavior:'smooth'});saveProgress().catch(()=>{});});
$('next').addEventListener('click',async()=>{
  if(finishingLesson)return;
  if(progress.step!==7){progress.step++;renderProgress();window.scrollTo({top:0,behavior:'smooth'});saveProgress().catch(()=>{});return;}
  finishingLesson=true;$('next').disabled=true;
  try{await finishLesson();}catch{notice('Could not save lesson completion. Your place has been kept.');}
  finally{finishingLesson=false;$('next').disabled=false;}
});
async function finishLesson(){
  const before=structuredClone(progress),lesson=progress.lesson,atEnd=lesson===(courseIndex?.book.lessonCount||100)||lesson===9999;
  // One saved record contains both completion history and the next study position.
  progress={...progress,completions:recordCompletion(progress.completions,lesson),lesson:atEnd?lesson:lesson+1,step:atEnd?7:0};
  try{await saveProgress();}catch(error){progress=before;renderProgress();throw error;}
  renderProgress();renderAudioOptions();await loadAudio(progress.tracks[progress.lesson]||'');window.scrollTo({top:0,behavior:'smooth'});
  if(atEnd)showTab('progress');notice(`Lesson ${lesson} completed.`);
}
async function setCompletionHistory(history){
  const before=progress.completions;progress.completions=validateCompletions(history);
  try{await saveProgress();}catch(error){progress.completions=before;progressView?.update();throw error;}
  progressView?.update();
}
function renderAudioOptions(){const files=library.filter(x=>x.kind==='audio').sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));$('audio-select').replaceChildren(new Option(files.length?'Choose a recording…':'Import audio to begin',''),...files.map(x=>new Option(x.name,x.id)));$('audio-select').value=progress.tracks[progress.lesson]||'';}
async function loadAudio(id){const request=++playbackRequest;$('player').pause();$('player').removeAttribute('src');$('player').load();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=null;activeAudioId='';const meta=library.find(x=>x.id===id);if(!meta){$('audio-info').textContent='No audio selected.';return;}$('audio-info').textContent='Opening stored recording…';try{const file=await getFile(meta);if(request!==playbackRequest)return;audioUrl=URL.createObjectURL(file.type===meta.type?file:file.slice(0,file.size,meta.type));activeAudioId=id;$('player').src=audioUrl;document.dispatchEvent(new CustomEvent('audio-loaded',{detail:{id}}));$('audio-info').textContent=`Stored on this device · ${size(meta.size)}`;}catch(e){if(request===playbackRequest){$('audio-info').textContent='Recording unavailable. Reimport it from your originals.';notice(e.message);}}}
$('audio-select').addEventListener('change',async e=>{const id=e.target.value;study?.stopSession();progress.tracks[progress.lesson]=id;try{await Promise.all([saveProgress(),loadAudio(id)]);}catch(e){notice(e.message);}});
$('repeat').addEventListener('change',e=>$('player').loop=e.target.checked);
$('player').addEventListener('error',()=>{const failure=playbackFailure($('player'));if(failure)notice(failure.message);});
async function renderLibrary(){if(matchRecordings())await saveProgress();renderAudioOptions();if((progress.tracks[progress.lesson]||'')!==activeAudioId)await loadAudio(progress.tracks[progress.lesson]||'');$('file-total').textContent=`${library.length} ${library.length===1?'file':'files'} · ${size(library.reduce((s,x)=>s+x.size,0))}`;$('empty-library').hidden=library.length>0;
  $('file-list').replaceChildren(...[...library].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(meta=>{const li=document.createElement('li'),icon=document.createElement('span'),detail=document.createElement('div'),name=document.createElement('span'),info=document.createElement('span'),remove=document.createElement('button');icon.className='file-type';icon.textContent=meta.kind==='pdf'?'PDF':'♫';detail.className='file-detail';name.className='file-name';name.textContent=meta.name;info.className='file-meta';const lesson=meta.kind==='audio'?(matchedAudio(courseIndex,meta)?.number||lessonFromFilename(meta.name)):null;info.textContent=`${size(meta.size)} · Stored${lesson?` · Lesson ${lesson}`:matchedCombinedBook(courseIndex,meta)?' · Full book matched':meta.bookMappingError?' · Custom page setup needed':''}`;detail.append(name,info);remove.className='remove';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${meta.name}`);remove.addEventListener('click',async()=>{if(!confirm(`Remove ${meta.name} from this device? You can import your original again.`))return;remove.disabled=true;try{await deleteFile(meta);await renderLibrary();}catch(e){notice(e.message);remove.disabled=false;}});li.append(icon,detail,remove);return li;}));
  const pdf=library.find(x=>x.kind==='pdf');$('open-book').disabled=!pdf;
  const bookCount=new Set(library.map(x=>matchedSource(courseIndex,x)?.id).filter(Boolean)).size,audioCount=new Set(library.map(x=>matchedAudio(courseIndex,x)?.number).filter(Boolean)).size;
  const bookStatus=library.some(file=>matchedCombinedBook(courseIndex,file))?'Full book matched':bookCount===3?'Book matched':`${bookCount} of 3 book parts matched`;
  $('course-import-status').textContent=courseIndex?`${bookStatus} · ${audioCount} of 100 prepared recordings matched.`:'Prepared course data unavailable. Reopen online to finish setup.';
  $('materials-prompt').hidden=library.length>0;$('materials-prompt-text').textContent='Add your full book PDF and a few recordings once to begin.';
  study?.update().catch(e=>notice(e.message));
  if(navigator.storage?.estimate){try{const estimate=await navigator.storage.estimate();$('storage-info').textContent=`${size(estimate.usage||0)} used${estimate.quota?` of approximately ${size(estimate.quota)} browser storage`:''}. Available capacity can change.`;}catch{$('storage-info').textContent='Storage estimates are unavailable in this browser.';}}else $('storage-info').textContent='Storage estimates are unavailable in this browser.';
}
$('file-input').addEventListener('change',async e=>{const files=[...e.target.files];if(!files.length)return;e.target.disabled=true;let imported=0,skipped=0,failed=0;for(let i=0;i<files.length;i++){const file=files[i];$('import-status').textContent=`Saving ${i+1} of ${files.length}: ${file.name} (${size(file.size)})…`;try{if(await storeFile(file))imported++;else skipped++;await verifyPendingBooks();await renderLibrary();}catch(error){failed++;notice(error.name==='QuotaExceededError'?'Not enough browser storage. Keep the files already imported and try a smaller batch.':`Could not import ${file.name}: ${error.message}`);if(error.name==='QuotaExceededError'){failed+=files.length-i-1;break;}}}$('import-status').textContent=`${imported} stored · ${skipped} already stored · ${failed} not imported. Keep this app installed and your originals backed up.`;e.target.value='';e.target.disabled=false;});
$('open-book').addEventListener('click',async()=>{const pdf=library.find(x=>x.kind==='pdf');if(!pdf)return; // Open synchronously to preserve the user gesture on iOS.
  const tab=window.open('about:blank','_blank');if(!tab){notice('Allow opening a new tab to view your stored PDF.');return;}tab.document.title='Opening your stored book';tab.document.body.textContent='Opening your stored PDF…';try{const file=await getFile(pdf);if(bookUrl)URL.revokeObjectURL(bookUrl);bookUrl=URL.createObjectURL(file.type==='application/pdf'?file:file.slice(0,file.size,'application/pdf'));tab.location.replace(bookUrl);}catch(e){tab.close();notice(e.message);}});
$('persist').addEventListener('click',async()=>{if(!navigator.storage?.persist){$('persist-info').textContent='This browser does not offer storage protection. Keep originals and export your progress.';return;}try{const granted=await navigator.storage.persist();$('persist-info').textContent=granted?'Storage protection granted. Clearing website data or removing the app can still remove your files.':'Storage protection was not granted. You can still use the app; keep originals and export progress.';}catch{$('persist-info').textContent='Storage protection could not be requested. Keep originals and export progress.';}});
function download(data,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('export').addEventListener('click',()=>{const tracks=Object.entries(progress.tracks).flatMap(([lesson,id])=>{const file=library.find(x=>x.id===id);return file?[{lesson:Number(lesson),name:file.name,size:file.size}]:[];});download({format:'german-study-progress',version:2,lesson:progress.lesson,step:progress.step,tracks,course:study?.exportCourse(),timer:stepTimer?.exportSettings(),completions:structuredClone(progress.completions)},'german-study-progress.json');});
$('restore').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>16777216)throw new Error('Choose a small progress JSON backup, not study materials.');const data=JSON.parse(await file.text());if(data.format!=='german-study-progress'||![1,2].includes(data.version)||!Number.isInteger(data.lesson)||data.lesson<1||data.lesson>9999||!Number.isInteger(data.step)||data.step<0||data.step>=steps.length||!Array.isArray(data.tracks))throw new Error('This is not a supported progress backup.');const timerLengths=data.timer===undefined?null:validateDurations(data.timer?.durations);const completionHistory=data.completions===undefined?null:validateCompletions(data.completions);const tracks={};let missing=0;for(const t of data.tracks){if(!Number.isInteger(t.lesson)||t.lesson<1||t.lesson>9999||typeof t.name!=='string'||!Number.isFinite(t.size))throw new Error('Invalid track data in backup.');const match=library.find(x=>x.kind==='audio'&&x.name===t.name&&x.size===t.size);if(match)tracks[t.lesson]=match.id;else missing++;}await study?.restoreCourse(data.course);progress={lesson:data.lesson,step:data.step,tracks,completions:completionHistory||progress.completions};if(timerLengths)await stepTimer?.restoreSettings(timerLengths);await saveProgress();renderProgress();await renderLibrary();await loadAudio(tracks[progress.lesson]||'');notice(`Progress restored.${missing?' Reimport missing recordings to reconnect track choices.':''}`);}catch(error){notice(error.message);}finally{e.target.value='';}});
async function init(){$('file-input').disabled=true;showTab(location.hash.slice(1)||'study');try{db=await openDB();const stored=await read('state','progress');if(stored&&Number.isInteger(stored.lesson)&&stored.lesson>0&&stored.lesson<=9999&&Number.isInteger(stored.step)&&stored.step>=0&&stored.step<steps.length)progress={...stored,tracks:stored.tracks||{},completions:stored.completions?validateCompletions(stored.completions):emptyCompletions()};library=await operation('files','readonly',s=>s.getAll());try{const response=await fetch('./course-index.json');if(!response.ok)throw new Error('Course unavailable');courseIndex=await response.json();}catch{notice('Prepared lessons could not load. Reopen online to finish updating.');}for(const meta of library){try{if(!meta.sha256&&(meta.kind==='pdf'||fingerprintCandidates(courseIndex,meta.kind,meta.size).length)&&await fingerprint(await getFile(meta),meta))await operation('files','readwrite',store=>store.put(meta));}catch{notice(`Could not verify ${meta.name}. Reimport it if automatic setup is unavailable.`);}}renderProgress();await renderLibrary();await loadAudio(progress.tracks[progress.lesson]||'');study=await connectStudy({getIndex:()=>courseIndex,getProgress:()=>progress,getLibrary:()=>library,getActiveAudioId:()=>activeAudioId,getFile,read,write,loadAudio,saveProgress,notice});await verifyPendingBooks();await renderLibrary();await study.update();stepTimer=await connectStepTimer({steps,getProgress:()=>progress,read,write,notice});progressView=connectProgressView({steps,getIndex:()=>courseIndex,getProgress:()=>progress,getHistory:()=>progress.completions,setHistory:setCompletionHistory});$('file-input').disabled=false;$('save-status').textContent='Saved on device';await saveProgress();}catch(e){$('save-status').textContent='Storage unavailable';notice('Device storage could not be opened. Avoid Private Browsing and try reopening.');document.querySelectorAll('button,input,select').forEach(el=>{if(!el.dataset.tab&&!el.dataset.go)el.disabled=true;});}setupOffline({beforeReload:async()=>{if($('file-input').disabled)throw new Error('Wait for the file import to finish before reloading.');study?.stopSession();if(db)await saveProgress();await study?.flush();await stepTimer?.flush();}});}
init();
