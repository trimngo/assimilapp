import {formatTime} from './audio-tools.js';

// Browser media events can be delayed or missed. Always display the native audio clock.
export function connectPlaybackControls(player,{onPlay,onPause,onSeek,onTick}={}){
  const element=player.element||player;
  element.insertAdjacentHTML('afterend',`<div id="playback-controls" class="playback-controls" role="group" aria-label="Audio playback"><button id="playback-toggle" class="primary" type="button" aria-label="Play recording">Play</button><div class="playback-position"><input id="playback-position" type="range" min="0" max="0" step="0.01" value="0" aria-label="Audio position"><span id="playback-time">0:00 / 0:00</span></div></div>`);
  const controls=document.getElementById('playback-controls'),toggle=document.getElementById('playback-toggle'),position=document.getElementById('playback-position'),time=document.getElementById('playback-time');
  let poll=null,dragging=false;
  element.classList.add('app-controlled');element.controls=false;
  function refresh(){
    controls.hidden=element.hidden;
    const loaded=!!player.getAttribute('src'),duration=Number.isFinite(player.duration)?player.duration:0,current=Number.isFinite(player.currentTime)?player.currentTime:0;
    toggle.disabled=!loaded;position.disabled=!loaded||duration<=0;
    const label=player.paused?'Play':'Pause';if(toggle.textContent!==label)toggle.textContent=label;
    toggle.setAttribute('aria-label',`${label} recording`);
    if(Number(position.max)!==duration)position.max=String(duration);
    if(!dragging)position.value=String(Math.min(current,duration));
    const text=`${formatTime(current)} / ${formatTime(duration)}`;if(time.textContent!==text)time.textContent=text;
    position.setAttribute('aria-valuetext',`${formatTime(current)} of ${formatTime(duration)}`);
    if(!player.paused){if(poll===null)poll=setInterval(refresh,250);}
    else if(poll!==null){clearInterval(poll);poll=null;}
    onTick?.();
  }
  toggle.addEventListener('click',()=>{
    if(!player.paused){if(onPause)onPause();else player.pause();}
    else if(onPlay)onPlay();else player.play().catch(()=>{});
    refresh();
  });
  position.addEventListener('pointerdown',()=>{dragging=true;});
  const endDrag=()=>{dragging=false;refresh();};
  for(const event of ['pointerup','pointercancel','change','blur'])position.addEventListener(event,endDrag);
  for(const event of ['pointerup','pointercancel'])document.addEventListener(event,()=>{if(dragging)endDrag();});
  position.addEventListener('input',()=>{
    if(Number.isFinite(player.duration)){const target=Math.max(0,Math.min(player.duration,Number(position.value)));onSeek?.(target);player.currentTime=target;}
    refresh();
  });
  for(const event of ['loadedmetadata','durationchange','loadstart','emptied','timeupdate','play','playing','pause','ended','seeking','seeked','error'])player.addEventListener(event,refresh);
  document.addEventListener('visibilitychange',refresh);window.addEventListener('pageshow',refresh);
  refresh();return {refresh,element:controls};
}
