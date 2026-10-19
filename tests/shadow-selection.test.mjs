import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionState,selectionQueue,selectionStart,selectionRun,validateSelection} from '../dist/shadow-selection.js';

const spans=[{start:2,end:4},{start:5,end:8},{start:10,end:12}];
test('nonadjacent checked sentences retain dialogue order and resume their own cursor',()=>{
  const state={...selectionState(spans),selected:[0,2],index:2,time:11,repeat:true};
  const queue=selectionQueue(state);
  assert.deepEqual(queue,[{index:0,start:2,end:4},{index:2,start:10,end:12}]);
  assert.deepEqual(selectionStart(state,queue),{cursor:1,time:11});
  assert.deepEqual(selectionStart({...state,completed:true},queue),{cursor:0,time:2});
  assert.deepEqual(selectionStart({...state,index:1,time:6},queue),{cursor:0,time:2});
  assert.equal(selectionStart(state,[]),null);
});
test('editing, inserting and splitting preserve existing checked identities and an empty selection',()=>{
  const state={...selectionState(spans),selected:[1],index:1,time:7,repeat:true,repeatDelay:5};
  const edited=selectionState([{start:2,end:4},{start:5.5,end:6.5},spans[2]],state);
  assert.deepEqual(edited.selected,[1]);assert.equal(edited.time,7);assert.equal(edited.repeatDelay,5);
  const inserted=selectionState([spans[0],{start:4,end:4.5},spans[1],spans[2]],state);
  assert.deepEqual(inserted.selected,[2]);assert.equal(inserted.index,2);
  const split=selectionState([spans[0],{start:5,end:6},{start:6,end:8},spans[2]],state);
  assert.deepEqual(split.selected,[1,2]);assert.equal(split.index,2);assert.equal(split.time,7);
  assert.deepEqual(selectionState(spans,{...state,selected:[]}).selected,[]);
});
test('backup selections validate atomically, including empty selections and old cut snapshots',()=>{
  const state={...selectionState(spans),selected:[],index:1,time:5,repeat:true};
  assert.deepEqual(validateSelection(state),state);
  const {repeatDelay,...legacy}=state;assert.equal(validateSelection(legacy).repeatDelay,0);
  assert.equal(validateSelection({...state,repeatDelay:8}).repeatDelay,8);
  const {language,...old}=state;assert.equal(validateSelection(old).language,'de');
  assert.equal(validateSelection({...state,language:'en'}).language,'en');
  for(const invalid of [{language:'fr'},{repeatDelay:-1},{repeatDelay:1.5},{repeatDelay:'5'},{repeatDelay:Infinity},{repeatDelay:61},{selected:[2,0]},{selected:[1,1]},{selected:[3]},{time:100},{index:-1},{repeat:'true'},{spans:[{start:0,end:2},{start:1,end:3}]}])assert.throws(()=>validateSelection({...state,...invalid}),/Invalid shadowing/);
});

test('adjacent checked sentences preserve the recording, skipped speech keeps only its preceding pause',()=>{
  const state={...selectionState(spans),selected:[0,1,2],language:'en'},queue=selectionQueue(state);
  assert.deepEqual(selectionRun(spans,queue,0),{start:2,end:12,index:0,last:2});
  const skipped=selectionQueue({...state,selected:[0,2]});
  assert.deepEqual(selectionRun(spans,skipped,0),{start:2,end:5,index:0,last:0});
  assert.deepEqual(selectionRun(spans,skipped,1),{start:10,end:12,index:2,last:1});
  const paused={...state,index:0,time:4.5};
  assert.deepEqual(selectionStart(paused,queue),{cursor:0,time:4.5});
  assert.equal(validateSelection(paused).time,4.5);
  assert.equal(selectionState(spans,paused).language,'en');
  assert.deepEqual(selectionStart({...paused,time:5},queue),{cursor:1,time:5});
});
