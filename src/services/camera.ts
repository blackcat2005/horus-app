/**
 * Camera Service
 * Quản lý camera, chụp ảnh và mã hóa frame
 */

import { CameraView } from 'expo-camera';
import { logger } from '../utils/logger';
import { fileToBase64, getFileSize } from '../utils/file';
import {
  CAMERA_PHOTO_QUALITY,
  CAMERA_PREVIEW_QUALITY,
  MAX_FRAME_WIDTH,
  MAX_FRAME_HEIGHT,
} from '../constants/config';

export type CameraMode = 'picture' | 'video';

export interface PhotoAsset {
  uri: string;
  width: number;
  height: number;
}

export interface CapturedFrame {
  base64: string;
  width: number;
  height: number;
}

class CameraService {
  private cameraRef: CameraView | null = null;
  private isReady: boolean = false;
  private isStreaming: boolean = false;
  private frameIndex: number = 0;
  private lastFrameTime: number = 0;
  private isRecordingVideo: boolean = false;
  private recordingPromise: Promise<{ uri: string } | undefined> | null = null;
  private recordingUri: string | null = null;

  /**
   * Gán camera ref
   */
  public setCameraRef(ref: CameraView | null): void {
    this.cameraRef = ref as CameraView;
    logger.info('Camera ref assigned');
  }

  /**
   * Đánh dấu camera là sẵn sàng
   */
  public setReady(ready: boolean): void {
    this.isReady = ready;
    logger.info('Camera ready status changed', { isReady: ready });
  }

  /**
   * Kiểm tra camera có sẵn sàng không
   */
  public isReady_(): boolean {
    return this.isReady && this.cameraRef !== null;
  }

