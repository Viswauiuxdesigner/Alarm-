// Duo Native Alarm Subsystem Bridge for Android WebView & Capacitor
class NativeAlarmManager {
  constructor() {
    this.isNativeAvailable = typeof window.DuoNativeAlarm !== 'undefined';
    if (this.isNativeAvailable) {
      console.log('Native Android Alarm Subsystem is available');
    }
  }

  // Check if running inside Android Native container
  isAvailable() {
    return typeof window.DuoNativeAlarm !== 'undefined';
  }

  // Sync all active reminders with native Android AlarmManager
  syncReminders(reminders) {
    if (!this.isAvailable()) return;
    try {
      const activeReminders = (reminders || []).filter(r => r.active !== false);
      window.DuoNativeAlarm.scheduleReminderAlarms(JSON.stringify(activeReminders));
    } catch (e) {
      console.warn('NativeAlarmManager syncReminders error:', e);
    }
  }

  // Cancel an alarm by ID
  cancelAlarm(reminderId) {
    if (!this.isAvailable()) return;
    try {
      window.DuoNativeAlarm.cancelAlarm(reminderId);
    } catch (e) {
      console.warn('NativeAlarmManager cancelAlarm error:', e);
    }
  }

  // Stop active ringing alarm
  stopAlarm(reminderId) {
    if (!this.isAvailable()) return;
    try {
      window.DuoNativeAlarm.stopAlarm(reminderId);
    } catch (e) {
      console.warn('NativeAlarmManager stopAlarm error:', e);
    }
  }

  // Schedule native snooze alarm
  scheduleSnooze(reminderId, minutes = 10) {
    if (!this.isAvailable()) return;
    try {
      window.DuoNativeAlarm.scheduleSnooze(reminderId, minutes);
    } catch (e) {
      console.warn('NativeAlarmManager scheduleSnooze error:', e);
    }
  }

  // Check exact alarm permission on Android 12+ (S)
  canScheduleExactAlarms() {
    if (!this.isAvailable()) return true;
    try {
      return window.DuoNativeAlarm.canScheduleExactAlarms();
    } catch (e) {
      return true;
    }
  }

  // Request exact alarm permission settings screen
  requestExactAlarmPermission() {
    if (!this.isAvailable()) return;
    try {
      window.DuoNativeAlarm.requestExactAlarmPermission();
    } catch (e) {
      console.warn('NativeAlarmManager requestExactAlarmPermission error:', e);
    }
  }
}

window.nativeAlarm = new NativeAlarmManager();
