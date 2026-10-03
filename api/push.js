// Serverless Push Endpoint: api/push.js
// Handles VAPID public key sharing, push subscription registration, unsubscription, and push testing.

const db = require('./_db');
const push = require('./_push');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // 1. GET: Fetch VAPID Public Key
    if (req.method === 'GET') {
      const vapidPublicKey = push.getVapidPublicKey();
      return res.status(200).json({
        success: true,
        configured: !!vapidPublicKey,
        vapidPublicKey: vapidPublicKey || null
      });
    }

    // 2. POST: Actions
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { action, pairId, userId, subscription } = body;

      if (!pairId) {
        return res.status(400).json({ error: 'Missing pairId' });
      }

      const data = await db.getPairData(pairId);
      if (!data) {
        return res.status(404).json({ error: 'Pair space not found' });
      }

      if (!data.subscriptions) {
        data.subscriptions = [];
      }

      // ACTION: Register Push Subscription
      if (action === 'subscribe') {
        if (!subscription || !subscription.endpoint || !userId) {
          return res.status(400).json({ error: 'Invalid subscription payload or missing userId' });
        }

        // Avoid duplicates by endpoint
        const existingIdx = data.subscriptions.findIndex(
          s => s.subscription && s.subscription.endpoint === subscription.endpoint
        );

        const subRecord = {
          id: 'sub_' + Math.random().toString(36).substring(2, 9),
          userId,
          subscription,
          deviceInfo: body.deviceInfo || 'web',
          updatedAt: new Date().toISOString()
        };

        if (existingIdx >= 0) {
          data.subscriptions[existingIdx] = subRecord;
        } else {
          data.subscriptions.push(subRecord);
        }

        await db.savePairData(pairId, data);
        return res.status(200).json({ success: true, message: 'Push subscription registered' });
      }

      // ACTION: Unsubscribe
      if (action === 'unsubscribe') {
        const endpoint = body.endpoint || (subscription && subscription.endpoint);
        if (endpoint) {
          data.subscriptions = data.subscriptions.filter(
            s => !(s.subscription && s.subscription.endpoint === endpoint)
          );
          await db.savePairData(pairId, data);
        }
        return res.status(200).json({ success: true, message: 'Push subscription removed' });
      }

      // ACTION: Test Remote Push
      if (action === 'test_push') {
        const targetUserId = userId;
        const targetSubs = data.subscriptions.filter(s => !targetUserId || s.userId === targetUserId);

        if (targetSubs.length === 0) {
          return res.status(400).json({
            error: 'No active push subscriptions found for this user/device on the server.'
          });
        }

        const payload = {
          title: '⏰ Duo Test Reminder',
          body: "Push notification system is connected and working perfectly!",
          icon: '/assets/icons/icon-192.png',
          badge: '/assets/icons/icon-192.png',
          tag: 'duo-test-push',
          data: {
            url: './'
          }
        };

        const result = await push.sendPushToMultiple(targetSubs, payload);

        // Prune expired subscriptions if any
        if (result.expiredEndpoints && result.expiredEndpoints.length > 0) {
          data.subscriptions = data.subscriptions.filter(
            s => !result.expiredEndpoints.includes(s.subscription.endpoint)
          );
          await db.savePairData(pairId, data);
        }

        return res.status(200).json({
          success: true,
          sent: result.sent,
          failed: result.failed,
          expiredPruned: result.expiredEndpoints.length
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Push API error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
};
