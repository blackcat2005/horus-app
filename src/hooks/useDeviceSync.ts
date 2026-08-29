/**
 * useDeviceSync — hook nối RemoteScreen với polling sync_device
 * Tự cung cấp telemetry (recording_state, elapsed_ms...) và xử lý pending_commands
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { deviceSyncService } from '../services/deviceSync';
import { cameraService } from '../services/camera';
import { streamingService } from '../services/streaming';
import { logger } from '../utils/logger';
import { authStore } from '../services/authStore';
import { useRouter } from 'expo-router';

export function useDeviceSync(deviceId: string, opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  const router = useRouter();
  const recordingStartAt = useRef<number | null>(null);

  const getTelemetry = useCallback(() => {
    const isRecording = cameraService.isVideoRecording_();
    const elapsed = isRecording && recordingStartAt.current ? Date.now() - recordingStartAt.current : 0;
    return {
      recording_state: isRecording ? 'recording' : 'idle',
      elapsed_ms: elapsed || undefined,
      // Có thể mở rộng: battery_level, storage_free, temperature_state
    };
  }, []);

  useEffect(() => {
    if (!deviceId || !enabled) return;

    deviceSyncService.initialize(deviceId);
    deviceSyncService.setTelemetryProvider(getTelemetry);

    const offStart = deviceSyncService.onCommand('start_record', async cmd => {
      const payload = cmd.payload as { session_id?: string; config?: { max_duration?: number; resolution?: string; fps?: number }; client_command_id?: string };
      logger.info('Handling start_record', payload);
      // session_id từ server — lưu vào upload metadata
      const maxDur = typeof payload.config?.max_duration === 'number' ? payload.config.max_duration : 60;
      const started = await streamingService.startRecording(maxDur);
      if (started) recordingStartAt.current = Date.now();
      deviceSyncService.setLastCommandId(cmd.command_id);
    });

    const offStop = deviceSyncService.onCommand('stop_record', async cmd => {
      logger.info('Handling stop_record', cmd.payload);
      const uri = await streamingService.stopRecording();
      recordingStartAt.current = null;
      if (uri) {
        // Tách nền upload chunk theo spec (giữ local + upload)
        const payload = cmd.payload as { session_id?: string };
        streamingService
          .uploadRecording(uri)
          .then(ok => logger.info('Auto-upload after stop_record', { ok, session_id: payload.session_id }))
          .catch(e => logger.error('Auto-upload failed', e));
      }
      deviceSyncService.setLastCommandId(cmd.command_id);
    });

    const offCamera = deviceSyncService.onCommand('camera_config', async cmd => {
      const p = cmd.payload as { flash_mode?: string; zoom_factor?: number };
      logger.info('Handling camera_config', p);
      // Hiện tại expo-camera chưa đổi flash/zoom động — log để gắn sau
      // TODO: cameraService.setFlashMode / setZoom
      deviceSyncService.setLastCommandId(cmd.command_id);
    });

    const offLeave = deviceSyncService.onCommand('leave_room', async cmd => {
      logger.info('Handling leave_room (kicked/closed)', cmd.payload);
      deviceSyncService.setLastCommandId(cmd.command_id);
      // Có thể điều hướng hoặc toast
    });

    deviceSyncService.onRevoked(async () => {
      logger.warn('Session revoked → logout');
      await authStore.clear();
      router.replace('/login');
    });

    deviceSyncService.start();

    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') deviceSyncService.start();
      else if (state === 'background') deviceSyncService.stop();
    });

    return () => {
      offStart();
      offStop();
      offCamera();
      offLeave();
      sub.remove();
      deviceSyncService.stop();
    };
  }, [deviceId, enabled, getTelemetry, router]);
}
