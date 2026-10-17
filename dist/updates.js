export const APP_VERSION='3.16.0';
export const CACHE_NAME='german-study-shell-v28';

const $=id=>document.getElementById(id);
function deadline(promise,milliseconds,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]).finally(()=>clearTimeout(timer));}
function workerInfo(worker){if(!worker)return Promise.resolve(null);return new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();resolve(null);},1000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};try{worker.postMessage({type:'APP_INFO'},[channel.port2]);}catch{clearTimeout(timer);channel.port1.close();resolve(null);}});}

export async function setupOffline({beforeReload}={}){
  const displayEvents=[];
  function recordDisplay(reason){const viewport=window.visualViewport;displayEvents.push(`${(performance.now()/1000).toFixed(1)}s ${reason}: layout ${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}; visual ${viewport?`${Math.round(viewport.width)} × ${Math.round(viewport.height)} at scale ${viewport.scale.toFixed(3)}`:'unavailable'}`);if(displayEvents.length>8)displayEvents.shift();}
  recordDisplay('opened');for(const name of ['resize','orientationchange','pageshow'])window.addEventListener(name,()=>recordDisplay(name),{passive:true});
  window.visualViewport?.addEventListener('resize',()=>recordDisplay('visual resize'),{passive:true});
  $('copy-display-details').addEventListener('click',async()=>{
    const viewport=window.visualViewport,reader=$('pdf-pages');
    const details=[`App: ${APP_VERSION}`,`Browser: ${navigator.userAgent}`,`View: ${document.body.dataset.view}; standalone: ${matchMedia('(display-mode:standalone)').matches||!!navigator.standalone}`,`Layout viewport: ${document.documentElement.clientWidth} × ${document.documentElement.clientHeight}; inner: ${innerWidth} × ${innerHeight}`,`Document width: ${document.documentElement.scrollWidth}`,`Browser window: ${outerWidth} × ${outerHeight}`,`Visual viewport: ${viewport?`${viewport.width} × ${viewport.height}; scale: ${viewport.scale}`:'Unavailable'}`,`Screen: ${screen.width} × ${screen.height}; pixel ratio: ${devicePixelRatio}`,`Orientation query: ${matchMedia('(orientation:landscape)').matches?'landscape':'portrait'}`,`Container queries: ${CSS.supports('container-type','inline-size')}`,`Reader width: ${reader?.clientWidth||'hidden in this view'}`,`Viewport setting: ${document.querySelector('meta[name="viewport"]').content}`,'Recent viewport changes:',...displayEvents].join('\n');
    try{await navigator.clipboard.writeText(details);$('display-details-status').textContent='Display details copied. Paste them into the support chat.';}
    catch{$('display-details').textContent=details;$('display-details').hidden=false;$('display-details-status').textContent='Copy the display details below.';}
  });
  const check=$('check-updates'),reload=$('reload-app'),status=$('update-status');
  $('running-version').textContent=`Running version ${APP_VERSION}`;
  check.disabled=false;
  let registration,busy=false;
  async function offlineStatus(){const cache=await caches.open(CACHE_NAME);$('offline-status').textContent=await cache.match(new URL('./index.html',location.href))?'App available offline':'Preparing offline app…';}
  function readyToReload(version){status.textContent=`Version ${version} is ready. Tap Reload app to use it.`;reload.hidden=false;reload.disabled=false;}
  async function checkUpdates(){
    if(busy)return;busy=true;check.disabled=true;reload.hidden=true;status.textContent='Checking for updates…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(new URL('./version.json',location.href),{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('Update metadata unavailable');
      const release=await response.json();
      if(release.app!=='german-study-companion'||!/^\d+\.\d+\.\d+$/.test(release.version))throw new Error('Invalid update metadata');
      clearTimeout(timer);
      if(release.version===APP_VERSION){status.textContent=`You’re running the latest published version (${APP_VERSION}).`;return;}
      status.textContent=`Downloading version ${release.version}…`;
      registration ||= await navigator.serviceWorker.getRegistration();
      if(!registration)throw new Error('Offline app not ready');
      await deadline(registration.update(),30000,'Update check timed out');
      const end=Date.now()+30000;
      while(Date.now()<end){const info=await workerInfo(registration.active);if(info?.version===release.version&&info.offlineReady){readyToReload(release.version);return;}await new Promise(resolve=>setTimeout(resolve,400));}
      status.textContent='The update is still downloading or deployment is finishing. Check again shortly.';
    }catch{status.textContent='Could not check for updates. Go online and try again. Your running version is shown above.';}
    finally{clearTimeout(timer);busy=false;check.disabled=false;}
  }
  check.addEventListener('click',checkUpdates);
  reload.addEventListener('click',async()=>{reload.disabled=true;try{await beforeReload?.();location.reload();}catch(error){status.textContent=error.message;reload.disabled=false;}});
  if(!('serviceWorker'in navigator)){status.textContent='Refresh this browser page while online to update.';$('offline-status').textContent='Offline app support unavailable';return;}
  navigator.serviceWorker.addEventListener('controllerchange',async()=>{await offlineStatus();const info=await workerInfo(navigator.serviceWorker.controller);if(info?.version&&info.version!==APP_VERSION)readyToReload(info.version);});
  try{
    registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    await offlineStatus();
    await deadline(navigator.serviceWorker.ready,45000,'Offline setup timed out');
    await offlineStatus();
    if(navigator.onLine)checkUpdates();else status.textContent='Offline. Go online and tap Check for updates to compare versions.';
  }catch{$('offline-status').textContent='Offline setup incomplete; reconnect and reopen';status.textContent='Go online, reopen the app, then check for updates.';}
}
