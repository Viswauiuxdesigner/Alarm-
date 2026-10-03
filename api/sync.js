// Vercel Serverless Function: api/sync.js
// Handles Pair Creation, Sync, Reminder CRUD, and Occurrence Responses for 2 People.

const db = require('./_db');
const push = require('./_push');

// Helper to generate a clean 6-character pairing code
function generatePairCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

module.exports = async function handler(req, res) {
  // Enable CORS for PWA and preview environments
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. GET: Fetch current pair state
    if (req.method === 'GET') {
      const { pairId } = req.query;
      if (!pairId) {
        return res.status(400).json({ error: 'Missing pairId query parameter' });
      }

      const data = await db.getPairData(pairId.toUpperCase());
      if (!data) {
        return res.status(404).json({ error: 'Pair space not found' });
      }

      return res.status(200).json({
        success: true,
        ...data,
        serverTime: new Date().toISOString()
      });
    }

    // 2. POST: Actions
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { action } = body;

      // ACTION: Create Pair
      if (action === 'create_pair') {
        const { userName, partnerName, timezone } = body;
        const pairId = generatePairCode();
        const user1Id = 'u_' + Math.random().toString(36).substring(2, 9);
        const user2Id = 'u_' + Math.random().toString(36).substring(2, 9);

        const newPair = {
          id: pairId,
          user1: { id: user1Id, name: userName || 'Viswa' },
          user2: { id: user2Id, name: partnerName || 'Partner', joined: false },
          paired: false,
          timezone: timezone || 'UTC',
          createdAt: new Date().toISOString()
        };

        // Seed with a welcoming first default reminder (Walking at 6:00 AM)
        const initialReminders = [
          {
            id: 'rem_' + Math.random().toString(36).substring(2, 9),
            pairId: pairId,
            title: 'Walking',
            icon: '🚶',
            time: '06:00',
            repeat: 'daily',
            timezone: timezone || 'UTC',
            active: true,
            createdAt: new Date().toISOString()
          }
        ];

        const payload = {
          pair: newPair,
          reminders: initialReminders,
          responses: [],
          subscriptions: []
        };

        await db.savePairData(pairId, payload);

        return res.status(200).json({
          success: true,
          pair: newPair,
          currentUser: newPair.user1,
          reminders: initialReminders,
          responses: []
        });
      }

      // ACTION: Join / Reconnect Existing Pair
      if (action === 'join_pair') {
        const { pairCode, userName, partnerName, timezone } = body;
        const pairId = (pairCode || '').trim().toUpperCase();
        const data = await db.getPairData(pairId);

        if (!data || !data.pair) {
          return res.status(404).json({ error: "That code doesn't match. Check your partner's code and try again." });
        }

        let currentUser = data.pair.user2;
        const cleanUserName = (userName || '').trim();

        // Check if user is reconnecting as user 1 (creator)
        if (cleanUserName && data.pair.user1 && data.pair.user1.name.toLowerCase() === cleanUserName.toLowerCase()) {
          currentUser = data.pair.user1;
        } else {
          // Connecting / reconnecting as user 2 (partner)
          if (cleanUserName) {
            data.pair.user2.name = cleanUserName;
          }
          data.pair.user2.joined = true;
          currentUser = data.pair.user2;
        }

        data.pair.paired = true;
        if (timezone) {
          data.pair.timezone = timezone;
        }
        await db.savePairData(pairId, data);

        return res.status(200).json({
          success: true,
          pair: data.pair,
          currentUser,
          reminders: data.reminders || [],
          responses: data.responses || []
        });
      }

      // Pair-dependent actions require pairId
      const pairId = (body.pairId || '').toUpperCase();
      let data = await db.getPairData(pairId);

      if (!data) {
        // Automatically initialize if missing
        data = {
          pair: {
            id: pairId,
            user1: { id: 'u_1', name: body.userName || 'You' },
            user2: { id: 'u_2', name: body.partnerName || 'Partner' },
            timezone: body.timezone || 'UTC',
            createdAt: new Date().toISOString()
          },
          reminders: [],
          responses: [],
          subscriptions: []
        };
      }

      // ACTION: Save / Update Reminder
      if (action === 'save_reminder') {
        const reminder = body.reminder;
        if (!reminder || !reminder.id) {
          return res.status(400).json({ error: 'Invalid reminder payload' });
        }

        const existingIdx = data.reminders.findIndex(r => r.id === reminder.id);
        if (existingIdx >= 0) {
          data.reminders[existingIdx] = { ...data.reminders[existingIdx], ...reminder };
        } else {
          data.reminders.push(reminder);
        }

        await db.savePairData(pairId, data);
        return res.status(200).json({ success: true, reminders: data.reminders });
      }

      // ACTION: Delete Reminder
      if (action === 'delete_reminder') {
        const { reminderId } = body;
        data.reminders = data.reminders.filter(r => r.id !== reminderId);
        data.responses = data.responses.filter(r => r.reminderId !== reminderId);
        await db.savePairData(pairId, data);
        return res.status(200).json({ success: true, reminders: data.reminders });
      }

      // ACTION: Submit Response (Going, Skipped, Snoozed)
      if (action === 'submit_response') {
        const { reminderId, date, userId, status, respondedAt, snoozeUntil } = body;
        if (!reminderId || !date || !userId || !status) {
          return res.status(400).json({ error: 'Missing required response parameters' });
        }

        // Find existing response for this occurrence and user
        const existingIdx = data.responses.findIndex(
          resp => resp.reminderId === reminderId && resp.date === date && resp.userId === userId
        );

        const newResponse = {
          id: existingIdx >= 0 ? data.responses[existingIdx].id : 'resp_' + Math.random().toString(36).substring(2, 9),
          reminderId,
          date,
          userId,
          status, // 'going' | 'skipped' | 'snoozed' | 'pending'
          respondedAt: respondedAt || new Date().toISOString(),
          snoozeUntil: snoozeUntil || null
        };

        if (existingIdx >= 0) {
          data.responses[existingIdx] = newResponse;
        } else {
          data.responses.push(newResponse);
        }

        await db.savePairData(pairId, data);

        // CROSS-DEVICE DISMISSAL: Send silent/dismiss push to partner device(s)
        // This closes active notification on the partner phone immediately!
        if (data.subscriptions && data.subscriptions.length > 0) {
          const partnerSubs = data.subscriptions.filter(s => s.userId !== userId);
          if (partnerSubs.length > 0) {
            const dismissPayload = {
              type: 'response_update',
              reminderId,
              dateKey: date,
              userId,
              status,
              snoozeUntil: snoozeUntil || null
            };
            push.sendPushToMultiple(partnerSubs, dismissPayload).catch(err => {
              console.warn('Failed to send partner response dismissal push:', err);
            });
          }
        }

        return res.status(200).json({
          success: true,
          response: newResponse,
          responses: data.responses
        });
      }

      // ACTION: Batch sync (Offline queue flush)
      if (action === 'batch_sync' || action === 'sync_state') {
        if (Array.isArray(body.queue)) {
          body.queue.forEach(item => {
            if (item.action === 'submit_response') {
              const existingIdx = data.responses.findIndex(
                r => r.reminderId === item.reminderId && r.date === item.date && r.userId === item.userId
              );
              const resp = {
                id: existingIdx >= 0 ? data.responses[existingIdx].id : 'resp_' + Math.random().toString(36).substring(2, 9),
                reminderId: item.reminderId,
                date: item.date,
                userId: item.userId,
                status: item.status,
                respondedAt: item.respondedAt || new Date().toISOString(),
                snoozeUntil: item.snoozeUntil || null
              };
              if (existingIdx >= 0) data.responses[existingIdx] = resp;
              else data.responses.push(resp);
            }
          });
        }
        if (Array.isArray(body.reminders)) {
          data.reminders = body.reminders;
        }
        await db.savePairData(pairId, data);
        return res.status(200).json({ success: true, reminders: data.reminders, responses: data.responses });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
};
