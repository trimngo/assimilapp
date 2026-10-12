const $=id=>document.getElementById(id);
const DB_NAME='assimil-drive-download-test';
const SHELL_CACHE='assimil-drive-test-shell-v1';
let db,directory=null,active=null,previewUrl='';
const log=message=>{$('test-log').textContent+=`${message}\n`;};
const size=bytes=>`${(bytes/1048576).toFixed(2)} MB`;

export function driveId(link){
  const url=new URL(link);
  if(url.protocol!=='https:'||!['drive.google.com','drive.usercontent.google.com'].includes(url.hostname))throw new Error('Use an HTTPS Google Drive file link.');
  if(url.pathname.includes('/folders/'))throw new Error('Choose one MP3 file and copy its file link, rather than the folder link.');
  const id=url.pathname.match(/\/file\/d\/([^/]+)/)?.[1]||url.searchParams.get('id');
  if(!id||!/^[-\w]{10,}$/.test(id))throw new Error('Could not find a file ID in this link. Use Share → Copy link on the individual file.');
  return id;
}

function operation(stores,mode,callback){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(stores,mode);let result;
    try{const request=callback(transaction);if(request)request.onsuccess=()=>{result=request.result;};}
    catch(error){transaction.abort();reject(error);return;}
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>reject(transaction.error||new Error('Test storage failed.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Test storage was interrupted.'));
  });
}
const read=kind=>operation(['files'],'readonly',tx=>tx.objectStore('files').get(kind));

function signatureMatches(kind,bytes){
  if(kind==='pdf')return bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
  return (bytes.length>=3&&bytes[0]===73&&bytes[1]===68&&bytes[2]===51)||
    (bytes.length>=2&&bytes[0]===255&&(bytes[1]&224)===224);
}

async function downloadFile(url,kind,controller){
  let reader,writer,filename='',saved=false,timer;
  const waiting=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(new Error('Download stalled for 45 seconds. Try again with a stable connection.')),45000);};
  const storageError=error=>Object.assign(new Error(`Could not save the test file: ${error.message}`),{storage:true});
  try{
    waiting();
    const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal});
    const type=response.headers.get('Content-Type')||'unknown';
    log(`HTTP ${response.status}; content type: ${type}.`);
    if(!response.ok)throw new Error(`Drive returned HTTP ${response.status}.`);
    if(/html|json|text\//i.test(type)){await response.body?.cancel();throw new Error('Drive returned a web page instead of file bytes. Check public sharing or a download confirmation.');}
    if(!response.body)throw new Error('This browser does not expose the download stream.');
    reader=response.body.getReader();const first=[];let bytes=0,done=false;
    while(bytes<12&&!done){waiting();const part=await reader.read();done=part.done;if(part.value){first.push(part.value);bytes+=part.value.length;}}
    const prefix=new Uint8Array(Math.min(bytes,12));let at=0;
    for(const chunk of first){const part=chunk.subarray(0,prefix.length-at);prefix.set(part,at);at+=part.length;if(at===prefix.length)break;}
    if(!signatureMatches(kind,prefix))throw new Error(`The downloaded bytes are not a ${kind==='pdf'?'PDF':'MP3'}. Nothing was saved.`);
    log(`${kind==='pdf'?'PDF':'MP3'} signature verified.`);
    const previous=await read(kind),chunks=[];
    if(directory){
      try{
        filename=crypto.randomUUID();const handle=await directory.getFileHandle(filename,{create:true});
        if(typeof handle.createWritable==='function')writer=await handle.createWritable();
        else{await directory.removeEntry(filename);filename='';}
      }catch(error){throw storageError(error);}
    }
    const total=Number(response.headers.get('Content-Length'))||0;
    $('download-progress').hidden=false;
    if(total){$('download-progress').max=total;$('download-progress').value=bytes;}else $('download-progress').removeAttribute('value');
    async function append(chunk){
      if(controller.signal.aborted)throw controller.signal.reason||new DOMException('Cancelled','AbortError');
      if(writer){try{await writer.write(chunk);}catch(error){throw storageError(error);}}
      else chunks.push(chunk);
      $('download-status').textContent=`Downloading ${kind==='pdf'?'PDF':'MP3'}: ${size(bytes)}${total?` of ${size(total)}`:''}…`;
      if(total)$('download-progress').value=bytes;
    }
    for(const chunk of first)await append(chunk);
    while(!done){waiting();const part=await reader.read();done=part.done;if(part.value){bytes+=part.value.length;await append(part.value);}}
    if(controller.signal.aborted)throw controller.signal.reason;
    if(writer){try{await writer.close();writer=null;}catch(error){throw storageError(error);}}
    if(controller.signal.aborted)throw controller.signal.reason;
    const contentType=kind==='pdf'?'application/pdf':'audio/mpeg';
    const file={kind,size:bytes,type:contentType,backend:filename?'opfs':'idb',filename,savedAt:new Date().toISOString()};
    try{
      await operation(['files','blobs'],'readwrite',tx=>{
        tx.objectStore('files').put(file);
        if(filename)tx.objectStore('blobs').delete(kind);
        else tx.objectStore('blobs').put(new Blob(chunks,{type:contentType}),kind);
      });
    }catch(error){throw storageError(error);}
    saved=true;
    if(previous?.backend==='opfs'&&previous.filename!==filename)await directory.removeEntry(previous.filename).catch(()=>{});
    log(`Saved ${size(bytes)} in isolated ${file.backend.toUpperCase()} test storage.`);
    return file;
  }finally{
    clearTimeout(timer);
    await reader?.cancel().catch(()=>{});
    await writer?.abort().catch(()=>{});
    if(filename&&!saved)await directory.removeEntry(filename).catch(()=>{});
  }
}

