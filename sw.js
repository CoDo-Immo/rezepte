// Minimaler Service Worker – wird nur für die PWA-Installierbarkeit
// (Chrome/Android verlangt einen registrierten Service Worker) und
// eine kleine App-Shell-Cache benötigt. Rezeptdaten kommen immer live
// von Supabase, werden hier nicht zwischengespeichert.
const CACHE_NAME = "rezepte-shell-v1";
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

// Nur die App-Shell (HTML/CSS/JS) aus dem Cache bedienen, alles andere
// (Supabase-API, Bilder) geht immer normal ans Netz.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // Supabase & Co. unangetastet lassen
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
