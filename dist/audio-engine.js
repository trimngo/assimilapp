// One study-facing clock; compatibility playback never sends MP3s through <audio>.
const engines=new WeakMap(),MODE_KEY='german-study-audio-mode',FALLBACK_KEY='german-study-audio-fallback';
const events=['loadstart','emptied','loadedmetadata','durationchange','canplay','play','playing','pause','timeupdate','seeking','seeked','ratechange','volumechange','waiting','stalled','ended','error'];
export const isRendererFailure=error=>error?.code===3&&/AUDIO_RENDERER_ERROR|audio render error|PIPELINE_ERROR_COULD_NOT_RENDER/i.test(error.message||'');
const aborted=()=>new DOMException('Playback was canceled.','AbortError');

export function getAudioEngine(element){
  if(!engines.has(element))engines.set(element,new AudioEngine(element));
  return engines.get(element);
}

export class AudioEngine extends EventTarget{
  constructor(element,{storage,AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext,OfflineAudioContext=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext,fetchFile=globalThis.fetch?.bind(globalThis)}={}){
    super();if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}this.element=element;this.storage=storage;this.Context=AudioContext;this.Decoder=OfflineAudioContext;this.fetchFile=fetchFile;
    this.mode='auto';this.fallback=false;try{const saved=storage?.getItem(MODE_KEY);if(['auto','native','compatibility'].includes(saved))this.mode=saved;this.fallback=storage?.getItem(FALLBACK_KEY)==='true';}catch{}
    this.backend=this.mode==='compatibility'||this.mode==='auto'&&this.fallback?'compatibility':'native';
    this._url=element.getAttribute('src')||'';this._offset=0;this._duration=NaN;this._paused=true;this._seeking=false;this._ended=false;this._ready=0;this._network=0;this._error=null;this._volume=1;this._muted=false;this._loop=false;this._generation=0;this._playTicket=0;
    for(const name of events)element.addEventListener(name,()=>{
      if(this.backend!=='native')return;
      if(name==='error'&&isRendererFailure(element.error)){this.rendererFailure=element.error.message;this.fallback=true;try{storage?.setItem(FALLBACK_KEY,'true');}catch{}}
      this._emit(name);
    });
  }
  _emit(name){this.dispatchEvent(new Event(name));}
  get src(){return this.backend==='native'?this.element.src:this._url;}
  set src(url){this._url=url;if(this.backend==='native')this.element.src=url;else this.load();}
  getAttribute(name){return name==='src'?(this.backend==='native'?this.element.getAttribute(name):this._url||null):this.element.getAttribute(name);}
  removeAttribute(name){this.element.removeAttribute(name);if(name==='src')this._url='';}
  get currentSrc(){return this.backend==='native'?this.element.currentSrc:this._url;}
  get duration(){return this.backend==='native'?this.element.duration:this._duration;}
  get currentTime(){
    if(this.backend==='native')return this.element.currentTime;
    const time=this._offset+(!this._paused&&this.context?Math.max(0,this.context.currentTime-this._startedAt):0);
    return this._loop&&this._duration>0?time%this._duration:Math.min(time,Number.isFinite(this._duration)?this._duration:Infinity);
  }
  set currentTime(value){
    if(this.backend==='native'){this.element.currentTime=value;return;}
    if(!Number.isFinite(value))return;
    this._offset=Math.max(0,Math.min(value,Number.isFinite(this._duration)?this._duration:Infinity));this._ended=false;this._seeking=true;this._emit('seeking');
    if(!this._paused)this._startNode();
    queueMicrotask(()=>{this._seeking=false;this._emit('seeked');this._emit('timeupdate');});
  }
  get paused(){return this.backend==='native'?this.element.paused:this._paused;}
  get seeking(){return this.backend==='native'?this.element.seeking:this._seeking;}
  get ended(){return this.backend==='native'?this.element.ended:this._ended;}
  get readyState(){return this.backend==='native'?this.element.readyState:this._ready;}
  get networkState(){return this.backend==='native'?this.element.networkState:this._network;}
  get error(){return this.backend==='native'?this.element.error:this._error;}
  get playbackRate(){return this.backend==='native'?this.element.playbackRate:1;}
  set playbackRate(value){if(this.backend==='native')this.element.playbackRate=value;}
  get muted(){return this.backend==='native'?this.element.muted:this._muted;}
  set muted(value){this._muted=!!value;this.element.muted=!!value;this._updateGain();}
  get volume(){return this.backend==='native'?this.element.volume:this._volume;}
  set volume(value){this._volume=Math.max(0,Math.min(1,value));this.element.volume=this._volume;this._updateGain();}
  get loop(){return this.backend==='native'?this.element.loop:this._loop;}
  set loop(value){this._loop=!!value;this.element.loop=!!value;if(this.node)this.node.loop=this._loop;}
  _updateGain(){if(this.gain)this.gain.gain.value=this._muted?0:this._volume;}
  _ensureContext(){
    if(this.context&&this.context.state!=='closed')return this.context;
    if(!this.Context)throw new Error('Compatibility audio is unavailable in this browser.');
    let context;try{context=new this.Context({sampleRate:48000});}catch{context=new this.Context();}
    this.context=context;this.gain=context.createGain();this.gain.connect(context.destination);this._updateGain();
    context.addEventListener('statechange',()=>{
      this._emit('outputchange');
      if(this.context!==context||this._paused||context.state==='running')return;
      this.pause();this._error={code:3,message:`Web Audio output interrupted (${context.state}).`};this._emit('error');
    });
    return context;
  }
  unlock(){if(this.backend!=='compatibility')return Promise.resolve();try{return this._ensureContext().resume();}catch(error){return Promise.reject(error);}}
  load(){
    if(this.backend==='native'){this.element.load();return;}
    this.pause();this._generation++;const generation=this._generation,url=this._url;
    this.abortFetch?.abort();this._offset=0;this._duration=NaN;this._ready=0;this._error=null;this._ended=false;this._seeking=false;this._network=url?2:0;this._emit('emptied');
    if(!url){this.buffer=null;this.bufferUrl='';this.loading=null;return;}
    this._emit('loadstart');
    this.loading=(async()=>{
      let buffer=this.bufferUrl===url?this.buffer:null;
      if(!buffer){
        this.buffer=null;this.bufferUrl='';this.abortFetch=new AbortController();
        const response=await this.fetchFile(url,{signal:this.abortFetch.signal});if(!response.ok)throw new Error('Could not read the stored recording.');
        const bytes=await response.arrayBuffer();if(generation!==this._generation)throw aborted();
        if(!this.Decoder)throw new Error('This browser cannot decode compatibility audio.');
        this.decoder ||= new this.Decoder(1,1,48000);buffer=await this.decoder.decodeAudioData(bytes);
      }
      if(generation!==this._generation)throw aborted();
      this.buffer=buffer;this.bufferUrl=url;this._duration=buffer.duration;this._offset=Math.min(this._offset,buffer.duration);this._ready=4;this._network=1;
      this._emit('durationchange');this._emit('loadedmetadata');this._emit('canplay');
    })();
    this.loading.catch(error=>{if(generation!==this._generation||error.name==='AbortError')return;this._error={code:3,message:`Compatibility audio could not decode this recording: ${error.message}`};this._network=1;this._emit('error');});
  }
  _stopNode(){const node=this.node;this.node=null;if(node){node.onended=null;try{node.stop();}catch{}node.disconnect();}clearInterval(this.tick);this.tick=null;}
  _startNode(){
    this._stopNode();const context=this._ensureContext(),node=context.createBufferSource();node.buffer=this.buffer;node.loop=this._loop;node.connect(this.gain);this.node=node;this._startedAt=context.currentTime;
    node.onended=()=>{if(this.node!==node||this._loop)return;this._offset=this._duration;this._paused=true;this._ended=true;this._stopNode();this._emit('timeupdate');this._emit('pause');this._emit('ended');};
    node.start(0,Math.min(this._offset,this._duration));this.tick=setInterval(()=>this._emit('timeupdate'),250);
  }
  async play(){
    if(this.backend==='native')return this.element.play();
    const context=this._ensureContext(),resuming=context.resume(),ticket=++this._playTicket,generation=this._generation;
    await Promise.all([resuming,this.loading]);if(ticket!==this._playTicket||generation!==this._generation||context!==this.context)throw aborted();
    if(context.state!=='running')throw new DOMException('Tap Play to activate the audio output.','NotAllowedError');
    if(this._error)throw new Error(this._error.message);if(!this.buffer)throw new Error('Recording is not ready.');
    if(!this._paused)return;
    if(this._offset>=this._duration-.01)this._offset=0;
    this._error=null;this._paused=false;this._ended=false;
    try{this._startNode();}catch(error){this._paused=true;this._stopNode();this._error={code:3,message:`Web Audio output failed: ${error.message}`};this._emit('error');throw error;}
    this._emit('play');this._emit('playing');
  }
  pause(){
    if(this.backend==='native'){this.element.pause();return;}
    this._playTicket++;const playing=!this._paused;if(playing)this._offset=this.currentTime;
    this._paused=true;this._stopNode();if(playing)this._emit('pause');
  }
  async _closeContext(){const previous=this.context;this.context=null;this.gain=null;if(previous&&previous.state!=='closed')await previous.close().catch(()=>{});}
  async setMode(mode){
    if(!['auto','native','compatibility'].includes(mode))throw new Error('Invalid audio playback mode.');
    this.mode=mode;try{this.storage?.setItem(MODE_KEY,mode);}catch{}
    await this.reconnect();
  }
  async reconnect(){
    const desired=this.mode==='compatibility'||this.mode==='auto'&&this.fallback?'compatibility':'native';
    const url=this.getAttribute('src')||'';this.pause();this._url=url;
    if(this.backend!==desired){
      this._generation++;this.abortFetch?.abort();this._stopNode();
      this.backend=desired;this.element.pause();this.element.removeAttribute('src');this.element.load();
      if(desired==='native'){await this._closeContext();this.buffer=null;this.bufferUrl='';if(url)this.element.src=url;}
      this._emit('enginechange');
    }
    if(this.backend==='compatibility'){await this._closeContext();this.unlock().catch(()=>{});}
    this.load();
  }
  diagnostics(){return [`Audio mode: ${this.mode}; engine: ${this.backend}; renderer fallback saved: ${this.fallback}`,`Last native renderer failure: ${this.rendererFailure||'Not recorded this session'}`,`Web Audio state: ${this.context?.state||'not open'}; sample rate: ${this.context?.sampleRate||'N/A'}; decoded channels: ${this.buffer?.numberOfChannels||'N/A'}`].join('\n');}
}
