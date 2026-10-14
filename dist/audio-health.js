// Track intent separately from native state: output interruptions often have no MediaError.
export function observeAudioHealth(player,{onInterrupted,onStalled,stallAfter=8000,now=()=>performance.now()}={}){
  let expected=false,position=player.currentTime,lastAdvance=now(),lastResult='Not requested';
  const events=[];
  function record(event){
    events.push(`${(now()/1000).toFixed(2)}s ${event}; position=${player.currentTime.toFixed(3)}; paused=${player.paused}; ready=${player.readyState}; network=${player.networkState}`);
    if(events.length>40)events.shift();
  }
  function resetClock(){position=player.currentTime;lastAdvance=now();}
  function expectPlay(){expected=true;lastResult='Pending';resetClock();record('play requested');}
  function expectPause(reason){expected=false;if(lastResult==='Pending')lastResult=`Canceled: ${reason}`;record(`pause requested: ${reason}`);}
  function result(value){lastResult=value;record(`play result: ${value}`);}
  function check(){
    if(!expected||player.paused||player.ended||!player.getAttribute('src')){resetClock();return;}
    if(Math.abs(player.currentTime-position)>=.01){resetClock();return;}
    if(now()-lastAdvance>=stallAfter){expected=false;record('clock stalled');onStalled?.();}
  }
  for(const name of ['play','playing','pause','ended','seeking','seeked','waiting','stalled','error','emptied','loadedmetadata'])player.addEventListener(name,()=>{
    record(name);
    if(name==='play'&&!player.paused)expected=true;
    if(['playing','seeking','seeked','loadedmetadata'].includes(name))resetClock();
    if(name==='emptied'||name==='ended'){expected=false;resetClock();}
    if(name==='pause'&&player.paused&&expected&&!player.ended){expected=false;record('unexpected pause');onInterrupted?.();}
  });
  return {expectPlay,expectPause,result,record,check,details:()=>[`Last play request: ${lastResult}`,'Recent audio events (seconds since page opened):',...events].join('\n')};
}
