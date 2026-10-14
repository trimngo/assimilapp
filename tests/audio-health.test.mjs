import test from 'node:test';
import assert from 'node:assert/strict';
import {observeAudioHealth} from '../dist/audio-health.js';

function setup(){
  const player=Object.assign(new EventTarget(),{currentTime:0,paused:true,ended:false,readyState:4,networkState:1,getAttribute:()=> 'blob:recording'});
  let time=0,interrupted=0,stalled=0;
  const health=observeAudioHealth(player,{now:()=>time,onInterrupted:()=>interrupted++,onStalled:()=>stalled++});
  return {player,health,advance:value=>{time+=value;health.check();},counts:()=>({interrupted,stalled})};
}
test('native pauses without media errors are distinguished from intentional pauses',()=>{
  const {player,health,counts}=setup();
  health.expectPlay();player.paused=false;player.dispatchEvent(new Event('play'));health.result('playing');
  health.expectPause('user paused');player.paused=true;player.dispatchEvent(new Event('pause'));
  assert.deepEqual(counts(),{interrupted:0,stalled:0});
  health.expectPlay();player.paused=false;player.dispatchEvent(new Event('playing'));
  player.paused=true;player.dispatchEvent(new Event('pause'));player.dispatchEvent(new Event('pause'));
  assert.deepEqual(counts(),{interrupted:1,stalled:0});assert.match(health.details(),/unexpected pause/);
});
test('a frozen clock is detected once even if the browser keeps claiming to seek',()=>{
  const {player,health,advance,counts}=setup();health.expectPlay();player.paused=false;player.seeking=true;
  advance(7000);assert.equal(counts().stalled,0);advance(1000);advance(1000);assert.equal(counts().stalled,1);
  assert.match(health.details(),/clock stalled/);
});
test('slow advancing audio, user seeks, and source changes do not count as stalls',()=>{
  const {player,health,advance,counts}=setup();health.expectPlay();player.paused=false;
  for(let i=0;i<12;i++){player.currentTime+=.2;advance(1000);}
  player.currentTime=3;player.dispatchEvent(new Event('seeking'));advance(7000);
  player.dispatchEvent(new Event('emptied'));advance(20000);
  assert.deepEqual(counts(),{interrupted:0,stalled:0});
});
