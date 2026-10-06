// Ersetzt den Service Worker einer früheren Galerie und meldet sich selbst ab.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ereignis) => {
  ereignis.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.map((n) => caches.delete(n))))
      .then(() => self.registration.unregister()),
  );
});
