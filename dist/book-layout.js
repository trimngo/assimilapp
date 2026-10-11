import {sha256} from './vendor/sha256.mjs';
export const BOOK_LAYOUT_ALGORITHM='pdfjs-text-geometry-v1';
const rounded=value=>Math.round(value*10000)/10000;
export const hexHash=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const digest=value=>hexHash(sha256(new TextEncoder().encode(value)));
const normalize=value=>value.normalize('NFKD').toLowerCase().replace(/ß/g,'ss').replace(/[^a-z0-9]/g,'');
async function extractLayout(page){
  const viewport=page.getViewport({scale:1}),content=await page.getTextContent();
  const [a,b,c,d,e,f]=viewport.transform;const parts=[];let text='';
  const items=content.items.filter(item=>typeof item.str==='string').map(item=>{
    const x=item.transform[4],y=item.transform[5];
    const left=(a*x+c*y+e)/viewport.width,top=(b*x+d*y+f)/viewport.height,width=item.width/viewport.width;
    const str=normalize(item.str);if(str){parts.push({start:text.length,end:text.length+str.length,x:left,y:top,w:width});text+=str;}
    return [item.str.normalize('NFKC').replace(/\s+/g,''),rounded(left),rounded(top),rounded(width),rounded(item.height/viewport.height)];
  }).filter(item=>item[0]);
  return {width:rounded(viewport.width),height:rounded(viewport.height),sha256:digest(JSON.stringify(items)),text,parts};
}
function pointAt(parts,offset){const part=parts.find(part=>offset>=part.start&&offset<part.end)||parts.at(-1);return part?{x:part.x+part.w*(offset-part.start)/(part.end-part.start),y:part.y}:{x:0,y:0};}
export async function pageLayout(page){
  const {text,parts,...layout}=await extractLayout(page);const length=Math.min(48,text.length),count=text.length>=48?24:0;
  layout.textLength=text.length;layout.textHash=digest(text);layout.anchors=[];
  for(let i=0;i<count;i++){
    const offset=Math.round((text.length-length)*i/(count-1)),point=pointAt(parts,offset+Math.floor(length/2));
    layout.anchors.push({offset,length,sha256:digest(text.slice(offset,offset+length)),x:rounded(point.x),y:rounded(point.y)});
  }
  return layout;
}
function matchesLayout(actual,expected){
  if(Math.abs(actual.width/expected.width-1)>.005||Math.abs(actual.height/expected.height-1)>.005)return false;
  if(actual.sha256===expected.sha256)return true;
  if(!expected.anchors.length)return digest(actual.text)===expected.textHash;
  if(Math.abs(actual.text.length-expected.textLength)>Math.max(16,expected.textLength*.01))return false;
  let matched=0;
  for(const anchor of expected.anchors){
    const estimate=Math.round(anchor.offset*actual.text.length/expected.textLength);
    for(let offset=Math.max(0,estimate-16);offset<=Math.min(actual.text.length-anchor.length,estimate+16);offset++){
      if(digest(actual.text.slice(offset,offset+anchor.length))!==anchor.sha256)continue;
      const point=pointAt(actual.parts,offset+Math.floor(anchor.length/2));
      if(Math.abs(point.x-anchor.x)<=.025&&Math.abs(point.y-anchor.y)<=.008){matched++;break;}
    }
  }
  // Small OCR/glyph differences may survive PDF compression. Every page must still match
  // its text and position anchors; page count alone never enables translation crops.
  return matched>=Math.ceil(expected.anchors.length*.9);
}
export async function verifyBookLayout(doc,profile,{signal,onProgress=()=>{}}={}){
  if(profile.algorithm!==BOOK_LAYOUT_ALGORITHM||profile.pages.length!==profile.pageCount)
    throw new Error('Book matching data is unavailable. Reopen online to finish updating.');
  function mismatch(message){const error=new Error(message);error.name='BookLayoutMismatch';throw error;}
  if(doc.numPages!==profile.pageCount)
    mismatch(`This book has ${doc.numPages} pages; the prepared scan has ${profile.pageCount}. Your PDF is saved. Use custom page settings for this edition.`);
  for(let i=0;i<profile.pages.length;i++){
    signal?.throwIfAborted();const page=await doc.getPage(i+1),actual=await extractLayout(page);page.cleanup();
    if(!matchesLayout(actual,profile.pages[i]))mismatch(`Book page ${i+1} differs from the prepared scan. Your PDF is saved. Use custom page settings for this edition.`);
    onProgress(i+1,profile.pageCount);
  }
  return profile.layoutSignature;
}
