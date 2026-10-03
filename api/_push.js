// Web Push Dispatcher: api/_push.js
// Configures VAPID and sends push notifications to client PushSubscription endpoints.

let webpush = null;
try {
  webpush = require('web-push');
} catch (e) {
  // web-push optional fallback during local dev before npm install
}

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || null;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@duoremind.app';

if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (err) {
    console.error('Failed to configure VAPID details:', err);
  }
}

function getVapidPublicKey() {
  return VAPID_PUBLIC;
}

// Send push notification to a single subscription
// Returns { success: true } or { success: false, expired: true/false, error }
async function sendPush(subscription, payload) {
  if (!webpush || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('Web push not configured: missing web-push package or VAPID keys');
    return { success: false, error: 'VAPID keys not configured on server' };
  }

  try {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await webpush.sendNotification(subscription, payloadStr, {
      TTL: 60 * 60, // 1 hour TTL
      urgency: 'high'
    });
    return { success: true };
  } catch (err) {
    const statusCode = err.statusCode;
    // 404 Not Found or 410 Gone means the subscription has expired or unsubscribed
    const isExpired = statusCode === 404 || statusCode === 410;
    return {
      success: false,
      statusCode,
      expired: isExpired,
      error: err.message
    };
  }
}

// Broadcast push to an array of subscriptions, automatically collecting expired endpoints
async function sendPushToMultiple(subscriptions, payload) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return { sent: 0, failed: 0, expiredEndpoints: [] };
  }

  const results = {
    sent: 0,
    failed: 0,
    expiredEndpoints: []
  };

  await Promise.all(
    subscriptions.map(async (subItem) => {
      const sub = subItem.subscription || subItem;
      const res = await sendPush(sub, payload);
      if (res.success) {
        results.sent++;
      } else {
        results.failed++;
        if (res.expired) {
          results.expiredEndpoints.push(sub.endpoint);
        }
      }
    })
  );

  return results;
}

module.exports = {
  getVapidPublicKey,
  sendPush,
  sendPushToMultiple
};