function closePreview(){
  $('audio').pause();$('audio').removeAttribute('src');$('audio').load();$('pdf').removeAttribute('src');
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('preview').hidden=true;
}
async function openSaved(file){
  try{
    closePreview();
    if(file.backend==='opfs'&&!directory)throw new Error('File storage is unavailable in this browser. Download the test file again.');
    const blob=file.backend==='opfs'?await(await directory.getFileHandle(file.filename)).getFile():await operation(['blobs'],'readonly',tx=>tx.objectStore('blobs').get(file.kind));
    if(!blob||blob.size!==file.size)throw new Error('The saved test file is unavailable. Download it again.');
    previewUrl=URL.createObjectURL(new Blob([blob],{type:file.type}));
    $('preview').hidden=false;$('preview-title').textContent=file.kind==='pdf'?'Saved PDF — local copy':'Saved MP3 — local copy';
    $('audio').hidden=file.kind!=='audio';$('pdf').hidden=file.kind!=='pdf';
    $(file.kind==='audio'?'audio':'pdf').src=previewUrl;
    log(`Opened saved ${file.kind==='pdf'?'PDF':'MP3'} from device storage${navigator.onLine?'':' while offline'}.`);
    $('preview').scrollIntoView({block:'start'});
  }catch(error){$('download-status').textContent=error.message;log(error.message);}
}
async function renderSaved(){
  const files=await operation(['files'],'readonly',tx=>tx.objectStore('files').getAll());
  $('saved-files').replaceChildren();
  if(!files.length){const p=document.createElement('p');p.textContent='No test files saved yet.';$('saved-files').append(p);}
  for(const file of files){
    const row=document.createElement('div');row.className='saved-file';
    const p=document.createElement('p');p.textContent=`${file.kind==='pdf'?'Book PDF':'Lesson MP3'} · ${size(file.size)} · saved on this device`;
    const button=document.createElement('button');button.type='button';button.textContent=file.kind==='pdf'?'Open saved PDF':'Play saved MP3';button.dataset.kind=file.kind;
    button.addEventListener('click',()=>openSaved(file));row.append(p,button);$('saved-files').append(row);
  }
}
$('download-form').addEventListener('submit',async event=>{
  event.preventDefault();if(active)return;
  try{
    const id=driveId($('drive-link').value),kind=$('kind').value,key=new URL($('drive-link').value).searchParams.get('resourcekey');closePreview();
    active=new AbortController();$('download').disabled=true;$('kind').disabled=true;$('drive-link').disabled=true;$('clear').disabled=true;$('cancel').disabled=false;
    log(`Starting public ${kind==='pdf'?'PDF':'MP3'} download, without cookies.`);
    const urls=[`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`].map(url=>key?`${url}&resourcekey=${encodeURIComponent(key)}`:url);
    let lastError;
    for(const url of urls){
      try{log(`Trying ${new URL(url).hostname}.`);$('download-status').textContent='Connecting to Drive…';await downloadFile(url,kind,active);lastError=null;break;}
      catch(error){lastError=error;log(error.message);if(active.signal.aborted||error.storage)break;}
    }
    if(lastError)throw lastError;
    $('download-status').textContent='Download and save passed. Open the saved file, then repeat with Airplane Mode and a page reload.';
    await renderSaved();
  }catch(error){
    const message=active?.signal.aborted?(active.signal.reason?.message||'Download cancelled.'):error instanceof TypeError?'The browser could not read the Drive download. This may be a CORS restriction, sharing setting, or network problem. Open the link while signed out to check sharing.':error.message;
    $('download-status').textContent=message;log(message);
  }finally{
    active=null;$('download').disabled=false;$('kind').disabled=false;$('drive-link').disabled=false;$('clear').disabled=false;$('cancel').disabled=true;$('download-progress').hidden=true;
  }
});
$('cancel').addEventListener('click',()=>active?.abort(new DOMException('Download cancelled.','AbortError')));
$('close-preview').addEventListener('click',closePreview);
$('clear').addEventListener('click',async()=>{
  if(active)return;
  try{
    closePreview();const files=await operation(['files'],'readonly',tx=>tx.objectStore('files').getAll());
    if(directory)for(const file of files)if(file.backend==='opfs')await directory.removeEntry(file.filename).catch(()=>{});
    await operation(['files','blobs'],'readwrite',tx=>{tx.objectStore('files').clear();tx.objectStore('blobs').clear();});
    await renderSaved();$('download-status').textContent='Test downloads removed. Study files and progress were left alone.';log('Removed only this page’s test downloads.');
  }catch(error){$('download-status').textContent=error.message;}
});
$('copy-log').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('test-log').textContent);$('copy-log').textContent='Copied';}
  catch{$('download-status').textContent='Copy the text under Test details manually.';}
});

