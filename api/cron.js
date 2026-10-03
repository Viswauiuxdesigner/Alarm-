// Scheduled Cron Reminder Dispatcher: api/cron.js
// Callable serverless endpoint executed every 1 minute via external cron (e.g. cron-job.org).
// Secured via CRON_SECRET.

const db = require('./_db');
const push = require('./_push');

// Helper to compute accurate local time and date info for a given timezone
function getLocalTimeInfo(date, timeZone = 'UTC') {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    });
    const parts = dtf.formatToParts(date);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    
    let hour = map.hour === '24' ? '00' : map.hour;
    const time = `${hour}:${map.minute}`;
    const dateKey = `${map.year}-${map.month}-${map.day}`;
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayOfWeek = days.indexOf(map.weekday);
    return {
      time,
      dateKey,
      dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : date.getUTCDay()
    };
  } catch (e) {
    // Fallback to UTC if timezone string is invalid
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    const m = String(date.getUTCMinutes()).padStart(2, '0');
    return {
      time: `${h}:${m}`,
      dateKey: `${year}-${month}-${day}`,
      dayOfWeek: date.getUTCDay()
    };
  }
}

// Check if a reminder repeats on given day in target timezone
function isReminderActiveOnDay(reminder, dayOfWeek, dateKey) {
  if (!reminder || !reminder.active) return false;

  switch (reminder.repeat) {
    case 'daily':
      return true;
    case 'weekdays':
      return dayOfWeek >= 1 && dayOfWeek <= 5;
    case 'custom':
      return Array.isArray(reminder.customDays) && reminder.customDays.includes(dayOfWeek);
    case 'once':
      const remDateKey = reminder.onceDate || (reminder.createdAt ? reminder.createdAt.split('T')[0] : '');
      return remDateKey === dateKey;
    default:
      return true;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 1. Security Check via CRON_SECRET
  const configuredSecret = process.env.CRON_SECRET;
  if (configuredSecret) {
    const authHeader = req.headers['authorization'] || '';
    const headerSecret = req.headers['x-cron-secret'] || '';
    const querySecret = (req.query && req.query.secret) || '';

    const providedSecret = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : (headerSecret || querySecret);

    if (providedSecret !== configuredSecret) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid or missing CRON_SECRET',
        message: 'Provide CRON_SECRET via Authorization Bearer header, x-cron-secret header, or ?secret= query parameter.'
      });
    }
  }

  const now = new Date();
  const pairIds = await db.getAllPairIds();

  // Fast exit if no pairs exist
  if (!pairIds || pairIds.length === 0) {
    return res.status(200).json({
      success: true,
      timestamp: now.toISOString(),
      checkedPairs: 0,
      notificationsSent: 0,
      message: 'No active pairs found.'
    });
  }

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
      const pairTimezone = (data.pair && data.pair.timezone) || 'UTC';

      let subscriptionsChanged = false;

      for (const reminder of reminders) {
        stats.remindersEvaluated++;
        
        // Use reminder timezone or fallback to pair timezone
        const reminderTz = reminder.timezone || pairTimezone || 'UTC';
        const { time: currentLocalTime, dateKey: localDateKey, dayOfWeek: localDayOfWeek } = getLocalTimeInfo(now, reminderTz);

        if (!isReminderActiveOnDay(reminder, localDayOfWeek, localDateKey)) continue;

        // 1. Check if Base Scheduled Time is Due
        const isBaseDue = (reminder.time === currentLocalTime);

        // 2. Check if Snooze Time is Due (for any snoozed response for this reminder today)
        const snoozedResp = responses.find(r => 
          r.reminderId === reminder.id && 
          r.date === localDateKey && 
          r.status === 'snoozed' && 
          r.snoozeUntil
        );

        let isSnoozeDue = false;
        let snoozeTriggerKey = '';
        if (snoozedResp && snoozedResp.snoozeUntil) {
          const snoozeDate = new Date(snoozedResp.snoozeUntil);
          const diffMs = Math.abs(now.getTime() - snoozeDate.getTime());
          // 70s window allows external 1-minute crons to reliably capture the minute
          if (diffMs <= 70000) {
            isSnoozeDue = true;
            snoozeTriggerKey = `snooze_${Math.floor(snoozeDate.getTime() / 60000)}`;
          }
        }

        // If neither base time nor snooze is due, skip
        if (!isBaseDue && !isSnoozeDue) continue;

        // Check if reminder was already resolved today (Going or Skipped) by either user
        const isResolved = responses.some(r =>
          r.reminderId === reminder.id &&
          r.date === localDateKey &&
          (r.status === 'going' || r.status === 'skipped')
        );

        // If already resolved (e.g. user went earlier), do not alert for base time
        if (isResolved && isBaseDue && !isSnoozeDue) {
          continue;
        }

        // 3. Duplicate Delivery Protection Key
        const triggerKey = isSnoozeDue ? snoozeTriggerKey : `base_${reminder.time}`;
        const deliveryKey = `${pairId}_${reminder.id}_${localDateKey}_${triggerKey}`;
        const alreadySent = await db.isDelivered(deliveryKey);

        if (alreadySent) {
          stats.duplicatesSkipped++;
          continue;
        }

        // Mark delivery BEFORE sending to strictly prevent race conditions
        await db.markDelivered(deliveryKey);

        // 4. Target all active subscriptions belonging to this pair (Phone A and Phone B)
        if (subscriptions.length === 0) continue;

        // 5. Construct payload
        const payload = {
          type: 'reminder',
          reminderId: reminder.id,
          pairId: pairId,
          title: reminder.title,
          time: reminder.time,
          dateKey: localDateKey,
          occurrenceId: `${reminder.id}_${localDateKey}`,
          body: isSnoozeDue
            ? `Snooze ended for ${reminder.title}. What are you doing?`
            : `It's time for ${reminder.title}`,
          icon: '/assets/icons/icon-192.png',
          badge: '/assets/icons/icon-192.png',
          tag: `reminder-${reminder.id}`,
          data: {
            reminderId: reminder.id,
            pairId: pairId,
            title: reminder.title,
            icon: reminder.icon,
            dateKey: localDateKey,
            occurrenceId: `${reminder.id}_${localDateKey}`,
            url: `./?reminderId=${reminder.id}`
          },
          actions: [
            { action: 'going', title: "Going" },
            { action: 'skipped', title: "Skip" },
            { action: 'snooze', title: "Snooze 10m" }
          ]
        };

        // 6. Send Web Push to BOTH phone subscriptions
        const pushRes = await push.sendPushToMultiple(subscriptions, payload);
        stats.notificationsSent += pushRes.sent;

        // Prune any expired endpoints
        if (pushRes.expiredEndpoints && pushRes.expiredEndpoints.length > 0) {
          data.subscriptions = data.subscriptions.filter(
            s => !pushRes.expiredEndpoints.includes(s.subscription && s.subscription.endpoint)
          );
          subscriptionsChanged = true;
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
