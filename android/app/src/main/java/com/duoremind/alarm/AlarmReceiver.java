package com.duoremind.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class AlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "DuoAlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String reminderId = intent.getStringExtra("reminderId");
        String title = intent.getStringExtra("title");
        String icon = intent.getStringExtra("icon");
        String time = intent.getStringExtra("time");
        boolean isSnooze = intent.getBooleanExtra("isSnooze", false);

        Log.i(TAG, "⏰ Alarm received for reminder: " + title + " (" + reminderId + ")");

        // Start Alarm Foreground Service to loop sound, vibrate, and display notification
        Intent serviceIntent = new Intent(context, AlarmService.class);
        serviceIntent.putExtra("reminderId", reminderId);
        serviceIntent.putExtra("title", title);
        serviceIntent.putExtra("icon", icon);
        serviceIntent.putExtra("time", time);
        serviceIntent.putExtra("isSnooze", isSnooze);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }

        // Reschedule next occurrence if daily/repeating
        AlarmHelper.scheduleAllFromSaved(context);
    }
}
