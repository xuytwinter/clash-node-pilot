package com.clashnodepilot.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

public final class PilotForegroundService extends Service {
    private static final String CHANNEL_ID = "pilot-status";
    private static final int NOTIFICATION_ID = 3210;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PairingStore store;
    private volatile boolean optimizing;

    private final Runnable poller = new Runnable() {
        @Override
        public void run() {
            runHealthCheck();
            handler.postDelayed(this, 180_000);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        store = new PairingStore(this);
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && PairingStore.ACTION_REVOKE.equals(intent.getAction())) {
            handler.removeCallbacks(poller);
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && PairingStore.ACTION_STOP.equals(intent.getAction())) {
            handler.removeCallbacks(poller);
            updateNotification("Automatic optimization stopped.");
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, notification("Node Pilot is optimizing the paired local Controller."));
        handler.removeCallbacks(poller);
        handler.post(poller);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(poller);
        super.onDestroy();
    }

    private void runHealthCheck() {
        if (!store.isPaired()) {
            updateNotification("Pairing required. Automation stopped.");
            stopSelf();
            return;
        }
        if (optimizing) return;
        optimizing = true;
        new Thread(() -> {
            try {
                ControllerClient client = new ControllerClient(store.controllerUrl(), store.secret());
                AndroidOptimizer.Result result = AndroidOptimizer.optimize(client, store.targetGroup(), store.nodeFilter());
                if (result.switched) {
                    updateNotification("Switched " + result.groupName + " to " + result.bestName + " (" + result.bestDelay + " ms).");
                } else {
                    updateNotification("Best node already active: " + result.bestName + " (" + result.bestDelay + " ms).");
                }
            } catch (Exception error) {
                updateNotification("Optimization skipped: " + error.getMessage());
            } finally {
                optimizing = false;
            }
        }).start();
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, notification(text));
    }

    private Notification notification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL_ID) : new Notification.Builder(this);
        return builder
                .setContentTitle("Clash Node Pilot")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Node Pilot status", NotificationManager.IMPORTANCE_LOW));
    }
}
