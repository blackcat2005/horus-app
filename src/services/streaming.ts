/**
 * Streaming Service
 * Quản lý capture và gửi video frames tới server
 */

import { logger } from '../utils/logger';
import { wsService } from './websocket';
import { cameraService } from './camera';
import { uploadService } from './upload';
import { StreamFrameMessage } from '../types/protocol';
import { FRAME_BUFFER_SIZE, CAMERA_VIDEO_MAX_DURATION } from '../constants/config';

interface FrameBuffer {
  data: string; // base64 encoded
  width: number;
  height: number;
  timestamp: number;
  index: number;
}

class StreamingService {
  private isStreaming: boolean = false;
  private frameBuffer: FrameBuffer[] = [];
  private frameRate: number = 5; // fps
  private quality: number = 0.8;
  private captureInterval: ReturnType<typeof setInterval> | null = null;
  private deviceId: string = '';
  private isStoppingRecording: boolean = false;
  private lastUploadedUri: string | null = null;
  private currentRoomId: string | null = null;
  private currentSessionId: string | null = null;
  private recordingStartedAt: number | null = null;
  private recordingDurationMs: number | null = null;
  private deviceModel: string = '';
  private cameraName: string = 'Remote Camera';

  /**
   * Khởi tạo streaming service
   */
  public initialize(
    deviceId: string,
    extra?: { deviceModel?: string; cameraName?: string; roomId?: string }
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

  public getActiveRoom(): string | null {
    return this.currentRoomId;
  }

  /**
   * Gán session_id từ lệnh start_record của Controller (gọi khi nhận pending_commands).
   * Session này sẽ được dùng để gom tất cả video của 1 lần "Start All" vào cùng 1 folder trên MinIO.
   */
  public setActiveSession(sessionId: string | null): void {
    this.currentSessionId = sessionId;
    logger.info('StreamingService active session updated', { sessionId });
  }

  /**
   * Lấy session_id hiện tại (nếu có)
   */
  public getActiveSession(): string | null {
    return this.currentSessionId;
  }

  /**
   * Cập nhật camera name (vd "Camera sau" / "Cam-ABCD") — được dùng làm metadata khi upload
   */
  public setCameraName(name: string): void {
    this.cameraName = name;
  }

  /**
   * Bắt đầu streaming video
   */
  public startStreaming(frameRate: number = 5, quality: number = 0.8): void {
    if (this.isStreaming) {
      logger.warn('Streaming already in progress');
      return;
    }

    this.frameRate = frameRate;
    this.quality = quality;
    this.isStreaming = true;
    this.frameBuffer = [];

    logger.info('Starting video stream', { frameRate, quality });

    cameraService.startStreaming();
    wsService.startStreaming(frameRate, quality);

    // Bắt đầu capture frames với khoảng cách dựa vào frame rate
    const captureInterval = Math.floor(1000 / frameRate);
    this.captureInterval = setInterval(() => {
      this.captureAndSendFrame();
    }, captureInterval);
  }

  /**
   * Dừng streaming video
   */
  public stopStreaming(): void {
    if (!this.isStreaming) {
      logger.warn('Streaming is not in progress');
      return;
    }

    this.isStreaming = false;

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    cameraService.stopStreaming();
    wsService.stopStreaming();

    logger.info('Streaming stopped');
  }

  /**
   * Capture và gửi một frame
   */
  private async captureAndSendFrame(): Promise<void> {
    if (!this.isStreaming || !cameraService.isReady_()) {
      return;
    }

    try {
      // Chụp frame trực tiếp trong bộ nhớ (không ghi file tạm)
      const frame = await cameraService.captureFrame(this.quality);
      if (!frame) {
        logger.warn('Failed to capture frame');
        return;
      }

      // Tạo frame message
      const frameIndex = cameraService.getNextFrameIndex();
      const frameMessage: StreamFrameMessage = {
        type: 'STREAM_FRAME',
        device_id: this.deviceId,
        device_type: 'remote',
        timestamp: Date.now(),
        frame_data: frame.base64,
        frame_width: frame.width,
        frame_height: frame.height,
        frame_index: frameIndex,
      };

      // Gửi frame tới server
      wsService.send(frameMessage);

      // Lưu vào buffer
      this.bufferFrame(frameMessage);

      cameraService.updateLastFrameTime();

      logger.debug('Frame sent', {
        frameIndex,
        fps: cameraService.getCurrentFPS(),
        base64Size: frame.base64.length,
      });
    } catch (error) {
      logger.error('Error capturing frame', error);
    }
  }

  /**
   * Bắt đầu quay video thật trên device (+ gửi RECORD_START lên server)
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
      wsService.send({
        type: 'RECORD_START',
        device_id: this.deviceId,
        device_type: 'remote',
        timestamp: Date.now(),
        max_duration: maxDurationSec,
        session_id: this.currentSessionId,
      });
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
      return uri;
    } finally {
      this.isStoppingRecording = false;
    }
  }

  /**
   * Upload file video lên server theo luồng chunked upload của API v1.
   * Chạy nền, không chặn UI.
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
    const fileName = uri.split('/').pop() || `recording_${Date.now()}.mp4`;
    const localVideoUid = `${effectiveSessionId}_${this.deviceId}_${this.recordingStartedAt ?? Date.now()}`;

    try {
      await uploadService.uploadVideo(
        uri,
        {
          localVideoUid,
          deviceId: this.deviceId,
          roomId: this.currentRoomId ?? undefined,
          cameraName: this.cameraName,
          sessionId: effectiveSessionId,
          recordedAt,
          durationMs: this.recordingDurationMs ?? undefined,
          resolution: undefined,
          fps: undefined,
        },
        onProgress,
      );
      logger.info('Video upload completed/queued', {
        sessionId: effectiveSessionId,
        roomId: this.currentRoomId,
        deviceId: this.deviceId,
        durationMs: this.recordingDurationMs,
      });
      return true;
    } catch (error) {
      logger.error('Failed to upload recording', error);
      this.lastUploadedUri = null;
      return false;
    } finally {
      wsService.send({
        type: 'RECORD_END',
        device_id: this.deviceId,
        device_type: 'remote',
        timestamp: Date.now(),
        session_id: effectiveSessionId,
      });
      this.recordingStartedAt = null;
      this.recordingDurationMs = null;
    }
  }

  /**
   * Lưu frame vào buffer
   */
  private bufferFrame(frame: StreamFrameMessage): void {
    this.frameBuffer.push({
      data: frame.frame_data,
      width: frame.frame_width,
      height: frame.frame_height,
      timestamp: frame.timestamp,
      index: frame.frame_index,
    });

    // Giữ buffer size không vượt quá limit
    if (this.frameBuffer.length > FRAME_BUFFER_SIZE) {
      this.frameBuffer.shift();
    }
  }

  /**
   * Lấy last N frames từ buffer
   */
  public getBufferedFrames(count: number = 10): FrameBuffer[] {
    return this.frameBuffer.slice(-count);
  }

  /**
   * Kiểm tra streaming có đang chạy không
   */
  public isStreaming_(): boolean {
    return this.isStreaming;
  }

  /**
   * Lấy current streaming stats
   */
  public getStreamingStats() {
    return {
      isStreaming: this.isStreaming,
      frameRate: this.frameRate,
      quality: this.quality,
      bufferedFrames: this.frameBuffer.length,
      currentFPS: cameraService.getCurrentFPS(),
    };
  }

  /**
   * Reset streaming state
   */
  public reset(): void {
    this.stopStreaming();
    this.frameBuffer = [];
    this.frameRate = 5;
    this.quality = 0.8;
    this.currentRoomId = null;
    this.currentSessionId = null;
    this.recordingStartedAt = null;
    this.recordingDurationMs = null;
    this.lastUploadedUri = null;
  }
}

// Export singleton instance
export const streamingService = new StreamingService();
