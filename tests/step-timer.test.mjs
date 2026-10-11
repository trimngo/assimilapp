import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingTime,formatCountdown,validateDurations} from '../dist/step-timer.js';

test('countdown uses elapsed wall time when the browser suspends ticks or reloads',()=>{
  const stored={remainingMs:300000,deadline:1300000};
  assert.equal(remainingTime(stored,1000000),300000);
  const reopened=JSON.parse(JSON.stringify(stored));
  assert.equal(remainingTime(reopened,1123456),176544);
  assert.equal(remainingTime(reopened,1300000),0);
  assert.equal(remainingTime(reopened,1500000),0);
  assert.equal(remainingTime(reopened,900000),300000);
});
test('pausing freezes remaining time until a new deadline is set',()=>{
  const paused={remainingMs:remainingTime({remainingMs:300000,deadline:1300000},1123456),deadline:null};
  assert.equal(remainingTime(paused,2000000),176544);
  const resumed={...paused,deadline:2000000+paused.remainingMs};
  assert.equal(remainingTime(resumed,2020000),156544);
  assert.equal(formatCountdown(156544),'02:37');
  assert.equal(formatCountdown(0),'00:00');
  assert.equal(formatCountdown(180*60000),'180:00');
});
test('invalid backup durations cannot turn a countdown negative or unbounded',()=>{
  const valid=[5,3,7,5,10,8,5,2];
  for(const value of [-1,0,Infinity,NaN,'5',181])assert.throws(()=>validateDurations([value,...valid.slice(1)]));
  assert.throws(()=>validateDurations(valid.slice(1)));
  assert.throws(()=>validateDurations(null));
  assert.deepEqual(validateDurations([.1,...valid.slice(1)]),[.1,...valid.slice(1)]);
});
