/**
 * Uploads API — upload video theo chunk (init -> chunks -> complete)
 * POST /videos/uploads | PUT /videos/uploads/:id/chunks/:index
 * GET /videos/uploads/:id | POST /videos/uploads/:id/complete | DELETE /videos/uploads/:id
 */

import { apiRequest } from './client';
import {
  CompleteUploadData,
  InitUploadData,
  InitUploadPayload,
  UploadChunkData,
  UploadStatusData,
} from './types';

export async function initUpload(payload: InitUploadPayload): Promise<InitUploadData> {
  return apiRequest('/videos/uploads', { method: 'POST', body: payload });
}

/**
 * Gửi 1 chunk nhị phân (application/octet-stream).
 * checksumHex: sha256 của riêng mảnh (tùy chọn, server đối chiếu nếu có).
 */
export async function uploadChunk(
  uploadId: string,
  index: number,
  bytes: ArrayBuffer,
  checksumHex?: string,
): Promise<UploadChunkData> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (checksumHex) {
    headers['chunk-checksum'] = checksumHex;
  }
  return apiRequest(`/videos/uploads/${uploadId}/chunks/${index}`, {
    method: 'PUT',
    body: bytes,
    headers,
    timeoutMs: 120000,
  });
}

export async function getUploadStatus(uploadId: string): Promise<UploadStatusData> {
  return apiRequest(`/videos/uploads/${uploadId}`);
}

export async function completeUpload(uploadId: string): Promise<CompleteUploadData> {
  return apiRequest(`/videos/uploads/${uploadId}/complete`, { method: 'POST' });
}

export async function abortUpload(uploadId: string): Promise<unknown> {
  return apiRequest(`/videos/uploads/${uploadId}`, { method: 'DELETE' });
}
