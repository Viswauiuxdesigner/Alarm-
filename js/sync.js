// Duo Two-Person Sync & Network Engine
class SyncEngine {
  constructor() {
    this.apiBase = './api/sync';
    this.isPolling = false;
    this.pollTimer = null;
    this.isOnline = navigator.onLine !== false;
    this.broadcastChannel = null;

    if ('BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('duo_sync_channel');
        this.broadcastChannel.onmessage = (event) => {
          this.handleBroadcastMessage(event.data);
        };
      } catch (e) {}
    }

    // Network status listeners
    window.addEventListener('online', () => {
      this.isOnline = true;
      window.dispatchEvent(new CustomEvent('duo:network_status', { detail: { online: true } }));
      this.flushOfflineQueue();
      this.fetchLatest();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      window.dispatchEvent(new CustomEvent('duo:network_status', { detail: { online: false } }));
    });
  }

  // Broadcast to other tabs/windows on same device
  broadcast(type, payload) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload, timestamp: Date.now() });
      } catch (e) {}
    }
  }

  handleBroadcastMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'SYNC_UPDATE') {
      const { reminders, responses, pair } = msg.payload;
      if (reminders) window.storage.setReminders(reminders);
      if (responses) window.storage.setResponses(responses);
      if (pair) {
        const currentPair = window.storage.getPair();
        if (currentPair) {
          currentPair.user1 = pair.user1;
          currentPair.user2 = pair.user2;
          window.storage.setPair(currentPair);
        }
      }
      window.dispatchEvent(new CustomEvent('duo:state_synced'));
    }
  }

  // Create a new pairing space on backend
  async createPair(userName, partnerName) {
    const defaultPairId = 'DUO' + Math.floor(1000 + Math.random() * 9000);
    const user1 = { id: 'u_1', name: userName || 'Viswa' };
    const user2 = { id: 'u_2', name: partnerName || 'Friend' };

    const pair = {
      id: defaultPairId,
      user1,
      user2,
      createdAt: new Date().toISOString()
    };

    const initialReminders = [
      {
        id: 'rem_' + Math.random().toString(36).substring(2, 9),
        pairId: pair.id,
        title: 'Walking',
        icon: '🚶',
        time: '06:00',
        repeat: window.CONFIG.REPEAT.DAILY,
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'rem_' + Math.random().toString(36).substring(2, 9),
        pairId: pair.id,
        title: 'Workout',
        icon: '💪',
        time: '19:00',
        repeat: window.CONFIG.REPEAT.DAILY,
        active: true,
        createdAt: new Date().toISOString()
      }
    ];

    try {
      const res = await fetch(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_pair',
          userName: user1.name,
          partnerName: user2.name
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.pair) {
          window.storage.setPair(data.pair);
          window.storage.setCurrentUser(data.currentUser || data.pair.user1);
          window.storage.setReminders(data.reminders || initialReminders);
          window.storage.setResponses(data.responses || []);
          this.broadcast('SYNC_UPDATE', { reminders: data.reminders, responses: data.responses, pair: data.pair });
          return data.pair;
        }
      }
    } catch (e) {
      console.warn('Backend not reachable, running offline local pair mode', e);
    }

    // Local fallback
    window.storage.setPair(pair);
    window.storage.setCurrentUser(user1);
    window.storage.setReminders(initialReminders);
    window.storage.setResponses([]);
    this.broadcast('SYNC_UPDATE', { reminders: initialReminders, responses: [], pair });
    return pair;
  }

  // Join an existing pairing space from Device B
  async joinPair(pairCode, userName) {
    const code = (pairCode || '').trim().toUpperCase();
    try {
      const res = await fetch(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join_pair',
          pairCode: code,
          userName: userName || 'Partner'
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.pair) {
          window.storage.setPair(data.pair);
          // Set this device's user as User 2
          window.storage.setCurrentUser(data.currentUser || data.pair.user2);
          window.storage.setReminders(data.reminders || []);
          window.storage.setResponses(data.responses || []);
          this.broadcast('SYNC_UPDATE', { reminders: data.reminders, responses: data.responses, pair: data.pair });
          return { success: true, pair: data.pair };
        }
      }
      return { success: false, error: 'Pair code not found. Please verify the code.' };
    } catch (e) {
      console.warn('Join pair offline error:', e);
      return { success: false, error: 'Could not connect to server. Please check your network connection.' };
    }
  }

  // Save / Update a reminder
  async saveReminder(reminder) {
    const pair = window.storage.getPair();
    const reminders = window.storage.getReminders();
    const idx = reminders.findIndex(r => r.id === reminder.id);
    if (idx >= 0) {
      reminders[idx] = reminder;
    } else {
      reminders.push(reminder);
    }
    window.storage.setReminders(reminders);
    this.broadcast('SYNC_UPDATE', { reminders, responses: window.storage.getResponses(), pair });

    if (pair && pair.id) {
      try {
        const res = await fetch(this.apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_reminder',
            pairId: pair.id,
            reminder
          })
        });
        if (!res.ok) throw new Error('Save reminder failed on server');
      } catch (e) {
        console.warn('Offline: queued reminder save', e);
        window.storage.addToOfflineQueue({ action: 'save_reminder', reminder });
      }
    }
    return reminders;
  }

  // Delete a reminder
  async deleteReminder(reminderId) {
    const pair = window.storage.getPair();
    let reminders = window.storage.getReminders().filter(r => r.id !== reminderId);
    let responses = window.storage.getResponses().filter(r => r.reminderId !== reminderId);

    window.storage.setReminders(reminders);
    window.storage.setResponses(responses);
    this.broadcast('SYNC_UPDATE', { reminders, responses, pair });

    if (pair && pair.id) {
      try {
        await fetch(this.apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'delete_reminder',
            pairId: pair.id,
            reminderId
          })
        });
      } catch (e) {
        console.warn('Offline: queued delete reminder', e);
        window.storage.addToOfflineQueue({ action: 'delete_reminder', reminderId });
      }
    }
  }

  // Submit response (Going, Skipped, Snoozed)
  async submitResponse(reminderId, date, userId, status, respondedAt, snoozeUntil) {
    const pair = window.storage.getPair();
    const responses = window.storage.getResponses();

    const existingIdx = responses.findIndex(
      resp => resp.reminderId === reminderId && resp.date === date && resp.userId === userId
    );

    const newResponse = {
      id: existingIdx >= 0 ? responses[existingIdx].id : 'resp_' + Math.random().toString(36).substring(2, 9),
      reminderId,
      date,
      userId,
      status,
      respondedAt: respondedAt || new Date().toISOString(),
      snoozeUntil: snoozeUntil || null
    };

    if (existingIdx >= 0) {
      responses[existingIdx] = newResponse;
    } else {
      responses.push(newResponse);
    }

    // Update local cache immediately for responsive UI
    window.storage.setResponses(responses);
    this.broadcast('SYNC_UPDATE', { reminders: window.storage.getReminders(), responses, pair });

    if (pair && pair.id) {
      try {
        const res = await fetch(this.apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_response',
            pairId: pair.id,
            reminderId,
            date,
            userId,
            status,
            respondedAt: newResponse.respondedAt,
            snoozeUntil: newResponse.snoozeUntil
          })
        });
        if (!res.ok) throw new Error('Response submission failed on server');
      } catch (e) {
        console.warn('Offline: queued response submission', e);
        window.storage.addToOfflineQueue({
          action: 'submit_response',
          reminderId,
          date,
          userId,
          status,
          respondedAt: newResponse.respondedAt,
          snoozeUntil: newResponse.snoozeUntil
        });
      }
    }

    return newResponse;
  }

  // Flush offline queue when reconnected
  async flushOfflineQueue() {
    const queue = window.storage.getOfflineQueue();
    const pair = window.storage.getPair();
    if (!queue.length || !pair || !pair.id) return;

    try {
      const res = await fetch(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_sync',
          pairId: pair.id,
          queue
        })
      });

      if (res.ok) {
        window.storage.clearOfflineQueue();
        console.log('Successfully flushed offline sync queue');
        this.fetchLatest();
      }
    } catch (e) {
      console.warn('Failed to flush offline queue, will retry', e);
    }
  }

  // Fetch latest state from server
  async fetchLatest() {
    const pair = window.storage.getPair();
    if (!pair || !pair.id) return;

    try {
      const res = await fetch(`${this.apiBase}?pairId=${encodeURIComponent(pair.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.reminders) window.storage.setReminders(data.reminders);
          if (data.responses) window.storage.setResponses(data.responses);
          if (data.pair) {
            // Merge pair names without changing current user identity
            const currentPair = window.storage.getPair();
            if (currentPair) {
              currentPair.user1 = data.pair.user1;
              currentPair.user2 = data.pair.user2;
              window.storage.setPair(currentPair);
            }
          }
          window.dispatchEvent(new CustomEvent('duo:state_synced'));
        }
      }
    } catch (e) {
      // Network hiccup - preserve local cache silently
    }
  }

  // Background polling for pair updates
  startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;

    this.pollTimer = setInterval(() => {
      this.fetchLatest();
    }, window.CONFIG.SYNC_INTERVAL_MS);
  }

  stopPolling() {
    this.isPolling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

window.sync = new SyncEngine();
