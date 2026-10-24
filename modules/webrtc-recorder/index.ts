/**
 * Android-only local Expo module that taps react-native-webrtc camera frames.
 * M0 (experiment): probe API only — measures what the frame processor receives.
 * On iOS/web or in a build without the module, `WebrtcRecorder` is null (unsupported).
 */
import { requireOptionalNativeModule, type NativeModule } from 'expo';

export type ProbeStats = {
  fps: number;
  width: number;
  height: number;
  rotation: number;
  maxGapMs: number;
  droppedFrames: number;
  totalFrames: number;
  rawFrames: boolean;
};

export type ProbeSummary = {
  durationMs: number;
  totalFrames: number;
  avgFps: number;
  maxGapMs: number;
  droppedFrames: number;
  framesPerResolution: Record<string, number>;
  rawFrames: boolean;
};

type Events = {
  onStats: (s: ProbeStats) => void;
  onError: (e: { message: string }) => void;
};

declare class WebrtcRecorderNative extends NativeModule<Events> {
  isRawFramePatchApplied(): boolean;
  setRawFrameMode(enabled: boolean): boolean;
  /** Returns the processor name for track._setVideoEffects([...]). */
  probeStart(): string;
  probeStop(): ProbeSummary;
}

export const WebrtcRecorder = requireOptionalNativeModule<WebrtcRecorderNative>('WebrtcRecorder');
