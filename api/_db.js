// Production & Local Database Adapter: api/_db.js
// Supports Upstash Redis / Vercel KV REST in production, and file/memory fallback in local dev.

const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

// In-memory fallback
const memoryStore = {
  pairs: {},
  reminders: {},
  responses: {},
  subscriptions: {}, // pairId -> Array of { id, userId, subscription, createdAt }
  deliveries: {},    // key -> timestamp
  pairIndex: []      // List of all active pair IDs
};

// Helper: Upstash / Vercel KV REST call
async function kvCommand(command, ...args) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/${command}/${args.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result !== undefined ? data.result : null;
  } catch (err) {
    console.warn('KV command error:', command, err);
    return null;
  }
}

// Local File Store helper
function readLocalStore() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {}
  return memoryStore;
}

function writeLocalStore(store) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {}
}

// Get all active pair IDs (for cron scheduler)
async function getAllPairIds() {
  if (KV_URL && KV_TOKEN) {
    const raw = await kvCommand('get', 'duo_pair_index');
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {}
    }
    return [];
  }
  const store = readLocalStore();
  return Object.keys(store.pairs || {});
}

async function addPairToIndex(pairId) {
  if (KV_URL && KV_TOKEN) {
    const existing = await getAllPairIds();
    if (!existing.includes(pairId)) {
      existing.push(pairId);
      await kvCommand('set', 'duo_pair_index', JSON.stringify(existing));
    }
    return;
  }
  const store = readLocalStore();
  if (!store.pairs[pairId]) {
    store.pairs[pairId] = true;
  }
  writeLocalStore(store);
}

// Get full Pair Space Record
async function getPairData(pairId) {
  const cleanId = (pairId || '').toUpperCase();
  if (!cleanId) return null;

  if (KV_URL && KV_TOKEN) {
    const raw = await kvCommand('get', `duo_pair_${cleanId}`);
    if (raw) {
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        console.error('Failed to parse pair JSON from KV:', e);
      }
    }
    return null;
  }

  const store = readLocalStore();
  const pair = store.pairs[cleanId];
  if (!pair) return null;

  return {
    pair,
    reminders: store.reminders[cleanId] || [],
    responses: store.responses[cleanId] || [],
    subscriptions: store.subscriptions[cleanId] || []
  };
}

// Save full Pair Space Record
async function savePairData(pairId, data) {
  const cleanId = (pairId || '').toUpperCase();
  if (!cleanId) return;

  const payload = {
    pair: data.pair,
    reminders: data.reminders || [],
    responses: data.responses || [],
    subscriptions: data.subscriptions || []
  };

  if (KV_URL && KV_TOKEN) {
    await kvCommand('set', `duo_pair_${cleanId}`, JSON.stringify(payload));
    await addPairToIndex(cleanId);
    return;
  }

  const store = readLocalStore();
  store.pairs[cleanId] = data.pair;
  store.reminders[cleanId] = data.reminders || [];
  store.responses[cleanId] = data.responses || [];
  store.subscriptions[cleanId] = data.subscriptions || [];
  writeLocalStore(store);
}

// Delivery Log (Duplicate Prevention for notifications)
// deliveryKey format: ${pairId}_${reminderId}_${date}_${userId}_${time}
async function isDelivered(deliveryKey) {
  if (KV_URL && KV_TOKEN) {
    const val = await kvCommand('get', `duo_deliv_${deliveryKey}`);
    return val !== null && val !== undefined;
  }
  const store = readLocalStore();
  return !!(store.deliveries && store.deliveries[deliveryKey]);
}

async function markDelivered(deliveryKey, ttlSeconds = 86400 * 2) {
  if (KV_URL && KV_TOKEN) {
    // Set with 48-hour expiration
    await kvCommand('setex', `duo_deliv_${deliveryKey}`, ttlSeconds, '1');
    return;
  }
  const store = readLocalStore();
  if (!store.deliveries) store.deliveries = {};
  store.deliveries[deliveryKey] = Date.now();
  writeLocalStore(store);
}

module.exports = {
  getPairData,
  savePairData,
  getAllPairIds,
  addPairToIndex,
  isDelivered,
  markDelivered
};
