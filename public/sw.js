// Service worker: static assets + offline shell only. Financial data is never cached (section 4.10).
const STATIC = "gs-static-v1";
const SHELL = ["/offline", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // F-12.2: park the first shared image for 10 minutes, then open the receipt screen
  if (e.request.method === "POST" && url.pathname === "/share-target") {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const files = form.getAll("image").filter((f) => f instanceof File);
      const first = files[0];
      if (!first || !first.type.startsWith("image/")) return Response.redirect("/nota/baru?format=salah", 303);
      const cache = await caches.open("gs-share");
      await cache.put("/shared-image", new Response(first, { headers: { "content-type": first.type, "x-expires": String(Date.now() + 600000) } }));
      return Response.redirect(`/nota/baru?shared=1${files.length > 1 ? "&lebih=1" : ""}`, 303);
    })());
    return;
  }

  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(STATIC).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => (r.ok && c.put(e.request, r.clone()), r))));
    return;
  }
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => caches.match("/offline")));
});

self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { body: "" };
  e.waitUntil(self.registration.showNotification("Glideslope", { body: data.body, icon: "/icon-192.png", tag: "glideslope" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow("/inbox"));
});
