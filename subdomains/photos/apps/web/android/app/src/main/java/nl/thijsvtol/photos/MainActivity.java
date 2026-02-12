package nl.thijsvtol.photos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import nl.thijsvtol.photos.plugins.SafDirectoryPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafDirectoryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
