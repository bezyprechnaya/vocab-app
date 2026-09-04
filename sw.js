/* Service worker — единственная точка версионирования (глава I, 3.7 и 5).

   Стратегия «сначала кэш, обновление в фоне»: экран открывается мгновенно
   и без сети, а свежие файлы подтягиваются следующим заходом. Чтобы выкатить
   новую версию, достаточно поменять VERSION — старый кэш удалится сам.
   Никакого `?v=` в тегах: версия живёт здесь и только здесь.

   Пакеты (`packs/`) в кэш не кладём: после установки они лежат в IndexedDB,
   дублировать нечего. */

const VERSION = "2026-09-04.1";
const CACHE = `vocab-${VERSION}`;

// На локальном сервере разработки кэш только мешает: правка файла должна быть видна
// с первой перезагрузки. Поэтому там работаем «сначала сеть», а кэш держим запасным.
const DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./styles/main.css",
  "./styles/home.css",
  "./styles/day.css",
  "./styles/lists.css",
  "./src/main.js",
  "./src/nav.js",
  "./src/db.js",
  "./src/ui.js",
  "./src/packs.js",
  "./src/progress.js",
  "./src/session.js",
  "./src/settings.js",
  "./src/backup.js",
  "./src/screens/home.js",
  "./src/screens/day.js",
  "./src/screens/sort.js",
  "./src/screens/cards.js",
  "./src/screens/check.js",
  "./src/screens/done.js",
  "./src/screens/history.js",
  "./src/screens/review.js",
  "./src/screens/packs.js",
  "./src/screens/settings.js",
  "./src/screens/help.js",
  "./src/screens/onboarding.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (!DEV) {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((path) => new URL(path, self.registration.scope)));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("vocab-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/packs/")) return;      // пакеты живут в IndexedDB

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    if (cached && !DEV) return cached;                // сначала кэш
    const fresh = await network;                      // обновление в фоне
    if (fresh) return fresh;
    if (cached) return cached;                        // в разработке — кэш как запасной
    if (request.mode === "navigate") {
      const shell = await cache.match(new URL("./index.html", self.registration.scope));
      if (shell) return shell;
    }
    return new Response("Нет сети и нет копии в кэше", { status: 503 });
  })());
});
