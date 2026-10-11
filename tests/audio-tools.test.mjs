import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSegments,validateSegments,parseSegments} from '../dist/audio-tools.js';

test('pause detection separates long gaps while keeping short speech pauses together',()=>{
  const rate=16000,samples=new Float32Array(rate*5);
  for(let i=0;i<samples.length;i++){
    const t=i/rate;
    if((t>.2&&t<1)||(t>1.2&&t<2)||(t>2.8&&t<4.3))samples[i]=.2*Math.sin(i*2*Math.PI*220/rate);
  }
  const spans=detectSegments([samples],rate,5);
  assert.equal(spans.length,2);
  assert(spans[0].start<.25&&spans[0].end>2&&spans[0].end<2.2);
  assert(spans[1].start>2.6&&spans[1].end>4.2);
});
test('sentence timing edits reject overlapping, reversed, and out-of-recording ranges',()=>{
  for(const spans of [[{start:0,end:2},{start:1,end:3}],[{start:2,end:1}],[{start:-1,end:1}],[{start:0,end:6}]])assert.throws(()=>validateSegments(spans,5));
  assert.deepEqual(validateSegments([{start:0,end:1},{start:1,end:2}],5),[{start:0,end:1},{start:1,end:2}]);
});
test('timing text accepts seconds in pairs and rejects malformed entries',()=>{
  assert.deepEqual(parseSegments('0, 1\n1.5; 2.5\n3 4',5),[{start:0,end:1},{start:1.5,end:2.5},{start:3,end:4}]);
  assert.throws(()=>parseSegments('0, 1, 2',5));
  assert.throws(()=>parseSegments('hello, 2',5));
});
