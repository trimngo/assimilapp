import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileVoiceSlots} from '../dist/voice-store.js';
const spans=[{start:1,end:3},{start:4,end:6},{start:7,end:9}],previous={spans,slots:['a','b','c']};
test('voice takes retain sentence identity across timing corrections',()=>{
  assert.deepEqual(reconcileVoiceSlots(previous,[{start:.8,end:2.5},{start:3,end:5.8},{start:7.1,end:9.2}]).slots,['a','b','c']);
});
test('inserting a missing sentence keeps existing recordings on their exact rows',()=>{
  assert.deepEqual(reconcileVoiceSlots(previous,[spans[0],{start:3.1,end:3.9},spans[1],spans[2]],()=> 'new').slots,['a','new','b','c']);
});
test('splitting and merging never duplicate a take across sentences',()=>{
  const split=reconcileVoiceSlots(previous,[{start:1,end:2},{start:2.1,end:3},spans[1],spans[2]],()=> 'new');
  assert.deepEqual(split.slots,['a','new','b','c']);assert.equal(new Set(split.slots).size,4);
  const merged=reconcileVoiceSlots(previous,[{start:1,end:6},spans[2]]);assert.deepEqual(merged.slots,['a','c']);
});
