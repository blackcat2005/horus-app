/**
 * M0 experiment (feat/android-recorder) — throwaway; delete once M0 is decided.
 *
 * Change the variant and reload the JS bundle (press `r` in Metro; no native rebuild needed),
 * then start the preview from the Remote screen. Results go to Metro/logcat as `[probe] ...`
 * lines once per second and a `[probe] summary` when the preview stops.
 *
 * - 'off'                         normal preview (720p, default encodings), no probe
 * - 'as-is'                       1080p30 capture, producer maxBitrate 150 kbps /
 *                                 scaleResolutionDownBy 4, stock frame tap
 * - 'patched'                     'as-is' + raw-frame patch (tap sees frames before adaptation)
 * - 'maintain-resolution'         'as-is' + sender degradationPreference 'maintain-resolution'
 * - 'patched+maintain-resolution' both
 */
export type RecorderProbeVariant =
  'off' | 'as-is' | 'patched' | 'maintain-resolution' | 'patched+maintain-resolution';

export const RECORDER_PROBE_VARIANT = 'as-is' as RecorderProbeVariant;
