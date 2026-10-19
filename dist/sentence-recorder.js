import {VoiceStore,reconcileVoiceSlots} from './voice-store.js';
import {getAudioEngine} from './audio-engine.js';

const stopTracks=stream=>{for(const track of stream?.getTracks()||[])track.stop();};
export function recordingOptions(Recorder){
  for(const mimeType of ['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'])
    if(Recorder.isTypeSupported?.(mimeType))return {mimeType,audioBitsPerSecond:64000};
  return {};
}
export function microphoneMessage(error){
  if(['NotAllowedError','SecurityError'].includes(error?.name))return 'Allow microphone access in this browser’s site settings, then tap Record again.';
  if(error?.name==='NotFoundError')return 'No microphone is available. Connect or enable a microphone and try again.';
  if(error?.name==='NotReadableError')return 'The microphone could not be opened. Close other recording apps and try again.';
  return error?.message||'Recording could not start. Your previous take is still available.';
}
function makeSample(mode){
  const element=document.createElement('audio');element.hidden=true;element.dataset.voiceSample='true';element.dataset.backend=mode;document.body.append(element);
  const engine=getAudioEngine(element,{storage:{getItem:key=>key==='german-study-audio-mode'?mode:null,setItem(){}}});
  return {engine,remove:()=>element.remove()};
}

