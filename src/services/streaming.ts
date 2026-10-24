/**
 * Streaming Service
 * Quay video local (nguồn dữ liệu chính) và upload sau khi dừng quay.
 * Giữ room/session hiện tại để gắn metadata khi upload, và telemetry recording/upload cho sync_device.
 */

import { logger } from '../utils/logger';
import { cameraService } from './camera';
import { uploadService } from './upload';
import { localStore } from './localStore';
import type { DeviceSyncTelemetry } from './deviceSync';
import { CAMERA_VIDEO_MAX_DURATION } from '../constants/config';

class StreamingService {
  private deviceId: string = '';
  private isStoppingRecording: boolean = false;
  private lastUploadedUri: string | null = null;
  private currentRoomId: string | null = null;
  private currentSessionId: string | null = null;
  private recordingStartedAt: number | null = null;
  private recordingDurationMs: number | null = null;
  private deviceModel: string = '';
  private cameraName: string = 'Remote Camera';
  private telemetry: DeviceSyncTelemetry = {};

  /**
   * Khởi tạo streaming service
   */
  public initialize(
    deviceId: string,
    extra?: { deviceModel?: string; cameraName?: string; roomId?: string },
  ): void {
    this.deviceId = deviceId;
    if (extra?.deviceModel) this.deviceModel = extra.deviceModel;
    if (extra?.cameraName) this.cameraName = extra.cameraName;
    if (extra?.roomId) this.currentRoomId = extra.roomId;
    logger.info('StreamingService initialized', {
      deviceId,
      roomId: this.currentRoomId,
      model: this.deviceModel,
      cameraName: this.cameraName,
    });
  }

  /**
   * Gán room_id của phòng remote đang tham gia (để folder tên trên MinIO theo cấu trúc room_id/session_time)
   */
  public setActiveRoom(roomId: string | null): void {
    this.currentRoomId = roomId;
    logger.info('StreamingService active room updated', { roomId });
  }

  /**
   * Gán session_id từ lệnh start_record của Controller (gọi khi nhận pending_commands).
   * Session này sẽ được dùng để gom tất cả video của 1 lần "Start All" vào cùng 1 folder trên MinIO.
   */
  public setActiveSession(sessionId: string | null): void {
    this.currentSessionId = sessionId;
    logger.info('StreamingService active session updated', { sessionId });
  }

  /** Telemetry recording/upload gửi kèm sync_device */
  public getTelemetry(): DeviceSyncTelemetry {
    return this.telemetry;
  }

  /**
   * Bắt đầu quay video thật trên device
   */
  public async startRecording(
    maxDurationSec: number = CAMERA_VIDEO_MAX_DURATION,
  ): Promise<boolean> {
    if (cameraService.isVideoRecording_()) {
      logger.warn('Recording already in progress');
      return false;
    }

    const started = await cameraService.startVideoRecording(maxDurationSec);
    if (started) {
      this.lastUploadedUri = null;
      this.recordingStartedAt = Date.now();
      this.recordingDurationMs = null;
      this.telemetry = { recording_state: 'recording' };
      logger.info('Video recording started', { maxDurationSec, sessionId: this.currentSessionId });
    } else {
      logger.warn('startVideoRecording returned false', {
        maxDurationSec,
        cameraReady: cameraService.isReady_(),
        alreadyRecording: cameraService.isVideoRecording_(),
      });
    }

    return started;
  }

  /**
   * Dừng quay video NGAY LẬP TỨC, trả về uri file video.
   * (Không upload ở đây - upload được tách riêng để UI không bị block)
   */
  public async stopRecording(): Promise<string | null> {
    // Chặn gọi trùng: nếu đang dừng thì bỏ qua (single-flight)
    if (this.isStoppingRecording) {
      logger.warn('stopRecording already in progress, ignoring duplicate call');
      return null;
    }

    this.isStoppingRecording = true;
    try {
      const uri = await cameraService.stopVideoRecording();
      if (uri && this.recordingStartedAt) {
        this.recordingDurationMs = Math.max(500, Date.now() - this.recordingStartedAt);
        logger.info('Video recording stopped', { durationMs: this.recordingDurationMs });
      }
      this.telemetry = { recording_state: uri ? 'saved' : 'idle' };
      return uri;
    } finally {
      this.isStoppingRecording = false;
    }
  }

  /**
   * Copy clip từ cache của camera sang thư mục bền (hiện ở tab Files), rồi upload.
   * Chỉ xoá bản bền khi complete thành công; lỗi thì clip vẫn nằm ở Files để upload lại.
   * Session_id và device info được lấy từ state đã setActiveSession() khi nhận lệnh start_record.
   */
  public async uploadRecording(
    uri: string,
    onProgress?: (percent: number) => void,
  ): Promise<boolean> {
    if (!uri) {
      return false;
    }

    if (this.lastUploadedUri === uri) {
      logger.warn('Video already uploaded, skipping duplicate upload', { uri });
      return true;
    }

    this.lastUploadedUri = uri;

    const effectiveSessionId = this.currentSessionId ?? 'standalone';
    const recordedAt = this.recordingStartedAt
      ? new Date(this.recordingStartedAt).toISOString()
      : new Date().toISOString();
    const localVideoUid = `${effectiveSessionId}_${this.deviceId}_${this.recordingStartedAt ?? Date.now()}`;
    const durationMs = this.recordingDurationMs ?? undefined;
    this.recordingStartedAt = null;
    this.recordingDurationMs = null;

    const report = (percent: number) => {
      this.telemetry = { ...this.telemetry, upload_state: 'uploading', upload_percent: percent };
      onProgress?.(percent);
    };

    const saved = await localStore.saveCapturedMedia(uri, 'video');
    if (!saved) {
      this.lastUploadedUri = null;
      this.telemetry = { ...this.telemetry, upload_state: 'failed' };
      return false;
    }

    try {
      report(0);
      await uploadService.uploadVideo(
        saved.localUri,
        {
          localVideoUid,
          deviceId: this.deviceId,
          roomId: this.currentRoomId ?? undefined,
          cameraName: this.cameraName,
          sessionId: effectiveSessionId,
          recordedAt,
          durationMs,
        },
        report,
      );
      this.telemetry = { ...this.telemetry, upload_state: 'uploaded', upload_percent: 100 };
      await localStore.deleteCapturedFile(saved.id);
      logger.info('Video upload completed', {
        sessionId: effectiveSessionId,
        roomId: this.currentRoomId,
        deviceId: this.deviceId,
        durationMs,
      });
      return true;
    } catch (error) {
      logger.error('Failed to upload recording', error);
      this.telemetry = { ...this.telemetry, upload_state: 'failed' };
      this.lastUploadedUri = null;
      return false;
    }
  }
}

// Export singleton instance
export const streamingService = new StreamingService();
