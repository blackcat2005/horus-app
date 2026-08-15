/**
 * Upload Service
 * Đẩy các file (ảnh/video) lên server qua HTTP multipart,
 * hỗ trợ báo tiến trình upload (progress)
 */

import * as FileSystem from 'expo-file-system';
import { logger } from '../utils/logger';

export type UploadProgressCallback = (percent: number) => void;

class UploadService {
  private baseUrl: string = '';

  /**
   * Khởi tạo với base URL của server (dùng chung host/port với WebSocket)
   */
  public initialize(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    logger.info('UploadService initialized', { baseUrl: this.baseUrl });
  }

  /**
   * Upload file video lên server -> server lưu/upload Minio
   */
  public async uploadVideo(
    videoUri: string,
    deviceId: string,
    onProgress?: UploadProgressCallback,
  ): Promise<boolean> {
    return this.uploadFile(
      videoUri,
      deviceId,
      'video/upload',
      `recording_${Date.now()}.mp4`,
      'video/mp4',
      onProgress,
    );
  }

  /**
   * Upload file ảnh lên server -> server lưu/upload Minio
   */
  public async uploadPhoto(
    photoUri: string,
    deviceId: string,
    onProgress?: UploadProgressCallback,
  ): Promise<boolean> {
    return this.uploadFile(
      photoUri,
      deviceId,
      'photo/upload',
      `photo_${Date.now()}.jpg`,
      'image/jpeg',
      onProgress,
    );
  }

  /**
   * Gửi file dạng multipart/form-data lên server, có báo tiến trình
   */
  private async uploadFile(
    fileUri: string,
    deviceId: string,
    endpoint: string,
    fileName: string,
    mimeType: string,
    onProgress?: UploadProgressCallback,
  ): Promise<boolean> {
    if (!this.baseUrl) {
      logger.error('UploadService not initialized');
      return false;
    }

    const url = `${this.baseUrl}/api/devices/${deviceId}/${endpoint}`;

    logger.info('File uploading', {
      deviceId,
      endpoint,
      fileName,
    });

    try {
      const uploadTask = FileSystem.createUploadTask(
        url,
        fileUri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'file',
          mimeType,
          parameters: {
            fileName,
          },
        },
        progress => {
          if (onProgress) {
            const total = progress.totalBytesExpectedToSend;
            const sent = progress.totalBytesSent;
            const percent = total > 0 ? Math.round((sent / total) * 100) : 0;
            onProgress(Math.min(100, percent));
          }
        },
      );

      const result = await uploadTask.uploadAsync();

      if (result && result.status >= 200 && result.status < 300) {
        let body: any = {};
        try {
          body = JSON.parse(String(result.body));
        } catch {
          body = {};
        }

        if (body.success) {
          logger.info('File uploaded successfully', body);
          return true;
        }
      }

      logger.error('File upload rejected', result);
      return false;
    } catch (error) {
      logger.error('Failed to upload file', error);
      return false;
    }
  }
}

// Export singleton instance
export const uploadService = new UploadService();
