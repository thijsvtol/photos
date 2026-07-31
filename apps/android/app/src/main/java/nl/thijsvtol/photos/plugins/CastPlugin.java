package nl.thijsvtol.photos.plugins;

import androidx.mediarouter.app.MediaRouteChooserDialog;
import androidx.mediarouter.media.MediaRouteSelector;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.CastStateListener;
import com.google.android.gms.cast.framework.SessionManagerListener;

/**
 * Native Capacitor plugin bridging to Google's native Cast SDK
 * (play-services-cast-framework).
 *
 * WHY THIS EXISTS: the standard Cast Web Sender SDK (`chrome.cast` /
 * `cast.framework`, used by services/castService.ts on the web) only exists
 * inside the actual Chrome browser app — a generic Android WebView (which is
 * what wraps this app via Capacitor) does not implement it at all. So the
 * native app needs this real native bridge to Google's native Cast SDK
 * instead; JS calls the same-shaped methods via castService.ts, which
 * dispatches to this plugin on native instead of `chrome.cast` on web.
 *
 * Casting to a CUSTOM receiver (not the stock default media receiver) is
 * driven entirely through CastSession.sendMessage() on our custom message
 * namespace — see services/castService.ts's CAST_NAMESPACE and
 * pages/CastReceiver.tsx, which is the page that actually renders on the TV.
 */
@CapacitorPlugin(name = "Cast")
public class CastPlugin extends Plugin {

    private CastContext castContext;
    private boolean castStateAvailable = false;

    @Override
    public void load() {
        super.load();
        try {
            castContext = CastContext.getSharedInstance(getContext());
            castContext.addCastStateListener(new CastStateListener() {
                @Override
                public void onCastStateChanged(int state) {
                    // CastState.NO_DEVICES_AVAILABLE == 1; anything else means at
                    // least one Cast-capable device is reachable on the network.
                    castStateAvailable = state != com.google.android.gms.cast.framework.CastState.NO_DEVICES_AVAILABLE;
                }
            });
            castContext.getSessionManager().addSessionManagerListener(sessionListener, CastSession.class);
        } catch (Exception e) {
            // Play Services Cast framework unavailable on this device (e.g. no
            // Google Play Services, or running on an emulator without it) —
            // isAvailable() will correctly report false and the JS-side Cast
            // button simply stays hidden.
            android.util.Log.w("CastPlugin", "Cast framework unavailable: " + e.getMessage());
            castContext = null;
        }
    }

    private final SessionManagerListener<CastSession> sessionListener = new SessionManagerListener<CastSession>() {
        @Override
        public void onSessionStarted(CastSession session, String sessionId) {
            notifyConnected(session);
        }

        @Override
        public void onSessionResumed(CastSession session, boolean wasSuspended) {
            notifyConnected(session);
        }

        @Override
        public void onSessionEnded(CastSession session, int error) {
            notifyDisconnected();
        }

        @Override
        public void onSessionSuspended(CastSession session, int reason) {
            notifyDisconnected();
        }

        @Override
        public void onSessionStarting(CastSession session) {}
        @Override
        public void onSessionStartFailed(CastSession session, int error) {
            notifyDisconnected();
        }
        @Override
        public void onSessionEnding(CastSession session) {}
        @Override
        public void onSessionResuming(CastSession session, String sessionId) {}
        @Override
        public void onSessionResumeFailed(CastSession session, int error) {
            notifyDisconnected();
        }
    };

    private void notifyConnected(CastSession session) {
        JSObject data = new JSObject();
        data.put("connected", true);
        data.put("deviceName", session.getCastDevice() != null ? session.getCastDevice().getFriendlyName() : null);
        notifyListeners("sessionStateChanged", data);
    }

    private void notifyDisconnected() {
        JSObject data = new JSObject();
        data.put("connected", false);
        notifyListeners("sessionStateChanged", data);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", castContext != null);
        call.resolve(result);
    }

    /**
     * Shows the standard Android system "Cast to" device chooser dialog
     * (androidx.mediarouter). Selecting a device starts a CastSession, which
     * the SessionManagerListener above picks up and reports back to JS via
     * the 'sessionStateChanged' event.
     */
    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (castContext == null) {
            call.reject("Cast framework unavailable");
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                // getMergedSelector() already returns a selector configured for
                // whatever receiver Application ID CastOptionsProvider supplied —
                // no need to look up/rebuild the category manually.
                MediaRouteSelector selector = castContext.getMergedSelector();

                MediaRouteChooserDialog dialog = new MediaRouteChooserDialog(getActivity());
                dialog.setRouteSelector(selector);
                dialog.show();

                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to show Cast device picker: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void loadMedia(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("message is required");
            return;
        }
        if (castContext == null) {
            call.reject("Cast framework unavailable");
            return;
        }

        CastSession session = castContext.getSessionManager().getCurrentCastSession();
        if (session == null || !session.isConnected()) {
            call.reject("No active Cast session");
            return;
        }

        try {
            session.sendMessage(nl.thijsvtol.photos.plugins.CastConstants.NAMESPACE, message)
                .setResultCallback(status -> {
                    if (status.isSuccess()) {
                        call.resolve();
                    } else {
                        call.reject("Failed to send message to receiver: " + status.getStatusMessage());
                    }
                });
        } catch (Exception e) {
            call.reject("Failed to send message: " + e.getMessage());
        }
    }

    @PluginMethod
    public void endSession(PluginCall call) {
        if (castContext != null) {
            castContext.getSessionManager().endCurrentSession(true);
        }
        call.resolve();
    }
}
