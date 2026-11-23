const CACHE='trainboard-preview-shell-v2';
const SHELL=['/','/index.html','/app.css','/app.js','/icon.svg','/manifest.webmanifest'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  ]));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if (event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||caches.match('/index.html'))));
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data={};
    try { data=event.data?.json() || {}; } catch { return; }
    if (typeof data.title !== 'string' || typeof data.body !== 'string') return;
    await self.registration.showNotification(data.title.slice(0,120),{
      body:data.body.slice(0,400),
      tag: typeof data.tag==='string' ? data.tag.slice(0,100) : 'trainboard-change',
      icon:'/icon.svg',
      badge:'/icon.svg',
      data:{url:'/'}
    });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientsList=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=clientsList.find(c=>new URL(c.url).origin===self.location.origin);
    if(existing) {await existing.focus();return;}
    await self.clients.openWindow('/');
  })());
});
