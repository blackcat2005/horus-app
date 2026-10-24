package expo.modules.webrtcrecorder

import android.util.Log
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

private const val TAG = "WebrtcRecorder"

/**
 * M0 (experiment) surface of the Android WebRTC recorder module: registers a probe frame
 * processor in react-native-webrtc's static registry and reports what it receives once per
 * second (logcat tag "WebrtcRecorder" + JS event "onStats"). The recorder itself comes in M1.
 */
class WebrtcRecorderModule : Module() {
  private val stats = FrameStats()
  private var ticker: ScheduledExecutorService? = null

  override fun definition() = ModuleDefinition {
    Name("WebrtcRecorder")

    Events("onStats", "onError")

    OnCreate { registerProcessor() }

    OnDestroy { stopTicker() }

    Function("isRawFramePatchApplied") { ProbeFrameProcessor.isRawPatchApplied() }

    // Returns the mode now in effect (false when the patch is not applied).
    Function("setRawFrameMode") { enabled: Boolean -> ProbeFrameProcessor.setRawFrames(enabled) }

    // Resets counters and starts the 1 s stats ticker. Returns the processor name to pass to
    // track._setVideoEffects([...]).
    Function("probeStart") {
      registerProcessor()
      stats.reset()
      startTicker()
      ProbeFrameProcessor.PROCESSOR_NAME
    }

    // Stops the ticker and returns the whole-session summary.
    Function("probeStop") {
      stopTicker()
      val summary = stats.summary()
      summary["rawFrames"] = ProbeFrameProcessor.getRawFrames()
      Log.i(TAG, "probe summary $summary")
      summary
    }
  }

  private fun registerProcessor() {
    ProcessorProvider.addProcessor(
      ProbeFrameProcessor.PROCESSOR_NAME,
      VideoFrameProcessorFactoryInterface { ProbeFrameProcessor(stats) },
    )
  }

  @Synchronized
  private fun startTicker() {
    if (ticker != null) return
    ticker = Executors.newSingleThreadScheduledExecutor().also {
      it.scheduleAtFixedRate({ emitTick() }, 1, 1, TimeUnit.SECONDS)
    }
  }

  @Synchronized
  private fun stopTicker() {
    ticker?.shutdownNow()
    ticker = null
  }

  private fun emitTick() {
    try {
      val s = stats.tick()
      s["rawFrames"] = ProbeFrameProcessor.getRawFrames()
      Log.i(
        TAG,
        "tap ${s["width"]}x${s["height"]} rot=${s["rotation"]} fps=${s["fps"]} " +
          "maxGapMs=${s["maxGapMs"]} raw=${s["rawFrames"]}",
      )
      sendEvent("onStats", s)
    } catch (t: Throwable) {
      // Never let the ticker die silently; a throw inside scheduleAtFixedRate cancels it.
      Log.e(TAG, "stats tick failed", t)
    }
  }
}
