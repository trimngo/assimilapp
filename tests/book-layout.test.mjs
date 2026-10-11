import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {BOOK_LAYOUT_ALGORITHM,pageLayout,verifyBookLayout} from '../dist/book-layout.js';
import {hashFile} from '../dist/file-hash.js';

const text=Array.from({length:160},(_,i)=>`Sentence ${i}: German Äpfel und English translation.`).join(' ');
const page=(str=text,{y=700,x=40}={})=>({
  getViewport:()=>({width:600,height:800,transform:[1,0,0,-1,0,800]}),
  getTextContent:async()=>({items:[{str,transform:[12,0,0,12,x,y],width:510,height:12}]}),cleanup(){}
});
async function profile(pages){return {algorithm:BOOK_LAYOUT_ALGORITHM,pageCount:pages.length,layoutSignature:'verified',pages:await Promise.all(pages.map(pageLayout))};}
const doc=pages=>({numPages:pages.length,getPage:async n=>pages[n-1]});

test('layout matching checks every page and tolerates punctuation/glyph changes',async()=>{
  const expected=await profile([page(),page(text+' End.')]),progress=[];
  assert.equal(await verifyBookLayout(doc([page(text.replace('Sentence 70','Sentence–70')),page(text+' End!')]),expected,{onProgress:n=>progress.push(n)}),'verified');
  assert.deepEqual(progress,[1,2]);
  assert(!JSON.stringify(expected).includes('German'));
});
test('page count, changed page order and shifted text refuse automatic crops',async()=>{
  const expected=await profile([page(),page('different '.repeat(900))]);
  const rejects=pages=>assert.rejects(verifyBookLayout(doc(pages),expected),{name:'BookLayoutMismatch'});
  await rejects([page()]);
  await rejects([page('different '.repeat(900)),page()]);
  await rejects([page(text,{y:670}),page('different '.repeat(900))]);
  await rejects([page(''),page('different '.repeat(900))]);
});
test('matching is cancellable without recording a result',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(verifyBookLayout(doc([page()]),await profile([page()]),{signal:controller.signal}),{name:'AbortError'});
});
test('prepared profile covers every source page and matches its saved signature',()=>{
  const hosted=readFileSync(new URL('../dist/combined-layout.json',import.meta.url));
  const prepared=readFileSync(new URL('../course/combined-layout.json',import.meta.url));
  assert.deepEqual(JSON.parse(hosted),JSON.parse(prepared));
  const data=JSON.parse(hosted),index=JSON.parse(readFileSync(new URL('../dist/course-index.json',import.meta.url)));
  assert.equal(data.pages.length,614);assert.equal(data.courseId,index.courseId);
  assert.equal(data.layoutSignature,index.book.combinedLayoutSignature);
  assert.equal(createHash('sha256').update(JSON.stringify(data.pages)).digest('hex'),data.layoutSignature);
});
test('large file identity matches SHA-256 without requesting the whole file buffer',async()=>{
  const bytes=Uint8Array.from({length:3500000},(_,i)=>i%251),blob=new Blob([bytes]);let largest=0;
  const file={size:blob.size,slice(start,end){largest=Math.max(largest,end-start);return blob.slice(start,end);},arrayBuffer(){throw new Error('Whole file buffer requested');}};
  assert.equal(await hashFile(file),createHash('sha256').update(bytes).digest('hex'));assert(largest<=1048576);
  assert.equal(await hashFile(new Blob()),createHash('sha256').digest('hex'));
});
