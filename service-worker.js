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
    type: 'reminder',
    reminderId: 'default',
    title: 'Reminder',
    body: "It's time for your shared reminder. Tap to respond!",
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    tag: 'reminder-default'
  };

  if (event.data) {
    try {
      data = Object.assign(data, event.data.json());
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // 1. Cross-Device Notification Dismissal / Update
  if (data.type === 'response_update') {
    const reminderId = data.reminderId;
    const targetTag = reminderId ? `reminder-${reminderId}` : null;

    event.waitUntil(
      (async () => {
        if (targetTag && self.registration && self.registration.getNotifications) {
          const notifications = await self.registration.getNotifications({ tag: targetTag });
          notifications.forEach(n => n.close());
        }

        // Notify any active clients to refresh state immediately
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(client => {
          client.postMessage({
            type: 'REMOTE_RESPONSE_UPDATE',
            reminderId: data.reminderId,
            status: data.status,
            dateKey: data.dateKey
          });
        });
      })()
    );
    return;
  }

  // 2. Display System Notification (Alarm-like behavior)
  const reminderId = data.reminderId || (data.data && data.data.reminderId) || 'default';
  const displayTitle = data.title ? (data.title.startsWith('⏰') ? data.title : `⏰ ${data.title}`) : '⏰ Duo Reminder';
  const displayBody = data.body || `It's time for ${data.title || 'your reminder'}`;

  const options = {
    body: displayBody,
    icon: data.icon || './assets/icons/icon-192.png',
    badge: data.badge || './assets/icons/icon-192.png',
    vibrate: [500, 200, 500, 200, 500, 200, 800, 200, 800],
    tag: `reminder-${reminderId}`,
    renotify: true,
    requireInteraction: true,
    timestamp: Date.now(),
    data: {
      type: 'reminder',
      reminderId: reminderId,
      pairId: data.pairId,
      title: data.title,
      dateKey: data.dateKey,
      url: `./?reminderId=${reminderId}`
    },
    actions: data.actions || [
      { action: 'going', title: "Going" },
      { action: 'skipped', title: "Skip" },
      { action: 'snooze', title: "Snooze 10m" }
    ]
  };

  event.waitUntil(self.registration.showNotification(displayTitle, options));
});

// Notification Click & Action Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action; // 'going', 'skipped', 'snooze', or empty
  const notificationData = event.notification.data || {};
  const reminderId = notificationData.reminderId;
  const pairId = notificationData.pairId;
  const dateKey = notificationData.dateKey;
  const targetUrl = reminderId ? `./?reminderId=${reminderId}&action=${action || 'open'}` : './';

  event.waitUntil(
    (async () => {
      // 1. If an action button was tapped (Going / Skip / Snooze), submit response to backend
      if (action && ['going', 'skipped', 'snooze'].includes(action) && reminderId && pairId) {
        try {
          let snoozeUntil = null;
          let status = action === 'going' ? 'going' : (action === 'skipped' ? 'skipped' : 'snoozed');
          if (action === 'snooze') {
            const sDate = new Date();
            sDate.setMinutes(sDate.getMinutes() + 10);
            snoozeUntil = sDate.toISOString();
          }

          // We attempt direct sync to backend
          await fetch('./api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'submit_response',
              pairId,
              reminderId,
              date: dateKey || new Date().toISOString().split('T')[0],
              userId: 'from_notification',
              status,
              snoozeUntil
            })
          }).catch(() => {});
        } catch (e) {}
      }

      // 2. Focus or open window
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
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

      // 3. Otherwise launch new window if user tapped body without open window
      if (self.clients.openWindow && (!action || action === 'open')) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});
