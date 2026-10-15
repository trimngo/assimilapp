// One sentence with/without text, then the growing dialogue with/without text.
export function shadowingPass(count,position=0){
  if(!Number.isInteger(count)||count<1)return null;
  const total=count*4-2,index=Math.max(0,Math.min(Number.isInteger(position)?position:0,total-1));
  const sentence=index<2?0:1+Math.floor((index-2)/4),part=index<2?index:(index-2)%4;
  const cumulative=part>=2,first=cumulative?0:sentence;
  return {index,total,sentence,part,stageCount:sentence===0?2:4,first,last:sentence,withText:part%2===0,cumulative,final:index===total-1,
    label:first===sentence?`Sentence ${sentence+1}`:`Sentences 1–${sentence+1}`};
}

// Keep the saved position format while exposing sentence/stage navigation.
export function shadowingPosition(sentence,part=0){
  if(!Number.isInteger(sentence)||sentence<0)return 0;
  const stage=Math.max(0,Math.min(Number.isInteger(part)?part:0,sentence===0?1:3));
  return sentence===0?stage:2+(sentence-1)*4+stage;
}

export function shadowingRange(spans,position){
  const pass=shadowingPass(spans.length,position);
  return pass?{start:spans[pass.first].start,end:spans[pass.last].end}:null;
}
