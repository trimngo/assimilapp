import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchedAudio,matchedSource,lessonPages,preparedSentences} from '../dist/course-data.js';
const index=JSON.parse(readFileSync(new URL('../dist/course-index.json',import.meta.url)));
const books=index.book.sources.map(source=>({id:source.id,kind:'pdf',name:source.filename,size:source.bytes,sha256:source.sha256}));

test('prepared mappings require matching content, including renamed files',()=>{
  const source=books[0];assert.equal(matchedSource(index,{...source,name:'renamed.pdf'}).id,source.id);
  assert.equal(matchedSource(index,{...source,sha256:'different'}),null);
  assert.equal(matchedSource(index,{...source,sha256:undefined}),null);
  const audio=index.lessons[0].audio;
  assert.equal(matchedAudio(index,{kind:'audio',name:'renamed.mp3',sha256:audio.sha256}).number,1);
  assert.equal(matchedAudio(index,{kind:'audio',name:audio.filename,size:audio.bytes}),null);
});
test('lesson 57 spans both PDFs and missing parts stay explicit',()=>{
  const pages=lessonPages(index,books,57);
  assert.deepEqual(pages.map(page=>page.globalPage),[297,298,299,300,301,302]);
  assert.equal(pages[4].file.id,'301-600.pdf');assert.equal(pages[4].page,1);
  const partial=lessonPages(index,[books[0]],57);
  assert.equal(partial[4].file,null);assert(partial.slice(0,4).every(page=>page.file));
});
test('recall includes all translation crops, including review translations on following pages',()=>{
  for(const lesson of index.lessons){
    const pages=lessonPages(index,books,lesson.number,true);
    assert.equal(pages.length,lesson.englishRecall.length);
    assert(pages.every(page=>page.file&&page.crop.h<1&&page.crop.w>0));
  }
  const review=index.lessons[6];assert(lessonPages(index,books,7,true).some(page=>page.globalPage>=index.lessons[7].startGlobalPage));
  assert.equal(review.kind,'review');
});
test('prepared sentence padding stays ordered and flags remain visible',()=>{
  let flagged=0;
  for(const lesson of index.lessons){
    const spans=preparedSentences(lesson);assert(spans.length);
    for(let i=0;i<spans.length;i++){assert(spans[i].start>=0);assert(spans[i].end>spans[i].start);assert(spans[i].end<=lesson.audio.duration);if(i)assert(spans[i].start>=spans[i-1].end-1e-8);if(spans[i].needsReview)flagged++;}
  }
  assert(flagged>0);
});
test('hosted metadata equals the reviewed source index',()=>{
  assert.deepEqual(index,JSON.parse(readFileSync(new URL('../course/assimil-german.index.json',import.meta.url))));
});
