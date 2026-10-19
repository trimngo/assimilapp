// Voice blobs live in a separate local database; lesson/progress storage is untouched.
const cuts=spans=>spans.map(({start,end})=>({start,end}));
export function reconcileVoiceSlots(previous,spans,makeId=()=>crypto.randomUUID()){
  if(!previous)return {spans:cuts(spans),slots:spans.map(()=>makeId())};
  if(previous.spans.length===spans.length)return {spans:cuts(spans),slots:[...previous.slots]};
  const used=new Set(),slots=spans.map(span=>{
    const index=previous.spans.findIndex((old,i)=>!used.has(i)&&old.start===span.start&&old.end===span.end);
    if(index<0)return null;used.add(index);return previous.slots[index];
  });
  // Reserve exact matches first. A split inherits its old take only once;
  // an inserted sentence never shifts another sentence's recording onto it.
  spans.forEach((span,i)=>{
    if(slots[i])return;
    const candidates=previous.spans.map((old,index)=>({index,overlap:Math.min(old.end,span.end)-Math.max(old.start,span.start)}))
      .filter(item=>!used.has(item.index)&&item.overlap>0).sort((a,b)=>b.overlap-a.overlap);
    const match=candidates[0];if(match){used.add(match.index);slots[i]=previous.slots[match.index];}else slots[i]=makeId();
  });
  return {spans:cuts(spans),slots};
}

export class VoiceStore{
  constructor(factory=globalThis.indexedDB){this.factory=factory;}
  open(){
    if(!this.opening)this.opening=new Promise((resolve,reject)=>{
      const request=this.factory.open('german-study-voice',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('lessons',{keyPath:'scope'});const takes=request.result.createObjectStore('takes',{keyPath:'key'});takes.createIndex('scope','scope');};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();this.opening=null;};resolve(request.result);};
      request.onerror=()=>{this.opening=null;reject(request.error);};
    });
    return this.opening;
  }
  async load(scope){
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['lessons','takes']),mapping=tx.objectStore('lessons').get(scope),takes=tx.objectStore('takes').index('scope').getAll(scope);
      tx.oncomplete=()=>resolve({mapping:mapping.result,takes:takes.result});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Voice storage was interrupted.'));
    });
  }
  async save(model,take){
    const mapping={scope:model.scope,spans:cuts(model.spans),slots:[...model.slots]};
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['lessons','takes'],'readwrite');
      // One transaction commits both the sentence identity and replacement blob.
      tx.objectStore('lessons').put(mapping);if(take)tx.objectStore('takes').put(take);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Voice storage was interrupted.'));
    });
  }
}
