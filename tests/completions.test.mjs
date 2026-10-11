import test from 'node:test';
import assert from 'node:assert/strict';
import {localDay,validDay,emptyCompletions,validateCompletions,recordCompletion,markCompleted,unmarkCompleted,weekCount,monthDays} from '../dist/completions.js';

test('a lesson counts once per day and stays unique overall when repeated on another day',()=>{
  let history=recordCompletion(emptyCompletions(),9,'2026-10-11');
  history=recordCompletion(history,9,'2026-10-11');history=recordCompletion(history,10,'2026-10-11');
  history=recordCompletion(history,9,'2026-10-12');
  assert.deepEqual(history.completed,[9,10]);assert.deepEqual(history.days['2026-10-11'],[9,10]);assert.deepEqual(history.days['2026-10-12'],[9]);
});
test('historical marking adds no guessed dates and unmarking removes related activity only',()=>{
  const history=recordCompletion(recordCompletion(emptyCompletions(),9,'2026-10-11'),10,'2026-10-11');
  const marked=markCompleted(history,[1,2,9]);assert.deepEqual(marked.completed,[1,2,9,10]);assert.deepEqual(marked.days,history.days);
  const undone=unmarkCompleted(marked,9);assert.deepEqual(undone.completed,[1,2,10]);assert.deepEqual(undone.days,{'2026-10-11':[10]});
  assert.deepEqual(unmarkCompleted(undone,10).days,{});assert.deepEqual(history.completed,[9,10]);
});
test('calendar and weekly counts handle leap years, year boundaries and Monday starts',()=>{
  const february=monthDays(2024,1);assert.equal(february.length%7,0);assert.equal(february.filter(Boolean).length,29);assert.equal(february[3],'2024-02-01');assert(february.includes('2024-02-29'));
  const history={completed:[1,2,3,4],days:{'2025-12-28':[1],'2025-12-29':[2],'2026-01-01':[3,4],'2026-01-04':[2],'2026-01-05':[1]}};
  assert.equal(weekCount(history,new Date(2026,0,1,12)),4);assert.equal(weekCount(history,new Date(2026,0,4,23)),4);assert.equal(weekCount(history,new Date(2026,0,5,0)),1);
});
test('local completion dates use the device day rather than the UTC day',()=>{
  const previous=process.env.TZ;
  try{process.env.TZ='America/Los_Angeles';assert.equal(localDay(new Date('2026-10-12T01:00:00Z')),'2026-10-11');process.env.TZ='Asia/Tokyo';assert.equal(localDay(new Date('2026-10-11T20:00:00Z')),'2026-10-12');}
  finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('backup validation rejects impossible dates and lesson numbers, and deduplicates valid history',()=>{
  for(const day of ['2026-02-29','2026-13-01','2026-10-00','2026-10-11T00:00:00Z']){
    assert.equal(validDay(day),false);assert.throws(()=>validateCompletions({completed:[1],days:{[day]:[1]}}));
  }
  for(const lesson of [0,-1,10000,'9',1.5])assert.throws(()=>validateCompletions({completed:[lesson],days:{}}));
  assert.deepEqual(validateCompletions({completed:[2,2],days:{'2026-10-11':[3,3,2]}}),{completed:[2,3],days:{'2026-10-11':[2,3]}});
  assert.throws(()=>validateCompletions({completed:[],days:[]}));assert.throws(()=>validateCompletions(null));
});
