// Prepare small layout fingerprints on a laptop. No book text is written to the index.
import fs from 'node:fs';
import {getDocument} from '../dist/vendor/pdf.mjs';
import {pageLayout,hexHash,BOOK_LAYOUT_ALGORITHM} from '../dist/book-layout.js';
import {sha256} from '../dist/vendor/sha256.mjs';
const paths=process.argv.slice(2);if(paths.length!==3)throw new Error('Supply the three prepared PDFs in page order.');
const indexText=fs.readFileSync('course/assimil-german.index.json','utf8');
const index=JSON.parse(indexText);const pages=[];
for(let part=0;part<paths.length;part++){
  const bytes=new Uint8Array(fs.readFileSync(paths[part]));
  if(hexHash(sha256(bytes))!==index.book.sources[part].sha256)throw new Error('Use the exact prepared split PDFs.');
  const task=getDocument({data:bytes,useSystemFonts:false,isEvalSupported:false,verbosity:0,standardFontDataUrl:new URL('../dist/vendor/standard_fonts/',import.meta.url).pathname});const doc=await task.promise;
  for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);pages.push(await pageLayout(page));page.cleanup();}
  await task.destroy();
}
const layoutSignature=hexHash(sha256(new TextEncoder().encode(JSON.stringify(pages))));
const profile={schemaVersion:1,courseId:index.courseId,algorithm:BOOK_LAYOUT_ALGORITHM,pageCount:pages.length,layoutSignature,pages};
const formatted=JSON.stringify({...profile,pages:[]},null,2).replace('\"pages\": []',`\"pages\": [\n${pages.map(page=>'    '+JSON.stringify(page)).join(',\n')}\n  ]`);
fs.writeFileSync('course/combined-layout.json',formatted+'\n');
fs.copyFileSync('course/combined-layout.json','dist/combined-layout.json');
const signatureLine=`\"combinedLayoutSignature\": \"${layoutSignature}\"`;
const bookEnd=indexText.indexOf('\n  },\n  \"lessons\":');
if(bookEnd<0)throw new Error('Expected the prepared course index format.');
const updated=index.book.combinedLayoutSignature
  ? indexText.replace(/\"combinedLayoutSignature\": \"[a-f0-9]+\"/,signatureLine)
  : indexText.slice(0,bookEnd)+`,\n    ${signatureLine}`+indexText.slice(bookEnd);
fs.writeFileSync('course/assimil-german.index.json',updated);fs.copyFileSync('course/assimil-german.index.json','dist/course-index.json');
console.log(`Prepared layout fingerprints for ${pages.length} pages. No text or images published.`);
