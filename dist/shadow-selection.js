// Saved independently of the audio clock: seeking never changes the checkboxes.
const cuts=spans=>spans.map(({start,end})=>({start,end}));
const clamp=(time,span)=>Math.max(span.start,Math.min(time,span.end));

export function selectionState(spans,saved){
  if(!saved)return {spans:cuts(spans),selected:spans.length?[0]:[],repeat:false,index:0,time:spans[0]?.start||0,completed:false};
  const sameCount=saved.spans.length===spans.length;
  const previous=new Set(saved.selected);
  // Timing edits keep ordinal identities. Insertion/splitting follows the old
  // interval, so a selected split stays selected and an unrelated new cut does not.
  const origins=spans.map((span,i)=>sameCount?i:saved.spans.findIndex(old=>old.start===span.start&&old.end===span.end));
  spans.forEach((span,i)=>{if(origins[i]<0){const mid=(span.start+span.end)/2;origins[i]=saved.spans.findIndex(old=>mid>=old.start&&mid<old.end);}});
  const selected=origins.flatMap((origin,i)=>previous.has(origin)?[i]:[]);
  let index=sameCount?saved.index:origins.findIndex((origin,i)=>origin===saved.index&&saved.time>=spans[i].start&&saved.time<spans[i].end);
  if(index<0)index=origins.indexOf(saved.index);
  if(index<0||index>=spans.length)index=selected[0]??0;
  return {spans:cuts(spans),selected,repeat:!!saved.repeat,index,time:spans[index]?clamp(saved.time,spans[index]):0,completed:!!saved.completed};
}

export function selectionQueue(state){
  return state.selected.map(index=>({index,...state.spans[index]})).filter(span=>Number.isFinite(span?.end));
}

export function selectionStart(state,queue){
  if(!queue.length)return null;
  const at=state.completed?-1:queue.findIndex(span=>span.index===state.index&&state.time<span.end-.01);
  const cursor=at<0?0:at;
  return {cursor,time:at<0?queue[0].start:clamp(state.time,queue[cursor])};
}

export function validateSelection(state){
  const invalid=()=>{throw new Error('Invalid shadowing selection in backup.');};
  if(!state||!Array.isArray(state.spans)||state.spans.length>1000||!Array.isArray(state.selected)||typeof state.repeat!=='boolean'||typeof state.completed!=='boolean'||!Number.isInteger(state.index)||state.index<0||state.index>=Math.max(1,state.spans.length)||!Number.isFinite(state.time)||state.time<0)invalid();
  let end=0;
  for(const span of state.spans){if(!span||!Number.isFinite(span.start)||!Number.isFinite(span.end)||span.start<end||span.end<=span.start)invalid();end=span.end;}
  let last=-1;
  for(const index of state.selected){if(!Number.isInteger(index)||index<=last||index>=state.spans.length)invalid();last=index;}
  if(state.spans.length&&(state.time<state.spans[state.index].start||state.time>state.spans[state.index].end))invalid();
  return selectionState(state.spans,state);
}
