// Duo Reminders & Occurrence Engine
class ReminderEngine {
  // Format standard date key: YYYY-MM-DD
  getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Format 12-hour display time: "6:00 AM" or "06:00 PM"
  formatTime(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  // Format timestamp (ISO or Date) to "6:03 AM"
  formatTimestamp(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  // Check if reminder is scheduled for given date
  isReminderActiveOnDate(reminder, date) {
    if (!reminder || !reminder.active) return false;
    const dayOfWeek = date.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

    switch (reminder.repeat) {
      case 'daily':
        return true;
      case 'weekdays':
        return dayOfWeek >= 1 && dayOfWeek <= 5;
      case 'custom':
        return Array.isArray(reminder.customDays) && reminder.customDays.includes(dayOfWeek);
      case 'once':
        const remDateKey = reminder.onceDate || reminder.createdAt.split('T')[0];
        return remDateKey === this.getDateKey(date);
      default:
        return true;
    }
  }

  // Get Today's reminders with user status and partner status
  getTodayReminders() {
    const today = new Date();
    const todayKey = this.getDateKey(today);
    const reminders = window.storage.getReminders();
    const responses = window.storage.getResponses();
    const pair = window.storage.getPair();
    const currentUser = window.storage.getCurrentUser();

    const user1 = pair ? pair.user1 : { id: 'u_1', name: 'You' };
    const user2 = pair ? pair.user2 : { id: 'u_2', name: 'Partner' };
    const myId = currentUser ? currentUser.id : user1.id;
    const partnerId = myId === user1.id ? user2.id : user1.id;
    const partnerName = myId === user1.id ? user2.name : user1.name;

    const todayItems = reminders
      .filter(r => this.isReminderActiveOnDate(r, today))
      .map(reminder => {
        // My response for today
        const myResp = responses.find(
          resp => resp.reminderId === reminder.id && resp.date === todayKey && resp.userId === myId
        );

        // Partner response for today
        const partnerResp = responses.find(
          resp => resp.reminderId === reminder.id && resp.date === todayKey && resp.userId === partnerId
        );

        // Check if currently snoozed
        let effectiveTime = reminder.time;
        let isSnoozed = false;
        let snoozeTimeStr = null;

        if (myResp && myResp.status === 'snoozed' && myResp.snoozeUntil) {
          const snoozeDate = new Date(myResp.snoozeUntil);
          if (snoozeDate > new Date()) {
            isSnoozed = true;
            snoozeTimeStr = snoozeDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          }
        }

        // Relative time calculation
        const [rHours, rMinutes] = reminder.time.split(':').map(Number);
        const reminderDate = new Date();
        reminderDate.setHours(rHours, rMinutes, 0, 0);

        const now = new Date();
        const diffMs = reminderDate - now;
        const diffMins = Math.round(diffMs / 60000);

        let relativeStatus = '';
        let isPast = false;
        let isActiveNow = false;

        if (diffMins > 0) {
          const h = Math.floor(diffMins / 60);
          const m = diffMins % 60;
          relativeStatus = h > 0 ? `Next in ${h}h ${m}m` : `Next in ${m}m`;
        } else if (diffMins >= -30) {
          // Trigger window: active within last 30 minutes
          relativeStatus = 'Active Now';
          isActiveNow = true;
        } else {
          relativeStatus = 'Passed';
          isPast = true;
        }

        return {
          reminder,
          effectiveTime,
          isSnoozed,
          snoozeTimeStr,
          myStatus: myResp ? myResp.status : window.CONFIG.STATUS.PENDING,
          myRespondedAt: myResp ? this.formatTimestamp(myResp.respondedAt) : null,
          partnerName,
          partnerStatus: partnerResp ? partnerResp.status : window.CONFIG.STATUS.PENDING,
          partnerRespondedAt: partnerResp ? this.formatTimestamp(partnerResp.respondedAt) : null,
          relativeStatus,
          isPast,
          isActiveNow,
          rawDiffMins: diffMins
        };
      });

    // Sort chronologically by scheduled time
    todayItems.sort((a, b) => a.reminder.time.localeCompare(b.reminder.time));
    return todayItems;
  }

  // Get 7-Day History
  getHistory(daysCount = 7) {
    const historyGroups = [];
    const reminders = window.storage.getReminders();
    const responses = window.storage.getResponses();
    const pair = window.storage.getPair();
    const currentUser = window.storage.getCurrentUser();

    const user1 = pair ? pair.user1 : { id: 'u_1', name: 'You' };
    const user2 = pair ? pair.user2 : { id: 'u_2', name: 'Partner' };
    const myId = currentUser ? currentUser.id : user1.id;
    const partnerId = myId === user1.id ? user2.id : user1.id;
    const partnerName = myId === user1.id ? user2.name : user1.name;

    for (let i = 0; i < daysCount; i++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - i);
      const dateKey = this.getDateKey(targetDate);

      // Label for date
      let dateLabel = '';
      if (i === 0) {
        dateLabel = 'Today';
      } else if (i === 1) {
        dateLabel = 'Yesterday';
      } else {
        dateLabel = targetDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }

      const activeReminders = reminders.filter(r => this.isReminderActiveOnDate(r, targetDate));
      const groupItems = activeReminders.map(reminder => {
        const myResp = responses.find(
          resp => resp.reminderId === reminder.id && resp.date === dateKey && resp.userId === myId
        );
        const partnerResp = responses.find(
          resp => resp.reminderId === reminder.id && resp.date === dateKey && resp.userId === partnerId
        );

        return {
          reminder,
          myStatus: myResp ? myResp.status : window.CONFIG.STATUS.PENDING,
          myTime: myResp ? this.formatTimestamp(myResp.respondedAt) : null,
          partnerName,
          partnerStatus: partnerResp ? partnerResp.status : window.CONFIG.STATUS.PENDING,
          partnerTime: partnerResp ? this.formatTimestamp(partnerResp.respondedAt) : null
        };
      });

      if (groupItems.length > 0) {
        historyGroups.push({
          dateKey,
          dateLabel,
          items: groupItems
        });
      }
    }

    return historyGroups;
  }
}

window.reminders = new ReminderEngine();
