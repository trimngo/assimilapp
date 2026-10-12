import test from 'node:test';
import assert from 'node:assert/strict';
import {detectSegments,validateSegments,parseSegments,replaceSegment,insertSegment,splitSegment} from '../dist/audio-tools.js';

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
test('editing one sentence preserves neighbors and their review flags',()=>{
  const original=[{start:1.2844,end:2.31,needsReview:true},{start:2.5,end:4,needsReview:true},{start:4.5,end:6,needsReview:true}];
  const edited=replaceSegment(original,1,{start:'2.45',end:'4.10'},10);
  assert.deepEqual(edited[0],original[0]);assert.deepEqual(edited[2],original[2]);
  assert.deepEqual(edited[1],{start:2.45,end:4.1,needsReview:false});assert.equal(original[1].start,2.5);
  // Backup/restore retains flags on other draft cuts.
  assert.equal(validateSegments(edited,10)[0].needsReview,true);
  for(const times of [{start:2,end:4},{start:2.5,end:5},{start:-.1,end:4},{start:3,end:2},{start:2.5,end:11}])
    assert.throws(()=>replaceSegment(original,1,times,10));
  assert.throws(()=>replaceSegment(original,3,{start:2.5,end:4},10));
});


test('inserting missing sentences orders cuts and preserves all prior edits and flags',()=>{
  const original=[{start:2.123,end:3,needsReview:true},{start:6,end:7,needsReview:false}];
  for(const [times,index] of [[{start:0,end:1},0],[{start:4,end:5},1],[{start:8,end:9},2]]){
    const result=insertSegment(original,times,10);
    assert.equal(result.index,index);assert.deepEqual(result.segments[index],times);
    assert.deepEqual(result.segments.filter((_,i)=>i!==index),original);
  }
  assert.equal(original.length,2);
  for(const times of [{start:2.5,end:4},{start:1,end:2.5},{start:6,end:7},{start:9,end:11},{start:5,end:4},{start:-1,end:1},{start:'bad',end:1}])assert.throws(()=>insertSegment(original,times,10));
  assert.deepEqual(insertSegment([], {start:1,end:2},10),{segments:[{start:1,end:2}],index:0});
});
test('splitting a merged sentence selects the second half without changing neighbors',()=>{
  const original=[{start:1,end:2,needsReview:false},{start:3,end:7,needsReview:true},{start:8,end:9}];
  const result=splitSegment(original,1,5,10);
  assert.equal(result.index,2);assert.deepEqual(result.segments,[original[0],{start:3,end:5,needsReview:true},{start:5,end:7,needsReview:true},original[2]]);
  assert.equal(original.length,3);assert.equal(original[1].end,7);
  for(const time of [2,3,7,8,NaN])assert.throws(()=>splitSegment(original,1,time,10));
  assert.throws(()=>splitSegment(original,-1,5,10));
  assert.deepEqual(validateSegments(JSON.parse(JSON.stringify(result.segments)),10),validateSegments(result.segments,10));
});
