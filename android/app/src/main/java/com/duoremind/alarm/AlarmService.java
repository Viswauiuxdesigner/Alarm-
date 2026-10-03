package com.duoremind.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class AlarmService extends Service {
    private static final String TAG = "DuoAlarmService";
    public static final String CHANNEL_ID = "duo_alarm_channel_v2";
    public static final int NOTIFICATION_ID = 2001;

    private static AlarmService instance;
    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private String currentReminderId;

    public static void stopAlarm(Context context) {
        if (instance != null) {
            instance.stopSelf();
        } else {
            Intent intent = new Intent(context, AlarmService.class);
            context.stopService(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            currentReminderId = intent.getStringExtra("reminderId");
            String title = intent.getStringExtra("title");
            String icon = intent.getStringExtra("icon");
            boolean isSnooze = intent.getBooleanExtra("isSnooze", false);

            acquireWakeLock();
            startAlarmNotification(currentReminderId, title, icon, isSnooze);
            startAlarmSound();
            startVibration();
        }

        return START_NOT_STICKY;
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "duo:AlarmWakeLock");
                // 10 minutes max timeout safety
                wakeLock.acquire(10 * 60 * 1000L);
            }
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Duo Alarm Reminders",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("High-priority alarm notifications that play alarm sound and display on lock screen");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 800});
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(true);

                // Set USAGE_ALARM audio attributes
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .build();

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (soundUri == null) {
                    soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                }
                channel.setSound(soundUri, audioAttributes);

                nm.createNotificationChannel(channel);
            }
        }
    }

    private void startAlarmNotification(String reminderId, String title, String icon, boolean isSnooze) {
        String displayTitle = (icon != null && !icon.isEmpty() ? icon + " " : "⏰ ") + (title != null ? title : "Reminder");
        String displayBody = isSnooze ? "Snooze ended. Time to choose your action!" : "It's time for your shared reminder. What are you doing?";

        // Full Screen Intent to AlarmActivity
        Intent fullScreenIntent = new Intent(this, AlarmActivity.class);
        fullScreenIntent.putExtra("reminderId", reminderId);
        fullScreenIntent.putExtra("title", title);
        fullScreenIntent.putExtra("icon", icon);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(this, 100, fullScreenIntent, flags);

        // Action 1: Going
        Intent goingIntent = new Intent(this, AlarmActionReceiver.class);
        goingIntent.setAction("com.duoremind.alarm.ACTION_GOING");
        goingIntent.putExtra("reminderId", reminderId);
        PendingIntent goingPendingIntent = PendingIntent.getBroadcast(this, 101, goingIntent, flags);

        // Action 2: Skip
        Intent skipIntent = new Intent(this, AlarmActionReceiver.class);
        skipIntent.setAction("com.duoremind.alarm.ACTION_SKIP");
        skipIntent.putExtra("reminderId", reminderId);
        PendingIntent skipPendingIntent = PendingIntent.getBroadcast(this, 102, skipIntent, flags);

        // Action 3: Snooze 10m
        Intent snoozeIntent = new Intent(this, AlarmActionReceiver.class);
        snoozeIntent.setAction("com.duoremind.alarm.ACTION_SNOOZE");
        snoozeIntent.putExtra("reminderId", reminderId);
        PendingIntent snoozePendingIntent = PendingIntent.getBroadcast(this, 103, snoozeIntent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(displayTitle)
                .setContentText(displayBody)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .addAction(android.R.drawable.checkbox_on_background, "✅ Going", goingPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "❌ Skip", skipPendingIntent)
                .addAction(android.R.drawable.ic_lock_idle_alarm, "⏰ Snooze 10m", snoozePendingIntent);

        startForeground(NOTIFICATION_ID, builder.build());
    }

    private void startAlarmSound() {
        try {
            if (mediaPlayer != null) {
                mediaPlayer.release();
                mediaPlayer = null;
            }

            Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (soundUri == null) {
                soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(this, soundUri);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setLegacyStreamType(AudioManager.STREAM_ALARM)
                    .build();

            mediaPlayer.setAudioAttributes(audioAttributes);
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
            Log.i(TAG, "Alarm sound looping started on STREAM_ALARM");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start media player alarm sound: " + e.getMessage(), e);
        }
    }

    private void startVibration() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = new long[]{0, 600, 300, 600, 300, 800};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Vibration failed: " + e.getMessage());
        }
    }

    private void stopVibration() {
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception e) {}
            vibrator = null;
        }
    }

    private void stopSound() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.release();
            } catch (Exception e) {}
            mediaPlayer = null;
        }
    }

    @Override
    public void onDestroy() {
        stopSound();
        stopVibration();
        releaseWakeLock();
        instance = null;
        super.onDestroy();
        Log.i(TAG, "AlarmService stopped successfully");
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
