import test from 'node:test';import assert from 'node:assert/strict';
import {STEP,STEP_ORDER,LEGACY_STEP_ORDER,STUDY_STEPS,DEFAULT_MINUTES,migrateProgress,migrateTimer,remapStep,remapDurations} from '../dist/study-steps.js';

test('old saved positions follow the same activity through the reorder, exactly once',()=>{
  const expected=[0,1,2,3,6,4,5,7],history={completed:[9,10],days:{'2026-10-18':[10]}};
  for(let step=0;step<8;step++){
    const old={lesson:11,step,tracks:{11:'audio'},completions:history},before=structuredClone(old),next=migrateProgress(old);
    assert.equal(next.step,expected[step]);assert.equal(STEP_ORDER[next.step],LEGACY_STEP_ORDER[step]);assert.equal(next.lesson,11);assert.deepEqual(next.tracks,old.tracks);assert.deepEqual(next.completions,history);assert.deepEqual(migrateProgress(next),next);assert.deepEqual(old,before);
  }
});
test('custom durations and active, paused or overtime clocks stay with their activity',()=>{
  const durations=[1,2,3,4,5,6,7,8],expected=[1,2,3,4,6,7,5,8];
  for(const step of [4,5,6])for(const [remainingMs,deadline] of [[14000,1234567],[14000,null],[-1000,null],[-1000,1234567]]){
    const old={durations,current:{lesson:11,step,remainingMs,deadline,resumeOnStudy:false}},before=structuredClone(old),next=migrateTimer(old);
    assert.deepEqual(next.durations,expected);assert.equal(next.current.step,remapStep(step));assert.equal(next.current.remainingMs,remainingMs);assert.equal(next.current.deadline,deadline);assert.equal(next.current.resumeOnStudy,false);assert.deepEqual(migrateTimer(next),next);assert.deepEqual(old,before);
  }
});
test('explicit orders in backups map by activity identity; invalid orders fail before restore',()=>{
  const reversed=[...STEP_ORDER].reverse(),values=reversed.map(id=>STEP_ORDER.indexOf(id)+1);
  assert.deepEqual(remapDurations(values,reversed),[1,2,3,4,5,6,7,8]);assert.equal(remapStep(1,reversed),STEP.SHADOWING);
  assert.throws(()=>remapStep(4,['shadowing']));assert.throws(()=>remapStep(4,[...STEP_ORDER.slice(0,7),'write']));assert.throws(()=>remapStep(8));assert.throws(()=>remapStep(-1));
  assert.deepEqual(remapDurations(DEFAULT_MINUTES,STEP_ORDER),DEFAULT_MINUTES);assert.equal(migrateTimer(null),null);
});
test('the displayed routine and suggested minutes follow the agreed sequence',()=>{
  assert.deepEqual(STUDY_STEPS.map(([name])=>name),['Review','Blind listening','Understand','Read along','Exercises','Write','Shadowing','Recall']);
  assert.deepEqual(DEFAULT_MINUTES,[5,3,7,5,8,5,10,2]);assert.equal(DEFAULT_MINUTES.reduce((sum,n)=>sum+n),45);
});
