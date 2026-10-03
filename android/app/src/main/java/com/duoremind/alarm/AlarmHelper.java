package com.duoremind.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

public class AlarmHelper {
    private static final String TAG = "DuoAlarmHelper";
    private static final String PREF_NAME = "duo_alarm_prefs";
    private static final String KEY_REMINDERS_JSON = "saved_reminders_json";

    public static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        }
        return true;
    }

    public static void saveRemindersJson(Context context, String json) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_REMINDERS_JSON, json).apply();
    }

    public static String getSavedRemindersJson(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_REMINDERS_JSON, "[]");
    }

    public static void scheduleAllFromSaved(Context context) {
        String json = getSavedRemindersJson(context);
        scheduleReminderAlarms(context, json);
    }

    public static void scheduleReminderAlarms(Context context, String remindersJson) {
        if (remindersJson == null) return;
        saveRemindersJson(context, remindersJson);

        try {
            JSONArray array = new JSONArray(remindersJson);
            for (int i = 0; i < array.length(); i++) {
                JSONObject reminder = array.getJSONObject(i);
                scheduleSingleAlarm(context, reminder);
            }
            Log.i(TAG, "Successfully scheduled " + array.length() + " reminders with AlarmManager");
        } catch (Exception e) {
            Log.e(TAG, "Failed to parse and schedule reminders: " + e.getMessage(), e);
        }
    }

    public static void scheduleSingleAlarm(Context context, JSONObject reminder) {
        if (reminder == null) return;
        try {
            String id = reminder.optString("id");
            String title = reminder.optString("title", "Reminder");
            String icon = reminder.optString("icon", "⏰");
            String timeStr = reminder.optString("time", "06:00");
            String repeat = reminder.optString("repeat", "daily");
            boolean active = reminder.optBoolean("active", true);

            if (!active || id.isEmpty()) {
                cancelAlarm(context, id);
                return;
            }

            String[] timeParts = timeStr.split(":");
            int hour = Integer.parseInt(timeParts[0]);
            int minute = Integer.parseInt(timeParts[1]);

            Calendar target = Calendar.getInstance();
            target.set(Calendar.HOUR_OF_DAY, hour);
            target.set(Calendar.MINUTE, minute);
            target.set(Calendar.SECOND, 0);
            target.set(Calendar.MILLISECOND, 0);

            Calendar now = Calendar.getInstance();
            if (target.before(now)) {
                // Time has passed for today, schedule for tomorrow
                target.add(Calendar.DAY_OF_YEAR, 1);
            }

            // Weekdays check
            if ("weekdays".equalsIgnoreCase(repeat)) {
                int dayOfWeek = target.get(Calendar.DAY_OF_WEEK);
                while (dayOfWeek == Calendar.SATURDAY || dayOfWeek == Calendar.SUNDAY) {
                    target.add(Calendar.DAY_OF_YEAR, 1);
                    dayOfWeek = target.get(Calendar.DAY_OF_WEEK);
                }
            }

            long triggerMillis = target.getTimeInMillis();
            scheduleExactAlarm(context, id, title, icon, timeStr, triggerMillis, false);

        } catch (Exception e) {
            Log.e(TAG, "Error scheduling single alarm: " + e.getMessage(), e);
        }
    }

    public static void scheduleSnooze(Context context, String reminderId, int minutes) {
        if (reminderId == null || reminderId.isEmpty()) return;

        Calendar target = Calendar.getInstance();
        target.add(Calendar.MINUTE, minutes);
        long triggerMillis = target.getTimeInMillis();

        scheduleExactAlarm(context, reminderId, "Snoozed Reminder", "⏰", "", triggerMillis, true);
        Log.i(TAG, "Snooze scheduled for reminder " + reminderId + " in " + minutes + " minutes");
    }

    private static void scheduleExactAlarm(Context context, String reminderId, String title, String icon, String timeStr, long triggerMillis, boolean isSnooze) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.putExtra("reminderId", reminderId);
        intent.putExtra("title", title);
        intent.putExtra("icon", icon);
        intent.putExtra("time", timeStr);
        intent.putExtra("isSnooze", isSnooze);

        int requestCode = Math.abs(reminderId.hashCode());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, requestCode, intent, flags);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMillis, pendingIntent);
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerMillis, pendingIntent);
            }
            Log.i(TAG, "Exact alarm set for " + title + " (" + reminderId + ") at epoch " + triggerMillis);
        } catch (SecurityException se) {
            Log.w(TAG, "Exact alarm permission denied, falling back to standard alarm: " + se.getMessage());
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerMillis, pendingIntent);
        }
    }

    public static void cancelAlarm(Context context, String reminderId) {
        if (reminderId == null || reminderId.isEmpty()) return;
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        int requestCode = Math.abs(reminderId.hashCode());
        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, requestCode, intent, flags);
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent);
            pendingIntent.cancel();
            Log.i(TAG, "Cancelled alarm for " + reminderId);
        }
    }
}