async function setupOffline(){
  const expected=new URL('./sw.js',location.href).href;
  const check=async()=>{const cache=await caches.open(SHELL_CACHE);const ready=navigator.serviceWorker?.controller?.scriptURL===expected&&await cache.match(new URL('./index.html',location.href));$('offline-status').textContent=ready?'Test page available offline':'Preparing offline test page…';return !!ready;};
  try{
    if(!('serviceWorker' in navigator))throw new Error('No service worker support');
    if(!navigator.onLine&&await check())return;
    navigator.serviceWorker.addEventListener('controllerchange',check);
    await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});await navigator.serviceWorker.ready;await check();
  }catch{try{if(await check())return;}catch{}$('offline-status').textContent='Offline test page is unavailable. Open this page over HTTPS and allow device storage.';}
}
try{
  db=await new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{request.result.createObjectStore('files',{keyPath:'kind'});request.result.createObjectStore('blobs');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  if(navigator.storage?.getDirectory){try{directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('assimil-drive-download-test',{create:true});}catch{}}
  await renderSaved();$('download-status').textContent='Ready. Paste a public file link to test a direct download.';$('download').disabled=false;$('clear').disabled=false;
}catch(error){$('download-status').textContent=`Test storage could not open: ${error.message}. Try a regular browser window.`;}
setupOffline();
