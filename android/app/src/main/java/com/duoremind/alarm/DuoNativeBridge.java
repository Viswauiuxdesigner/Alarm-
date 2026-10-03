package com.duoremind.alarm;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;

public class DuoNativeBridge {
    private static final String TAG = "DuoNativeBridge";
    private final Context context;

    public DuoNativeBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public void scheduleReminderAlarms(String json) {
        Log.i(TAG, "Bridge: scheduleReminderAlarms: " + json);
        AlarmHelper.scheduleReminderAlarms(context, json);
    }

    @JavascriptInterface
    public void cancelAlarm(String reminderId) {
        Log.i(TAG, "Bridge: cancelAlarm: " + reminderId);
        AlarmHelper.cancelAlarm(context, reminderId);
    }

    @JavascriptInterface
    public void stopAlarm(String reminderId) {
        Log.i(TAG, "Bridge: stopAlarm: " + reminderId);
        AlarmService.stopAlarm(context);
    }

    @JavascriptInterface
    public void scheduleSnooze(String reminderId, int minutes) {
        Log.i(TAG, "Bridge: scheduleSnooze: " + reminderId + " in " + minutes + "m");
        AlarmHelper.scheduleSnooze(context, reminderId, minutes);
    }

    @JavascriptInterface
    public boolean canScheduleExactAlarms() {
        return AlarmHelper.canScheduleExactAlarms(context);
    }

    @JavascriptInterface
    public void requestExactAlarmPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null && !am.canScheduleExactAlarms()) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
        }
    }
}
