'use strict';
const SHELL='owner-property-shell-v26-mobile';
const STATIC=[
  '/', '/manifest.webmanifest','/icon.svg',
  '/base.css','/features.css','/premium.css','/object-management.css','/v23-polish.css','/v24-field.css','/pwa-mobile.css',
  '/core.js','/views-buildings.js','/views-operations.js','/views-utilities.js','/admin.js','/forms.js',
  '/object-management-ui.js','/object-card-actions.js','/v23-core.js','/v23-attention.js','/v23-calendar.js','/v23-workspace.js','/v23-fixes.js',
  '/v24-media.js','/v24-offline.js','/v24-followups.js','/v24-notifications.js','/pwa-mobile.js','/bootstrap.js'
];
self.addEventListener('install',event=>event.waitUntil(caches.open(SHELL).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/api/issue-media/')||url.pathname.startsWith('/api/inspection-media/'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(SHELL).then(c=>c.put('/',copy));return res;}).catch(()=>caches.match('/')));return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(SHELL).then(c=>c.put(req,copy));}return res;})));
});
