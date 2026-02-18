package nl.thijsvtol.photos.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import nl.thijsvtol.photos.MainActivity;
import nl.thijsvtol.photos.R;

@CapacitorPlugin(name = "ProgressNotification")
public class ProgressNotificationPlugin extends Plugin {
    private static final String CHANNEL_ID = "upload_progress";
    private static final String CHANNEL_NAME = "Upload Progress";
    private NotificationManager notificationManager;

    @Override
    public void load() {
        super.load();
        notificationManager = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW // Low importance so it doesn't make sound
            );
            channel.setDescription("Shows progress of photo uploads");
            notificationManager.createNotificationChannel(channel);
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        Integer id = call.getInt("id");
        String title = call.getString("title", "Upload in progress");
        String body = call.getString("body", "");
        String largeBody = call.getString("largeBody");
        Integer progress = call.getInt("progress", 0);
        Integer maxProgress = call.getInt("maxProgress", 100);
        Boolean indeterminate = call.getBoolean("indeterminate", false);
        Boolean ongoing = call.getBoolean("ongoing", true);
        String eventSlug = call.getString("eventSlug");

        if (id == null) {
            call.reject("must provide notification id");
            return;
        }

        // Create intent for when notification is tapped
        Intent intent = new Intent(getContext(), MainActivity.class);
        if (eventSlug != null) {
            intent.putExtra("eventSlug", eventSlug);
            intent.putExtra("action", "view_event");
        }
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            getContext(),
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true) // Don't make sound/vibration on updates
            .setContentIntent(pendingIntent)
            .setAutoCancel(!ongoing);

        // Add progress bar
        builder.setProgress(maxProgress, progress, indeterminate);

        // Add large body text if provided
        if (largeBody != null && !largeBody.isEmpty()) {
            builder.setStyle(new NotificationCompat.BigTextStyle()
                .bigText(largeBody)
                .setBigContentTitle(title));
        }

        Notification notification = builder.build();
        notificationManager.notify(id, notification);

        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Integer id = call.getInt("id");
        if (id == null) {
            call.reject("must provide notification id");
            return;
        }

        notificationManager.cancel(id);
        call.resolve();
    }
}
