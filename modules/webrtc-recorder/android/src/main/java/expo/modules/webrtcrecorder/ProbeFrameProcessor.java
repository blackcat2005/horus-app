package expo.modules.webrtcrecorder;

import com.oney.WebRTCModule.videoEffects.VideoEffectProcessor;
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor;

import org.webrtc.SurfaceTextureHelper;
import org.webrtc.VideoFrame;

import java.lang.reflect.Field;

/**
 * M0 probe tap: measures every frame react-native-webrtc hands to the processor chain and returns
 * it unchanged. Enabled on a track from JS with track._setVideoEffects([PROCESSOR_NAME]).
 */
final class ProbeFrameProcessor implements VideoFrameProcessor {
    static final String PROCESSOR_NAME = "webrtcRecorderProbe";

    private final FrameStats stats;

    ProbeFrameProcessor(FrameStats stats) {
        this.stats = stats;
    }

    @Override
    public VideoFrame process(VideoFrame frame, SurfaceTextureHelper textureHelper) {
        stats.onFrame(frame);
        // The caller releases the returned frame and the input separately, so hand back our own ref.
        frame.retain();
        return frame;
    }

    // --- raw-frame patch switch (patches/react-native-webrtc+*.patch) -------------------------
    // Reflection so this module still compiles and runs (stock behaviour) without the patch.

    private static Field rawFlag() {
        try {
            return VideoEffectProcessor.class.getField("processRawFrames");
        } catch (NoSuchFieldException e) {
            return null;
        }
    }

    static boolean isRawPatchApplied() {
        return rawFlag() != null;
    }

    /** @return the flag value now in effect (false if the patch is missing). */
    static boolean setRawFrames(boolean enabled) {
        Field f = rawFlag();
        if (f == null) return false;
        try {
            f.setBoolean(null, enabled);
            return f.getBoolean(null);
        } catch (IllegalAccessException e) {
            return false;
        }
    }

    static boolean getRawFrames() {
        Field f = rawFlag();
        if (f == null) return false;
        try {
            return f.getBoolean(null);
        } catch (IllegalAccessException e) {
            return false;
        }
    }
}
