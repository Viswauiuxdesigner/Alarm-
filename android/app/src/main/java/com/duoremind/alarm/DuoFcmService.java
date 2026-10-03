package com.duoremind.alarm;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

public class DuoFcmService extends FirebaseMessagingService {
    private static final String TAG = "DuoFcmService";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Log.i(TAG, "Native FCM Message received from: " + remoteMessage.getFrom());

        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) {
            return;
        }

        String type = data.get("type");
        String reminderId = data.get("reminderId");
        String status = data.get("status");
        String title = data.get("title");
        String icon = data.get("icon");

        Log.i(TAG, "FCM data payload: type=" + type + ", reminderId=" + reminderId + ", status=" + status);

        // 1. Cross-Device Dismissal: Partner tapped Going / Skip / Snooze on Phone A
        if ("response_update".equals(type) || "going".equals(status) || "skipped".equals(status) || "snoozed".equals(status)) {
            Log.i(TAG, "Partner responded. Terminating local native alarm immediately for reminder: " + reminderId);
            AlarmService.stopAlarm(this);

            if ("snoozed".equals(status)) {
                // If partner snoozed, schedule native alarm for +10 minutes on this device too
                AlarmHelper.scheduleSnooze(this, reminderId, 10);
            }
            return;
        }

        // 2. Remote Reminder Trigger (Fallback wake-up if exact alarm was not pre-scheduled locally)
        if ("reminder".equals(type)) {
            Intent serviceIntent = new Intent(this, AlarmService.class);
            serviceIntent.putExtra("reminderId", reminderId);
            serviceIntent.putExtra("title", title != null ? title : "Reminder");
            serviceIntent.putExtra("icon", icon != null ? icon : "⏰");
            serviceIntent.putExtra("isSnooze", false);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.i(TAG, "New FCM Registration Token: " + token);

        // Save token locally
        SharedPreferences prefs = getSharedPreferences("duo_alarm_prefs", Context.MODE_PRIVATE);
        prefs.edit().putString("fcm_token", token).apply();

        // Register token with backend if pair session exists
        String pairId = prefs.getString("current_pair_id", "");
        String userId = prefs.getString("current_user_id", "");
        String backendUrl = prefs.getString("backend_url", "https://duo-remind-viswa.vercel.app/api/push");

        if (!pairId.isEmpty() && !userId.isEmpty()) {
            new Thread(() -> {
                try {
                    JSONObject payload = new JSONObject();
                    payload.put("action", "subscribe");
                    payload.put("pairId", pairId);
                    payload.put("userId", userId);
                    payload.put("deviceInfo", "Android Native App (" + Build.MODEL + ")");

                    JSONObject subObj = new JSONObject();
                    subObj.put("endpoint", "fcm:" + token);
                    payload.put("subscription", subObj);

                    URL url = new URL(backendUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setDoOutput(true);

                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(payload.toString().getBytes("UTF-8"));
                    }

                    int code = conn.getResponseCode();
                    Log.i(TAG, "FCM token synced with server, response code: " + code);
                    conn.disconnect();
                } catch (Exception e) {
                    Log.w(TAG, "Failed to sync FCM token with server: " + e.getMessage());
                }
            }).start();
        }
    }
}
