import {BookReader,validateCrop} from './pdf-reader.js';
import {detectSegments,validateSegments,parseSegments,formatTime} from './audio-tools.js';
import {matchedAudio,matchedSource,matchedCombinedBook,lessonPages,preparedSentences} from './course-data.js';
import {verifyBookLayout} from './book-layout.js';
const $=id=>document.getElementById(id);
const fullCrop={x:0,y:0,w:1,h:1};

export async function connectStudy(api){
  let course=await api.read('state','course')||{books:{},segments:{},rate:1};
  course.books ||= {};course.segments ||= {};course.segmentMode ||= {};course.rate=Number(course.rate)||1;
  let courseQueue=Promise.resolve(),generation=0,openedId='',opening=null,currentMap=null,editingEnglish=false,draftCrop={...fullCrop},segmentIndex=0,session=null,boundaryTimer,gapTimer,analysisGeneration=0,activeAnalysisTicket=0,stepKey='',shadowMode='sentence';
  const player=$('player');
  $('audio-select').insertAdjacentHTML('afterend',`<label class="field speed-field">Playback speed<select id="speed"><option value="0.75">0.75×</option><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.1">1.1×</option><option value="1.25">1.25×</option></select></label>`);
  $('player').insertAdjacentHTML('beforebegin',`<div id="routine-audio"><div id="review-controls" hidden><details><summary>Review options</summary><label class="field">Previous lessons<select id="review-count"><option value="3">Last three</option><option value="2">Last two</option></select></label></details><p id="review-list" class="note"></p><button id="start-review" class="primary">Play review</button></div><div id="blind-controls" hidden><button id="start-blind" class="primary">Listen twice</button><p id="blind-status" class="note" role="status">Two listens, with the book hidden.</p></div><div id="shadow-controls" hidden><label class="field">Practice mode<select id="shadow-mode"><option value="sentence">Pause & repeat each sentence</option><option value="with">Speak along with text</option><option value="without">Speak along without text</option></select></label><div id="sentence-controls"><p id="sentence-status" class="note" role="status"></p><div class="sentence-actions"><button id="sentence-back" class="secondary" aria-label="Previous sentence">←</button><button id="sentence-play" class="primary">Repeat sentence</button><button id="sentence-next" class="secondary" aria-label="Next sentence">→</button></div><details><summary>Practice options</summary><label class="check"><input id="sentence-auto" type="checkbox"> Continue after a pause</label><label class="field">Time to repeat<select id="sentence-gap"><option value="match">Length of the sentence</option><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="8">8 seconds</option></select></label><div id="sentence-list" class="sentence-list"></div><details id="timing-editor"><summary>Adjust sentence boundaries</summary><p class="note">Times are seconds: one start, end pair per line. Adjust a cut if it interrupts a sentence. Timings save on this device.</p><textarea id="timing-text" rows="7" aria-label="Sentence start and end times" placeholder="0.00, 3.20\n3.60, 6.10"></textarea><div class="backup-actions"><button id="save-timings" class="secondary">Save timings</button><button id="mark-boundary" class="secondary">Split at playhead</button></div></details><button id="use-saved-timings" class="text-button" hidden>Use saved custom timings</button><button id="use-prepared" class="text-button" hidden>Use prepared sentence timings</button><button id="detect-sentences" class="text-button">Detect pauses for a different recording</button></details></div></div><p id="play-status" class="note" role="status"></p></div>`);
  $('book-card').insertAdjacentHTML('beforeend',`<details id="manual-book"><summary>Book options</summary><button id="prepared-book" class="text-button">Use automatically matched pages</button><div class="reader-tools"><label class="field">Book<select id="book-select"></select></label><label class="check"><input id="spread" type="checkbox" checked> Two-page view in landscape</label><button id="configure-pages" class="text-button">Set lesson pages</button></div><details id="page-settings"><summary>Lesson pages & English area</summary><p class="note">Use PDF page numbers, which may differ from printed book numbers. Set a lesson once; later lessons can follow the same page pattern.</p><div class="page-fields"><label class="field">First page<input id="page-start" type="number" min="1" value="1"></label><label class="field">Last page<input id="page-end" type="number" min="1" value="2"></label><label class="field">English page<input id="english-page" type="number" min="1" value="2"></label></div><label class="check"><input id="page-pattern" type="checkbox"> Estimate other lessons using this page count</label><div class="backup-actions"><button id="preview-pages" class="secondary">Preview pages</button><button id="save-pages" class="primary">Save lesson pages</button></div><hr><p class="note">Choose the English page above, then select only the translation area. This works with scanned pages and needs no text recognition.</p><div class="backup-actions"><button id="select-english" class="secondary">Select English area</button><button id="reset-crop" class="secondary">Use whole English page</button><button id="save-crop" class="primary" disabled>Save English area</button></div><label class="check"><input id="reuse-crop" type="checkbox" checked> Use this English layout for other lessons</label><p id="mapping-status" class="note" role="status"></p></details></details><div id="recall-controls" hidden><button id="reveal-german" class="secondary">Show German to check</button><p class="note">Try saying the German before revealing the full lesson.</p></div><p id="reader-status" class="note" role="status"></p><div id="pdf-pages" class="pdf-pages"></div>`);
  document.body.insertAdjacentHTML('beforeend',`<div id="mini-player" hidden><button id="mini-play" class="primary" aria-label="Play recording">▶</button><div><span id="mini-title"></span><small id="mini-time">0:00</small></div><button id="mini-repeat" class="secondary" aria-label="Repeat current sentence or recording">↺</button></div>`);
  $('book-card').append($('manual-book'));
  const reader=new BookReader($('pdf-pages'),$('reader-status'));
  let recallRevealed=false;
  const getBook=()=>api.getLibrary().find(x=>x.id===course.activeBook&&x.kind==='pdf')||api.getLibrary().find(x=>x.kind==='pdf');
  const bookSettings=()=>{const book=getBook();if(!book)return null;return course.books[book.id] ||= {pages:{}};};
  const audioLesson=()=>matchedAudio(api.getIndex(),api.getLibrary().find(file=>file.id===api.getActiveAudioId()));
  const sentences=()=>{const id=api.getActiveAudioId(),prepared=preparedSentences(audioLesson());return course.segmentMode[id]==='custom'&&course.segments[id]?course.segments[id]:prepared.length?prepared:course.segments[id]||[];};
  const preparedPlan=recall=>lessonPages(api.getIndex(),api.getLibrary(),api.getProgress().lesson,recall);
  const hasPreparedBook=()=>api.getLibrary().some(file=>matchedSource(api.getIndex(),file)||matchedCombinedBook(api.getIndex(),file));
  const dialogue=id=>matchedAudio(api.getIndex(),api.getLibrary().find(file=>file.id===id))?.audio.dialogue||{start:0,end:player.duration};
  function saveCourse(){const snapshot=structuredClone(course);const attempt=courseQueue.then(()=>api.write('state','course',snapshot));courseQueue=attempt.catch(()=>{});return attempt.catch(error=>{api.notice('Could not save lesson setup. Check storage and export a backup.');throw error;});}
  function mapping(lesson){const settings=bookSettings();if(!settings)return null;if(settings.pages?.[lesson])return {...settings.pages[lesson],estimated:false};if(settings.pattern){const {baseLesson,basePage,span}=settings.pattern;const start=basePage+(lesson-baseLesson)*span;if(start<1)return null;const layout=settings.layout||{offset:Math.min(1,span-1),crop:fullCrop};return {start,end:start+span-1,englishPage:start+layout.offset,crop:layout.crop,estimated:true};}return null;}
  function stopSession(){session=null;clearTimeout(boundaryTimer);clearTimeout(gapTimer);$('play-status').textContent='';player.pause();}
  function reviewTracks(){const p=api.getProgress(),n=Number($('review-count').value);return Array.from({length:Math.min(n,p.lesson-1)},(_,i)=>p.lesson-Math.min(n,p.lesson-1)+i).map(lesson=>({lesson,file:api.getLibrary().find(x=>x.id===p.tracks[lesson]&&x.kind==='audio')}));}
  function refreshReview(){const tracks=reviewTracks();$('review-list').textContent=tracks.length?tracks.map(x=>`Lesson ${x.lesson}${x.file?'':' (recording not imported)'}`).join(' · '):'This is your first lesson. Continue to blind listening.';$('start-review').disabled=!tracks.some(x=>x.file);}
  function refreshSentences(){const spans=sentences();segmentIndex=Math.min(segmentIndex,Math.max(0,spans.length-1));const current=spans[segmentIndex];$('sentence-status').textContent=!current&&$('detect-sentences').disabled?'Finding pauses on this device…':current?`Sentence ${segmentIndex+1} of ${spans.length}${current.needsReview?' · Draft cut: check where it pauses.':course.segmentMode[api.getActiveAudioId()]!=='custom'&&audioLesson()?.audio.sentenceAlignment.status==='needs-review'?' · Prepared cuts need a listening check.':''}`:'No prepared cuts for this recording. Pause manually, or add timings in Practice options.';$('sentence-play').disabled=!current;$('sentence-back').disabled=!current||segmentIndex===0;$('sentence-next').disabled=!current||segmentIndex===spans.length-1;$('sentence-list').replaceChildren(...spans.map((span,i)=>{const button=document.createElement('button');button.textContent=String(i+1);button.className=i===segmentIndex?'selected':'';button.setAttribute('aria-label',`Sentence ${i+1}, ${formatTime(span.start)} to ${formatTime(span.end)}`);button.addEventListener('click',()=>{stopSession();segmentIndex=i;refreshSentences();});return button;}));$('use-prepared').hidden=!audioLesson();$('use-saved-timings').hidden=!audioLesson()||!course.segments[api.getActiveAudioId()]||course.segmentMode[api.getActiveAudioId()]==='custom';$('detect-sentences').hidden=!!audioLesson();if(document.activeElement!==$('timing-text'))$('timing-text').value=spans.map(x=>`${x.start.toFixed(2)}, ${x.end.toFixed(2)}`).join('\n');}
  function mini(){const file=api.getLibrary().find(x=>x.id===api.getActiveAudioId());$('mini-player').hidden=!file||$('study').hidden||document.querySelector('.audio-card').hidden||$('player').getBoundingClientRect().bottom>0;$('mini-title').textContent=file?.name||'';$('mini-time').textContent=`${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;$('mini-play').textContent=player.paused?'Play':'Pause';$('mini-play').setAttribute('aria-label',player.paused?'Play recording':'Pause recording');}
  async function play(){try{await player.play();$('play-status').textContent='';}catch(error){if(error.name==='NotAllowedError')$('play-status').textContent='Tap Play to continue this recording.';else if(error.name!=='AbortError')api.notice('This recording could not play. Try the Play control again.');}}
  async function startSentence(){const span=sentences()[segmentIndex];if(!span)return;clearTimeout(gapTimer);const active=session={kind:'sentence'};player.loop=false;$('repeat').checked=false;try{await readyPlayer();if(session!==active)return;player.currentTime=span.start;await play();scheduleBoundary();}catch(error){stopSession();api.notice(error.message);}}
  function scheduleBoundary(){
    clearTimeout(boundaryTimer);if(!session||player.paused||session.finishing)return;
    const span=session.kind==='sentence'?sentences()[segmentIndex]:session.span;
    if(!span||!Number.isFinite(span.end))return;
    const delay=(span.end-player.currentTime)/player.playbackRate*1000;
    if(delay<=0){finishRange().catch(error=>api.notice(error.message));return;}
    boundaryTimer=setTimeout(()=>{if(player.currentTime>=span.end-.03)finishRange().catch(error=>api.notice(error.message));else scheduleBoundary();},delay);
  }
  function finishSentence(){
    if(session?.kind!=='sentence'||session.finishing)return;session.finishing=true;clearTimeout(boundaryTimer);player.pause();
    const span=sentences()[segmentIndex];if(span)player.currentTime=span.end;
    $('play-status').textContent=`Your turn: repeat sentence ${segmentIndex+1}.`;
    if($('sentence-auto').checked&&segmentIndex<sentences().length-1){
      const seconds=$('sentence-gap').value==='match'?Math.max(1,span.end-span.start):Number($('sentence-gap').value);
      gapTimer=setTimeout(()=>{if(session?.kind==='sentence'&&$('sentence-auto').checked){segmentIndex++;refreshSentences();startSentence();}},seconds*1000);
    }
  }
  async function readyPlayer(){
    if(player.readyState>=1)return;
    await new Promise((resolve,reject)=>{
      const done=error=>{clearTimeout(timer);player.removeEventListener('loadedmetadata',loaded);player.removeEventListener('error',failed);error?reject(error):resolve();};
      const loaded=()=>done(),failed=()=>done(new Error('Recording unavailable. Reimport it from your originals.'));
      const timer=setTimeout(()=>done(new Error('Recording did not load. Try again.')),15000);
      player.addEventListener('loadedmetadata',loaded,{once:true});player.addEventListener('error',failed,{once:true});
    });
  }
  async function beginRange(active,id){
    if(api.getActiveAudioId()!==id)await api.loadAudio(id);await readyPlayer();if(session!==active)return;
    active.span=dialogue(id);active.finishing=false;player.currentTime=active.span.start;
    await play();scheduleBoundary();
  }
  async function finishRange(){
    const active=session;if(!active||active.finishing)return;
    if(active.kind==='sentence'){finishSentence();return;}
    active.finishing=true;clearTimeout(boundaryTimer);player.pause();
    if(active.kind==='blind'){
      active.played++;$('blind-status').textContent=`Listen ${active.played} of 2 complete.`;
      if(active.played<2){$('blind-status').textContent='Listen 2 of 2…';await beginRange(active,active.id);}
      else{session=null;$('blind-status').textContent='Both listens complete. Continue to Understand.';}
    }else if(active.kind==='review'){
      active.index++;
      if(active.index<active.tracks.length){$('play-status').textContent=`Reviewing lesson ${active.tracks[active.index].lesson}`;await beginRange(active,active.tracks[active.index].file.id);}
      else{session=null;$('play-status').textContent='Review complete. Continue to blind listening.';}
    }else if($('repeat').checked){await beginRange(active,api.getActiveAudioId());}
    else{session=null;$('play-status').textContent='Lesson audio complete.';}
    mini();
  }
  for(const event of ['playing','seeked','ratechange'])player.addEventListener(event,scheduleBoundary);
  player.addEventListener('pause',()=>{clearTimeout(boundaryTimer);mini();});
  player.addEventListener('timeupdate',()=>{mini();const span=session?.kind==='sentence'?sentences()[segmentIndex]:session?.span;if(span&&player.currentTime>=span.end)finishRange().catch(error=>api.notice(error.message));});
  player.addEventListener('play',()=>{
    mini();if(session?.finishing){session.finishing=false;if(session.kind==='sentence')player.currentTime=sentences()[segmentIndex].start;}
    if(!session&&api.getProgress().step===4&&shadowMode==='sentence'&&sentences().length){session={kind:'sentence'};const span=sentences()[segmentIndex];if(player.currentTime<span.start||player.currentTime>=span.end)player.currentTime=span.start;}
    else if(!session&&[0,1,3,4].includes(api.getProgress().step)){
      session={kind:'lesson',span:dialogue(api.getActiveAudioId())};
      if(player.currentTime<session.span.start||player.currentTime>=session.span.end)player.currentTime=session.span.start;
    }
    scheduleBoundary();
  });
  player.addEventListener('ended',()=>finishRange().catch(error=>api.notice(error.message)));
  $('start-review').addEventListener('click',async()=>{try{stopSession();const tracks=reviewTracks().filter(x=>x.file);if(!tracks.length)return;const active=session={kind:'review',tracks,index:0};player.loop=false;$('repeat').checked=false;$('play-status').textContent=`Reviewing lesson ${tracks[0].lesson}`;await beginRange(active,tracks[0].file.id);}catch(error){stopSession();api.notice(error.message);}});
  $('review-count').addEventListener('change',refreshReview);
  $('start-blind').addEventListener('click',async()=>{try{stopSession();const id=api.getProgress().tracks[api.getProgress().lesson];if(!id){api.notice('Import the recording for this lesson first.');return;}const active=session={kind:'blind',played:0,id};player.loop=false;$('repeat').checked=false;$('blind-status').textContent='Listen 1 of 2…';await beginRange(active,id);}catch(error){stopSession();api.notice(error.message);}});
  $('sentence-play').addEventListener('click',startSentence);
  $('sentence-back').addEventListener('click',()=>{stopSession();segmentIndex=Math.max(0,segmentIndex-1);refreshSentences();});$('sentence-next').addEventListener('click',()=>{stopSession();segmentIndex=Math.min(sentences().length-1,segmentIndex+1);refreshSentences();});
  $('sentence-auto').addEventListener('change',()=>{if(!$('sentence-auto').checked)clearTimeout(gapTimer);});
  $('shadow-mode').addEventListener('change',()=>{stopSession();shadowMode=$('shadow-mode').value;$('sentence-controls').hidden=shadowMode!=='sentence';update();});
  $('speed').value=String(course.rate);player.playbackRate=course.rate;$('speed').addEventListener('change',()=>{course.rate=Number($('speed').value);player.playbackRate=course.rate;saveCourse().catch(()=>{});});
  $('repeat').addEventListener('change',()=>{if(session?.kind==='blind'||session?.kind==='review')stopSession();if(session?.kind==='sentence'){player.loop=false;$('repeat').checked=false;api.notice('Use Repeat sentence for sentence practice.');}});
  $('mini-play').addEventListener('click',()=>{clearTimeout(gapTimer);if(!player.paused){player.pause();return;}if(api.getProgress().step===4&&shadowMode==='sentence')startSentence();else play();});
  $('mini-repeat').addEventListener('click',()=>{if(api.getProgress().step===4&&shadowMode==='sentence')startSentence();else{player.currentTime=dialogue(api.getActiveAudioId()).start;session=null;play();}});
  document.addEventListener('study-navigation',()=>{mini();if(!$('study').hidden)update().catch(error=>api.notice(error.message));else reader.clear();});window.addEventListener('scroll',mini,{passive:true});
  async function analyze(){const id=api.getActiveAudioId(),meta=api.getLibrary().find(x=>x.id===id);if(!meta){api.notice('Import and select a lesson recording first.');return;}stopSession();const ticket=++analysisGeneration;activeAnalysisTicket=ticket;$('detect-sentences').disabled=true;$('sentence-status').textContent='Finding pauses on this device…';let context;try{context=new (window.AudioContext||window.webkitAudioContext)();const buffer=await context.decodeAudioData(await(await api.getFile(meta)).arrayBuffer());if(ticket!==analysisGeneration||id!==api.getActiveAudioId())return;const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));course.segmentMode[id]='custom';course.segments[id]=detectSegments(channels,buffer.sampleRate,buffer.duration);await saveCourse();segmentIndex=0;refreshSentences();$('play-status').textContent='Pauses detected. Check the boundaries; you can join or split phrases below.';}catch(error){api.notice('Pause detection could not finish. You can enter sentence timings manually.');refreshSentences();}finally{if(context)await context.close().catch(()=>{});if(activeAnalysisTicket===ticket){$('detect-sentences').disabled=false;refreshSentences();}}}
  $('detect-sentences').addEventListener('click',analyze);
  $('save-timings').addEventListener('click',async()=>{try{const id=api.getActiveAudioId();if(!id)throw new Error('Select a recording first.');if(!Number.isFinite(player.duration))throw new Error('Wait for the recording to finish loading before saving timings.');const spans=parseSegments($('timing-text').value,player.duration);if(!spans.length)throw new Error('Enter at least one start, end pair.');analysisGeneration++;stopSession();course.segmentMode[id]='custom';course.segments[id]=spans;await saveCourse();segmentIndex=0;refreshSentences();api.notice('Sentence timings saved on this device.');}catch(error){api.notice(error.message);}});
  $('mark-boundary').addEventListener('click',async()=>{const id=api.getActiveAudioId(),time=+player.currentTime.toFixed(2),spans=sentences().map(x=>({...x}));const index=spans.findIndex(x=>time>x.start+.15&&time<x.end-.15);if(index<0){api.notice('Play to a point inside a sentence, then split there.');return;}stopSession();const span=spans[index];spans.splice(index,1,{start:span.start,end:time},{start:time,end:span.end});course.segmentMode[id]='custom';course.segments[id]=spans;await saveCourse();segmentIndex=index;refreshSentences();});
  async function ensureBook(){const meta=getBook();if(!meta)return null;if(openedId!==meta.id){openedId=meta.id;opening=api.getFile(meta).then(file=>reader.open(file,meta.id));}try{return await opening;}catch(error){openedId='';opening=null;throw error;}}
  function fillSettings(map){const p=api.getProgress();map ||= {start:1,end:2,englishPage:2,crop:fullCrop};$('page-start').value=map.start;$('page-end').value=map.end;$('english-page').value=map.englishPage;draftCrop={...(map.crop||fullCrop)};$('page-pattern').checked=false;$('mapping-status').textContent=map.estimated?'These pages follow your saved pattern. Adjust and save any exceptions.':currentMap?`Page mapping saved for lesson ${p.lesson}.`:'Find this lesson’s first and last PDF pages, preview them, then save.';}
  function readPageFields(){const start=Number($('page-start').value),end=Number($('page-end').value),englishPage=Number($('english-page').value);if(!reader.document)throw new Error('Import and open a PDF first.');if(![start,end,englishPage].every(Number.isInteger)||start<1||end<start||end>reader.document.numPages||end-start>11||englishPage<start||englishPage>end)throw new Error(`Choose up to 12 pages within this book (1–${reader.document.numPages}), with the English page inside the lesson.`);return {start,end,englishPage,crop:{...draftCrop}};}
  const range=map=>Array.from({length:map.end-map.start+1},(_,i)=>map.start+i);
  function setEnglishSelection(figure,canvas){const overlay=document.createElement('div');overlay.className='crop-selection';figure.append(overlay);const show=()=>{overlay.style.left=`${draftCrop.x*100}%`;overlay.style.top=`${draftCrop.y*canvas.clientHeight}px`;overlay.style.width=`${draftCrop.w*100}%`;overlay.style.height=`${draftCrop.h*canvas.clientHeight}px`;};show();let anchor;const coords=e=>{const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};canvas.style.touchAction='none';canvas.addEventListener('pointerdown',e=>{anchor=coords(e);canvas.setPointerCapture(e.pointerId);e.preventDefault();});canvas.addEventListener('pointermove',e=>{if(!anchor)return;const c=coords(e);draftCrop={x:Math.min(anchor.x,c.x),y:Math.min(anchor.y,c.y),w:Math.abs(c.x-anchor.x),h:Math.abs(c.y-anchor.y)};show();});canvas.addEventListener('pointerup',()=>{anchor=null;if(draftCrop.w<.02||draftCrop.h<.02){draftCrop={...fullCrop};show();}$('save-crop').disabled=false;});}
  $('prepared-book').addEventListener('click',async()=>{course.preferCustom=false;await saveCourse();await update();});
  $('book-select').addEventListener('change',async()=>{stopSession();course.activeBook=$('book-select').value;course.preferCustom=true;currentMap=null;await saveCourse();await update();});
  $('spread').addEventListener('change',()=>{$('pdf-pages').classList.toggle('single-column',!$('spread').checked);});
  $('configure-pages').addEventListener('click',()=>{$('page-settings').open=true;$('page-settings').scrollIntoView({behavior:'smooth',block:'start'});});
  $('preview-pages').addEventListener('click',async()=>{try{await ensureBook();const map=readPageFields();editingEnglish=false;await reader.render(range(map));}catch(error){api.notice(error.message);}});
  $('save-pages').addEventListener('click',async()=>{try{await ensureBook();const map=readPageFields(),settings=bookSettings(),lesson=api.getProgress().lesson;course.preferCustom=true;settings.pages ||= {};settings.pages[lesson]=map;if($('page-pattern').checked){settings.pattern={baseLesson:lesson,basePage:map.start,span:map.end-map.start+1};settings.layout={offset:map.englishPage-map.start,crop:map.crop};}await saveCourse();editingEnglish=false;await update();$('page-settings').open=false;api.notice('Lesson pages saved.');}catch(error){api.notice(error.message);}});
  $('select-english').addEventListener('click',async()=>{try{await ensureBook();const map=readPageFields();editingEnglish=true;$('save-crop').disabled=false;$('mapping-status').textContent='Drag a rectangle around the English translation, then save the English area.';await reader.render([map.englishPage],{select:setEnglishSelection});}catch(error){api.notice(error.message);}});
  $('reset-crop').addEventListener('click',()=>{draftCrop={...fullCrop};$('save-crop').disabled=false;if(editingEnglish)$('select-english').click();});
  $('save-crop').addEventListener('click',async()=>{try{const map=readPageFields();map.crop=validateCrop(draftCrop);const settings=bookSettings(),lesson=api.getProgress().lesson;course.preferCustom=true;settings.pages ||= {};settings.pages[lesson]=map;if($('reuse-crop').checked){settings.layout={offset:map.englishPage-map.start,crop:map.crop};for(const stored of Object.values(settings.pages)){if(stored.start+settings.layout.offset<=stored.end){stored.englishPage=stored.start+settings.layout.offset;stored.crop={...map.crop};}}}await saveCourse();editingEnglish=false;await update();api.notice('English area saved for recall.');}catch(error){api.notice(error.message);}});
  $('use-saved-timings').addEventListener('click',async()=>{stopSession();course.segmentMode[api.getActiveAudioId()]='custom';await saveCourse();segmentIndex=0;refreshSentences();});
  $('use-prepared').addEventListener('click',async()=>{stopSession();course.segmentMode[api.getActiveAudioId()]='prepared';await saveCourse();segmentIndex=0;refreshSentences();});
  $('reveal-german').addEventListener('click',async()=>{recallRevealed=!recallRevealed;$('reveal-german').textContent=recallRevealed?'Hide German again':'Show German to check';await renderBook();});
  document.addEventListener('audio-loaded',()=>{analysisGeneration++;segmentIndex=0;player.playbackRate=course.rate;refreshSentences();mini();});
  async function renderBook(){
    const recall=api.getProgress().step===7&&!recallRevealed;
    const plan=preparedPlan(recall);
    // Exact split files or a verified full-book layout enable the reviewed page/crop map.
    if(plan&&hasPreparedBook()&&!course.preferCustom){
      currentMap=mapping(api.getProgress().lesson);fillSettings(currentMap);$('manual-book').open=false;$('book-title').textContent=recall?'English only':'Lesson pages';
      $('book-info').textContent=`Lesson ${api.getProgress().lesson} · pages matched automatically`;
      await reader.renderEntries(plan,api.getFile,{english:recall});return;
    }
    const meta=getBook();currentMap=mapping(api.getProgress().lesson);fillSettings(currentMap);
    $('book-title').textContent=recall?'English only':'Lesson pages';$('book-info').textContent=meta?meta.name:'Import your full book PDF or the three parts in My materials.';
    if(!meta){reader.clear();$('reader-status').textContent='Add your book in Menu → My materials.';return;}
    const doc=await ensureBook();
    $('page-start').max=$('page-end').max=$('english-page').max=doc.numPages;
    if(!currentMap||currentMap.end>doc.numPages){reader.clear();$('reader-status').textContent=meta.bookMappingError||'This PDF has no matched lesson pages. Import the supplied full book or three parts, or use custom page settings below.';return;}
    if(editingEnglish)return;
    if(recall&&(!currentMap.crop||(currentMap.crop.x===0&&currentMap.crop.y===0&&currentMap.crop.w===1&&currentMap.crop.h===1))){reader.clear();$('reader-status').textContent='Select an English-only area in custom page settings before recall.';return;}
    await reader.render(recall?[currentMap.englishPage]:range(currentMap),recall?{crop:currentMap.crop}:{});
  }
  async function update(){
    const ticket=++generation,p={...api.getProgress()},key=`${p.lesson}:${p.step}`;
    if(stepKey!==key){stopSession();editingEnglish=false;recallRevealed=false;$('reveal-german').textContent='Show German to check';stepKey=key;reader.clear();
      if(p.step>0&&api.getActiveAudioId()!==(p.tracks[p.lesson]||''))await api.loadAudio(p.tracks[p.lesson]||'');
      if(p.step===1){player.loop=false;$('repeat').checked=false;$('blind-status').textContent='Two listens, with the book hidden.';}
    }
    if(ticket!==generation)return;
    $('review-controls').hidden=p.step!==0;$('blind-controls').hidden=p.step!==1;$('shadow-controls').hidden=p.step!==4;$('repeat').disabled=p.step===1;
    document.querySelector('.audio-card').hidden=[2,6,7].includes(p.step);
    $('sentence-controls').hidden=shadowMode!=='sentence';refreshReview();refreshSentences();mini();
    const noAudio=!p.tracks[p.lesson];$('audio-options').hidden=noAudio;$('player').hidden=noAudio&&p.step!==0;$('audio-info').hidden=!noAudio;
    if(noAudio)$('audio-info').textContent='Add this lesson’s recording in Menu → My materials.';
    const hideText=p.step<2||(p.step===4&&shadowMode==='without');$('book-card').hidden=hideText;
    if(hideText||$('study').hidden){reader.clear();return;}
    const books=api.getLibrary().filter(x=>x.kind==='pdf');$('book-select').replaceChildren(...books.map(x=>new Option(x.name,x.id)));$('book-select').value=getBook()?.id||'';
    $('recall-controls').hidden=p.step!==7;
    try{if(ticket===generation)await renderBook();}catch(error){if(ticket===generation)api.notice(`Could not open your PDF: ${error.message}`);}
  }
  function exportCourse(){return {rate:course.rate,preferCustom:!!course.preferCustom,books:api.getLibrary().filter(x=>x.kind==='pdf'&&course.books[x.id]).map(x=>({name:x.name,size:x.size,settings:course.books[x.id],active:x.id===getBook()?.id})),segments:api.getLibrary().filter(x=>x.kind==='audio'&&course.segments[x.id]).map(x=>({name:x.name,size:x.size,timings:course.segments[x.id],useCustom:course.segmentMode[x.id]==='custom'}))};}
  async function restoreCourse(data){if(!data)return;const next={books:{},segments:{},segmentMode:{},preferCustom:!!data.preferCustom,rate:[.75,.9,1,1.1,1.25].includes(data.rate)?data.rate:1};if(!Array.isArray(data.books)||!Array.isArray(data.segments))throw new Error('Invalid lesson setup in backup.');for(const item of data.books){const file=api.getLibrary().find(x=>x.kind==='pdf'&&x.name===item.name&&x.size===item.size);if(!file)continue;const settings=item.settings;if(!settings||typeof settings.pages!=='object')throw new Error('Invalid book pages in backup.');for(const [lesson,map] of Object.entries(settings.pages)){if(!/^\d+$/.test(lesson)||!Number.isInteger(map.start)||!Number.isInteger(map.end)||map.start<1||map.end<map.start||map.end-map.start>11||!Number.isInteger(map.englishPage)||map.englishPage<map.start||map.englishPage>map.end)throw new Error('Invalid page mapping in backup.');validateCrop(map.crop||fullCrop);}if(settings.pattern){const pattern=settings.pattern;if(!Number.isInteger(pattern.baseLesson)||pattern.baseLesson<1||!Number.isInteger(pattern.basePage)||pattern.basePage<1||!Number.isInteger(pattern.span)||pattern.span<1||pattern.span>12)throw new Error('Invalid page pattern in backup.');}if(settings.layout){validateCrop(settings.layout.crop);if(!Number.isInteger(settings.layout.offset)||settings.layout.offset<0||settings.layout.offset>11)throw new Error('Invalid English layout in backup.');}next.books[file.id]=settings;if(item.active)next.activeBook=file.id;}for(const item of data.segments){const file=api.getLibrary().find(x=>x.kind==='audio'&&x.name===item.name&&x.size===item.size);if(file){next.segments[file.id]=validateSegments(item.timings);next.segmentMode[file.id]=item.useCustom===false?'prepared':'custom';}}course=next;await saveCourse();$('speed').value=String(course.rate);player.playbackRate=course.rate;await update();}
  async function verifyBook(meta,profile,options){return verifyBookLayout(await reader.load(await api.getFile(meta),meta.id),profile,options);}
  return {update,exportCourse,restoreCourse,stopSession,verifyBook,flush:()=>courseQueue};
}
