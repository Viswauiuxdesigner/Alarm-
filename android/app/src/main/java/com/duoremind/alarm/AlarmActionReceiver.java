package com.duoremind.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class AlarmActionReceiver extends BroadcastReceiver {
    private static final String TAG = "DuoAlarmAction";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        String reminderId = intent.getStringExtra("reminderId");

        Log.i(TAG, "Notification action received: " + action + " for reminder: " + reminderId);

        // 1. Stop the looping alarm sound & vibration immediately
        AlarmService.stopAlarm(context);

        String status = "going";
        boolean isSnooze = false;

        if ("com.duoremind.alarm.ACTION_GOING".equals(action)) {
            status = "going";
        } else if ("com.duoremind.alarm.ACTION_SKIP".equals(action)) {
            status = "skipped";
        } else if ("com.duoremind.alarm.ACTION_SNOOZE".equals(action)) {
            status = "snoozed";
            isSnooze = true;
            // Schedule local 10-min exact snooze
            AlarmHelper.scheduleSnooze(context, reminderId, 10);
        } else if ("com.duoremind.alarm.ACTION_DISMISS".equals(action)) {
            return;
        }

        // 2. Submit response asynchronously to backend /api/sync
        final String finalStatus = status;
        final boolean finalIsSnooze = isSnooze;
        new Thread(() -> {
            try {
                SharedPreferences prefs = context.getSharedPreferences("duo_alarm_prefs", Context.MODE_PRIVATE);
                String pairId = prefs.getString("current_pair_id", "");
                String userId = prefs.getString("current_user_id", "android_device");
                String backendUrl = prefs.getString("backend_url", "https://duo-remind-viswa.vercel.app/api/sync");

                if (pairId.isEmpty()) return;

                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                String todayKey = sdf.format(new Date());

                String snoozeUntil = null;
                if (finalIsSnooze) {
                    long snoozeMillis = System.currentTimeMillis() + (10 * 60 * 1000L);
                    SimpleDateFormat isoSdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                    snoozeUntil = isoSdf.format(new Date(snoozeMillis));
                }

                JSONObject payload = new JSONObject();
                payload.put("action", "submit_response");
                payload.put("pairId", pairId);
                payload.put("reminderId", reminderId);
                payload.put("date", todayKey);
                payload.put("userId", userId);
                payload.put("status", finalStatus);
                payload.put("respondedAt", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date()));
                if (snoozeUntil != null) {
                    payload.put("snoozeUntil", snoozeUntil);
                }

                URL url = new URL(backendUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                byte[] out = payload.toString().getBytes("UTF-8");
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(out);
                }

                int respCode = conn.getResponseCode();
                Log.i(TAG, "Backend sync response code: " + respCode);
                conn.disconnect();
            } catch (Exception e) {
                Log.w(TAG, "Failed to submit background response to backend: " + e.getMessage());
            }
        }).start();
    }
}
