import {BookReader,validateCrop} from './pdf-reader.js';
import {detectSegments,validateSegments,parseSegments,formatTime,replaceSegment,insertSegment,splitSegment,playbackFailure} from './audio-tools.js';
import {matchedAudio,matchedSource,matchedCombinedBook,lessonPages,preparedSentences,preparedDialogue,dialogueCount,sentenceBookItems,sentencePages} from './course-data.js';
import {verifyBookLayout} from './book-layout.js';
import {connectPlaybackControls} from './playback-controls.js';
import {observeAudioHealth} from './audio-health.js';
import {APP_VERSION} from './updates.js';
import {shadowingPass} from './shadowing.js';
import {selectionState,selectionQueue,selectionStart,selectionRun,selectionResumeEnd,validateSelection,REPEAT_DELAYS} from './shadow-selection.js';
import {SentenceRecorder} from './sentence-recorder.js';
import {STEP} from './study-steps.js';
const $=id=>document.getElementById(id);
const fullCrop={x:0,y:0,w:1,h:1};

export async function connectStudy(api){
  let course=await api.read('state','course')||{books:{},segments:{},rate:1};
  course.books ||= {};course.segments ||= {};course.segmentMode ||= {};course.shadowing ||= {};course.practice ||= {};course.rate=Number(course.rate)||1;
  let courseQueue=Promise.resolve(),generation=0,openedId='',opening=null,currentMap=null,editingEnglish=false,draftCrop={...fullCrop},segmentIndex=0,session=null,boundaryTimer,gapTimer,analysisGeneration=0,activeAnalysisTicket=0,stepKey='';
  const player=api.player||$('player');let voice;
  let reconnecting=false,recoveryPosition=null,reconnectSession=null,lastMediaFailure=null,needsReconnect=false,playRequest=0,shadowOwner=null,lastCheckpoint=0;
  const audioHealth=observeAudioHealth(player,{
    onInterrupted:()=>{if(!reconnecting){needsReconnect=true;$('play-status').textContent=playbackFailure(player)?'Audio output failed. Tap Play to reconnect and continue.':'Playback was interrupted. Tap Play to reconnect and continue.';}},
    onStalled:()=>{needsReconnect=true;pauseAudio('stalled clock');$('play-status').textContent='Audio stopped advancing. Tap Play to reconnect and continue.';}
  });
  document.addEventListener('visibilitychange',()=>audioHealth.record(`page ${document.visibilityState}`));
  function pauseAudio(reason){playRequest++;audioHealth.expectPause(reason);player.pause();}
  function seekTo(time){
    if(Math.abs(player.currentTime-time)<.001)return;
    player.currentTime=time;
  }
  function freePlayback(){
    clearTimeout(boundaryTimer);clearTimeout(gapTimer);session={kind:'continuation'};player.setPlaybackEnd?.(null);
    player.loop=false;$('repeat').checked=false;$('play-status').textContent='';
  }
  function userSeekDuringReconnect(time){
    if(!reconnecting)return;
    if(recoveryPosition)recoveryPosition.time=time;
    if(session?.kind==='sentence'||session?.kind==='preview'||api.getProgress().step===STEP.SHADOWING)freePlayback();
    reconnectSession=session;audioHealth.record('user seek during reconnect');
  }
  function userSeek(time){

    if(reconnecting){userSeekDuringReconnect(time);return;}
    if(session?.kind==='sentence'||session?.kind==='preview'||api.getProgress().step===STEP.SHADOWING)freePlayback();
  }
  $('audio-select').insertAdjacentHTML('afterend',`<label class="field speed-field">Playback speed<select id="speed"><option value="0.75">0.75×</option><option value="0.9">0.9×</option><option value="1">1×</option><option value="1.1">1.1×</option><option value="1.25">1.25×</option></select></label>`);
  $('player').insertAdjacentHTML('afterend',`<section id="sentence-tools" hidden aria-label="Sentence timings"><div class="sentence-tool-actions"><button id="edit-sentence-mode" class="secondary" aria-expanded="false" aria-controls="sentence-timing-options">Edit sentence</button><button id="add-sentence-mode" class="secondary" aria-expanded="false" aria-controls="add-sentence-options">Add sentence</button></div><div id="sentence-timing-options" hidden>
    <p id="timing-sentence" class="note"></p>
    <div class="timing-bound"><label class="field">Start (seconds)<input id="timing-start" type="number" min="0" step="0.01" inputmode="decimal" required></label><div class="timing-nudges"><button class="secondary" data-timing-edge="start" data-delta="-0.05" aria-label="Start 0.05 seconds earlier">−0.05</button><button class="secondary" data-timing-edge="start" data-delta="0.05" aria-label="Start 0.05 seconds later">+0.05</button></div><button id="timing-start-playhead" class="text-button">Use playhead</button></div>
    <div class="timing-bound"><label class="field">End (seconds)<input id="timing-end" type="number" min="0" step="0.01" inputmode="decimal" required></label><div class="timing-nudges"><button class="secondary" data-timing-edge="end" data-delta="-0.05" aria-label="End 0.05 seconds earlier">−0.05</button><button class="secondary" data-timing-edge="end" data-delta="0.05" aria-label="End 0.05 seconds later">+0.05</button></div><button id="timing-end-playhead" class="text-button">Use playhead</button></div>
    <div class="backup-actions"><button id="preview-sentence" class="secondary">Preview</button><button id="save-sentence" class="primary">Save sentence</button><button id="reset-sentence-edit" class="text-button">Discard changes</button></div>
    <p id="timing-edit-status" class="note" role="status">Adjust a time, preview the sentence, then save.</p>
  </div><div id="sentence-tools-extra" hidden><button id="mark-boundary" class="text-button">Split at playhead</button><p id="sentence-tools-status" class="note" role="status"></p></div></section>`);
  $('player').insertAdjacentHTML('beforebegin',`<div id="routine-audio"><div id="review-controls" hidden><details><summary>Review options</summary><label class="field">Previous lessons<select id="review-count"><option value="3">Last three</option><option value="2">Last two</option></select></label></details><p id="review-list" class="note"></p><button id="start-review" class="primary">Play review</button></div><div id="blind-controls" hidden><button id="start-blind" class="primary">Listen twice</button><p id="blind-status" class="note" role="status">Each listen includes both readings when recorded. The book stays hidden.</p></div><div id="shadow-controls" hidden><div id="sentence-controls"><p id="sentence-status" class="note" role="status"></p><p id="sentence-count-status" class="note" role="status" hidden></p><div class="sentence-actions"><button id="sentence-back" class="secondary" aria-label="Previous sentence">←</button><button id="sentence-play" class="primary">Repeat sentence</button><button id="sentence-next" class="secondary" aria-label="Next sentence">→</button></div><details><summary>Practice options</summary><label class="check"><input id="sentence-auto" type="checkbox"> Continue after a pause</label><label class="field">Time to repeat<select id="sentence-gap"><option value="match">Length of the sentence</option><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="8">8 seconds</option></select></label><div id="sentence-list" class="sentence-list"></div><details id="timing-editor"><summary>Edit all sentence timings</summary><p class="note">Times are seconds: one start, end pair per line. Adjust a cut if it interrupts a sentence. Timings save on this device.</p><textarea id="timing-text" rows="7" aria-label="Sentence start and end times" placeholder="0.00, 3.20\n3.60, 6.10"></textarea><div class="backup-actions"><button id="save-timings" class="secondary">Save timings</button></div></details><button id="use-saved-timings" class="text-button" hidden>Use saved custom timings</button><button id="use-prepared" class="text-button" hidden>Use prepared sentence timings</button><button id="detect-sentences" class="text-button">Detect pauses for a different recording</button></details></div></div><p id="play-status" class="note" role="status"></p></div>`);
  $('sentence-timing-options').insertAdjacentHTML('afterend',`<div id="add-sentence-options" hidden><p class="note">Enter the missing sentence’s start and end, or copy them from the playhead. If one cut contains two sentences, seek to their boundary and split it.</p><form id="add-sentence-form"><div class="timing-bound"><label class="field">Start (seconds)<input id="new-sentence-start" type="number" min="0" step="0.01" inputmode="decimal" required></label><button id="new-start-playhead" class="secondary" type="button">Use playhead</button></div><div class="timing-bound"><label class="field">End (seconds)<input id="new-sentence-end" type="number" min="0" step="0.01" inputmode="decimal" required></label><button id="new-end-playhead" class="secondary" type="button">Use playhead</button></div><div class="backup-actions"><button id="preview-new-sentence" class="secondary" type="button">Preview</button><button id="add-sentence" class="primary" type="submit">Add sentence</button><button id="cancel-new-sentence" class="text-button" type="button">Cancel</button></div></form><p id="new-sentence-status" class="note" role="status"></p></div>`);
  $('book-card').insertAdjacentHTML('beforeend',`<details id="manual-book"><summary>Book options</summary><button id="prepared-book" class="text-button">Use automatically matched pages</button><div class="reader-tools"><label class="field">Book<select id="book-select"></select></label><label class="check"><input id="spread" type="checkbox" checked> Show two pages when there’s room</label><button id="configure-pages" class="text-button">Set lesson pages</button></div><details id="page-settings"><summary>Lesson pages & English area</summary><p class="note">Use PDF page numbers, which may differ from printed book numbers. Set a lesson once; later lessons can follow the same page pattern.</p><div class="page-fields"><label class="field">First page<input id="page-start" type="number" min="1" value="1"></label><label class="field">Last page<input id="page-end" type="number" min="1" value="2"></label><label class="field">English page<input id="english-page" type="number" min="1" value="2"></label></div><label class="check"><input id="page-pattern" type="checkbox"> Estimate other lessons using this page count</label><div class="backup-actions"><button id="preview-pages" class="secondary">Preview pages</button><button id="save-pages" class="primary">Save lesson pages</button></div><hr><p class="note">Choose the English page above, then select only the translation area. This works with scanned pages and needs no text recognition.</p><div class="backup-actions"><button id="select-english" class="secondary">Select English area</button><button id="reset-crop" class="secondary">Use whole English page</button><button id="save-crop" class="primary" disabled>Save English area</button></div><label class="check"><input id="reuse-crop" type="checkbox" checked> Use this English layout for other lessons</label><p id="mapping-status" class="note" role="status"></p></details></details><div id="recall-controls" hidden><button id="reveal-german" class="secondary">Show German to check</button><p class="note">Try saying the German before revealing the full lesson.</p></div><p id="reader-status" class="note" role="status"></p><div id="pdf-pages" class="pdf-pages"></div>`);
  document.body.insertAdjacentHTML('beforeend',`<div id="mini-player" hidden><button id="mini-play" class="primary" aria-label="Play recording">▶</button><div><span id="mini-title"></span><small id="mini-time">0:00</small></div><button id="mini-repeat" class="secondary" aria-label="Repeat current sentence or recording">↺</button></div>`);
  $('floating-ui').append($('mini-player'));
  $('audio-options').insertAdjacentElement('afterend',$('sentence-list'));
  $('sentence-list').hidden=true;$('sentence-list').setAttribute('role','list');$('sentence-list').setAttribute('aria-label','Shadowing sentences');
  $('book-card').append($('manual-book'));
  const reader=new BookReader($('pdf-pages'),$('reader-status'));
  let recallRevealed=false,timingKey='',timingSaved='',sentenceToolMode='edit',sentenceToolsOpen=false,sentenceRowsKey='',sentenceRender=0;
  const getBook=()=>api.getLibrary().find(x=>x.id===course.activeBook&&x.kind==='pdf')||api.getLibrary().find(x=>x.kind==='pdf');
  const bookSettings=()=>{const book=getBook();if(!book)return null;return course.books[book.id] ||= {pages:{}};};
  const audioLesson=()=>matchedAudio(api.getIndex(),api.getLibrary().find(file=>file.id===api.getActiveAudioId()));
  const sentences=()=>{const id=api.getActiveAudioId(),prepared=preparedSentences(audioLesson());return course.segmentMode[id]==='custom'&&course.segments[id]?course.segments[id]:prepared.length?prepared:course.segments[id]||[];};
  const preparedPlan=recall=>lessonPages(api.getIndex(),api.getLibrary(),api.getProgress().lesson,recall);
  const hasPreparedBook=()=>api.getLibrary().some(file=>matchedSource(api.getIndex(),file)||matchedCombinedBook(api.getIndex(),file));
  const dialogue=(id,includeRepeat=api.getProgress().step===STEP.BLIND_LISTENING)=>preparedDialogue(matchedAudio(api.getIndex(),api.getLibrary().find(file=>file.id===id)),includeRepeat)||{start:0,end:player.duration};
  function saveCourse(){const snapshot=structuredClone(course);const attempt=courseQueue.then(()=>api.write('state','course',snapshot));courseQueue=attempt.catch(()=>{});return attempt.catch(error=>{api.notice('Could not save lesson setup. Check storage and export a backup.');throw error;});}
  function mapping(lesson){const settings=bookSettings();if(!settings)return null;if(settings.pages?.[lesson])return {...settings.pages[lesson],estimated:false};if(settings.pattern){const {baseLesson,basePage,span}=settings.pattern;const start=basePage+(lesson-baseLesson)*span;if(start<1)return null;const layout=settings.layout||{offset:Math.min(1,span-1),crop:fullCrop};return {start,end:start+span-1,englishPage:start+layout.offset,crop:layout.crop,estimated:true};}return null;}
  function stopSession({stopVoice=true}={}){if(stopVoice)voice?.stopActivity();checkpointShadowing();session=null;clearTimeout(boundaryTimer);clearTimeout(gapTimer);$('play-status').textContent='';pauseAudio('session stopped');player.setPlaybackEnd?.(null);}
  function reviewTracks(){const p=api.getProgress(),n=Number($('review-count').value);return Array.from({length:Math.min(n,p.lesson-1)},(_,i)=>p.lesson-Math.min(n,p.lesson-1)+i).map(lesson=>({lesson,file:api.getLibrary().find(x=>x.id===p.tracks[lesson]&&x.kind==='audio')}));}
  function refreshReview(){const tracks=reviewTracks();$('review-list').textContent=tracks.length?tracks.map(x=>`Lesson ${x.lesson}${x.file?'':' (recording not imported)'}`).join(' · '):'This is your first lesson. Continue to blind listening.';$('start-review').disabled=!tracks.some(x=>x.file);}
  function setShadowText(id,text){if($(id).textContent!==text)$(id).textContent=text;}
  function practiceState(){
    const id=api.getActiveAudioId(),lesson=api.getProgress().lesson,key=`${lesson}:${id}`,spans=sentences();
    let saved=course.practice[key];
    if(saved){saved.repeatDelay ??= 0;saved.language ||= 'de';}
    if(!saved&&Number.isInteger(course.shadowing[id])){
      const pass=shadowingPass(spans.length,course.shadowing[id]);
      saved=selectionState(spans);if(pass){saved.selected=Array.from({length:pass.last-pass.first+1},(_,i)=>i+pass.first);saved.index=pass.first;saved.time=spans[pass.first].start;}
    }
    if(saved&&saved.spans.length===spans.length&&saved.spans.every((span,i)=>span.start===spans[i].start&&span.end===spans[i].end))return course.practice[key]=saved;
    return course.practice[key]=selectionState(spans,saved);
  }
  function enterShadowing(){
    shadowOwner={key:`${api.getProgress().lesson}:${api.getActiveAudioId()}`,id:api.getActiveAudioId()};
    const state=practiceState();segmentIndex=state.index;
    if(player.readyState>=1&&sentences().length)seekTo(state.time);
  }
  function checkpointShadowing(){
    if(session?.kind!=='selection'||!shadowOwner||session.owner!==shadowOwner.key||api.getActiveAudioId()!==shadowOwner.id)return;
    const state=course.practice[shadowOwner.key],span=activeSelectionCut();if(!state||!span)return;
    state.index=span.index;state.time=Math.max(span.start,Math.min(player.currentTime,selectionResumeEnd(state.spans,state.index),session.span.end));
    const unchanged=state.selected.length===session.queue.length&&session.queue.every((cut,i)=>cut.index===state.selected[i]);
    state.completed=!!session.completed||!unchanged;lastCheckpoint=performance.now();saveCourse().catch(()=>{});
  }
  function activeSelectionCut(){
    if(session?.kind!=='selection')return null;
    while(session.cursor<session.span.last&&player.currentTime>=session.queue[session.cursor+1].start)session.cursor++;
    return session.queue[session.cursor];
  }
  function refreshShadowing(){
    if(!$('shadow-simple')||api.getProgress().step!==STEP.SHADOWING)return;
    const state=practiceState(),count=state.spans.length;
    const current=activeSelectionCut()?.index??state.index;
    setShadowText('shadow-coverage',state.selected.length?`${state.selected.length} of ${count} selected${state.selected.includes(current)?` · Sentence ${current+1}`:''}`:'Check a sentence to include it in playback.');
    $('shadow-loop').checked=state.repeat;
    for(const input of document.querySelectorAll('[name="shadow-language"]'))input.checked=input.value===state.language;
    $('shadow-repeat-delay').value=String(state.repeatDelay);$('shadow-repeat-delay').hidden=!state.repeat;
    setShadowText('shadow-simple-play',player.paused&&!session?.waiting?'Play':'Pause');
    $('shadow-simple-play').disabled=!!voice?.busy||player.paused&&!session?.waiting&&(!api.getActiveAudioId()||!state.selected.length);
    $('shadow-loop').disabled=!api.getActiveAudioId();
    $('mini-repeat').hidden=true;
  }
  async function shadowPlay(){
    if(voice?.busy)return;
    if(session?.waiting){stopSession();mini();return;}
    if(!player.paused){pauseAudio('user paused');checkpointShadowing();return;}
    player.unlock?.().catch(()=>{});checkpointShadowing();
    const state=practiceState(),queue=selectionQueue(state),start=selectionStart(state,queue);if(!start)return;
    stopSession();state.completed=false;const active=session={kind:'selection',owner:shadowOwner.key,queue,cuts:state.spans,cursor:start.cursor,span:selectionRun(state.spans,queue,start.cursor)};
    player.loop=false;$('repeat').checked=false;
    try{await readyPlayer();if(session!==active)return;seekTo(start.time);await play(true);scheduleBoundary();refreshSentenceButtons();}
    catch(error){if(session===active){stopSession();api.notice(error.message);}}
  }
  async function finishSelection(active){
    active.finishing=true;pauseAudio('selected sentence complete');seekTo(active.span.end);
    let next=active.span.last+1;
    if(next>=active.queue.length){
      const state=course.practice[active.owner];
      if(!state?.repeat){completeSelection(active);return;}
      if(state.repeatDelay>0){waitForRepeat(active,state.repeatDelay);return;}
      next=0;
    }
    await continueSelection(active,next);
  }
  function completeSelection(active){
    clearTimeout(gapTimer);active.waiting=false;active.completed=true;checkpointShadowing();$('play-status').textContent='Selection complete.';mini();
  }
  function waitForRepeat(active,seconds){
    clearTimeout(gapTimer);active.waiting=true;active.finishing=true;
    $('play-status').textContent=`Next repeat in ${seconds} ${seconds===1?'second':'seconds'}…`;mini();
    gapTimer=setTimeout(()=>{
      if(session!==active||!active.waiting)return;
      if(!course.practice[active.owner]?.repeat){completeSelection(active);return;}
      continueSelection(active,0).catch(error=>{if(session===active){stopSession();api.notice(error.message);}});
    },seconds*1000);
  }
  async function continueSelection(active,next){
    if(session!==active)return;
    active.waiting=false;
    // Continuous checked runs keep the original audio clock and natural pauses.
    active.cursor=next;active.span=selectionRun(active.cuts,active.queue,next);active.finishing=false;
    seekTo(active.span.start);checkpointShadowing();
    if(session!==active)return;await play(true);if(session===active)scheduleBoundary();
  }
  function refreshSentences(){
    const spans=sentences(),count=dialogueCount(audioLesson(),spans.length);
    $('sentence-count-status').hidden=count.matches!==false;
    $('sentence-count-status').textContent=count.matches===false?`${count.actual} cuts · ${count.expected} numbered items expected in the book. Check for missing or merged items; extra splits can be intentional.`:'';
    segmentIndex=Math.min(segmentIndex,Math.max(0,spans.length-1));const current=spans[segmentIndex];
    $('sentence-status').textContent=!current&&$('detect-sentences').disabled?'Finding pauses on this device…':current?`Sentence ${segmentIndex+1} of ${spans.length}${current.needsReview?' · Draft cut: check where it pauses.':course.segmentMode[api.getActiveAudioId()]!=='custom'&&audioLesson()?.audio.sentenceAlignment.status==='needs-review'?' · Prepared cuts need a listening check.':''}`:'No prepared cuts for this recording. Pause manually, or add timings in Practice options.';
    $('sentence-play').disabled=!current;$('sentence-back').disabled=!current||segmentIndex===0;$('sentence-next').disabled=!current||segmentIndex===spans.length-1;
    refreshShadowing();refreshSentenceRows(spans);
    $('use-prepared').hidden=!audioLesson();$('use-saved-timings').hidden=!audioLesson()||!course.segments[api.getActiveAudioId()]||course.segmentMode[api.getActiveAudioId()]==='custom';$('detect-sentences').hidden=!!audioLesson();
    if(document.activeElement!==$('timing-text'))$('timing-text').value=spans.map(x=>`${x.start.toFixed(2)}, ${x.end.toFixed(2)}`).join('\n');
    if($('shadow-edit-sentence')){
      const select=$('shadow-edit-sentence');if(select.options.length!==spans.length)select.replaceChildren(...spans.map((_,i)=>new Option(`Sentence ${i+1}`,String(i))));select.value=String(segmentIndex);
      $('shadow-individual-controls').hidden=false;$('shadow-individual-play').disabled=$('shadow-individual-repeat').disabled=!current;
    }
    refreshTimingEditor();
  }
  function selectSentence(index){stopSession();segmentIndex=index;refreshSentences();}
  function refreshSentenceButtons(){
    if(api.getProgress().step!==STEP.SHADOWING)return;
    const state=practiceState(),playing=activeSelectionCut()?.index??(state.selected.includes(state.index)?state.index:-1);
    for(const row of $('sentence-list').children){
      const index=Number(row.dataset.index);row.classList.toggle('selected',index===playing);
      row.querySelector('.sentence-check').checked=state.selected.includes(index);
      if(index===playing)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
      row.querySelector('.sentence-edit').setAttribute('aria-expanded',String(sentenceToolsOpen&&segmentIndex===index&&$('shadow-editor').parentElement===row));
      const key=row.dataset.takeKey,capture=voice?.active,ownCapture=key&&capture?.key===key,ownSample=key&&voice?.sample?.key===key;
      const original=row.querySelector('.sentence-original'),record=row.querySelector('.sentence-record'),mine=row.querySelector('.sentence-mine');
      const originalPlaying=session?.kind==='comparison'&&session.voiceKey===key&&!player.paused;
      const voiceUi=JSON.stringify([key,capture?.key,capture?.phase,voice?.sample?.key,!!voice?.take(key),!!voice?.supported,originalPlaying,!!api.getActiveAudioId()]);
      if(row.voiceUi===voiceUi)continue;row.voiceUi=voiceUi;
      original.disabled=!!voice?.busy||!api.getActiveAudioId();original.setAttribute('aria-label',`${originalPlaying?'Stop':'Play'} original sentence ${index+1}`);original.title=original.getAttribute('aria-label');original.setAttribute('aria-pressed',String(originalPlaying));
      const recording=ownCapture&&capture.phase==='recording',requesting=ownCapture&&capture.phase==='requesting';
      record.disabled=!key||!voice?.supported||!!capture&&(!ownCapture||capture.phase==='saving');
      record.dataset.recording=String(!!recording);record.querySelector('.voice-label').textContent=recording?'Stop':requesting?'Cancel':ownCapture?'Saving':'Rec';
      record.setAttribute('aria-label',`${recording?'Stop recording':requesting?'Cancel microphone request':ownCapture?'Saving recording':voice?.take(key)?'Replace recording for':'Record'} sentence ${index+1}`);record.title=voice?.supported?record.getAttribute('aria-label'):'Voice recording needs microphone support. Try Safari or Chrome.';record.setAttribute('aria-pressed',String(!!recording));
      mine.disabled=!!voice?.busy||!voice?.take(key);mine.querySelector('.voice-label').textContent=ownSample?'Stop':'Mine';mine.setAttribute('aria-label',`${ownSample?'Stop':'Play'} my recording for sentence ${index+1}`);mine.title=mine.getAttribute('aria-label');mine.setAttribute('aria-pressed',String(!!ownSample));
      row.dataset.voiceState=ownCapture?capture.phase:ownSample?'playing':'idle';
    }
  }
  function closeRowEditor(){
    if(!$('shadow-editor'))return;
    $('shadow-options-content').append($('playback-controls'),$('sentence-tools'));
    $('shadow-editor').hidden=true;audioCard.append($('shadow-editor'));sentenceToolsOpen=false;
  }
  function editRow(index,pause=true){
    if(pause)stopSession();closeRowEditor();segmentIndex=index;sentenceToolMode='edit';sentenceToolsOpen=true;
    const row=$('sentence-list').querySelector(`[data-index="${index}"]`);if(!row)return;
    row.append($('shadow-editor'));$('shadow-editor').append($('playback-controls'),$('sentence-tools'));$('shadow-editor').hidden=false;
    refreshTimingEditor();refreshSentenceButtons();
  }
  function refreshSentenceRows(spans){
    const list=$('sentence-list'),visible=api.getProgress().step===STEP.SHADOWING;list.hidden=!visible;
    if(!visible){sentenceRowsKey='';sentenceRender++;return;}
    const id=api.getActiveAudioId(),lesson=audioLesson(),custom=course.segmentMode[id]==='custom',library=api.getLibrary(),language=practiceState().language;
    list.dataset.language=language;
    const key=JSON.stringify([id,spans,custom,language,library.filter(file=>file.kind==='pdf').map(file=>[file.id,file.verifiedBookLayout])]);
    if(key===sentenceRowsKey){refreshSentenceButtons();return;}
    const editing=$('shadow-editor')&&!$('shadow-editor').hidden?segmentIndex:null;closeRowEditor();
    sentenceRowsKey=key;const ticket=++sentenceRender,groups=[],items=sentenceBookItems(lesson,spans,custom);
    list.replaceChildren(...spans.map((span,i)=>{
      const row=document.createElement('div');row.className='sentence-row';row.dataset.index=i;row.setAttribute('role','listitem');
      const label=document.createElement('label');label.className='sentence-choice';
      const check=document.createElement('input');check.type='checkbox';check.className='sentence-check';check.setAttribute('aria-label',`Include sentence ${i+1} in playback`);
      label.append(check);
      check.addEventListener('change',()=>{const state=practiceState(),selected=new Set(state.selected);check.checked?selected.add(i):selected.delete(i);state.selected=[...selected].sort((a,b)=>a-b);state.completed=true;saveCourse().catch(()=>{});refreshShadowing();refreshSentenceButtons();});
      const text=document.createElement('div');text.className='sentence-text';text.lang=language;
      const entries=sentencePages(api.getIndex(),library,lesson?.number,items[i],language).map(entry=>({...entry,crop:{...entry.crop,x:0,w:1}}));
      const note=document.createElement('p');note.className='note';note.textContent=entries.length?'Loading sentence…':`No ${language==='en'?'English':'German'} text matched to this cut. The full pages are in Read along.`;text.append(note);
      if(entries.length)groups.push({entries,container:text,note});
      const edit=document.createElement('button');edit.type='button';edit.className='text-button sentence-edit';edit.textContent=`${i+1} ✎`;edit.setAttribute('aria-label',`Edit sentence ${i+1} timings`);edit.title=edit.getAttribute('aria-label');edit.setAttribute('aria-expanded','false');
      edit.addEventListener('click',()=>{if(!$('shadow-editor').hidden&&segmentIndex===i){stopSession();closeRowEditor();refreshSentenceButtons();}else editRow(i);});
      const marker=document.createElement('div');marker.className='sentence-marker';marker.append(label,edit);
      const controls=document.createElement('div');controls.className='sentence-voice';controls.setAttribute('role','group');controls.setAttribute('aria-label',`Sentence ${i+1} audio`);
      const icons={original:'<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',record:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',mine:'<path d="m8 4 13 8-13 8V4Z"/>'};
      for(const [kind,caption] of [['original','Orig'],['record','Rec'],['mine','Mine']]){
        const button=document.createElement('button');button.type='button';button.className=`sentence-${kind}`;button.disabled=true;button.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${icons[kind]}</svg><span class="voice-label">${caption}</span>`;
        button.addEventListener('click',()=>{if(kind==='record')voice.record(row.dataset.takeKey);else if(kind==='mine')voice.playMine(row.dataset.takeKey);else playOriginal(i,row.dataset.takeKey);});controls.append(button);
      }
      row.append(marker,text,controls);return row;
    }));
    if(editing!==null&&editing<spans.length)editRow(editing,false);
    refreshSentenceButtons();
    const file=library.find(file=>file.id===id),scope=JSON.stringify(['german',api.getProgress().lesson,file?.sha256||id]);
    if(voice&&id)voice.setContext(scope,spans).then(model=>{if(!model||ticket!==sentenceRender)return;for(const [i,row] of [...list.children].entries())row.dataset.takeKey=model.slots[i];refreshSentenceButtons();}).catch(()=>{if(ticket===sentenceRender)api.notice('Could not open local voice recordings. Check device storage and try reopening the app.');});
    const current=()=>ticket===sentenceRender&&!list.hidden;
    reader.renderExcerpts(groups,api.getFile,current).then(()=>{if(current())for(const group of groups)group.note.remove();}).catch(()=>{if(current())for(const group of groups)group.note.textContent='Could not display this sentence. The full pages are in Read along.';});
  }
  async function playOriginal(index,key){
    if(voice?.busy)return;
    if(session?.kind==='comparison'&&session.voiceKey===key&&!player.paused){stopSession();mini();return;}
    player.unlock?.().catch(()=>{});stopSession();const span=sentences()[index];if(!span)return;
    const active=session={kind:'comparison',span:{start:span.start,end:span.end},voiceKey:key};player.loop=false;
    try{await readyPlayer();if(session!==active)return;seekTo(span.start);await play(true);scheduleBoundary();mini();}
    catch(error){if(session===active){stopSession();api.notice(error.message);}}
  }
  async function playFromSentence(index){
    player.unlock?.().catch(()=>{});selectSentence(index);const span=sentences()[index];if(!span)return;
    freePlayback();const active=session,id=api.getActiveAudioId();
    try{await readyPlayer();if(session!==active||api.getActiveAudioId()!==id)return;seekTo(span.start);await play();}
    catch(error){if(session===active){stopSession();api.notice(error.message);}}
  }
  function mini(){const file=api.getLibrary().find(x=>x.id===api.getActiveAudioId()),paused=player.paused&&!session?.waiting;$('mini-player').hidden=!file||$('study').hidden||document.querySelector('.audio-card').hidden||(api.getProgress().step===STEP.SHADOWING&&$('shadow-simple-controls')?$('shadow-simple-controls'):($('playback-controls')||$('player'))).getBoundingClientRect().bottom>document.querySelector('.top-bar').getBoundingClientRect().bottom;for(const [id,text] of [['mini-title',file?.name||''],['mini-time',`${formatTime(player.currentTime)} / ${formatTime(player.duration)}`],['mini-play',paused?'Play':'Pause']])if($(id).textContent!==text)$(id).textContent=text;$('mini-play').setAttribute('aria-label',paused?'Play recording':'Pause recording');refreshSentenceButtons();refreshShadowing();}
  async function play(bounded=false){
    if(voice?.busy){api.notice('Stop your recording before playing audio.');return false;}
    voice?.stopSample();
    player.unlock?.().catch(()=>{});
    if(reconnecting&&!bounded)return false;
    if(needsReconnect&&!reconnecting){if(!bounded&&api.getProgress().step===STEP.SHADOWING)freePlayback();return reconnectAudio({resume:true});}
    const request=++playRequest,source=player.getAttribute('src');let timer;audioHealth.expectPlay();
    if(!bounded&&api.getProgress().step===STEP.SHADOWING)freePlayback();
    armAudioBoundary();
    try{
      await Promise.race([player.play(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The browser did not start playback within 12 seconds.')),12000);})]);
      if(request!==playRequest||source!==player.getAttribute('src'))return false;
      audioHealth.result(player.paused?'resolved, but paused':'playing');
      if(player.paused){needsReconnect=true;audioHealth.expectPause('interrupted start');$('play-status').textContent='Playback was interrupted. Tap Play to reconnect and continue.';return false;}
      needsReconnect=false;
      if(session?.kind==='review')$('play-status').textContent=`Reviewing lesson ${session.tracks[session.index].lesson}`;else $('play-status').textContent='';
      return true;
    }catch(error){
      if(request!==playRequest||source!==player.getAttribute('src'))return false;
      audioHealth.result(`${error.name}: ${error.message}`);audioHealth.expectPause('start rejected');player.pause();
      if(error.name==='NotAllowedError')$('play-status').textContent='Tap Play to continue this recording.';
      else{needsReconnect=true;const failure=playbackFailure(player);if(failure)api.notice(failure.message);$('play-status').textContent='Audio could not start. Tap Play to reconnect and continue.';}
      return false;
    }finally{clearTimeout(timer);}
  }
  async function startSentence(){player.unlock?.().catch(()=>{});const span=sentences()[segmentIndex];if(!span)return;clearTimeout(gapTimer);const active=session={kind:'sentence'};player.loop=false;$('repeat').checked=false;try{await readyPlayer();if(session!==active)return;seekTo(span.start);await play(true);scheduleBoundary();}catch(error){stopSession();api.notice(error.message);}}
  function refreshTimingEditor(force=false){
    const span=sentences()[segmentIndex];
    $('sentence-tools').hidden=api.getProgress().step!==STEP.SHADOWING||!api.getActiveAudioId();
    $('edit-sentence-mode').disabled=!span;
    if(!span)sentenceToolMode='add';
    const editing=sentenceToolsOpen&&sentenceToolMode==='edit';
    $('sentence-timing-options').hidden=!editing||!span;
    $('add-sentence-options').hidden=!sentenceToolsOpen||sentenceToolMode!=='add';
    $('sentence-tools-extra').hidden=!sentenceToolsOpen;
    $('edit-sentence-mode').setAttribute('aria-expanded',String(editing&&!!span));
    $('add-sentence-mode').setAttribute('aria-expanded',String(sentenceToolsOpen&&sentenceToolMode==='add'));

    if(!span){timingKey='';return;}
    const key=`${api.getActiveAudioId()}:${segmentIndex}`,saved=`${span.start}:${span.end}`;
    const count=dialogueCount(audioLesson(),sentences().length);$('timing-sentence').textContent=`Sentence ${segmentIndex+1} of ${sentences().length}${count.matches===false?` · ${count.expected} numbered items in the book`:''} · use the lesson pages for context.`;
    if(force||timingKey!==key||timingSaved!==saved){
      timingKey=key;timingSaved=saved;$('timing-start').value=span.start.toFixed(2);$('timing-end').value=span.end.toFixed(2);
      $('timing-edit-status').textContent='Adjust a time, preview the sentence, then save.';
    }
    for(const edge of ['start','end'])if(Number.isFinite(player.duration))$(`timing-${edge}`).max=player.duration.toFixed(2);
  }
  for(const [id,mode] of [['edit-sentence-mode','edit'],['add-sentence-mode','add']]){
    $(id).addEventListener('click',()=>{
      stopSession();sentenceToolsOpen=sentenceToolMode===mode?!sentenceToolsOpen:true;sentenceToolMode=mode;
      $('sentence-tools-status').textContent='';refreshTimingEditor();
    });
  }
  function timingChanged(){stopSession();$('timing-edit-status').textContent='Unsaved changes. Preview, then save sentence.';}
  function editedSentences(){
    if(!$('timing-start').value||!$('timing-end').value)throw new Error('Enter both start and end times, in seconds.');
    if(!Number.isFinite(player.duration))throw new Error('Wait for the recording to finish loading.');
    return replaceSegment(sentences(),segmentIndex,{start:$('timing-start').value,end:$('timing-end').value},player.duration);
  }
  for(const edge of ['start','end']){
    $(`timing-${edge}`).addEventListener('input',timingChanged);
    $(`timing-${edge}-playhead`).addEventListener('click',()=>{$(`timing-${edge}`).value=player.currentTime.toFixed(2);timingChanged();});
  }
  document.querySelectorAll('[data-timing-edge]').forEach(button=>button.addEventListener('click',()=>{
    const input=$(`timing-${button.dataset.timingEdge}`);input.value=(Number(input.value)+Number(button.dataset.delta)).toFixed(2);timingChanged();
  }));
  $('reset-sentence-edit').addEventListener('click',()=>{stopSession();refreshTimingEditor(true);});
  $('preview-sentence').addEventListener('click',async()=>{
    try{
      stopSession();const id=api.getActiveAudioId(),index=segmentIndex;await readyPlayer();if(id!==api.getActiveAudioId()||index!==segmentIndex)return;
      const span=editedSentences()[segmentIndex];session={kind:'preview',span};player.loop=false;$('repeat').checked=false;
      seekTo(span.start);$('timing-edit-status').textContent='Playing preview…';await play(true);scheduleBoundary();
    }catch(error){$('timing-edit-status').textContent=error.message;api.notice(error.message);}
  });
  $('save-sentence').addEventListener('click',async()=>{
    try{
      const id=api.getActiveAudioId(),spans=editedSentences();if(!id)throw new Error('Select a recording first.');
      stopSession();analysisGeneration++;course.segmentMode[id]='custom';course.segments[id]=spans;
      await saveCourse();refreshSentences();$('timing-edit-status').textContent='Sentence timings saved on this device.';
    }catch(error){$('timing-edit-status').textContent=error.message;api.notice(error.message);}
  });
  let addingSentence=false;
  function newSentenceCut(){
    if(!$('new-sentence-start').value||!$('new-sentence-end').value)throw new Error('Enter both start and end times.');
    if(!api.getActiveAudioId()||!Number.isFinite(player.duration))throw new Error('Wait for the recording to finish loading.');
    return insertSegment(sentences(),{start:$('new-sentence-start').value,end:$('new-sentence-end').value},player.duration);
  }
  async function saveAddedCut(result,id){
    const oldSegments=course.segments[id],oldMode=course.segmentMode[id];
    stopSession();analysisGeneration++;course.segments[id]=result.segments;course.segmentMode[id]='custom';
    try{await saveCourse();}
    catch(error){
      if(oldSegments===undefined)delete course.segments[id];else course.segments[id]=oldSegments;
      if(oldMode===undefined)delete course.segmentMode[id];else course.segmentMode[id]=oldMode;
      throw error;
    }
    if(id===api.getActiveAudioId()){segmentIndex=result.index;sentenceToolMode='edit';sentenceToolsOpen=true;refreshSentences();}
  }
  for(const edge of ['start','end']){
    $(`new-${edge}-playhead`).addEventListener('click',()=>{stopSession();$(`new-sentence-${edge}`).value=player.currentTime.toFixed(2);$('new-sentence-status').textContent='Preview, then add the sentence.';});
  }
  $('add-sentence-form').addEventListener('input',()=>{stopSession();$('new-sentence-status').textContent='Unsaved sentence. Preview, then add.';});
  $('cancel-new-sentence').addEventListener('click',()=>{stopSession();$('add-sentence-form').reset();$('new-sentence-status').textContent='';sentenceToolMode='edit';sentenceToolsOpen=false;refreshTimingEditor();});
  $('preview-new-sentence').addEventListener('click',async()=>{
    try{
      stopSession();const result=newSentenceCut();session={kind:'preview',span:result.segments[result.index],statusId:'new-sentence-status'};
      player.loop=false;$('repeat').checked=false;seekTo(session.span.start);$('new-sentence-status').textContent='Playing preview…';await play(true);scheduleBoundary();
    }catch(error){$('new-sentence-status').textContent=error.message;}
  });
  async function addCut(makeCut,message){
    if(addingSentence)return;addingSentence=true;
    const controls=[...$('add-sentence-options').querySelectorAll('button,input'),$('mark-boundary')];controls.forEach(control=>control.disabled=true);
    try{const id=api.getActiveAudioId();if(!id||!Number.isFinite(player.duration))throw new Error('Wait for the recording to finish loading.');await saveAddedCut(makeCut(),id);$('add-sentence-form').reset();$('new-sentence-status').textContent=message;$('sentence-tools-status').textContent=message;}
    catch(error){$('new-sentence-status').textContent=error.message;}
    finally{addingSentence=false;controls.forEach(control=>control.disabled=false);}
  }
  $('add-sentence-form').addEventListener('submit',event=>{event.preventDefault();addCut(newSentenceCut,'Sentence added and saved on this device. You can adjust the selected sentence here.');});
  function scheduleBoundary(){
    clearTimeout(boundaryTimer);armAudioBoundary();if(reconnecting||!session||player.paused||session.finishing)return;
    const active=session;
    const span=session.kind==='sentence'?sentences()[segmentIndex]:session.span;
    if(!span||!Number.isFinite(span.end))return;
    const delay=(span.end-player.currentTime)/player.playbackRate*1000;
    if(delay<=0){finishRange().catch(error=>api.notice(error.message));return;}
    boundaryTimer=setTimeout(()=>{if(session!==active||player.paused)return;if(player.currentTime>=span.end-.03)finishRange().catch(error=>api.notice(error.message));else scheduleBoundary();},Math.max(10,delay));
  }
  function armAudioBoundary(){
    const span=session?.kind==='sentence'?sentences()[segmentIndex]:session?.span;
    player.setPlaybackEnd?.(session&&!session.finishing&&Number.isFinite(span?.end)?span.end:null);
  }
  function checkBoundary(){
    // A reconnect's play promise can remain pending even after its audio clock starts.
    if(player.paused)return;
    const cap=routineDialogue();
    // Review remains bounded even if output recovery loses the normal session or seek events.
    if(cap&&player.currentTime>=cap.end){
      // Seeking can synchronously refresh the controls while the next listen
      // awaits metadata. Its finishing session still owns this transition.
      if(session?.finishing)return;
      if(session&&!session.finishing&&session.span){finishRange().catch(error=>api.notice(error.message));}
      else{pauseAudio('dialogue complete');seekTo(cap.end);session=null;$('play-status').textContent='Dialogue complete. Restart review to continue the sequence.';}
      return;
    }
    const span=session?.kind==='sentence'?sentences()[segmentIndex]:session?.span;
    if(span&&!player.paused&&player.currentTime>=span.end)finishRange().catch(error=>api.notice(error.message));
  }
  function routineDialogue(){const step=api.getProgress().step;return [STEP.REVIEW,STEP.BLIND_LISTENING,STEP.READ_ALONG].includes(step)?preparedDialogue(audioLesson(),step===STEP.BLIND_LISTENING):null;}
  function restoreRoutineSession(){
    if(session?.finishing&&!session.span&&session.expectedId===api.getActiveAudioId()){
      session.span=dialogue(session.expectedId,session.kind==='blind');session.finishing=false;
    }
  }
  function finishSentence(){
    if(session?.kind!=='sentence'||session.finishing)return;session.finishing=true;clearTimeout(boundaryTimer);pauseAudio('sentence complete');
    const span=sentences()[segmentIndex];if(span)seekTo(span.end);
    $('play-status').textContent=`Sentence ${segmentIndex+1} complete.`;
    if($('sentence-auto').checked&&segmentIndex<sentences().length-1){
      const seconds=$('sentence-gap').value==='match'?Math.max(1,span.end-span.start):Number($('sentence-gap').value);
      gapTimer=setTimeout(()=>{if(session?.kind==='sentence'&&$('sentence-auto').checked){segmentIndex++;refreshSentences();startSentence();}},seconds*1000);
    }
  }
  async function readyPlayer(){
    if(player.readyState>=1)return;
    await new Promise((resolve,reject)=>{
      const done=error=>{clearTimeout(timer);player.removeEventListener('loadedmetadata',loaded);player.removeEventListener('error',failed);error?reject(error):resolve();};
      const loaded=()=>done(),failed=()=>{const failure=playbackFailure(player);if(failure)done(new Error(failure.message));};
      const timer=setTimeout(()=>done(new Error('Recording did not load. Try again.')),15000);
      player.addEventListener('loadedmetadata',loaded,{once:true});player.addEventListener('error',failed,{once:true});
    });
  }
  async function beginRange(active,id){
    active.span=null;active.finishing=true;active.expectedId=id;clearTimeout(boundaryTimer);
    const request=playRequest;
    if(api.getActiveAudioId()!==id)await api.loadAudio(id);await readyPlayer();if(session!==active||request!==playRequest)return;
    active.span=dialogue(id,active.kind==='blind');seekTo(active.span.start);active.finishing=false;
    if(player.paused)await play(true);else audioHealth.record('rewind without stopping playback');
    scheduleBoundary();
  }
  async function finishRange(){
    const active=session;if(!active||active.finishing)return;
    if(active.kind==='sentence'){finishSentence();return;}
    if(active.kind==='selection'){await finishSelection(active);return;}
    active.finishing=true;clearTimeout(boundaryTimer);
    // A same-file repeat can seek while playing, keeping Android's output session alive.
    const rewinding=active.kind==='blind'&&active.played<1||!['preview','comparison','review','blind'].includes(active.kind)&&$('repeat').checked;
    if(!rewinding)pauseAudio('range complete');
    if(active.kind==='comparison'){
      session=null;seekTo(active.span.end);$('play-status').textContent='Original complete.';
    }else if(active.kind==='preview'){
      session=null;seekTo(active.span.end);$(active.statusId||'timing-edit-status').textContent=active.statusId?'Preview complete. Add sentence to save it.':'Preview complete. Save sentence to keep these timings.';
    }else if(active.kind==='blind'){
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
  player.addEventListener('playing',()=>{if(reconnecting)return;restoreRoutineSession();checkBoundary();scheduleBoundary();});
  player.addEventListener('ratechange',scheduleBoundary);
  // Only a seek-bar action releases practice bounds. Safari media events can
  // arrive late or out of order, so they cannot establish user intent.
  player.addEventListener('seeking',scheduleBoundary);
  player.addEventListener('seeked',()=>{scheduleBoundary();});
  player.addEventListener('pause',()=>{if(player.paused){clearTimeout(boundaryTimer);checkpointShadowing();}else scheduleBoundary();mini();});
  player.addEventListener('timeupdate',()=>{mini();checkBoundary();if(!player.paused&&performance.now()-lastCheckpoint>5000)checkpointShadowing();});
  player.addEventListener('play',()=>{
    if(voice?.busy){pauseAudio('microphone active');return;}
    if(reconnecting||player.paused){mini();return;}
    voice?.stopSample();
    mini();clearTimeout(gapTimer);$('play-status').textContent='';
    // Playback intent is set by the button action, not the timing of Safari's play event.
    if(session?.finishing&&session.kind!=='selection'){if(api.getProgress().step===STEP.SHADOWING)freePlayback();else session.finishing=false;}
    if(!session&&[STEP.REVIEW,STEP.BLIND_LISTENING,STEP.READ_ALONG,STEP.SHADOWING].includes(api.getProgress().step)){
      session={kind:'lesson',span:dialogue(api.getActiveAudioId())};
      if(player.currentTime<session.span.start||player.currentTime>=session.span.end)seekTo(session.span.start);
    }
    if(session?.kind==='review')$('play-status').textContent=`Reviewing lesson ${session.tracks[session.index].lesson}`;
    scheduleBoundary();
  });
  player.addEventListener('ended',()=>finishRange().catch(error=>api.notice(error.message)));
  player.addEventListener('rangeended',()=>finishRange().catch(error=>api.notice(error.message)));
  $('start-review').addEventListener('click',async()=>{let active;try{player.unlock?.().catch(()=>{});stopSession();const tracks=reviewTracks().filter(x=>x.file);if(!tracks.length)return;active=session={kind:'review',tracks,index:0};player.loop=false;$('repeat').checked=false;$('play-status').textContent=`Reviewing lesson ${tracks[0].lesson}`;await beginRange(active,tracks[0].file.id);}catch(error){if(session===active){pauseAudio('review failed');api.notice(error.message);}}});
  $('review-count').addEventListener('change',refreshReview);
  $('start-blind').addEventListener('click',async()=>{let active;try{player.unlock?.().catch(()=>{});stopSession();const id=api.getProgress().tracks[api.getProgress().lesson];if(!id){api.notice('Import the recording for this lesson first.');return;}active=session={kind:'blind',played:0,id};player.loop=false;$('repeat').checked=false;$('blind-status').textContent='Listen 1 of 2…';await beginRange(active,id);}catch(error){if(session===active){pauseAudio('blind listening failed');api.notice(error.message);}}});
  $('sentence-play').addEventListener('click',startSentence);
  $('sentence-back').addEventListener('click',()=>{stopSession();segmentIndex=Math.max(0,segmentIndex-1);refreshSentences();});$('sentence-next').addEventListener('click',()=>{stopSession();segmentIndex=Math.min(sentences().length-1,segmentIndex+1);refreshSentences();});
  $('sentence-auto').addEventListener('change',()=>{if(!$('sentence-auto').checked)clearTimeout(gapTimer);});
  $('speed').value=String(course.rate);player.playbackRate=course.rate;$('speed').addEventListener('change',()=>{course.rate=Number($('speed').value);player.playbackRate=course.rate;saveCourse().catch(()=>{});});
  $('repeat').addEventListener('change',()=>{if(session?.kind==='blind'||session?.kind==='review')stopSession();if(session?.kind==='sentence'){player.loop=false;$('repeat').checked=false;api.notice('Use Repeat sentence for sentence practice.');}});
  $('mini-play').addEventListener('click',()=>{if(api.getProgress().step===STEP.SHADOWING){shadowPlay();return;}clearTimeout(gapTimer);if(!player.paused){pauseAudio('user paused');return;}play();});
  $('mini-repeat').addEventListener('click',()=>{if(api.getProgress().step!==STEP.SHADOWING){seekTo(dialogue(api.getActiveAudioId()).start);session=null;play();}});
  const playbackControls=connectPlaybackControls(player,{onPlay:()=>play(),onPause:()=>pauseAudio('user paused'),onSeek:userSeek,onTick:()=>{mini();checkBoundary();audioHealth.check();}});
  const audioCard=document.querySelector('.audio-card');
  audioCard.insertAdjacentHTML('afterbegin',`<div id="shadow-simple" hidden><div id="shadow-simple-controls"><button id="shadow-simple-play" class="primary" type="button">Play</button><label class="shadow-repeat-check"><input id="shadow-loop" type="checkbox"><span>Repeat</span></label><select id="shadow-repeat-delay" aria-label="Delay between repeats" title="Pause after the selected set, before repeating" hidden>${REPEAT_DELAYS.map(seconds=>`<option value="${seconds}">${seconds?`${seconds} s delay`:'No delay'}</option>`).join('')}</select></div><div id="shadow-text-controls"><p id="shadow-coverage" class="note" role="status"></p><div id="shadow-language" role="group" aria-label="Visible text"><label><input type="radio" name="shadow-language" value="de" checked>German</label><label><input type="radio" name="shadow-language" value="en">English</label></div></div><div id="shadow-feedback"></div></div>`);
  audioCard.insertAdjacentHTML('beforeend',`<details id="shadow-options" hidden><summary>Options</summary><div id="shadow-options-content"></div></details><div id="shadow-editor" hidden><button id="shadow-edit-done" class="text-button" type="button">Done editing</button></div>`);
  $('shadow-options-content').insertAdjacentHTML('beforeend',`<div id="shadow-individual-controls"><label class="field">Individual sentence<select id="shadow-edit-sentence"></select></label><div class="backup-actions"><button id="shadow-individual-play" class="secondary" type="button">Play sentence</button><button id="shadow-individual-repeat" class="secondary" type="button">Replay sentence</button></div></div>`);
  $('shadow-simple').append($('sentence-list'));
  voice=new SentenceRecorder({
    beforeActivity:()=>stopSession({stopVoice:false}),onNotice:message=>api.notice(message),getBackend:()=>player.backend||'native',
    onMicrophoneReleased:()=>{needsReconnect=true;recoveryPosition=null;audioHealth.record('microphone released');}
  });
  voice.addEventListener('change',()=>{refreshSentenceButtons();refreshShadowing();$('mini-play').disabled=voice.busy;});
  $('shadow-options-content').insertAdjacentHTML('beforeend','<p class="note">Beside each sentence: Orig plays the original sentence; Rec records your voice (tap Stop to save); Mine plays your take. Recording again replaces that take. Allow microphone access when asked. Voice takes stay on this device and work offline; progress backups do not include them.</p>');
  sentenceRowsKey='';
  const shadowHomes=new Map(['shadow-controls','playback-controls','sentence-tools','audio-options','book-card','play-status'].map(id=>{const element=$(id),home=document.createComment(`Original ${id} position`);element.before(home);return [id,home];}));
  function arrangeShadowing(shadow){
    if(!shadow)closeRowEditor();
    document.body.toggleAttribute('data-shadow-compact',shadow);document.body.toggleAttribute('data-shadow-options',shadow&&$('shadow-options').open);
    $('shadow-simple').hidden=$('shadow-options').hidden=!shadow;
    for(const [id,home] of shadowHomes){const target=id==='play-status'?$('shadow-feedback'):$('shadow-options-content');if(shadow){if($(id).parentElement!==target&&!$('shadow-editor').contains($(id)))target.append($(id));}else if($(id).previousSibling!==home)home.after($(id));}
    if(shadow)$('shadow-options-content').prepend($('shadow-individual-controls'));
    $('mini-repeat').hidden=shadow;
  }
  $('shadow-options').addEventListener('toggle',()=>{if(api.getProgress().step===STEP.SHADOWING)update().catch(error=>api.notice(error.message));});
  $('shadow-simple-play').addEventListener('click',()=>shadowPlay());
  for(const input of document.querySelectorAll('[name="shadow-language"]'))input.addEventListener('change',()=>{if(!input.checked)return;practiceState().language=input.value;saveCourse().catch(()=>{});refreshSentenceRows(sentences());});
  $('shadow-loop').addEventListener('change',()=>{const state=practiceState();state.repeat=$('shadow-loop').checked;saveCourse().catch(()=>{});if(!state.repeat&&session?.waiting)completeSelection(session);refreshShadowing();});
  $('shadow-repeat-delay').addEventListener('change',()=>{const state=practiceState();state.repeatDelay=Number($('shadow-repeat-delay').value);saveCourse().catch(()=>{});if(session?.waiting){if(state.repeatDelay>0)waitForRepeat(session,state.repeatDelay);else continueSelection(session,0).catch(error=>{stopSession();api.notice(error.message);});}});
  $('shadow-edit-done').addEventListener('click',()=>{stopSession();closeRowEditor();refreshSentenceButtons();});
  $('shadow-edit-sentence').addEventListener('change',()=>selectSentence(Number($('shadow-edit-sentence').value)));
  $('shadow-individual-play').addEventListener('click',()=>{if(!player.paused)pauseAudio('user paused');else playFromSentence(segmentIndex);});
  $('shadow-individual-repeat').addEventListener('click',startSentence);
  player.addEventListener('error',()=>{const failure=playbackFailure(player);if(failure){lastMediaFailure={...failure,recording:audioLesson()?.number||api.getLibrary().find(x=>x.id===api.getActiveAudioId())?.name||'Unknown'};needsReconnect=true;$('play-status').textContent='Audio output failed. Tap Play to reconnect and continue.';}});
  function refreshAudioMode(){
    if(!player.backend)return;
    $('audio-mode').value=player.mode;const compatibility=player.backend==='compatibility';
    $('speed').disabled=compatibility;$('speed').value=compatibility?'1':String(course.rate);
    $('audio-mode-note').textContent=compatibility?'Compatibility audio is active. It uses 1× speed to keep the pronunciation’s pitch unchanged.':'Automatic switches to compatibility audio after a browser renderer error.';
  }
  player.addEventListener('enginechange',()=>{audioHealth.record(`engine changed: ${player.backend}`);refreshAudioMode();});
  $('audio-mode').addEventListener('change',()=>reconnectAudio({mode:$('audio-mode').value}));refreshAudioMode();
  async function reconnectAudio({resume,mode}={}){
    if(reconnecting||!player.getAttribute('src'))return false;
    if(session?.waiting)stopSession();
    const source=player.getAttribute('src'),active=session,id=api.getActiveAudioId();
    const saved=recoveryPosition?.source===source?recoveryPosition:{source,time:player.currentTime,resume:!player.paused||!!player.error||needsReconnect,rate:player.playbackRate,loop:player.loop};
    recoveryPosition=saved;reconnectSession=active;reconnecting=true;clearTimeout(boundaryTimer);clearTimeout(gapTimer);
    $('reconnect-audio').disabled=true;$('audio-mode').disabled=true;$('audio-reconnect-status').hidden=false;$('audio-reconnect-status').textContent='Reconnecting audio…';
    try{
      pauseAudio('reconnect');const request=playRequest;
      if(mode&&player.setMode)await player.setMode(mode);else if(player.reconnect)await player.reconnect();else player.load();
      await readyPlayer();
      if(player.getAttribute('src')!==source||api.getActiveAudioId()!==id||session!==reconnectSession||request!==playRequest){$('audio-reconnect-status').textContent='Audio reconnect canceled.';return false;}
      player.playbackRate=mode?course.rate:saved.rate;player.loop=saved.loop;player.muted=false;player.volume=1;
      const cap=routineDialogue();seekTo(Math.min(saved.time,player.duration,cap?.end??Infinity));restoreRoutineSession();
      needsReconnect=false;recoveryPosition=null;
      const resumed=resume??saved.resume;
      if(resumed&&!await play(true)){
        const completed=player.getAttribute('src')===source&&!needsReconnect&&player.paused&&(session?.finishing||!session&&cap&&player.currentTime>=cap.end);
        $('audio-reconnect-status').textContent=completed?'Audio reconnected. Playback reached its stopping point.':'Audio was reloaded, but playback did not start. Tap Play to retry.';
        return !!completed;
      }
      $('audio-reconnect-status').textContent=`Audio reconnected at your saved position${player.backend==='compatibility'?' using compatibility playback':''}. If still silent, check the device’s Bluetooth media output.`;
      return true;
    }catch(error){if(player.getAttribute('src')===source){needsReconnect=true;$('audio-reconnect-status').textContent=error.message;}return false;}
    finally{reconnecting=false;reconnectSession=null;$('reconnect-audio').disabled=false;$('audio-mode').disabled=false;refreshAudioMode();playbackControls.refresh();scheduleBoundary();}
  }
  $('reconnect-audio').addEventListener('click',()=>reconnectAudio());
  $('copy-audio-details').addEventListener('click',async()=>{
    const lesson=audioLesson(),file=api.getLibrary().find(x=>x.id===api.getActiveAudioId());
    const details=[`App: ${APP_VERSION}`,player.diagnostics?.()||'Audio engine: native',`Browser: ${navigator.userAgent}`,`Study: lesson ${api.getProgress().lesson}, step ${api.getProgress().step+1}`,`Recording: ${file?.name||'None'}`,`Prepared lesson: ${lesson?.number||'Not matched'}`,`Dialogue end: ${routineDialogue()?.end??'No whole-dialogue limit in this mode'}`,`Position: ${player.currentTime}; duration: ${player.duration}`,`Paused: ${player.paused}; seeking: ${player.seeking}; session: ${session?.kind||'None'}`,`Listen completed: ${session?.kind==='blind'?session.played:'N/A'}; finishing: ${session?.finishing??false}`,`Ready state: ${player.readyState}; network state: ${player.networkState}; visible: ${document.visibilityState}`,`Reconnect needed: ${needsReconnect}; reconnecting: ${reconnecting}`,`Muted: ${player.muted}; volume: ${player.volume}`,`Current audio error: ${player.error?`${player.error.code}; ${player.error.message||''}`:'None'}`,`Last audio error: ${lastMediaFailure?`${lastMediaFailure.code}; recording ${lastMediaFailure.recording}; ${lastMediaFailure.detail}`:'None recorded'}`,audioHealth.details()].join('\n');
    try{await navigator.clipboard.writeText(details);$('audio-reconnect-status').hidden=false;$('audio-reconnect-status').textContent='Audio details copied. Paste them into the support chat.';}
    catch{$('audio-details').textContent=details;$('audio-details').hidden=false;}
  });
  document.addEventListener('study-navigation',()=>{mini();if(!$('study').hidden)update().catch(error=>api.notice(error.message));else reader.clear();});window.addEventListener('scroll',mini,{passive:true});
  document.addEventListener('floating-layout',mini);window.addEventListener('resize',mini,{passive:true});document.addEventListener('visibilitychange',mini);window.addEventListener('pageshow',mini);
  const layoutObserver=new ResizeObserver(mini);layoutObserver.observe($('study'));layoutObserver.observe(document.querySelector('.audio-card'));
  async function analyze(){const id=api.getActiveAudioId(),meta=api.getLibrary().find(x=>x.id===id);if(!meta){api.notice('Import and select a lesson recording first.');return;}stopSession();const ticket=++analysisGeneration;activeAnalysisTicket=ticket;$('detect-sentences').disabled=true;$('sentence-status').textContent='Finding pauses on this device…';let context;try{context=new (window.AudioContext||window.webkitAudioContext)();const buffer=await context.decodeAudioData(await(await api.getFile(meta)).arrayBuffer());if(ticket!==analysisGeneration||id!==api.getActiveAudioId())return;const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));course.segmentMode[id]='custom';course.segments[id]=detectSegments(channels,buffer.sampleRate,buffer.duration);await saveCourse();segmentIndex=0;refreshSentences();$('play-status').textContent='Pauses detected. Check the boundaries; you can join or split phrases below.';}catch(error){api.notice('Pause detection could not finish. You can enter sentence timings manually.');refreshSentences();}finally{if(context)await context.close().catch(()=>{});if(activeAnalysisTicket===ticket){$('detect-sentences').disabled=false;refreshSentences();}}}
  $('detect-sentences').addEventListener('click',analyze);
  $('save-timings').addEventListener('click',async()=>{try{const id=api.getActiveAudioId();if(!id)throw new Error('Select a recording first.');if(!Number.isFinite(player.duration))throw new Error('Wait for the recording to finish loading before saving timings.');const spans=parseSegments($('timing-text').value,player.duration);if(!spans.length)throw new Error('Enter at least one start, end pair.');analysisGeneration++;stopSession();course.segmentMode[id]='custom';course.segments[id]=spans;await saveCourse();segmentIndex=0;refreshSentences();api.notice('Sentence timings saved on this device.');}catch(error){api.notice(error.message);}});
  $('mark-boundary').addEventListener('click',()=>addCut(()=>{
    const time=player.currentTime,spans=sentences(),index=spans.findIndex(span=>time>span.start&&time<span.end);
    return splitSegment(spans,index,time,player.duration);
  },'Sentence split and saved. Check both new cuts and adjust their timings here.'));
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
  player.addEventListener('emptied',()=>{clearTimeout(boundaryTimer);});
  document.addEventListener('audio-loaded',()=>{recoveryPosition=null;needsReconnect=false;clearTimeout(boundaryTimer);$('audio-options').hidden=!api.getActiveAudioId();$('add-sentence-form').reset();$('new-sentence-status').textContent='';$('sentence-tools-status').textContent='';sentenceToolMode='edit';sentenceToolsOpen=false;analysisGeneration++;segmentIndex=0;if(api.getProgress().step===STEP.SHADOWING)enterShadowing();player.playbackRate=course.rate;refreshAudioMode();refreshSentences();playbackControls.refresh();});
  async function renderBook(){
    const recall=api.getProgress().step===STEP.RECALL&&!recallRevealed;
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
  document.addEventListener('study-navigation',()=>{if($('study').hidden)stopSession();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){checkpointShadowing();voice.stopActivity();}});
  window.addEventListener('pagehide',()=>voice.stopActivity());
  window.addEventListener('pagehide',()=>checkpointShadowing());
  async function update(){
    const ticket=++generation,p={...api.getProgress()},key=`${p.lesson}:${p.step}`;
    if(stepKey!==key){stopSession();editingEnglish=false;recallRevealed=false;$('reveal-german').textContent='Show German to check';closeRowEditor();stepKey=key;reader.clear();shadowOwner=null;
      if(p.step!==STEP.REVIEW&&api.getActiveAudioId()!==(p.tracks[p.lesson]||''))await api.loadAudio(p.tracks[p.lesson]||'');
      if(p.step===STEP.SHADOWING)enterShadowing();
      if(p.step===STEP.BLIND_LISTENING){player.loop=false;$('repeat').checked=false;$('blind-status').textContent='Each listen includes both readings when recorded. The book stays hidden.';}
    }
    if(ticket!==generation)return;
    arrangeShadowing(p.step===STEP.SHADOWING);
    $('review-controls').hidden=p.step!==STEP.REVIEW;$('blind-controls').hidden=p.step!==STEP.BLIND_LISTENING;$('shadow-controls').hidden=p.step!==STEP.SHADOWING;$('repeat').disabled=p.step===STEP.BLIND_LISTENING||p.step===STEP.SHADOWING;
    document.querySelector('.audio-card').hidden=[STEP.UNDERSTAND,STEP.RECALL].includes(p.step);
    $('sentence-controls').hidden=false;refreshReview();refreshSentences();mini();
    const noAudio=!p.tracks[p.lesson];$('audio-options').hidden=!api.getActiveAudioId();$('player').hidden=noAudio&&p.step!==STEP.REVIEW;$('audio-info').hidden=!noAudio;
    playbackControls.refresh();
    if(noAudio)$('audio-info').textContent='Add this lesson’s recording in Menu → My materials.';
    const hideText=[STEP.REVIEW,STEP.BLIND_LISTENING].includes(p.step);$('book-card').hidden=hideText;
    if(hideText||$('study').hidden||p.step===STEP.SHADOWING&&!$('shadow-options').open){reader.clear();return;}
    const books=api.getLibrary().filter(x=>x.kind==='pdf');$('book-select').replaceChildren(...books.map(x=>new Option(x.name,x.id)));$('book-select').value=getBook()?.id||'';
    $('recall-controls').hidden=p.step!==STEP.RECALL;
    try{if(ticket===generation)await renderBook();}catch(error){if(ticket===generation)api.notice(`Could not open your PDF: ${error.message}`);}
  }
  function exportCourse(){checkpointShadowing();return {rate:course.rate,preferCustom:!!course.preferCustom,books:api.getLibrary().filter(x=>x.kind==='pdf'&&course.books[x.id]).map(x=>({name:x.name,size:x.size,settings:course.books[x.id],active:x.id===getBook()?.id})),practice:api.getLibrary().filter(x=>x.kind==='audio').flatMap(x=>Object.entries(course.practice).filter(([key])=>key.endsWith(`:${x.id}`)).map(([key,settings])=>({name:x.name,size:x.size,lesson:Number(key.slice(0,key.indexOf(':'))),settings}))),shadowing:api.getLibrary().filter(x=>x.kind==='audio'&&Number.isInteger(course.shadowing[x.id])).map(x=>({name:x.name,size:x.size,position:course.shadowing[x.id]})),segments:api.getLibrary().filter(x=>x.kind==='audio'&&course.segments[x.id]).map(x=>({name:x.name,size:x.size,timings:course.segments[x.id],useCustom:course.segmentMode[x.id]==='custom'}))};}
  async function restoreCourse(data){if(!data)return;const next={books:{},segments:{},segmentMode:{},shadowing:{...course.shadowing},practice:{...course.practice},preferCustom:!!data.preferCustom,rate:[.75,.9,1,1.1,1.25].includes(data.rate)?data.rate:1};if(!Array.isArray(data.books)||!Array.isArray(data.segments))throw new Error('Invalid lesson setup in backup.');for(const item of data.books){const file=api.getLibrary().find(x=>x.kind==='pdf'&&x.name===item.name&&x.size===item.size);if(!file)continue;const settings=item.settings;if(!settings||typeof settings.pages!=='object')throw new Error('Invalid book pages in backup.');for(const [lesson,map] of Object.entries(settings.pages)){if(!/^\d+$/.test(lesson)||!Number.isInteger(map.start)||!Number.isInteger(map.end)||map.start<1||map.end<map.start||map.end-map.start>11||!Number.isInteger(map.englishPage)||map.englishPage<map.start||map.englishPage>map.end)throw new Error('Invalid page mapping in backup.');validateCrop(map.crop||fullCrop);}if(settings.pattern){const pattern=settings.pattern;if(!Number.isInteger(pattern.baseLesson)||pattern.baseLesson<1||!Number.isInteger(pattern.basePage)||pattern.basePage<1||!Number.isInteger(pattern.span)||pattern.span<1||pattern.span>12)throw new Error('Invalid page pattern in backup.');}if(settings.layout){validateCrop(settings.layout.crop);if(!Number.isInteger(settings.layout.offset)||settings.layout.offset<0||settings.layout.offset>11)throw new Error('Invalid English layout in backup.');}next.books[file.id]=settings;if(item.active)next.activeBook=file.id;}for(const item of data.segments){const file=api.getLibrary().find(x=>x.kind==='audio'&&x.name===item.name&&x.size===item.size);if(file){next.segments[file.id]=validateSegments(item.timings);next.segmentMode[file.id]=item.useCustom===false?'prepared':'custom';}}if(data.shadowing!==undefined){if(!Array.isArray(data.shadowing))throw new Error('Invalid shadowing progress in backup.');for(const item of data.shadowing){if(!Number.isInteger(item.position)||item.position<0||item.position>10000)throw new Error('Invalid shadowing pass in backup.');const file=api.getLibrary().find(x=>x.kind==='audio'&&x.name===item.name&&x.size===item.size);if(file)next.shadowing[file.id]=item.position;}}if(data.practice!==undefined){if(!Array.isArray(data.practice))throw new Error('Invalid shadowing selections in backup.');for(const item of data.practice){if(!Number.isInteger(item.lesson)||item.lesson<1||item.lesson>1000)throw new Error('Invalid shadowing lesson in backup.');const settings=validateSelection(item.settings),file=api.getLibrary().find(x=>x.kind==='audio'&&x.name===item.name&&x.size===item.size);if(file)next.practice[`${item.lesson}:${file.id}`]=settings;}}stopSession();course=next;stepKey='';await saveCourse();$('speed').value=String(course.rate);player.playbackRate=course.rate;refreshAudioMode();await update();}
  async function verifyBook(meta,profile,options){return verifyBookLayout(await reader.load(await api.getFile(meta),meta.id),profile,options);}
  return {update,exportCourse,restoreCourse,stopSession,verifyBook,flush:async()=>{await voice.flush();await courseQueue;}};
}
