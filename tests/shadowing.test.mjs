import test from 'node:test';import assert from 'node:assert/strict';
import {shadowingPass,shadowingRange} from '../dist/shadowing.js';
test('the learning sequence alternates text for each new sentence and the growing dialogue',()=>{
  const passes=Array.from({length:10},(_,i)=>shadowingPass(3,i));
  assert.deepEqual(passes.map(p=>[p.first,p.last,p.withText]),[
    [0,0,true],[0,0,false],[1,1,true],[1,1,false],[0,1,true],[0,1,false],
    [2,2,true],[2,2,false],[0,2,true],[0,2,false]
  ]);assert(passes.at(-1).final);assert.equal(passes.at(-1).label,'Sentences 1–3');
});
test('ranges respect edited endpoints and changing sentence counts leaves a valid final pass',()=>{
  const spans=[{start:6,end:7.1},{start:10,end:11.1},{start:14,end:15.2}];
  assert.deepEqual(shadowingRange(spans,2),spans[1]);assert.deepEqual(shadowingRange(spans,4),{start:6,end:11.1});
  assert.deepEqual(shadowingRange(spans,99),{start:6,end:15.2});assert.equal(shadowingPass(1,99).index,1);assert.equal(shadowingPass(0),null);assert.equal(shadowingRange([],0),null);
});
