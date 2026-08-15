/**
 * File System Utilities
 * Dùng để đọc file và chuyển đổi sang base64
 */

import * as FileSystem from 'expo-file-system';
import { logger } from './logger';

/**
 * Chuyển file ảnh thành base64 string
 */
export async function fileToBase64(fileUri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return base64;
  } catch (error) {
    logger.error('Failed to convert file to base64', error);
    return null;
  }
}

/**
 * Lấy kích thước file
 */
export async function getFileSize(fileUri: string): Promise<number | null> {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (fileInfo.exists && 'size' in fileInfo) {
      return (fileInfo as any).size || 0;
    }
    return 0;
  } catch (error) {
    logger.error('Failed to get file size', error);
    return null;
  }
}

/**
 * Xóa file
 */
export async function deleteFile(fileUri: string): Promise<boolean> {
  try {
    await FileSystem.deleteAsync(fileUri);
    return true;
  } catch (error) {
    logger.error('Failed to delete file', error);
    return false;
  }
}

/**
 * Tạo directory nếu chưa tồn tại
 */
export async function ensureDirectory(dirUri: string): Promise<boolean> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(dirUri);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
    }
    return true;
  } catch (error) {
    logger.error('Failed to ensure directory', error);
    return false;
  }
}
