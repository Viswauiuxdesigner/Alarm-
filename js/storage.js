// Duo Local Storage & Offline Persistence Manager
class AppStorage {
  constructor() {
    this.keys = window.CONFIG.STORAGE_KEYS;
    this.offlineQueueKey = 'duo_offline_queue';
  }

  // ==========================================
  // Session & Active Pairing State
  // ==========================================

  hasActiveSession() {
    try {
      const active = localStorage.getItem(this.keys.ACTIVE_SESSION);
      const pair = this.getPair();
      return active === 'true' && !!pair && !!pair.id;
    } catch (e) {
      return false;
    }
  }

  setActiveSession(active) {
    try {
      localStorage.setItem(this.keys.ACTIVE_SESSION, active ? 'true' : 'false');
    } catch (e) {
      console.error('Storage setActiveSession error:', e);
    }
  }

  deactivateDevice() {
    try {
      localStorage.setItem(this.keys.ACTIVE_SESSION, 'false');
      localStorage.removeItem(this.keys.PAIR);
      localStorage.removeItem(this.keys.USER);
      localStorage.removeItem(this.keys.REMINDERS);
      localStorage.removeItem(this.keys.RESPONSES);
      localStorage.removeItem(this.offlineQueueKey);
    } catch (e) {
      console.error('Storage deactivateDevice error:', e);
    }
  }

  // ==========================================
  // Shared Data (Cached locally from backend)
  // ==========================================

  // Shared Pair Space Record
  getPair() {
    try {
      const data = localStorage.getItem(this.keys.PAIR);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('Storage getPair error:', e);
      return null;
    }
  }

  setPair(pair) {
    try {
      localStorage.setItem(this.keys.PAIR, JSON.stringify(pair));
    } catch (e) {
      console.error('Storage setPair error:', e);
    }
  }

  // Shared Reminders List
  getReminders() {
    try {
      const data = localStorage.getItem(this.keys.REMINDERS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  setReminders(reminders) {
    try {
      localStorage.setItem(this.keys.REMINDERS, JSON.stringify(reminders || []));
    } catch (e) {
      console.error('Storage setReminders error:', e);
    }
  }

  // Shared Occurrence Responses
  getResponses() {
    try {
      const data = localStorage.getItem(this.keys.RESPONSES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  setResponses(responses) {
    try {
      localStorage.setItem(this.keys.RESPONSES, JSON.stringify(responses || []));
    } catch (e) {
      console.error('Storage setResponses error:', e);
    }
  }

  // ==========================================
  // Local-Only Device Data
  // ==========================================

  // Current Device Identity (User 1 or User 2)
  getCurrentUser() {
    try {
      const data = localStorage.getItem(this.keys.USER);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  setCurrentUser(user) {
    try {
      localStorage.setItem(this.keys.USER, JSON.stringify(user));
    } catch (e) {
      console.error('Storage setCurrentUser error:', e);
    }
  }

  // App Settings
  getSettings() {
    try {
      const data = localStorage.getItem(this.keys.SETTINGS);
      return data ? JSON.parse(data) : { soundEnabled: true, notificationsPrompted: false };
    } catch (e) {
      return { soundEnabled: true, notificationsPrompted: false };
    }
  }

  setSettings(settings) {
    try {
      const current = this.getSettings();
      localStorage.setItem(this.keys.SETTINGS, JSON.stringify({ ...current, ...settings }));
    } catch (e) {
      console.error('Storage setSettings error:', e);
    }
  }

  // Offline Sync Queue
  getOfflineQueue() {
    try {
      const data = localStorage.getItem(this.offlineQueueKey);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  addToOfflineQueue(actionPayload) {
    try {
      const queue = this.getOfflineQueue();
      queue.push({
        ...actionPayload,
        queuedAt: new Date().toISOString()
      });
      localStorage.setItem(this.offlineQueueKey, JSON.stringify(queue));
    } catch (e) {
      console.error('Offline queue add error:', e);
    }
  }

  clearOfflineQueue() {
    try {
      localStorage.removeItem(this.offlineQueueKey);
    } catch (e) {}
  }

  // Reset/Clear all data
  clearAll() {
    try {
      Object.values(this.keys).forEach(k => localStorage.removeItem(k));
      localStorage.removeItem(this.offlineQueueKey);
    } catch (e) {
      console.error('Storage clearAll error:', e);
    }
  }
}

window.storage = new AppStorage();
