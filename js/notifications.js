// Duo Notification & Web Push Manager
class NotificationManager {
  constructor() {
    this.swRegistration = null;
    this.vapidPublicKey = null;
    this.isSubscribed = false;
    this.init();
  }

  async init() {
    await this.initServiceWorker();
    await this.fetchVapidKey();
    if (this.getPermissionState() === 'granted') {
      this.syncSubscription();
    }
  }

  async initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
        this.swRegistration = reg;
        console.log('Service Worker registered:', reg.scope);

        // Listen for messages from SW (e.g. notification clicks or background actions)
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'NOTIFICATION_ACTION') {
            window.dispatchEvent(new CustomEvent('duo:notification_action', { detail: event.data }));
          }
        });
      } catch (err) {
        console.warn('Service Worker registration failed:', err);
      }
    }
  }

  // Fetch VAPID key from backend
  async fetchVapidKey() {
    try {
      const res = await fetch('./api/push');
      if (res.ok) {
        const data = await res.json();
        if (data.vapidPublicKey) {
          this.vapidPublicKey = data.vapidPublicKey;
        }
      }
    } catch (e) {
      console.warn('Could not fetch VAPID key from backend:', e);
    }
  }

  // Helper: Convert URL-safe base64 string to Uint8Array for PushManager
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  getPermissionState() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }

  // Request browser permission and subscribe to Web Push
  async requestPermissionAndSubscribe() {
    if (!('Notification' in window)) return 'unsupported';

    try {
      const permission = await Notification.requestPermission();
      window.storage.setSettings({ notificationsPrompted: true });

      if (permission === 'granted') {
        await this.subscribeToPush();
      }
      return permission;
    } catch (e) {
      console.error('Permission request failed:', e);
      return 'denied';
    }
  }

  // Subscribe to PushManager and register with backend database
  async subscribeToPush() {
    if (!this.swRegistration || !('PushManager' in window)) {
      console.warn('PushManager not available');
      return null;
    }

    if (!this.vapidPublicKey) {
      await this.fetchVapidKey();
      if (!this.vapidPublicKey) {
        console.warn('VAPID public key not configured on server');
        return null;
      }
    }

    try {
      // Check existing subscription
      let subscription = await this.swRegistration.pushManager.getSubscription();

      if (!subscription) {
        const convertedKey = this.urlBase64ToUint8Array(this.vapidPublicKey);
        subscription = await this.swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey
        });
      }

      this.isSubscribed = true;

      // Register subscription with backend
      await this.registerSubscriptionWithServer(subscription);
      return subscription;
    } catch (err) {
      console.error('Failed to subscribe to Web Push:', err);
      return null;
    }
  }

  // Send subscription object to backend database
  async registerSubscriptionWithServer(subscription) {
    const pair = window.storage.getPair();
    const currentUser = window.storage.getCurrentUser();
    if (!pair || !pair.id || !currentUser || !currentUser.id) return;

    try {
      await fetch('./api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'subscribe',
          pairId: pair.id,
          userId: currentUser.id,
          subscription: subscription.toJSON(),
          deviceInfo: navigator.userAgent.substring(0, 100)
        })
      });
      console.log('Web Push subscription registered with server');
    } catch (e) {
      console.warn('Failed to send push subscription to server:', e);
    }
  }

  // Auto-sync subscription when app opens
  async syncSubscription() {
    if (this.swRegistration && 'PushManager' in window && this.getPermissionState() === 'granted') {
      try {
        const sub = await this.swRegistration.pushManager.getSubscription();
        if (sub) {
          this.isSubscribed = true;
          this.registerSubscriptionWithServer(sub);
        } else if (this.vapidPublicKey) {
          this.subscribeToPush();
        }
      } catch (e) {}
    }
  }

  // Trigger local in-app chime & immediate local notification
  async triggerReminderNotification(reminder) {
    // 1. Synthesized chime
    window.sound.playReminderChime();

    // 2. Mobile vibration
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate([200, 100, 200]);
      } catch (e) {}
    }

    const title = `${reminder.icon || '⏰'} ${reminder.title}`;
    const body = `It's time for your ${reminder.title.toLowerCase()} reminder. Tap to respond!`;
    const options = {
      body: body,
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: `reminder-${reminder.id}`,
      renotify: true,
      requireInteraction: true,
      data: {
        reminderId: reminder.id,
        title: reminder.title,
        icon: reminder.icon,
        url: `./?reminderId=${reminder.id}`
      },
      actions: [
        { action: 'going', title: "✅ I'm Going" },
        { action: 'skipped', title: "❌ Skip Today" },
        { action: 'snooze', title: "⏰ Snooze 10m" }
      ]
    };

    if (this.swRegistration && 'showNotification' in this.swRegistration && Notification.permission === 'granted') {
      try {
        await this.swRegistration.showNotification(title, options);
        return;
      } catch (e) {}
    }

    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: body,
          icon: './assets/icons/icon-192.png',
          tag: `reminder-${reminder.id}`
        });
      } catch (e) {}
    }
  }
}

window.notifications = new NotificationManager();
