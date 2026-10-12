const CACHE='assimil-drive-test-shell-v1';
const ASSETS=['./index.html','./style.css','./test.js'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||url.origin!==scope.origin)return;
  const relative=url.pathname.slice(scope.pathname.length);
  if(event.request.mode==='navigate'&&(relative===''||relative==='index.html')){
    event.respondWith((async()=>await(await caches.open(CACHE)).match(new URL('./index.html',scope))||fetch(event.request))());
  }else if(ASSETS.some(path=>new URL(path,scope).pathname===url.pathname)){
    event.respondWith((async()=>await(await caches.open(CACHE)).match(event.request)||fetch(event.request))());
  }
});
