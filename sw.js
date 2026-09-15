/* Service worker — единственная точка версионирования. Стратегия «сначала кэш»:
   экран открывается мгновенно и без сети. Чтобы выкатить новую версию, довольно
   поменять VERSION — старый кэш удалится сам.

   Пакеты (`packs/`) не кэшируем: после установки они лежат в IndexedDB. */

const VERSION = "2026-09-12.2";
const CACHE = `vocab-${VERSION}`;

// На локальном сервере не перехватываем ничего: правка файла должна быть видна
// с первой перезагрузки.
const DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);

const SHELL = [
  "./", "./index.html", "./style.css", "./manifest.webmanifest", "./icons/icon.svg",
  "./vendor/htmx.min.js",
  "./src/app.js", "./src/views.js", "./src/core.js", "./src/store.js",
  "./src/packs.js", "./src/config.js",
];

self.addEventListener("install", (event) => event.waitUntil((async () => {
  if (!DEV) await (await caches.open(CACHE)).addAll(SHELL.map((p) => new URL(p, self.registration.scope)));
  await self.skipWaiting();
})()));

self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) {
    if (name.startsWith("vocab-") && name !== CACHE) await caches.delete(name);
  }
  await self.clients.claim();
})()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (DEV || request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/packs/")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return await cache.match(new URL("./index.html", self.registration.scope))
        || new Response("Нет сети и нет копии в кэше", { status: 503 });
    }
  })());
});
