// 홈 화면 설치용 서비스 워커. 앱 파일만 캐시하고, /api 와 /preview 는 캐시하지 않습니다.
const VERSION = "2026-11-04a";
const CACHE = `signposts-helper-${VERSION}`;
const ASSETS = ["./", "./index.html", "./app.css", "./app.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/preview")) return;
  // 앱 파일은 네트워크를 먼저 쓰고, 실패하면 캐시로 돌아갑니다.
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? (request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});

// 작업 완료 알림을 누르면 열려 있는 앱 창을 앞으로 가져오거나 새로 엽니다.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const date = event.notification.data?.date;
  const target = new URL(date ? `./#${date}` : "./", self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => "focus" in w);
      if (win) {
        if (date) win.navigate?.(target).catch?.(() => {});
        return win.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
