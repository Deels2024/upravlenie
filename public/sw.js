const CACHE='owner-property-shell-v3.8.1';
const SHELL=['/','/app.css?v=3.8.1','/simple.css?v=3.8.1','/app.js?v=3.8.1','/form-safety.js?v=3.8.1','/manifest.webmanifest','/icon.svg'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('owner-property-shell-')&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();

  })());
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||!SHELL.some(p=>new URL(p,location.origin).pathname===url.pathname))return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request)));
});

