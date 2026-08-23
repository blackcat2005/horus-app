/**
 * Videos API — thư viện video
 * GET /videos | GET /videos/:id | PUT /videos/:id | DELETE /videos/:id
 * POST /videos/bulk-delete | POST /videos/check-uploaded
 * GET /videos/:id/download (chỉ Controller)
 */

import { apiRequest } from './client';
import { CheckUploadedItem, DownloadUrlData, ServerVideo, VideoDetail } from './types';

export interface ListVideosParams {
  index?: number;
  count?: number;
  session_id?: string;
  device_id?: string;
  sort?: 'created_at_desc' | 'created_at_asc';
}

export async function listVideos(
  params: ListVideosParams = {},
): Promise<{ videos: ServerVideo[]; total: number }> {
  const query = new URLSearchParams();
  if (params.index !== undefined) query.set('index', String(params.index));
  if (params.count !== undefined) query.set('count', String(params.count));
  if (params.session_id) query.set('session_id', params.session_id);
  if (params.device_id) query.set('device_id', params.device_id);
  if (params.sort) query.set('sort', params.sort);

  const qs = query.toString();
  return apiRequest(`/videos${qs ? `?${qs}` : ''}`);
}

export async function getVideo(videoId: string): Promise<VideoDetail> {
  return apiRequest(`/videos/${videoId}`);
}

export async function updateVideo(
  videoId: string,
  payload: { name?: string; description?: string },
): Promise<{ id: string; name: string; description: string | null; updated_at: string }> {
  return apiRequest(`/videos/${videoId}`, { method: 'PUT', body: payload });
}

export async function deleteVideo(videoId: string): Promise<{ deleted_at: string }> {
  return apiRequest(`/videos/${videoId}`, { method: 'DELETE' });
}

export async function bulkDeleteVideos(
  videoIds: string[],
): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }> {
  return apiRequest('/videos/bulk-delete', { method: 'POST', body: { video_ids: videoIds } });
}

export async function checkUploaded(
  items: {
    local_video_uid: string;
    checksum_sha256: string;
    file_size: number;
  }[],
): Promise<{ items: CheckUploadedItem[] }> {
  return apiRequest('/videos/check-uploaded', { method: 'POST', body: { items } });
}

/** Chỉ tài khoản Controller gọi được */
export async function getDownloadUrl(videoId: string): Promise<DownloadUrlData> {
  return apiRequest(`/videos/${videoId}/download`);
}