  /**
   * Chụp ảnh
   */
  public async takePicture(quality: number = CAMERA_PHOTO_QUALITY): Promise<PhotoAsset | null> {
    if (!this.cameraRef) {
      logger.warn('Cannot take picture: camera not ready');
      return null;
    }

    try {
      const photo = await this.cameraRef.takePictureAsync({
        base64: false,
        quality,
      });

      if (photo?.uri) {
        logger.info('Picture taken', { uri: photo.uri });
        return {
          uri: photo.uri,
          width: photo.width,
          height: photo.height,
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to take picture', error);
      return null;
    }
  }

  /**
   * Chuyển ảnh thành base64
   */
  public async photoToBase64(photoUri: string): Promise<string | null> {
    try {
      const base64 = await fileToBase64(photoUri);
      if (!base64) {
        logger.warn('Failed to convert photo to base64');
        return null;
      }

      // Log file size for debugging
      const fileSize = await getFileSize(photoUri);
      logger.debug('Photo converted to base64', {
        uri: photoUri,
        base64Length: base64.length,
        fileSizeBytes: fileSize,
      });

      return base64;
    } catch (error) {
      logger.error('Failed to convert photo to base64', error);
      return null;
    }
  }

  /**
   * Chụp frame streaming trực tiếp trong bộ nhớ (base64: true)
   * Không ghi file tạm và đọc lại như takePicture -> mượt hơn nhiều
   */
  public async captureFrame(
    quality: number = CAMERA_PREVIEW_QUALITY,
  ): Promise<CapturedFrame | null> {
    if (!this.cameraRef) {
      logger.warn('Cannot capture frame: camera not ready');
      return null;
    }

    try {
      const photo = await this.cameraRef.takePictureAsync({
        base64: true,
        quality,
        shutterSound: false,
      });

      if (photo?.base64 && photo?.width && photo?.height) {
        return {
          base64: photo.base64,
          width: photo.width,
          height: photo.height,
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to capture frame', error);
      return null;
    }
  }

  /**
   * Bắt đầu quay video thật bằng expo-camera recordAsync
   */
  public async startVideoRecording(maxDurationSec: number): Promise<boolean> {
    if (!this.cameraRef || this.isRecordingVideo) {
      logger.warn('Cannot start video recording: camera not ready or already recording');
      return false;
    }

    // recordAsync trên iOS reject ngay nếu session chưa được cấu hình xong sang video mode
    // (vd vừa đổi mode="video"). Retry vài lần để chờ native cấu hình xong.
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.isRecordingVideo = true;
      this.recordingUri = null;

      try {
        this.recordingPromise = this.cameraRef.recordAsync({
          maxDuration: maxDurationSec,
        });

        if (!this.recordingPromise) {
          this.isRecordingVideo = false;
          this.recordingPromise = null;
          return false;
        }

        // Chờ trong ~1s để bắt rejection sớm. iOS có thể reject muộn sau khi
        // reconfigure session sang video mode — nếu timeout quá ngắn (300ms) thì
        // recordAsync reject sau đó sẽ làm mất/clip video mà ta tưởng đã bắt đầu.
        const startError = await this.waitForRecordStart(this.recordingPromise, 1000);
        if (!startError) {
          logger.info('Video recording started', {
            attempt,
            maxDurationSec,
          });
          return true;
        }

        logger.warn('recordAsync failed to start, retrying', {
          attempt,
          message: startError?.message,
          code: (startError as any)?.code,
        });
        this.isRecordingVideo = false;
        this.recordingPromise = null;
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        logger.error('Failed to start video recording', error);
        this.isRecordingVideo = false;
        this.recordingPromise = null;
        return false;
      }
    }

    logger.error('Video recording failed to start after retries');
    this.isRecordingVideo = false;
    this.recordingPromise = null;
    return false;
  }

  /**
   * Chờ trong timeoutMs để phát hiện recordAsync reject (lỗi start).
   * Trả về error nếu reject, null nếu quá hạn mà chưa reject (coi như đã bắt đầu).
   */
  private waitForRecordStart(
    promise: Promise<{ uri: string } | undefined>,
    timeoutMs: number,
  ): Promise<Error | null> {
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, timeoutMs);

      promise.catch((error: any) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(error);
        }
      });
    });
  }

  /**
   * Dừng quay video và trả về URI của file video
   */
  public async stopVideoRecording(): Promise<string | null> {
    if (!this.isRecordingVideo) {
      return this.recordingUri;
    }

    try {
      if (this.cameraRef) {
        this.cameraRef.stopRecording();
      }

      const recording = await this.recordingPromise;
      this.recordingUri = recording?.uri ?? null;

      // Chờ file được flush xong trước khi trả uri (copyAsync sau đó nếu quá sớm
      // sẽ bắt được file cụt — chỉ 3s dù quay lâu hơn). Đợi ngắn + verify size.
      if (this.recordingUri) {
        const fileSystem = (await import('expo-file-system')).default ?? await import('expo-file-system');
        const fs = fileSystem as typeof import('expo-file-system');
        for (let i = 0; i < 5; i++) {
          const info = await fs.getInfoAsync(this.recordingUri!);
          if (info.exists && (info as { size?: number }).size) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      this.isRecordingVideo = false;
      this.recordingPromise = null;

      logger.info('Video recording stopped', { uri: this.recordingUri });
      return this.recordingUri;
    } catch (error) {
      logger.error('Failed to stop video recording', error);
      this.isRecordingVideo = false;
      this.recordingPromise = null;
      return this.recordingUri;
    }
  }

  /**
   * Kiểm tra có đang quay video không
   */
  public isVideoRecording_(): boolean {
    return this.isRecordingVideo;
  }

  /**
   * Bắt đầu streaming (theo dõi frame capture)
   */
  public startStreaming(): void {
    this.isStreaming = true;
    this.frameIndex = 0;
    this.lastFrameTime = Date.now();
    logger.info('Camera streaming started');
  }

  /**
   * Dừng streaming
   */
  public stopStreaming(): void {
    this.isStreaming = false;
    logger.info('Camera streaming stopped');
  }

  /**
   * Kiểm tra streaming có đang chạy không
   */
  public isStreaming_(): boolean {
    return this.isStreaming;
  }

  /**
   * Lấy frame index tiếp theo
   */
  public getNextFrameIndex(): number {
    return ++this.frameIndex;
  }

  /**
   * Cập nhật thời gian frame cuối cùng
   */
  public updateLastFrameTime(): void {
    this.lastFrameTime = Date.now();
  }

  /**
   * Lấy FPS hiện tại
   */
  public getCurrentFPS(): number {
    if (this.frameIndex === 0) return 0;
    const elapsed = Date.now() - this.lastFrameTime;
    if (elapsed === 0) return 0;
    return Math.round((1000 / elapsed) * 1000) / 1000;
  }

  /**
   * Reset frame counter
   */
  public resetFrameCounter(): void {
    this.frameIndex = 0;
    this.lastFrameTime = Date.now();
  }
}

// Export singleton instance
export const cameraService = new CameraService();
