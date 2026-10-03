// Standalone Zero-Dependency Local Node Server: server.js
// Serves static PWA files and handles /api/sync, /api/push, and /api/cron endpoints.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Persistent Store Helper
function loadStore() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Error reading store.json, using defaults:', e);
  }
  return { pairs: {}, reminders: {}, responses: {}, subscriptions: {}, deliveries: {} };
}

function saveStore(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing store.json:', e);
  }
}

// Helper to generate 6-character pairing code
function generatePairCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// API Handler
async function handleApi(req, res, parsedUrl) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const pathname = parsedUrl.pathname;
  const store = loadStore();

  // ==========================================
  // 1. /api/push
  // ==========================================
  if (pathname === '/api/push') {
    if (req.method === 'GET') {
      const vapidPublic = process.env.VAPID_PUBLIC_KEY || null;
      res.writeHead(200);
      return res.end(JSON.stringify({
        success: true,
        configured: !!vapidPublic,
        vapidPublicKey: vapidPublic
      }));
    }

    if (req.method === 'POST') {
      let rawBody = '';
      req.on('data', chunk => { rawBody += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(rawBody || '{}');
          const { action, pairId, userId, subscription } = body;
          const cleanPairId = (pairId || '').toUpperCase();

          if (!cleanPairId || !store.pairs[cleanPairId]) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: 'Pair not found' }));
          }

          if (!store.subscriptions) store.subscriptions = {};
          if (!store.subscriptions[cleanPairId]) store.subscriptions[cleanPairId] = [];

          if (action === 'subscribe') {
            const subs = store.subscriptions[cleanPairId];
            const existingIdx = subs.findIndex(s => s.subscription && s.subscription.endpoint === subscription.endpoint);
            const subRec = {
              id: 'sub_' + Math.random().toString(36).substring(2, 9),
              userId,
              subscription,
              updatedAt: new Date().toISOString()
            };
            if (existingIdx >= 0) subs[existingIdx] = subRec;
            else subs.push(subRec);
            saveStore(store);

            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, message: 'Subscribed' }));
          }

          if (action === 'unsubscribe') {
            const endpoint = body.endpoint || (subscription && subscription.endpoint);
            store.subscriptions[cleanPairId] = store.subscriptions[cleanPairId].filter(
              s => !(s.subscription && s.subscription.endpoint === endpoint)
            );
            saveStore(store);

            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, message: 'Unsubscribed' }));
          }

          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Unknown action' }));
        } catch (e) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // ==========================================
  // 2. /api/sync
  // ==========================================
  if (pathname === '/api/sync') {
    if (req.method === 'GET') {
      const pairId = (parsedUrl.query.pairId || '').toUpperCase();
      if (!pairId) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Missing pairId query parameter' }));
      }

      const pair = store.pairs[pairId];
      if (!pair) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Pair space not found' }));
      }

      res.writeHead(200);
      return res.end(JSON.stringify({
        success: true,
        pair,
        reminders: store.reminders[pairId] || [],
        responses: store.responses[pairId] || [],
        serverTime: new Date().toISOString()
      }));
    }

    if (req.method === 'POST') {
      let rawBody = '';
      req.on('data', chunk => { rawBody += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(rawBody || '{}');
          const { action } = body;

          // ACTION: Create Pair
          if (action === 'create_pair') {
            const { userName, partnerName } = body;
            const pairId = generatePairCode();
            const user1Id = 'u_' + Math.random().toString(36).substring(2, 9);
            const user2Id = 'u_' + Math.random().toString(36).substring(2, 9);

            const newPair = {
              id: pairId,
              user1: { id: user1Id, name: userName || 'Viswa' },
              user2: { id: user2Id, name: partnerName || 'Friend' },
              createdAt: new Date().toISOString()
            };

            const initialReminders = [
              {
                id: 'rem_' + Math.random().toString(36).substring(2, 9),
                pairId: pairId,
                title: 'Walking',
                icon: '🚶',
                time: '06:00',
                repeat: 'daily',
                active: true,
                createdAt: new Date().toISOString()
              }
            ];

            store.pairs[pairId] = newPair;
            store.reminders[pairId] = initialReminders;
            store.responses[pairId] = [];
            store.subscriptions[pairId] = [];
            saveStore(store);

            res.writeHead(200);
            return res.end(JSON.stringify({
              success: true,
              pair: newPair,
              currentUser: newPair.user1,
              reminders: initialReminders,
              responses: []
            }));
          }

          // ACTION: Join Pair
          if (action === 'join_pair') {
            const { pairCode, userName } = body;
            const pairId = (pairCode || '').trim().toUpperCase();
            const pair = store.pairs[pairId];

            if (!pair) {
              res.writeHead(404);
              return res.end(JSON.stringify({ error: 'Pair code not found' }));
            }

            if (userName) {
              pair.user2.name = userName;
              store.pairs[pairId] = pair;
              saveStore(store);
            }

            res.writeHead(200);
            return res.end(JSON.stringify({
              success: true,
              pair,
              currentUser: pair.user2,
              reminders: store.reminders[pairId] || [],
              responses: store.responses[pairId] || []
            }));
          }

          const pairId = (body.pairId || '').toUpperCase();
          if (!pairId || !store.pairs[pairId]) {
            res.writeHead(404);
            return res.end(JSON.stringify({ error: 'Pair not found' }));
          }

          // ACTION: Save Reminder
          if (action === 'save_reminder') {
            const { reminder } = body;
            const remList = store.reminders[pairId] || [];
            const idx = remList.findIndex(r => r.id === reminder.id);
            if (idx >= 0) remList[idx] = { ...remList[idx], ...reminder };
            else remList.push(reminder);
            store.reminders[pairId] = remList;
            saveStore(store);

            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, reminders: remList }));
          }

          // ACTION: Delete Reminder
          if (action === 'delete_reminder') {
            const { reminderId } = body;
            store.reminders[pairId] = (store.reminders[pairId] || []).filter(r => r.id !== reminderId);
            store.responses[pairId] = (store.responses[pairId] || []).filter(r => r.reminderId !== reminderId);
            saveStore(store);

            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, reminders: store.reminders[pairId] }));
          }

          // ACTION: Submit Response
          if (action === 'submit_response') {
            const { reminderId, date, userId, status, respondedAt, snoozeUntil } = body;
            const respList = store.responses[pairId] || [];
            const existingIdx = respList.findIndex(
              r => r.reminderId === reminderId && r.date === date && r.userId === userId
            );

            const newResponse = {
              id: existingIdx >= 0 ? respList[existingIdx].id : 'resp_' + Math.random().toString(36).substring(2, 9),
              reminderId,
              date,
              userId,
              status,
              respondedAt: respondedAt || new Date().toISOString(),
              snoozeUntil: snoozeUntil || null
            };

            if (existingIdx >= 0) respList[existingIdx] = newResponse;
            else respList.push(newResponse);

            store.responses[pairId] = respList;
            saveStore(store);

            res.writeHead(200);
            return res.end(JSON.stringify({ success: true, response: newResponse, responses: respList }));
          }

          // ACTION: Batch sync
          if (action === 'batch_sync') {
            const { queue } = body;
            if (Array.isArray(queue)) {
              const respList = store.responses[pairId] || [];
              queue.forEach(item => {
                if (item.action === 'submit_response') {
                  const idx = respList.findIndex(
                    r => r.reminderId === item.reminderId && r.date === item.date && r.userId === item.userId
                  );
                  const resp = {
                    id: idx >= 0 ? respList[idx].id : 'resp_' + Math.random().toString(36).substring(2, 9),
                    reminderId: item.reminderId,
                    date: item.date,
                    userId: item.userId,
                    status: item.status,
                    respondedAt: item.respondedAt || new Date().toISOString(),
                    snoozeUntil: item.snoozeUntil || null
                  };
                  if (idx >= 0) respList[idx] = resp;
                  else respList.push(resp);
                }
              });
              store.responses[pairId] = respList;
              saveStore(store);
            }
            res.writeHead(200);
            return res.end(JSON.stringify({
              success: true,
              reminders: store.reminders[pairId] || [],
              responses: store.responses[pairId] || []
            }));
          }

          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Unknown action' }));
        } catch (e) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
  }

  // ==========================================
  // 3. /api/cron
  // ==========================================
  if (pathname === '/api/cron') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      message: 'Local cron endpoint active'
    }));
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not Found' }));
}

// Static File Server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, parsedUrl);
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' || ext === '.js' ? 'no-cache' : 'max-age=3600'
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Duo PWA Server running at: http://localhost:${PORT}`);
  console.log(` Open this URL on Device A & Device B to test sync!`);
  console.log(`======================================================\n`);
});
