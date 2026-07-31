package nl.thijsvtol.photos;

import android.content.Context;
import java.util.Collections;
import java.util.List;

import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;

/**
 * Required wiring for the Google Cast SDK (com.google.android.gms.cast.framework
 * .OPTIONS_PROVIDER_CLASS_NAME meta-data in AndroidManifest.xml points here).
 *
 * Supplies the custom receiver Application ID (see res/values/strings.xml's
 * cast_receiver_app_id, which the site owner sets after registering the
 * receiver at https://cast.google.com/publish — see pages/CastReceiver.tsx).
 */
public class CastOptionsProvider implements OptionsProvider {
    @Override
    public CastOptions getCastOptions(Context context) {
        String appId = context.getString(R.string.cast_receiver_app_id);
        return new CastOptions.Builder()
            .setReceiverApplicationId(appId)
            .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return Collections.emptyList();
    }
}
