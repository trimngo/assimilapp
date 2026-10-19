import test from 'node:test';import assert from 'node:assert/strict';
import {SentenceRecorder,recordingOptions,microphoneMessage} from '../dist/sentence-recorder.js';
class Store{
  constructor(){this.models=new Map();this.takes=new Map();}
  async load(scope){return {mapping:this.models.get(scope),takes:[...this.takes.values()].filter(t=>t.scope===scope)};}
  async save(model,take){if(this.fail)throw new Error('QuotaExceededError');this.models.set(model.scope,structuredClone({spans:model.spans,slots:model.slots}));if(take)this.takes.set(take.key,take);}
}
class Recorder{
  static isTypeSupported(type){return type==='audio/webm;codecs=opus';}
  constructor(stream,options){this.stream=stream;this.mimeType=options.mimeType;this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['sample'],{type:this.mimeType})});this.onstop?.();});}
}
const spans=[{start:1,end:2},{start:3,end:4}];
const stream=()=>({stopped:false,getTracks(){return [{stop:()=>this.stopped=true}];}});
function setup(overrides={}){
  const store=new Store(),notices=[],streams=[],samples=[];let before=0,released=0,revoked=0;
  const voice=new SentenceRecorder({store,Recorder,mediaDevices:{getUserMedia:async()=>{const s=stream();streams.push(s);return s;}},beforeActivity:()=>before++,onMicrophoneReleased:()=>released++,onNotice:msg=>notices.push(msg),makeUrl:()=> 'blob:sample',revokeUrl:()=>revoked++,sampleFactory:mode=>{
    const engine=new EventTarget();Object.assign(engine,{paused:true,unlock:async()=>{},play:async()=>{engine.paused=false;},dispose:async()=>{engine.paused=true;engine.disposed=true;}});const sample={engine,mode,remove:()=>sample.removed=true};samples.push(sample);return sample;
  },...overrides});
  return {voice,store,notices,streams,samples,counts:()=>({before,released,revoked})};
}
test('recording commits one local take; rerecord replaces it only after a successful save',async()=>{
  const {voice,store,streams,counts}=setup();const model=await voice.setContext('lesson11',spans),key=model.slots[0];
  assert(await voice.record(key));assert.equal(voice.active.phase,'recording');assert(!voice.take(key));assert.equal(counts().before,1);
  await voice.stopActivity();assert(!voice.busy);assert(streams[0].stopped);assert.equal(counts().released,1);const first=voice.take(key);assert.equal(await first.blob.text(),'sample');assert.equal(store.takes.size,1);
  store.fail=true;await voice.record(key);await voice.stopActivity();assert.equal(voice.take(key),first);assert.equal(store.takes.get(key),first);
  store.fail=false;await voice.record(key);await voice.stopActivity();assert.notEqual(voice.take(key),first);assert.equal(store.takes.size,1);
});
test('denied or canceled microphone access preserves the existing take and stops late tracks',async()=>{
  const {voice,notices}=setup();const model=await voice.setContext('lesson11',spans),key=model.slots[0];await voice.record(key);await voice.stopActivity();const old=voice.take(key);
  voice.mediaDevices={getUserMedia:async()=>{throw new DOMException('Denied','NotAllowedError');}};assert.equal(await voice.record(key),false);assert.equal(voice.take(key),old);assert.match(notices.at(-1),/site settings/);assert(!voice.busy);
  let resolve;voice.mediaDevices={getUserMedia:()=>new Promise(r=>resolve=r)};const recording=voice.record(key);assert.equal(voice.active.phase,'requesting');await voice.stopActivity();const late=stream();resolve(late);assert.equal(await recording,false);assert(late.stopped);assert.equal(voice.take(key),old);
});
test('navigation saves to the original sentence; timings and inserted sentences preserve take links',async()=>{
  const {voice,store}=setup();const model=await voice.setContext('lesson11',spans),key=model.slots[1];await voice.record(key);
  const next=await voice.setContext('lesson12',spans);await voice.flush();assert.equal(voice.context,next);assert(!voice.take(key));assert.equal(store.takes.get(key).scope,'lesson11');
  const edited=[spans[0],{start:2.1,end:2.9},{start:3,end:4}];const restored=await voice.setContext('lesson11',edited);assert.equal(restored.slots[2],key);assert(voice.take(key));
  const corrected=await voice.setContext('lesson11',[edited[0],edited[1],{start:2.95,end:4.1}]);assert.equal(corrected.slots[2],key);
  const reopened=setup({store}).voice;assert.equal((await reopened.setContext('lesson11',corrected.spans)).slots[2],key);assert(reopened.take(key));
});
test('sample playback is mutually exclusive, stops on completion and releases playback resources',async()=>{
  const {voice,samples,counts}=setup({getBackend:()=> 'compatibility'});const model=await voice.setContext('lesson11',spans),key=model.slots[0];await voice.record(key);await voice.stopActivity();
  assert(await voice.playMine(key));assert.equal(samples[0].mode,'compatibility');assert.equal(counts().before,2);
  await voice.playMine(key);assert(!voice.sample);assert(samples[0].engine.disposed);assert(samples[0].removed);assert.equal(counts().revoked,1);
  await voice.playMine(key);samples[1].engine.dispatchEvent(new Event('ended'));assert(!voice.sample);assert.equal(counts().revoked,2);
  await voice.playMine(key);await voice.record(key);assert(!voice.sample);assert.equal(await voice.playMine(key),false);assert.equal(samples.length,3);await voice.flush();
});
test('an interrupted encoder releases the microphone and preserves the saved take',async()=>{
  const {voice,streams}=setup();const model=await voice.setContext('lesson11',spans),key=model.slots[0];await voice.record(key);await voice.stopActivity();const original=voice.take(key);
  await voice.record(key);const active=voice.active;active.recorder.onerror({error:new Error('Encoder interrupted')});await active.done;assert(!voice.busy);assert(streams[1].stopped);assert.equal(voice.take(key),original);
  await voice.record(key);await voice.flush();assert.notEqual(voice.take(key),original);
});
test('microphone formats support Safari MP4, Chromium Opus, and browser defaults',()=>{
  assert.equal(recordingOptions(Recorder).mimeType,'audio/webm;codecs=opus');assert.equal(recordingOptions({isTypeSupported:type=>type==='audio/mp4'}).mimeType,'audio/mp4');assert.deepEqual(recordingOptions({}),{});
  assert.match(microphoneMessage({name:'NotFoundError'}),/No microphone/);assert.match(microphoneMessage({name:'NotReadableError'}),/other recording apps/);
});
