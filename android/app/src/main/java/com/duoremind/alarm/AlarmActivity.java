package com.duoremind.alarm;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

public class AlarmActivity extends Activity {

    private String reminderId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Turn on screen and show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }

        setContentView(R.layout.activity_alarm);

        Intent intent = getIntent();
        reminderId = intent.getStringExtra("reminderId");
        String title = intent.getStringExtra("title");
        String icon = intent.getStringExtra("icon");

        TextView emojiView = findViewById(R.id.alarm_emoji);
        TextView titleView = findViewById(R.id.alarm_title);
        TextView subtitleView = findViewById(R.id.alarm_subtitle);

        if (emojiView != null) emojiView.setText(icon != null && !icon.isEmpty() ? icon : "⏰");
        if (titleView != null) titleView.setText(title != null ? title : "Reminder");
        if (subtitleView != null) subtitleView.setText("It's time for your shared reminder.");

        Button btnGoing = findViewById(R.id.btn_alarm_going);
        Button btnSkip = findViewById(R.id.btn_alarm_skip);
        Button btnSnooze = findViewById(R.id.btn_alarm_snooze);

        if (btnGoing != null) {
            btnGoing.setOnClickListener(v -> handleAction("com.duoremind.alarm.ACTION_GOING"));
        }
        if (btnSkip != null) {
            btnSkip.setOnClickListener(v -> handleAction("com.duoremind.alarm.ACTION_SKIP"));
        }
        if (btnSnooze != null) {
            btnSnooze.setOnClickListener(v -> handleAction("com.duoremind.alarm.ACTION_SNOOZE"));
        }
    }

    private void handleAction(String action) {
        Intent actionIntent = new Intent(this, AlarmActionReceiver.class);
        actionIntent.setAction(action);
        actionIntent.putExtra("reminderId", reminderId);
        sendBroadcast(actionIntent);
        finish();
    }

    @Override
    public void onBackPressed() {
        // Do not dismiss on back press without choosing an action
    }
}
