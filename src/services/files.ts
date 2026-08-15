/**
 * Files Service
 * Lấy danh sách file (ảnh/video) đã upload lên Minio từ server
 */

import Constants from 'expo-constants';
import { logger } from '../utils/logger';

export interface DeviceFile {
  objectName: string;
  size: number;
  lastModified?: string;
  contentType: string;
}

class FilesService {
  private baseUrl: string = '';

  /**
   * Khởi tạo với base URL của server (dùng chung host/port với WebSocket)
   */
  public initialize(): void {
    const wsHost = Constants.expoConfig?.extra?.wsHost ?? '192.168.1.102';
    const wsPort = Constants.expoConfig?.extra?.wsPort ?? '3333';
    this.baseUrl = `http://${wsHost}:${wsPort}`.replace(/\/+$/, '');
    logger.info('FilesService initialized', { baseUrl: this.baseUrl });
  }

  /**
   * Lấy danh sách file đã upload cho một device
   */
  public async listFiles(deviceId: string): Promise<DeviceFile[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/devices/${deviceId}/files`);
      const result = await response.json();

      if (response.ok && result.success) {
        logger.info('Files fetched', { deviceId, fileCount: result.file_count });
        return (result.files || []).map((f: any) => ({
          objectName: f.objectName,
          size: f.size,
          lastModified: f.lastModified,
          contentType: f.contentType,
        }));
      }

      logger.error('Failed to list files', result);
      return [];
    } catch (error) {
      logger.error('Failed to list files', error);
      return [];
    }
  }

  /**
   * Lấy URL tải xuống (presigned) cho một object
   */
  public async getDownloadUrl(objectName: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/files/url?object=${encodeURIComponent(objectName)}`,
      );
      const result = await response.json();

      if (response.ok && result.success) {
        return result.url;
      }

      logger.error('Failed to get download URL', result);
      return null;
    } catch (error) {
      logger.error('Failed to get download URL', error);
      return null;
    }
  }
}

// Export singleton instance
export const filesService = new FilesService();
