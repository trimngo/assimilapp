import {getDocument, GlobalWorkerOptions, PDFDataRangeTransport} from './vendor/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

class LocalRange extends PDFDataRangeTransport {
  constructor(file, initial, onError) { super(file.size,initial);this.file=file;this.onError=onError;this.stopped=false; }
  requestDataRange(begin,end) { this.file.slice(begin,end).arrayBuffer().then(buffer=>{if(!this.stopped)this.onDataRange(begin,new Uint8Array(buffer));}).catch(error=>{if(!this.stopped)this.onError(error);}); }
  abort(){this.stopped=true;}
}
export class BookReader {
  constructor(container,status){this.container=container;this.status=status;this.task=null;this.document=null;this.generation=0;this.renderTasks=[];this.fileId=null;}
  cancelRender(){this.generation++;for(const task of this.renderTasks){try{task.cancel();}catch{}}this.renderTasks=[];}
  async open(file,id){if(this.fileId===id&&this.document)return this.document;this.cancelRender();if(this.task)await this.task.destroy();this.document=null;this.fileId=id;this.status.textContent='Opening your stored book…';const initial=new Uint8Array(await file.slice(0,65536).arrayBuffer());const range=new LocalRange(file,initial,error=>{this.status.textContent=`Could not read the book: ${error.message}`;});this.task=getDocument({range,rangeChunkSize:262144,disableStream:true,disableAutoFetch:true,isEvalSupported:false,useSystemFonts:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href});this.document=await this.task.promise;return this.document;}
  async render(pageNumbers, {crop=null,select=null}={}){
    this.cancelRender();const generation=this.generation;this.container.replaceChildren();if(!this.document)return;
    this.status.textContent='Loading lesson pages…';
    try{
      for(const number of pageNumbers){
        if(generation!==this.generation)return;
        const page=await this.document.getPage(number);if(generation!==this.generation)return;
        const base=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(2,1200/base.width)});
        const source=document.createElement('canvas');source.width=Math.ceil(viewport.width);source.height=Math.ceil(viewport.height);
        const render=page.render({canvasContext:source.getContext('2d'),viewport});this.renderTasks.push(render);await render.promise;if(generation!==this.generation){source.width=source.height=0;return;}
        const figure=document.createElement('figure');figure.className='pdf-page';figure.dataset.page=number;const caption=document.createElement('figcaption');caption.textContent=`PDF page ${number}`;
        let visible=source;
        if(crop){visible=document.createElement('canvas');visible.width=Math.max(1,Math.round(source.width*crop.w));visible.height=Math.max(1,Math.round(source.height*crop.h));visible.getContext('2d').drawImage(source,source.width*crop.x,source.height*crop.y,source.width*crop.w,source.height*crop.h,0,0,visible.width,visible.height);source.width=source.height=0;}
        visible.setAttribute('role','img');visible.setAttribute('aria-label',crop?`English area of PDF page ${number}`:`PDF page ${number}`);figure.append(visible,caption);this.container.append(figure);if(select)select(figure,visible);
        page.cleanup();
      }
      if(generation===this.generation)this.status.textContent=pageNumbers.length===1?`PDF page ${pageNumbers[0]}`:`PDF pages ${pageNumbers[0]}–${pageNumbers.at(-1)}`;
    }catch(error){if(error.name!=='RenderingCancelledException'&&generation===this.generation){this.status.textContent='Could not display these pages. Check the page numbers or reopen the app.';throw error;}}
  }
  clear(){this.cancelRender();this.container.replaceChildren();}
}
export function validateCrop(crop){if(!crop||![crop.x,crop.y,crop.w,crop.h].every(Number.isFinite)||crop.x<0||crop.y<0||crop.w<=0||crop.h<=0||crop.x+crop.w>1.001||crop.y+crop.h>1.001)throw new Error('Select an English area inside the page.');return {x:crop.x,y:crop.y,w:crop.w,h:crop.h};}
