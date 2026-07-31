package nl.thijsvtol.photos.plugins;

/**
 * Shared constants between the native Cast plugin and the JS side
 * (apps/web/src/services/castService.ts's CAST_NAMESPACE). Keep these in
 * sync — a mismatch means messages sent from the app are silently ignored by
 * the receiver (pages/CastReceiver.tsx).
 */
public final class CastConstants {
    public static final String NAMESPACE = "urn:x-cast:nl.thijsvtol.photos";

    private CastConstants() {}
}
