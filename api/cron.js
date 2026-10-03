// Scheduled Cron Reminder Dispatcher: api/cron.js
// Runs every minute via Vercel Cron or external scheduler to dispatch scheduled Web Push reminders.

const db = require('./_db');
const push = require('./_push');

// Format standard date key: YYYY-MM-DD
function getDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Check if a reminder repeats on given day of week
function isReminderActiveOnDay(reminder, date) {
  if (!reminder || !reminder.active) return false;
  const dayOfWeek = date.getUTCDay();

  switch (reminder.repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    case 'custom':
      return Array.isArray(reminder.customDays) && reminder.customDays.includes(dayOfWeek);
    case 'once':
      const remDateKey = reminder.onceDate || (reminder.createdAt ? reminder.createdAt.split('T')[0] : '');
      return remDateKey === getDateKey(date);
    default:
      return true;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  // Verify CRON_SECRET if configured
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'];
    const isVercelCron = req.headers['x-vercel-cron'] !== undefined;
    if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized cron request' });
    }
  }

  const now = new Date();
  const utcHours = String(now.getUTCHours()).padStart(2, '0');
  const utcMinutes = String(now.getUTCMinutes()).padStart(2, '0');
  const currentUtcTime = `${utcHours}:${utcMinutes}`;
  const dateKey = getDateKey(now);

  const pairIds = await db.getAllPairIds();
  const stats = {
    checkedPairs: pairIds.length,
    remindersEvaluated: 0,
    notificationsSent: 0,
    duplicatesSkipped: 0,
    errors: 0
  };

  for (const pairId of pairIds) {
    try {
      const data = await db.getPairData(pairId);
      if (!data || !data.reminders || !data.pair) continue;

      const reminders = data.reminders || [];
      const responses = data.responses || [];
      const subscriptions = data.subscriptions || [];
      const users = [data.pair.user1, data.pair.user2].filter(Boolean);

      let subscriptionsChanged = false;

      for (const reminder of reminders) {
        stats.remindersEvaluated++;
        if (!isReminderActiveOnDay(reminder, now)) continue;

        // Check each user's trigger condition (scheduled time or snoozed time)
        for (const user of users) {
          if (!user || !user.id) continue;

          // 1. Check Snooze status
          const userResp = responses.find(
            r => r.reminderId === reminder.id && r.date === dateKey && r.userId === user.id
          );

          let isDueNow = false;
          let triggerType = 'scheduled';
          let triggerTimeKey = reminder.time;

          if (userResp && userResp.status === 'snoozed' && userResp.snoozeUntil) {
            const snoozeDate = new Date(userResp.snoozeUntil);
            // If current time is within +/- 1 minute of snooze date
            const diffMs = Math.abs(now.getTime() - snoozeDate.getTime());
            if (diffMs <= 70000) {
              isDueNow = true;
              triggerType = 'snooze';
              triggerTimeKey = `snooze_${snoozeDate.getUTCHours()}_${snoozeDate.getUTCMinutes()}`;
            }
          } else {
            // Check base reminder time (allowing for user time matching current time)
            if (reminder.time === currentUtcTime || reminder.time === now.toTimeString().substring(0, 5)) {
              isDueNow = true;
              triggerType = 'base';
            }
          }

          if (!isDueNow) continue;

          // 2. Duplicate Protection Key: pairId_reminderId_dateKey_userId_triggerTimeKey
          const deliveryKey = `${pairId}_${reminder.id}_${dateKey}_${user.id}_${triggerTimeKey}`;
          const alreadySent = await db.isDelivered(deliveryKey);

          if (alreadySent) {
            stats.duplicatesSkipped++;
            continue;
          }

          // Mark delivery BEFORE sending to strictly prevent concurrent duplicate sends
          await db.markDelivered(deliveryKey);

          // 3. Gather this user's push subscriptions
          const userSubs = subscriptions.filter(s => s.userId === user.id);
          if (userSubs.length === 0) continue;

          // 4. Construct rich notification payload
          const payload = {
            title: `${reminder.icon || '⏰'} ${reminder.title}`,
            body: triggerType === 'snooze'
              ? `Snooze ended for ${reminder.title}. What are you doing?`
              : `It's time for your ${reminder.title} reminder. Tap to respond!`,
            icon: '/assets/icons/icon-192.png',
            badge: '/assets/icons/icon-192.png',
            tag: `reminder-${reminder.id}`,
            data: {
              reminderId: reminder.id,
              title: reminder.title,
              icon: reminder.icon,
              dateKey,
              url: `./?reminderId=${reminder.id}`
            },
            actions: [
              { action: 'going', title: "✅ I'm Going" },
              { action: 'skipped', title: "❌ Skip Today" },
              { action: 'snooze', title: "⏰ Snooze 10m" }
            ]
          };

          // 5. Send Web Push
          const pushRes = await push.sendPushToMultiple(userSubs, payload);
          stats.notificationsSent += pushRes.sent;

          // Prune invalid endpoints
          if (pushRes.expiredEndpoints && pushRes.expiredEndpoints.length > 0) {
            data.subscriptions = data.subscriptions.filter(
              s => !pushRes.expiredEndpoints.includes(s.subscription.endpoint)
            );
            subscriptionsChanged = true;
          }
        }
      }

      if (subscriptionsChanged) {
        await db.savePairData(pairId, data);
      }
    } catch (err) {
      console.error(`Cron error processing pair ${pairId}:`, err);
      stats.errors++;
    }
  }

  return res.status(200).json({
    success: true,
    timestamp: now.toISOString(),
    stats
  });
};
