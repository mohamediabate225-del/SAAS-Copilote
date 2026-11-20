const cacheName = "copilote-demo-v1";
const demoAssets = new Set(["/demo.html", "/demo.js", "/ui.css", "/copilote.svg", "/manifest.webmanifest", "/install.js"]);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll([...demoAssets])));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith("copilote-demo-") && name !== cacheName).map(name => caches.delete(name)))));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const home = url.pathname === "/" && event.request.mode === "navigate";
  if (event.request.method !== "GET" || url.origin !== location.origin || (!home && (!demoAssets.has(url.pathname) || url.search))) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(home ? "/demo.html" : url.pathname);
    return cached || Response.error();
  }));
});