export class SentenceRecorder extends EventTarget{
  constructor({store=new VoiceStore(),mediaDevices=globalThis.navigator?.mediaDevices,Recorder=globalThis.MediaRecorder,beforeActivity=()=>{},onNotice=()=>{},onMicrophoneReleased=()=>{},getBackend=()=> 'native',sampleFactory=makeSample,makeUrl=blob=>URL.createObjectURL(blob),revokeUrl=url=>URL.revokeObjectURL(url),maxSeconds=120}={}){
    super();Object.assign(this,{store,mediaDevices,Recorder,beforeActivity,onNotice,onMicrophoneReleased,getBackend,sampleFactory,makeUrl,revokeUrl,maxSeconds});
    this.models=new Map();this.loads=new Map();this.context=null;this.active=null;this.sample=null;this.contextTicket=0;this.pending=new Set();
  }
  get supported(){return !!(this.mediaDevices?.getUserMedia&&this.Recorder);}
  get busy(){return !!this.active;}
  changed(){this.dispatchEvent(new Event('change'));}
  async setContext(scope,spans){
    const ticket=++this.contextTicket;
    if(this.active&&(this.active.scope!==scope||JSON.stringify(this.context?.spans)!==JSON.stringify(spans.map(({start,end})=>({start,end})))))this.stopActivity();
    if(!this.loads.has(scope))this.loads.set(scope,this.store.load(scope).then(({mapping,takes})=>{
      const model={scope,...reconcileVoiceSlots(mapping,spans),takes:new Map(takes.map(take=>[take.key,take]))};this.models.set(scope,model);return model;
    }).catch(error=>{this.loads.delete(scope);throw error;}));
    const model=await this.loads.get(scope);if(ticket!==this.contextTicket)return null;
    const previous=JSON.stringify([model.spans,model.slots]);Object.assign(model,reconcileVoiceSlots(model,spans));this.context=model;
    if(model.takes.size&&previous!==JSON.stringify([model.spans,model.slots])){
      const saving=this.store.save(model);this.pending.add(saving);try{await saving;}finally{this.pending.delete(saving);}
    }
    if(ticket!==this.contextTicket)return null;this.changed();return model;
  }
  take(key){return this.context?.takes.get(key);}
  async record(key){
    if(this.active?.key===key)return this.stopActivity();
    if(this.active)return false;
    if(!this.supported){this.onNotice('Voice recording needs microphone support. Try Safari or Chrome.');return false;}
    const model=this.context;if(!model?.slots.includes(key))return false;
    this.stopSample();this.beforeActivity();
    const active={key,scope:model.scope,model,phase:'requesting',chunks:[],started:0};this.active=active;this.changed();
    try{
      const stream=await this.mediaDevices.getUserMedia({audio:true,video:false});
      if(this.active!==active){stopTracks(stream);return false;}
      active.stream=stream;const recorder=active.recorder=new this.Recorder(stream,recordingOptions(this.Recorder));
      active.done=new Promise(resolve=>active.resolve=resolve);
      recorder.ondataavailable=event=>{if(event.data?.size)active.chunks.push(event.data);};
      recorder.onerror=event=>{active.error=event.error||new Error('Recording was interrupted. Your previous take is still available.');if(recorder.state!=='inactive')try{recorder.stop();}catch{}this.finishRecording(active);};
      recorder.onstop=()=>this.finishRecording(active);
      recorder.start();active.started=performance.now();active.phase='recording';
      active.limit=setTimeout(()=>{if(this.active===active){this.onNotice('Recording stopped after two minutes.');this.stopActivity();}},this.maxSeconds*1000);
      this.changed();return true;
    }catch(error){
      clearTimeout(active.limit);stopTracks(active.stream);if(active.stream)this.onMicrophoneReleased();active.resolve?.(false);if(this.active===active){this.active=null;this.changed();this.onNotice(microphoneMessage(error));}return false;
    }
  }
  async finishRecording(active){
    if(active.finishing)return;active.finishing=true;clearTimeout(active.limit);clearTimeout(active.stopTimeout);stopTracks(active.stream);this.onMicrophoneReleased();
    active.phase='saving';this.changed();
    const saving=(async()=>{
      try{
        if(active.error)throw active.error;
        const type=active.recorder.mimeType||active.chunks[0]?.type||'audio/mp4',blob=new Blob(active.chunks,{type});
        if(!blob.size)throw new Error('No audio was recorded. Your previous take is still available.');
        const take={key:active.key,scope:active.scope,blob,type,createdAt:Date.now(),duration:Math.max(0,(performance.now()-active.started)/1000)};
        await this.store.save(active.model,take);active.model.takes.set(active.key,take);return true;
      }catch(error){this.onNotice(active.error||!active.chunks.length?microphoneMessage(error):'Could not save your recording. Your previous take is still available. Check device storage.');return false;}
      finally{if(this.active===active)this.active=null;this.changed();}
    })();
    this.pending.add(saving);const saved=await saving;this.pending.delete(saving);active.resolve?.(saved);
  }
  stopActivity(){
    this.stopSample();const active=this.active;if(!active)return Promise.resolve();
    if(active.phase==='requesting'){this.active=null;this.changed();return Promise.resolve();}
    if(active.phase==='recording'){
      active.phase='saving';clearTimeout(active.limit);this.changed();
      try{active.recorder.stop();stopTracks(active.stream);}
      catch(error){active.error=error;this.finishRecording(active);}
      if(!active.finishing)active.stopTimeout=setTimeout(()=>{active.error=new Error('Recording did not finish. Your previous take is still available.');this.finishRecording(active);},5000);
    }
    return active.done||Promise.resolve();
  }
  playMine(key){
    if(this.busy)return Promise.resolve(false);
    if(this.sample?.key===key){this.stopSample();return Promise.resolve(false);}
    const take=this.take(key);if(!take?.blob?.size)return Promise.resolve(false);
    this.stopSample();this.beforeActivity();
    const mode=this.getBackend()==='compatibility'||this.sampleFallback?'compatibility':'native',handle=this.sampleFactory(mode),sample={...handle,key,url:this.makeUrl(take.blob)};
    this.sample=sample;const {engine}=sample;
    engine.addEventListener('ended',()=>{if(this.sample===sample)this.stopSample();});
    engine.addEventListener('error',()=>{if(this.sample!==sample)return;if(engine.fallback)this.sampleFallback=true;this.stopSample();this.onNotice('Your recording could not play. Try again, or select Compatibility audio in Playback options.');});
    engine.src=sample.url;engine.unlock?.().catch(()=>{});this.changed();
    const playing=engine.play(); // Keep this call inside the user's tap, including on Safari.
    return Promise.resolve(playing).then(()=>this.sample===sample&&!engine.paused).catch(error=>{if(this.sample===sample){this.stopSample();this.onNotice(error.name==='NotAllowedError'?'Tap your recording’s Play button again to enable audio.':'Your recording could not play. Try again.');}return false;});
  }
  stopSample(){
    const sample=this.sample;if(!sample)return;this.sample=null;
    sample.engine.dispose().catch(()=>{});sample.remove();this.revokeUrl(sample.url);this.changed();
  }
  async flush(){await this.stopActivity();await Promise.allSettled([...this.pending]);}
}
