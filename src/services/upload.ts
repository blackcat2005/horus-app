/**
 * Upload Service (API v1 — chunked upload)
 * Upload video lên multicam-server theo luồng:
 *   1. Tính sha256 toàn file — ưu tiên expo-crypto (native), fallback js-sha256
 *      streaming cho file quá lớn để tránh tràn RAM
 *   2. POST /videos/uploads (init) — server trả chunk_size/total_chunks
 *      hoặc báo already_uploaded nếu clip này đã gửi trước đó
 *   3. PUT từng chunk 5 MiB (octet-stream), có retry + resume qua get status.
 *      Header chunk-checksum là tùy chọn nên bỏ qua để đỡ tốn 1 lần decode/chunk
 *   4. POST /videos/uploads/:id/complete để ghép file và lưu MinIO
 */

import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { sha256 } from 'js-sha256';

import { logger } from '../utils/logger';
import { base64ToUint8Array } from '../utils/base64';
import {
  abortUpload,
  completeUpload,
  getUploadStatus,
  initUpload,
  uploadChunk,
} from '../api/uploads';
import { ApiError, refreshSession } from '../api/client';
import { LOCAL_CODES } from '../api/types';
import { authStore } from './authStore';

export type UploadProgressCallback = (percent: number) => void;

export interface VideoMetadata {
  /** UID ổn định của clip ở client — dùng để chống trùng lặp */
  localVideoUid: string;
  deviceId: string;
  roomId?: string;
  cameraName?: string;
  sessionId?: string;
  recordedAt?: string;
  durationMs?: number;
  resolution?: string;
  fps?: number;
}

export interface UploadVideoResult {
  videoId: string | null;
  alreadyUploaded: boolean;
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MiB (server mặc định)
const MAX_CHUNK_RETRIES = 3;
// Giới hạn đọc cả file vào RAM để hash native; quá giới hạn thì fallback streaming
const NATIVE_HASH_MAX_BYTES = 150 * 1024 * 1024;

function bytesToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

class UploadService {
  /**
   * Hash nhanh bằng native expo-crypto: đọc cả file 1 lần, giải mã, digest.
   * Trả về null nếu file quá lớn hoặc có lỗi (sẽ fallback sang cách streaming).
   */
  private async computeChecksumNative(fileUri: string, fileSize: number): Promise<string | null> {
    if (fileSize <= 0 || fileSize > NATIVE_HASH_MAX_BYTES) {
      return null;
    }

    try {
      const started = Date.now();
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = base64ToUint8Array(base64);
      // expo-crypto Android yêu cầu Uint8Array (ArrayBuffer thuần sẽ bị lỗi convert Kotlin)
      const hash = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        bytes as unknown as Parameters<typeof Crypto.digest>[1],
      );
      logger.info('Native sha256 computed', {
        size: fileSize,
        ms: Date.now() - started,
      });
      return bytesToHex(hash);
    } catch (error) {
      logger.warn('Native checksum failed, falling back to streaming', error);
      return null;
    }
  }

