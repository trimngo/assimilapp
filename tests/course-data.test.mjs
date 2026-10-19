import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchedAudio,matchedSource,matchedCombinedBook,lessonPages,preparedSentences,preparedDialogue,dialogueCount,sentenceBookItems,sentencePages} from '../dist/course-data.js';
const index=JSON.parse(readFileSync(new URL('../dist/course-index.json',import.meta.url)));
const books=index.book.sources.map(source=>({id:source.id,kind:'pdf',name:source.filename,size:source.bytes,sha256:source.sha256}));

test('English prompt crops cover every dialogue item and remain inside reviewed English-only regions',()=>{
  const full={id:'full',kind:'pdf',verifiedBookLayout:index.book.combinedLayoutSignature};
  for(const lesson of index.lessons){
    const refs=lesson.englishSentenceExcerpts;
    assert.deepEqual([...new Set(refs.map(ref=>ref.number))],Array.from({length:lesson.numberedLineCount},(_,i)=>i+1));
    for(const ref of refs){
      const [x0,y0,x1,y1]=ref.crop;assert(x0>=0&&y0>=0&&x1<=1&&y1<=1&&x0<x1&&y0<y1);assert(!('text' in ref));
      assert(lesson.englishRecall.some(parent=>parent.globalPage===ref.globalPage&&parent.sourceId===ref.sourceId&&ref.crop.every((value,i)=>i<2?value>=parent.crop[i]-.000001:value<=parent.crop[i]+.000001)));
      if(lesson.kind==='review')assert(ref.visibleBands?.length);
      for(const band of ref.visibleBands||[]){assert(band[0]<band[2]&&band[1]<band[3]);assert(band.every((value,i)=>i<2?value>=ref.crop[i]-.000001:value<=ref.crop[i]+.000001));}
    }
    const items=Array.from({length:lesson.numberedLineCount},(_,i)=>i+1),split=sentencePages(index,books,lesson.number,items,'en'),combined=sentencePages(index,[full],lesson.number,items,'en');
    assert(split.every(page=>page.file&&page.language==='en'));
    assert(combined.every(page=>page.file.id==='full'&&page.page===page.globalPage&&page.language==='en'));
    assert.deepEqual(combined.map(page=>page.crop),split.map(page=>page.crop));
  }
  assert.equal(sentencePages(index,books,98,[19],'en').length,2,'English review prompts can continue on the next page');
  const inline=sentencePages(index,books,98,[8],'en');assert(inline[0].visibleBands[0].x>.2,'Neighbouring inline translations are blanked without resizing the page');
  assert(sentencePages(index,[books[0]],58,[1],'en').every(page=>!page.file&&page.sourceId==='301-600.pdf'));
});

test('every numbered dialogue item has a valid private-book excerpt, in split and full books',()=>{
  const full={id:'full',kind:'pdf',verifiedBookLayout:index.book.combinedLayoutSignature};
  for(const lesson of index.lessons){
    const refs=lesson.sentenceExcerpts;assert.deepEqual(refs.map(ref=>ref.number),Array.from({length:lesson.numberedLineCount},(_,i)=>i+1));
    for(const ref of refs){const [x0,y0,x1,y1]=ref.crop;assert(x0>=0&&y0>=0&&x1<=1&&y1<=1&&x0<x1&&y0<y1);assert(!('text' in ref));}
    const items=refs.map(ref=>ref.number),split=sentencePages(index,books,lesson.number,items),combined=sentencePages(index,[full],lesson.number,items);
    assert(split.every(page=>page.file));assert(combined.every(page=>page.file.id==='full'&&page.page===page.globalPage));
    assert.deepEqual(combined.map(page=>page.crop),split.map(page=>page.crop));
  }
  const partial=sentencePages(index,[books[0]],58,index.lessons[57].sentenceExcerpts.map(ref=>ref.number));assert(partial.every(page=>!page.file&&page.sourceId==='301-600.pdf'));
});

