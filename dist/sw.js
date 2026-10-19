const APP_VERSION='3.17.0';
const CACHE='german-study-shell-v30';
const ASSETS=["./index.html", "./style.css", "./theme.js", "./app.js", "./floating-ui.js", "./completions.js", "./progress-view.js", "./step-timer.js", "./course-data.js", "./book-layout.js", "./file-hash.js", "./combined-layout.json", "./vendor/sha256.mjs", "./course-index.json", "./study.js", "./shadowing.js", "./shadow-selection.js", "./playback-controls.js", "./audio-health.js", "./audio-engine.js", "./updates.js", "./audio-tools.js", "./pdf-reader.js", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./vendor/pdf.mjs", "./vendor/pdf.worker.mjs", "./vendor/standard_fonts/FoxitDingbats.pfb", "./vendor/standard_fonts/FoxitFixed.pfb", "./vendor/standard_fonts/FoxitFixedBold.pfb", "./vendor/standard_fonts/FoxitFixedBoldItalic.pfb", "./vendor/standard_fonts/FoxitFixedItalic.pfb", "./vendor/standard_fonts/FoxitSerif.pfb", "./vendor/standard_fonts/FoxitSerifBold.pfb", "./vendor/standard_fonts/FoxitSerifBoldItalic.pfb", "./vendor/standard_fonts/FoxitSerifItalic.pfb", "./vendor/standard_fonts/FoxitSymbol.pfb", "./vendor/standard_fonts/LiberationSans-Bold.ttf", "./vendor/standard_fonts/LiberationSans-BoldItalic.ttf", "./vendor/standard_fonts/LiberationSans-Italic.ttf", "./vendor/standard_fonts/LiberationSans-Regular.ttf"];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const requests=ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'}));
  const shell=await fetch(requests[0]);
  if(!shell.ok||shell.redirected||!(await shell.clone().text()).includes('data-study-app="1"'))throw new Error('Expected study app');
  const cache=await caches.open(CACHE);
  // addAll commits the shell together: a failed dependency must not advertise offline readiness.
  await cache.addAll(requests);
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('german-study-shell-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=='GET')return;
  const scope=new URL(self.registration.scope),relative=url.pathname.slice(scope.pathname.length);
  if(event.request.mode==='navigate'&&(relative===''||relative==='index.html'))event.respondWith((async()=>{
    const cache=await caches.open(CACHE);return await cache.match(new URL('./index.html',scope))||fetch(event.request);
  })());
  else if(ASSETS.some(path=>new URL(path,scope).pathname===url.pathname))event.respondWith((async()=>{
    const cache=await caches.open(CACHE);return await cache.match(event.request)||fetch(event.request);
  })());
});

// version.json intentionally stays network-only so an old app can discover a new release.
self.addEventListener('message',event=>{
  if(event.data?.type!=='APP_INFO'||!event.ports[0])return;
  event.waitUntil((async()=>{const cache=await caches.open(CACHE);const offlineReady=!!(await cache.match(new URL('./index.html',self.registration.scope)));event.ports[0].postMessage({version:APP_VERSION,offlineReady});})());
});