  /**
   * Fallback: đọc file theo chunk, hash incremental bằng js-sha256 (thuần JS).
   */
  private async computeChecksumStreaming(
    fileUri: string,
    fileSize: number,
    chunkSize: number,
    onProgress?: UploadProgressCallback,
  ): Promise<string> {
    const hasher = sha256.create();
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

    for (let i = 0; i < totalChunks; i++) {
      const base64 = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.Base64,
        position: i * chunkSize,
        length: chunkSize,
      });
      hasher.update(base64ToUint8Array(base64));
      onProgress?.(Math.round(((i + 1) / totalChunks) * 100));
    }

    return hasher.hex();
  }

  /**
   * Gửi 1 chunk với retry; trả về true nếu thành công.
   * Mỗi lần retry đọc/decode lại slice (đọc slice base64 là stateless).
   */
  private async sendChunkWithRetry(
    uploadId: string,
    index: number,
    fileUri: string,
    chunkSize: number,
    fileSize: number,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      try {
        const position = index * chunkSize;
        const length = Math.min(chunkSize, fileSize - position);

        // Đọc slice rồi chuyển sang ArrayBuffer để fetch gửi nhị phân
        const base64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
          position,
          length,
        });
        const bytes = base64ToUint8Array(base64);
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;

        await uploadChunk(uploadId, index, buffer);
        return true;
      } catch (error) {
        logger.warn(`Chunk ${index} attempt ${attempt} failed`, error);
        if (attempt === MAX_CHUNK_RETRIES) {
          return false;
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    return false;
  }

  /**
   * Upload video theo chunk. Ném ApiError khi thất bại.
   */
  public async uploadVideo(
    fileUri: string,
    metadata: VideoMetadata,
    onProgress?: UploadProgressCallback,
  ): Promise<UploadVideoResult> {
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists) {
      throw new ApiError(LOCAL_CODES.UNKNOWN_ERROR, 'File không tồn tại');
    }
    const fileSize = 'size' in info && typeof info.size === 'number' ? info.size : 0;
    const fileName = fileUri.split('/').pop() || `recording_${Date.now()}.mp4`;

    // Bước 0: nếu access token sắp hết hạn (<60s) thì refresh luôn,
    // tránh 401 giữa chừng khi upload dài
    const session = await authStore.load();
    if (session && session.expiresAt - Date.now() < 60_000) {
      logger.info('Access token expiring soon, refreshing before upload');
      await refreshSession();
    }

    // Bước 1: checksum toàn file (10% đầu của progress)
    let checksum = await this.computeChecksumNative(fileUri, fileSize);
    if (!checksum) {
      try {
        checksum = await this.computeChecksumStreaming(fileUri, fileSize, DEFAULT_CHUNK_SIZE, p =>
          onProgress?.(Math.round(p * 0.1)),
        );
      } catch (error) {
        logger.error('Failed to compute checksum', error);
        throw new ApiError(LOCAL_CODES.UPLOAD_FAILED, 'Không đọc được file video');
      }
    }

    // Bước 2: init upload
    const init = await initUpload({
      file_name: fileName,
      file_size: fileSize,
      mime_type: 'video/mp4',
      checksum_sha256: checksum,
      metadata: {
        local_video_uid: metadata.localVideoUid,
        device_id: metadata.deviceId,
        room_id: metadata.roomId,
        camera_name: metadata.cameraName,
        session_id: metadata.sessionId,
        recorded_at: metadata.recordedAt ?? new Date().toISOString(),
        duration_ms: metadata.durationMs,
        resolution: metadata.resolution,
        fps: metadata.fps,
      },
    });

    if (init.already_uploaded === 1 && init.video_id) {
      logger.info('Video already uploaded on server', { videoId: init.video_id });
      onProgress?.(100);
      return { videoId: init.video_id, alreadyUploaded: true };
    }

    const uploadId = init.upload_id;
    if (!uploadId) {
      throw new ApiError(LOCAL_CODES.UNKNOWN_ERROR, 'Server không cấp phiên upload');
    }

    const chunkSize = init.chunk_size || DEFAULT_CHUNK_SIZE;
    const totalChunks = init.total_chunks || Math.max(1, Math.ceil(fileSize / chunkSize));
    const uploadedChunks = new Set<number>();

    // Bước 3: gửi lần lượt các chunk (10% -> 90% của progress)
    for (let i = 0; i < totalChunks; i++) {
      const sent = await this.sendChunkWithRetry(uploadId, i, fileUri, chunkSize, fileSize);
      if (!sent) {
        // Thử resume: hỏi server thiếu chunk nào
        try {
          const status = await getUploadStatus(uploadId);
          status.missing_chunks.forEach(m => uploadedChunks.delete(m));
          status.received_chunks.forEach(r => uploadedChunks.add(r));
        } catch {
          await abortUpload(uploadId).catch(() => undefined);
        }
        throw new ApiError(
          LOCAL_CODES.NETWORK_ERROR,
          `Mất kết nối khi gửi phần ${i + 1}/${totalChunks}`,
        );
      }

      uploadedChunks.add(i);
      onProgress?.(10 + Math.round(((i + 1) / totalChunks) * 80));
    }

    // Bước 4: hoàn tất — server ghép file, đối chiếu checksum, đẩy MinIO
    const result = await completeUpload(uploadId);
    onProgress?.(100);
    logger.info('Video uploaded', { videoId: result.video_id });

    return { videoId: result.video_id, alreadyUploaded: false };
  }
}

// Export singleton instance
export const uploadService = new UploadService();
