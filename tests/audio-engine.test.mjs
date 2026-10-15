import test from 'node:test';import assert from 'node:assert/strict';
import {AudioEngine,isRendererFailure} from '../dist/audio-engine.js';
class Media extends EventTarget{
  constructor(){super();Object.assign(this,{source:'',currentTime:0,duration:90,paused:true,seeking:false,ended:false,readyState:4,networkState:1,volume:1,muted:false,loop:false,playbackRate:1,error:null});}
  getAttribute(){return this.source||null;}removeAttribute(){this.source='';}get src(){return this.source;}set src(v){this.source=v;}get currentSrc(){return this.source;}
  load(){this.currentTime=0;this.error=null;this.dispatchEvent(new Event('emptied'));}
  pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}
  async play(){this.paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}
}
class Context extends EventTarget{
  constructor(){super();Object.assign(this,{state:'suspended',sampleRate:48000,currentTime:0,destination:{}});}
  createGain(){return {gain:{value:1},connect(){}};}
  createBufferSource(){return {connect(){},disconnect(){},stop(){},start(time,offset){this.offset=offset;}};}
  async resume(){this.state='running';this.dispatchEvent(new Event('statechange'));}
  async close(){this.state='closed';this.dispatchEvent(new Event('statechange'));}
}
class Decoder{async decodeAudioData(){return {duration:90,numberOfChannels:2};}}
function setup(){const media=new Media(),data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};let reads=0;const engine=new AudioEngine(media,{storage,AudioContext:Context,OfflineAudioContext:Decoder,fetchFile:async()=>{reads++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};}});return {media,engine,storage,reads:()=>reads};}
test('renderer failures are identified specifically and remember a different playback path',async()=>{
  assert(isRendererFailure({code:3,message:'AUDIO_RENDERER_ERROR: audio render error'}));assert(!isRendererFailure({code:3,message:'Corrupted MP3'}));assert(!isRendererFailure({code:1,message:'Canceled'}));
  const {media,engine,storage}=setup();engine.src='blob:lesson';media.error={code:3,message:'AUDIO_RENDERER_ERROR'};media.dispatchEvent(new Event('error'));assert(engine.fallback);
  await engine.reconnect();await engine.loading;assert.equal(engine.backend,'compatibility');assert.equal(media.getAttribute('src'),null);assert.equal(engine.getAttribute('src'),'blob:lesson');assert.match(engine.diagnostics(),/AUDIO_RENDERER_ERROR/);
  const restored=new AudioEngine(new Media(),{storage});assert.equal(restored.backend,'compatibility');await engine._closeContext();
});
test('compatibility playback uses the output clock and supports precise pause, seek, loop and restart',async()=>{
  const {engine}=setup();engine.src='blob:lesson';await engine.setMode('compatibility');await engine.loading;engine.currentTime=17.36;await engine.play();engine.context.currentTime+=.75;assert(Math.abs(engine.currentTime-18.11)<1e-8);
  engine.pause();const paused=engine.currentTime;engine.context.currentTime+=3;assert.equal(engine.currentTime,paused);
  engine.currentTime=29.09;await engine.play();assert.equal(engine.node.offset,29.09);engine.currentTime=6;assert.equal(engine.node.offset,6);await Promise.resolve();assert(!engine.seeking);
  engine.loop=true;engine.context.currentTime+=91;assert.equal(engine.currentTime,7);engine.pause();engine.loop=false;engine.currentTime=90;await engine.play();assert.equal(engine.node.offset,0);engine.pause();await engine._closeContext();
});
test('reconnecting replaces the output context and reuses only the current decoded recording',async()=>{
  const {engine,reads}=setup();engine.src='blob:lesson';await engine.setMode('compatibility');await engine.loading;await engine.play();const previous=engine.context;engine.pause();await engine.reconnect();await engine.loading;assert.notEqual(engine.context,previous);assert.equal(previous.state,'closed');assert.equal(reads(),1);
  engine.src='blob:next-lesson';await engine.loading;assert.equal(reads(),2);assert.equal(engine.bufferUrl,'blob:next-lesson');engine.pause();await engine._closeContext();
});
test('an interrupted output is reported as paused and manual pause cancels a pending start',async()=>{
  const {engine}=setup();engine.src='blob:lesson';await engine.setMode('compatibility');await engine.loading;await engine.play();engine.context.state='suspended';engine.context.dispatchEvent(new Event('statechange'));assert(engine.paused);assert.match(engine.error.message,/output interrupted/);
  await engine.reconnect();await engine.loading;let release;engine.context.resume=()=>new Promise(resolve=>release=resolve);const pending=engine.play();engine.pause();release();await assert.rejects(pending,{name:'AbortError'});assert(engine.paused);await engine._closeContext();
});
test('compatibility stays at normal pitch and Standard remains available despite remembered failures',async()=>{
  const {engine}=setup();engine.src='blob:lesson';engine.playbackRate=.75;engine.fallback=true;await engine.reconnect();await engine.loading;engine.playbackRate=.75;assert.equal(engine.playbackRate,1);await engine.setMode('native');assert.equal(engine.backend,'native');assert.equal(engine.getAttribute('src'),'blob:lesson');assert.equal(engine.playbackRate,.75);
});
test('changing recordings while decoding discards the old buffer and cancels its pending Play',async()=>{
  const {engine}=setup(),decodes=[];engine.Decoder=class{decodeAudioData(){return new Promise(resolve=>decodes.push(resolve));}};
  engine.src='blob:first';await engine.setMode('compatibility');
  while(decodes.length<1)await Promise.resolve();
  const oldLoad=engine.loading,canceled=assert.rejects(engine.play(),{name:'AbortError'});engine.src='blob:second';
  while(decodes.length<2)await Promise.resolve();
  decodes[0]({duration:70,numberOfChannels:1});await assert.rejects(oldLoad,{name:'AbortError'});await canceled;assert(engine.paused);assert.equal(engine.buffer,null);
  decodes[1]({duration:80,numberOfChannels:2});await engine.loading;assert.equal(engine.bufferUrl,'blob:second');assert.equal(engine.duration,80);assert(engine.paused);await engine._closeContext();
});
