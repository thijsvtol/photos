package nl.thijsvtol.photos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the app process alive (and network access
 * unrestricted) while photo/video uploads are in progress.
 *
 * Without this, Android may throttle network access or suspend the JS/
 * WebView execution shortly after the app is backgrounded (e.g. when the
 * screen is locked), aborting in-flight chunk uploads with generic network
 * errors even though the device still has a working connection. Starting a
 * foreground service with a visible notification (required by the OS) tells
 * Android this work is user-visible and important, so it is not throttled or
 * killed.
 *
 * The notification shown here uses the same id/channel as
 * ProgressNotificationPlugin's upload-progress notification, so subsequent
 * calls to ProgressNotification.show() with the same id simply update this
 * same notification instead of creating a second one.
 */
public class UploadForegroundService extends Service {
    private static final String CHANNEL_ID = "upload_progress";
    private static final String CHANNEL_NAME = "Upload Progress";
    public static final String EXTRA_NOTIFICATION_ID = "notificationId";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";
    // Fallback only — in practice the caller (ProgressNotificationPlugin.startForeground)
    // always supplies EXTRA_NOTIFICATION_ID, matching the id used for the
    // corresponding ProgressNotification.show()/cancel() calls in backgroundSync.ts.
    private static final int DEFAULT_NOTIFICATION_ID = 999999001;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureNotificationChannel();

        int notificationId = intent != null
            ? intent.getIntExtra(EXTRA_NOTIFICATION_ID, DEFAULT_NOTIFICATION_ID)
            : DEFAULT_NOTIFICATION_ID;
        String title = intent != null && intent.getStringExtra(EXTRA_TITLE) != null
            ? intent.getStringExtra(EXTRA_TITLE)
            : "Uploading photos";
        String body = intent != null && intent.getStringExtra(EXTRA_BODY) != null
            ? intent.getStringExtra(EXTRA_BODY)
            : "Upload in progress";

        // Tapping opens the app, and "Cancel uploads" stops them. Google Play's
        // foreground-service policy requires that the user can terminate the
        // work and that the notification clearly conveys what is happening;
        // this notification previously had neither a tap target nor a stop
        // action, which is part of what got version 49 rejected.
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            notificationId,
            new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        PendingIntent cancelIntent = PendingIntent.getBroadcast(
            this,
            notificationId,
            new Intent(this, UploadActionReceiver.class).setAction(UploadActionReceiver.ACTION_CANCEL_UPLOADS),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            // Progress belongs on the phone, not buzzing a paired watch for the
            // duration of the upload — see ProgressNotificationPlugin.show().
            .setLocalOnly(true)
            .setSilent(true)
            .setContentIntent(contentIntent)
            .addAction(0, "Cancel uploads", cancelIntent)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(notificationId, notification);
        }

        // If the OS kills the process while the service is running, don't
        // automatically restart it with a stale/empty intent — the JS layer
        // will start it again the next time it has uploads to process.
        return START_NOT_STICKY;
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows progress of photo uploads");
            notificationManager.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        super.onDestroy();
    }
}
