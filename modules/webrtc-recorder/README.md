# webrtc-recorder (Android, local Expo module)

Records the react-native-webrtc camera track to MP4 from raw capture frames while the same
track feeds the mediasoup preview. Plan: `docs/android-recorder-module-plan.md`.

Status: **M0 experiment only.** The module registers a probe frame processor
(`webrtcRecorderProbe`) and reports what it receives. No recording yet.

## M0 runbook (needs a real Android phone + a new dev-client build)

1. `npm install` (postinstall applies `patches/react-native-webrtc+124.0.8.patch`), then build
   the dev client (native code changed).
2. Set `RECORDER_PROBE_VARIANT` in `src/constants/recorderProbe.ts`, reload JS (`r` in Metro).
3. Join a room on the Remote phone, start the preview, open it on the Controller, throttle the
   phone's network.
4. Read logs once per second (Metro or `adb logcat -s ReactNativeJS WebrtcRecorder`):
   `[probe] tap 1920x1080 rot=90 fps=30 maxGap=40ms raw=false | send 480x270@30 140kbps qlr=bandwidth`
   - `tap` = what the frame processor receives (buffer size is sensor orientation, so
     1920x1080 even in portrait).
   - `send` = what WebRTC actually encodes (`qlr` = qualityLimitationReason).
5. Stop the preview after 5 min: `[probe] summary {...}` shows avg fps, max gap and
   `framesPerResolution`.

Variants: `as-is`, `patched`, `maintain-resolution`, `patched+maintain-resolution`, `off`.

Gate: tap steady ~1920x1080 @ ~30 fps for 5 min while the Controller preview keeps working.
