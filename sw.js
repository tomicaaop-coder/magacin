/* Keš za rad aplikacije i kad je veza slaba. Podaci idu direktno u Firebase. */
const KES = "magacin-v16";
const OSNOVA = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./firebase-config.js", "./fb-adapter.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(KES).then(c => c.addAll(OSNOVA)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== KES).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { const c = r.clone(); caches.open(KES).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

/* klik na obaveštenje otvara aplikaciju */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(l => { for (const c of l) if ("focus" in c) return c.focus(); return self.clients.openWindow("./"); }));
});
