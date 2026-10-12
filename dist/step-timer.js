export const DEFAULT_MINUTES=Object.freeze([5,3,7,5,10,8,5,2]);

export function validateDurations(values){
  if(!Array.isArray(values)||values.length!==DEFAULT_MINUTES.length||
    values.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<.1||value>180))
    throw new Error('Choose a duration from 0.1 to 180 minutes for every step.');
  return [...values];
}

export function remainingTime(session,now=Date.now()){
  return Math.min(session.remainingMs,session.deadline===null?session.remainingMs:session.deadline-now);
}

export function formatCountdown(milliseconds){
  const overtime=milliseconds<0,seconds=overtime?Math.floor(-milliseconds/1000):Math.ceil(milliseconds/1000);
  return `${overtime?'+':''}${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}

export async function connectStepTimer(api){
  const $=id=>document.getElementById(id),button=$('step-timer');
  const stored=await api.read('state','step-timer');
  let durations=[...DEFAULT_MINUTES],current=null,saveQueue=Promise.resolve();
  try{if(stored?.durations)durations=validateDurations(stored.durations);}catch{}
  const saved=stored?.current;
  if(saved&&Number.isInteger(saved.lesson)&&saved.lesson>0&&Number.isInteger(saved.step)&&saved.step>=0&&saved.step<durations.length&&
    Number.isFinite(saved.remainingMs)&&saved.remainingMs<=durations[saved.step]*60000&&
    (saved.deadline===null||Number.isFinite(saved.deadline)))current={...saved,resumeOnStudy:!!saved.resumeOnStudy,notified:!!saved.notified};
  const visible=()=>!$('study').hidden;
  function persist(){
    const snapshot={durations:[...durations],current:{...current}};
    const attempt=saveQueue.then(()=>api.write('state','step-timer',snapshot));
    saveQueue=attempt.catch(()=>{});
    return attempt.catch(error=>{api.notice('Could not save the timer. Check device storage.');throw error;});
  }
  function render(){
    if(!current)return;
    const remaining=remainingTime(current),name=api.steps[current.step][0];
    const time=remaining===0?'+00:00':formatCountdown(remaining);
    $('timer-time').textContent=time;
    const running=current.deadline!==null;
    $('timer-icon').setAttribute('d',running?'M4 2v8M8 2v8':'M3 1l7 5-7 5z');
    button.dataset.state=running?(remaining<=0?'overtime':'running'):'paused';
    button.setAttribute('aria-label',`${running?'Pause':'Resume'} ${name} timer, ${time.replace('+','')} ${remaining<0?'over time':'remaining'}${running?'':'. Long press to restart.'}`);
    button.title=running?'Tap to pause timer':'Tap to resume; long press to restart timer';
  }
  function update(){
    const progress=api.getProgress();let changed=false;
    if(!current||current.lesson!==progress.lesson||current.step!==progress.step){
      current={lesson:progress.lesson,step:progress.step,remainingMs:Math.round(durations[progress.step]*60000),deadline:null,resumeOnStudy:true,notified:false};changed=true;
    }
    if(!visible()&&current.deadline!==null){
      current.remainingMs=remainingTime(current);current.deadline=null;current.resumeOnStudy=true;changed=true;
    }else if(visible()&&current.resumeOnStudy){
      current.deadline=Date.now()+current.remainingMs;current.resumeOnStudy=false;changed=true;
    }
    button.hidden=!visible();render();
    if(changed)persist().catch(()=>{});
  }
  function fillSettings(){
    durations.forEach((minutes,index)=>$(`duration-${index}`).value=String(minutes));
  }
  $('timer-durations').replaceChildren(...api.steps.map(([name],index)=>{
    const row=document.createElement('div');row.className='duration-row';
    const label=document.createElement('label');label.htmlFor=`duration-${index}`;label.textContent=name;
    const input=document.createElement('input');input.id=label.htmlFor;input.type='number';input.min='.1';input.max='180';input.step='any';input.inputMode='decimal';input.required=true;
    input.setAttribute('aria-label',`${name} duration in minutes`);
    const unit=document.createElement('span');unit.textContent='min';unit.setAttribute('aria-hidden','true');
    row.append(label,input,unit);return row;
  }));
  function restart(){
    current.remainingMs=Math.round(durations[current.step]*60000);current.notified=false;
    current.deadline=visible()?Date.now()+current.remainingMs:null;current.resumeOnStudy=!visible();render();
  }
  async function applyDurations(values){
    const next=validateDurations(values),reset=durations[current.step]!==next[current.step];durations=next;
    if(reset){current.remainingMs=Math.round(durations[current.step]*60000);current.notified=false;if(current.deadline!==null)current.deadline=Date.now()+current.remainingMs;}
    fillSettings();render();await persist();return reset;
  }
  let holdTimer=null,longPressed=false,holdOrigin=null;
  function cancelHold(){clearTimeout(holdTimer);holdTimer=null;holdOrigin=null;}
  button.addEventListener('pointerdown',event=>{
    cancelHold();longPressed=false;
    if(current.deadline!==null||!event.isPrimary||event.button!==0)return;
    holdOrigin={x:event.clientX,y:event.clientY};
    button.setPointerCapture(event.pointerId);
    holdTimer=setTimeout(()=>{
      holdTimer=null;longPressed=true;restart();persist().catch(()=>{});
    },650);
  });
  button.addEventListener('pointermove',event=>{
    if(holdOrigin&&Math.hypot(event.clientX-holdOrigin.x,event.clientY-holdOrigin.y)>10)cancelHold();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,cancelHold);
  button.addEventListener('contextmenu',event=>event.preventDefault());
  button.addEventListener('click',event=>{
    if(longPressed&&event.detail!==0){longPressed=false;return;}
    longPressed=false;
    if(current.deadline!==null){current.remainingMs=remainingTime(current);current.deadline=null;current.resumeOnStudy=false;}
    else{current.deadline=Date.now()+current.remainingMs;current.resumeOnStudy=false;}
    render();persist().catch(()=>{});
  });
  $('timer-settings-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{const reset=await applyDurations(durations.map((_,index)=>Number($(`duration-${index}`).value)));$('timer-settings-status').textContent=`Timer lengths saved on this device.${reset?' Current step reset to its new duration.':''}`;}
    catch(error){$('timer-settings-status').textContent=error.message;}
  });
  $('timer-reset').addEventListener('click',async()=>{
    try{restart();await persist();$('timer-settings-status').textContent='Current step timer reset. It will start when you return to Study.';}
    catch(error){$('timer-settings-status').textContent=error.message;}
  });
  $('timer-defaults').addEventListener('click',async()=>{
    try{await applyDurations([...DEFAULT_MINUTES]);$('timer-settings-status').textContent='Suggested timer lengths restored.';}
    catch(error){$('timer-settings-status').textContent=error.message;}
  });
  $('timer-settings-form').addEventListener('input',()=>{$('timer-settings-status').textContent='Unsaved timer lengths.';});
  document.addEventListener('study-navigation',update);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
  setInterval(render,250);
  button.disabled=false;$('timer-settings-form').querySelectorAll('button').forEach(control=>control.disabled=false);fillSettings();update();
  return {update,flush:()=>saveQueue,exportSettings:()=>({durations:[...durations]}),restoreSettings:async values=>{await applyDurations(values);update();await saveQueue;}};
}