test('sentence text follows book items across prepared merges, custom corrections and splits',()=>{
  const lesson=index.lessons[10],prepared=preparedSentences(lesson);
  assert.deepEqual(sentenceBookItems(lesson,prepared),Array.from({length:8},(_,i)=>[i+1]));
  const legacy=[...prepared.slice(0,6),{start:prepared[6].start,end:prepared[7].end}];
  assert.deepEqual(sentenceBookItems(lesson,legacy,true).at(-1),[7,8]);
  const split=[{start:prepared[0].start,end:(prepared[0].start+prepared[0].end)/2},{start:(prepared[0].start+prepared[0].end)/2,end:prepared[0].end},...prepared.slice(1)];
  assert.deepEqual(sentenceBookItems(lesson,split,true).slice(0,3),[[1],[1],[2]]);
  assert.deepEqual(sentenceBookItems(lesson,prepared.map((cut,i)=>({...cut,start:cut.start+(i===1?-.25:0)})),true),Array.from({length:8},(_,i)=>[i+1]));
  assert.deepEqual(sentenceBookItems(lesson,[{start:0,end:1}],true),[[]]);assert.deepEqual(sentenceBookItems(null,[{start:0,end:1}]),[[]]);
  const merged=index.lessons.find(l=>l.audio.sentenceAlignment.sentenceSegments.some(s=>s.bookItems.length>1));assert(sentenceBookItems(merged,preparedSentences(merged)).some(items=>items.length>1));
});

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
test('verified full books use global page references for all lessons and recall crops',()=>{
  const full={id:'full-book',kind:'pdf',verifiedBookLayout:index.book.combinedLayoutSignature};
  assert(matchedCombinedBook(index,full));
  assert(!matchedCombinedBook(index,{...full,verifiedBookLayout:'old-profile'}));
  assert(!matchedCombinedBook(index,{id:'unverified',kind:'pdf',size:51619803}));
  for(const lesson of index.lessons)for(const recall of [false,true]){
    const split=lessonPages(index,books,lesson.number,recall);
    const combined=lessonPages(index,[...books,full],lesson.number,recall);
    assert(combined.every(page=>page.file.id===full.id&&page.page===page.globalPage));
    assert.deepEqual(combined.map(page=>page.crop),split.map(page=>page.crop));
  }
  assert.deepEqual(lessonPages(index,[full],57).map(page=>page.page),[297,298,299,300,301,302]);
  assert(lessonPages(index,[{...full,verifiedBookLayout:undefined}],1).every(page=>!page.file));
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
test('lesson playback includes its spoken title and blind listening includes both readings',()=>{
  for(const lesson of index.lessons){
    const single=preparedDialogue(lesson),blind=preparedDialogue(lesson,true);
    assert.equal(single.start,0);
    assert.equal(single.end,lesson.audio.dialogue.end);
    assert.equal(blind.start,single.start);
    if(lesson.audio.repeatDialogue){
      assert(blind.end>=lesson.audio.repeatDialogue.end);assert(blind.end>single.end);assert(blind.end<=lesson.audio.duration);
    }else assert.deepEqual(blind,single);
  }
  const first=index.lessons[0];assert(preparedDialogue(first,true).end>47);assert(preparedDialogue(first).end<21);
  assert.equal(preparedDialogue(null,true),null);
});
test('hosted metadata equals the reviewed source index',()=>{
  assert.deepEqual(index,JSON.parse(readFileSync(new URL('../course/assimil-german.index.json',import.meta.url))));
});


test('book numbering stays the expected count even for missing or intentionally extra custom cuts',()=>{
  const lesson=index.lessons[10];assert.equal(lesson.numberedLineCount,8);
  assert.deepEqual(dialogueCount(lesson,7),{actual:7,expected:8,matches:false});
  assert.deepEqual(dialogueCount(lesson,8),{actual:8,expected:8,matches:true});
  assert.deepEqual(dialogueCount(lesson,9),{actual:9,expected:8,matches:false});
  assert.deepEqual(dialogueCount(null,7),{actual:7,expected:null,matches:null});
});
