import {getDocument, GlobalWorkerOptions, PDFDataRangeTransport} from './vendor/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

class LocalRange extends PDFDataRangeTransport {
  constructor(file, initial, onError) { super(file.size,initial);this.file=file;this.onError=onError;this.stopped=false; }
  requestDataRange(begin,end) { this.file.slice(begin,end).arrayBuffer().then(buffer=>{if(!this.stopped)this.onDataRange(begin,new Uint8Array(buffer));}).catch(error=>{if(!this.stopped)this.onError(error);}); }
  abort(){this.stopped=true;}
}
export class BookReader {
  constructor(container,status){this.container=container;this.status=status;this.document=null;this.generation=0;this.renderTasks=[];this.fileId=null;this.books=new Map();}
  cancelRender(){this.generation++;for(const task of this.renderTasks){try{task.cancel();}catch{}}this.renderTasks=[];}
  async load(file,id){
    if(this.books.has(id))return this.books.get(id).promise;
    const entry={};this.books.set(id,entry);
    entry.promise=(async()=>{
      const initial=new Uint8Array(await file.slice(0,65536).arrayBuffer());
      const range=new LocalRange(file,initial,error=>{this.status.textContent=`Could not read the book: ${error.message}`;});
      entry.task=getDocument({range,rangeChunkSize:262144,disableStream:true,disableAutoFetch:true,isEvalSupported:false,useSystemFonts:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href});
      return entry.task.promise;
    })().catch(error=>{this.books.delete(id);throw error;});
    return entry.promise;
  }
  async open(file,id){this.document=await this.load(file,id);this.fileId=id;return this.document;}
  async renderExcerpts(groups,resolveFile,isCurrent){
    // Render each source page once, then crop its sentences locally. No OCR or downloads.
    const pages=new Map();
    try{
      for(const group of groups){
        for(const entry of group.entries){
          if(!isCurrent())return;
          if(!entry.file){const note=document.createElement('p');note.className='note';note.textContent=`Import ${entry.sourceId} to see this sentence.`;group.container.append(note);continue;}
          const key=`${entry.file.id}:${entry.page}`;
          if(!pages.has(key)){
            const doc=await this.load(await resolveFile(entry.file),entry.file.id);if(!isCurrent())return;
            const page=await doc.getPage(entry.page),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:2});
            const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
            pages.set(key,{canvas,base});await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          }
          if(!isCurrent())return;
          const {canvas,base}=pages.get(key),crop=validateCrop(entry.crop),excerpt=document.createElement('canvas');
          excerpt.width=Math.max(1,Math.round(canvas.width*crop.w));excerpt.height=Math.max(1,Math.round(canvas.height*crop.h));
          const ctx=excerpt.getContext('2d');
          if(entry.visibleBands){
            ctx.fillStyle='white';ctx.fillRect(0,0,excerpt.width,excerpt.height);
            for(const value of entry.visibleBands){const band=validateCrop(value);ctx.drawImage(canvas,canvas.width*band.x,canvas.height*band.y,canvas.width*band.w,canvas.height*band.h,canvas.width*(band.x-crop.x),canvas.height*(band.y-crop.y),canvas.width*band.w,canvas.height*band.h);}
          }else ctx.drawImage(canvas,canvas.width*crop.x,canvas.height*crop.y,canvas.width*crop.w,canvas.height*crop.h,0,0,excerpt.width,excerpt.height);
          excerpt.style.setProperty('--excerpt-width',`${base.width*crop.w*1.1}px`);excerpt.setAttribute('role','img');excerpt.setAttribute('aria-label',`${entry.language==='en'?'English translation':'German dialogue text'} · ${entry.label}`);excerpt.dataset.globalPage=entry.globalPage;group.container.append(excerpt);
        }
      }
    }finally{for(const {canvas} of pages.values())canvas.width=canvas.height=0;}
  }
  async render(pageNumbers,{crop=null,select=null}={}){
    if(!this.document)return;
    return this.renderEntries(pageNumbers.map(page=>({page,document:this.document,crop,label:`PDF page ${page}`})),null,{select,english:!!crop});
  }
  async renderEntries(entries,resolveFile,{select=null,english=false}={}){
    this.cancelRender();const generation=this.generation;this.container.replaceChildren();
    this.status.textContent='Loading lesson pages…';let missing=0;
    try{
      for(const entry of entries){
        if(generation!==this.generation)return;
        if(!entry.document&&!entry.file){
          missing++;const message=document.createElement('p');message.className='missing-page';message.textContent=`Import ${entry.sourceId} to see ${entry.label.toLowerCase()}.`;this.container.append(message);continue;
        }
        const doc=entry.document||await this.load(await resolveFile(entry.file),entry.file.id);
        if(generation!==this.generation)return;
        const page=await doc.getPage(entry.page);if(generation!==this.generation)return;
        const base=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(2,1200/base.width)});
        const source=document.createElement('canvas');source.width=Math.ceil(viewport.width);source.height=Math.ceil(viewport.height);
        const render=page.render({canvasContext:source.getContext('2d'),viewport});this.renderTasks.push(render);await render.promise;
        if(generation!==this.generation){source.width=source.height=0;return;}
        const figure=document.createElement('figure');figure.className='pdf-page';figure.dataset.page=entry.page;if(entry.globalPage)figure.dataset.globalPage=entry.globalPage;
        const caption=document.createElement('figcaption');caption.textContent=entry.label;
        let visible=source;
        if(entry.crop){const crop=validateCrop(entry.crop);visible=document.createElement('canvas');visible.width=Math.max(1,Math.round(source.width*crop.w));visible.height=Math.max(1,Math.round(source.height*crop.h));visible.getContext('2d').drawImage(source,source.width*crop.x,source.height*crop.y,source.width*crop.w,source.height*crop.h,0,0,visible.width,visible.height);source.width=source.height=0;}
        visible.setAttribute('role','img');visible.setAttribute('aria-label',`${english?'English translation · ':''}${entry.label}`);figure.append(visible,caption);this.container.append(figure);if(select)select(figure,visible);page.cleanup();
      }
      if(generation===this.generation)this.status.textContent=missing?`${missing} lesson page${missing===1?'':'s'} need another book PDF.`:english?'English translations only.':`${entries.length} lesson pages · fits your available screen width.`;
    }catch(error){if(error.name!=='RenderingCancelledException'&&generation===this.generation){this.status.textContent='Could not display these pages. Reopen the app or check your stored PDF.';throw error;}}
  }
  clear(){this.cancelRender();this.container.replaceChildren();}
}
export function validateCrop(crop){if(!crop||![crop.x,crop.y,crop.w,crop.h].every(Number.isFinite)||crop.x<0||crop.y<0||crop.w<=0||crop.h<=0||crop.x+crop.w>1.001||crop.y+crop.h>1.001)throw new Error('Select an English area inside the page.');return {x:crop.x,y:crop.y,w:crop.w,h:crop.h};}
