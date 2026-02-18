package nl.thijsvtol.photos;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import nl.thijsvtol.photos.plugins.SafDirectoryPlugin;
import nl.thijsvtol.photos.plugins.ShareHandlerPlugin;
import nl.thijsvtol.photos.plugins.ProgressNotificationPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafDirectoryPlugin.class);
        registerPlugin(ShareHandlerPlugin.class);
        registerPlugin(ProgressNotificationPlugin.class);
        super.onCreate(savedInstanceState);
        
        android.util.Log.d("MainActivity", "onCreate completed, handling intent immediately");
        
        // Handle initial share intent if app was launched via share
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        
        // Handle share intent when app is already running
        handleIntent(intent);
    }

    /**
     * Process incoming intents for share actions.
     * Delegates to ShareHandlerPlugin if this is a share intent.
     */
    private void handleIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String action = intent.getAction();
        String type = intent.getType();

        // Check if this is a share intent
        if ((Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) 
                && type != null 
                && (type.startsWith("image/") || type.startsWith("video/"))) {
            
            // Find ShareHandlerPlugin and delegate intent processing
            Plugin sharePlugin = getBridge().getPlugin("ShareHandler").getInstance();
            if (sharePlugin instanceof ShareHandlerPlugin) {
                ((ShareHandlerPlugin) sharePlugin).handleShareIntent(intent);
            }
        }
    }
}
