// Duo Two-Person Reminder PWA - Service Worker
const CACHE_NAME = 'duo-reminder-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/storage.js',
  './js/sound.js',
  './js/notifications.js',
  './js/sync.js',
  './js/reminders.js',
  './js/ui.js',
  './js/app.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable.png'
];

// Install: Cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Claim clients & prune older caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-while-revalidate for local assets, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        return networkResponse;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Web Push Event Handler
self.addEventListener('push', (event) => {
  let data = {
    title: '⏰ Duo Reminder',
    body: "It's time for your shared reminder. Tap to respond!",
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: 'duo-reminder',
    data: {}
  };

  if (event.data) {
    try {
      data = Object.assign(data, event.data.json());
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || './assets/icons/icon-192.png',
    badge: data.badge || './assets/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'duo-reminder',
    renotify: true,
    requireInteraction: true,
    data: data.data || {},
    actions: data.actions || [
      { action: 'going', title: "✅ I'm Going" },
      { action: 'skipped', title: "❌ Skip Today" },
      { action: 'snooze', title: "⏰ Snooze 10m" }
    ]
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification Click & Action Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action; // 'going', 'skipped', 'snooze', or empty
  const notificationData = event.notification.data || {};
  const reminderId = notificationData.reminderId;
  const targetUrl = reminderId ? `./?reminderId=${reminderId}&action=${action || 'open'}` : './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. If an existing window is open, focus it and post message
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_ACTION',
            action: action || 'open',
            reminderId: reminderId,
            data: notificationData
          });
          return client.focus();
        }
      }

      // 2. Otherwise launch new window navigating directly to the reminder
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
