// Minimaler Service Worker – wird nur für die PWA-Installierbarkeit
// (Chrome/Android verlangt einen registrierten Service Worker) und
// eine kleine App-Shell-Cache benötigt. Rezeptdaten kommen immer live
// von Supabase, werden hier nicht zwischengespeichert.
const CACHE_NAME = "rezepte-shell-v3";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/supabaseClient.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App-Shell (HTML/CSS/JS) "network-first": online immer die aktuelle Version
// vom Server holen (und den Cache dabei auffrischen), nur offline auf den
// zuletzt bekannten Cache zurückfallen. So kommen künftige Deploys sofort
// an, ohne dass Nutzer:innen den Cache manuell leeren müssen. Supabase-API
// und Bilder gehen wie bisher immer normal ans Netz.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
