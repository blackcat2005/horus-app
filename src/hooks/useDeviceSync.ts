/**
 * useDeviceSync — hook nối RemoteScreen với polling sync_device
 * Tự cung cấp telemetry (recording_state, elapsed_ms...) và xử lý pending_commands
 */
import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { deviceSyncService } from '../services/deviceSync';
import { cameraService } from '../services/camera';
import { streamingService } from '../services/streaming';
import { localStore } from '../services/localStore';
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
      // Nếu đang preview (WebRTC giữ camera), phải nhả camera trước để expo-camera quay được
      const wasPreviewing = !cameraService.isReady_();
      if (wasPreviewing) {
        logger.info('start_record while previewing — disconnect preview to free camera');
        try { const { mediasoupClientService } = await import('../services/mediasoupClient'); mediasoupClientService.disconnect(); } catch {}
        deviceSyncService.triggerPreviewDisconnect();
        // đợi CameraView remount + onCameraReady
        for (let i = 0; i < 20; i++) {
          if (cameraService.isReady_()) break;
          await new Promise(r => setTimeout(r, 150));
        }
        if (!cameraService.isReady_()) logger.warn('Camera still not ready after preview disconnect, will try startRecording anyway');
        else await new Promise(r => setTimeout(r, 400));
      }
      const maxDur = typeof payload.config?.max_duration === 'number' ? payload.config.max_duration : 60;
      const started = await streamingService.startRecording(maxDur);
      if (started) recordingStartAt.current = Date.now();
      else logger.warn('startRecording failed after preview disconnect', { wasPreviewing, cameraReady: cameraService.isReady_() });
      deviceSyncService.setLastCommandId(cmd.command_id);
    });

    const offStop = deviceSyncService.onCommand('stop_record', async cmd => {
      logger.info('Handling stop_record', cmd.payload);
      const uri = await streamingService.stopRecording();
      recordingStartAt.current = null;
      if (uri) {
        // Lưu local trước (để Files hiện) rồi upload nền
        try { await localStore.saveCapturedMedia(uri, 'video'); } catch (e) { logger.warn('saveCapturedMedia failed', e); }
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
