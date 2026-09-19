/**
 * Devices API — khớp API Docs v1.md
 * POST /devices (register) | GET /devices (list)
 * PUT /devices/:id (set_device_config) | DELETE /devices/:id (delete_device)
 * PUT /devices/:id/push-token (set_devtoken) | POST /devices/:id/sync (sync_device)
 */

import { apiRequest } from './client';
import { DeviceInfo } from './types';

export interface RegisterDevicePayload {
  device_id: string;
  device_type: 1 | 2 | 3 | 4;
  device_name: string;
  model?: string;
  os_version?: string;
  capabilities?: Record<string, unknown> | string[];
}

export async function registerDevice(payload: RegisterDevicePayload): Promise<{
  device_id: string;
  device_name: string;
  account_role: string;
  remote_control_enabled: number;
  registered_at: string;
}> {
  return apiRequest('/devices', { method: 'POST', body: payload });
}

export async function listDevices(): Promise<{ devices: DeviceInfo[]; total: number }> {
  return apiRequest('/devices');
}

// ── set_device_config ──
export interface SetDeviceConfigPayload {
  remote_control_enabled?: 0 | 1;
  camera_name?: string;
}

export async function setDeviceConfig(
  deviceId: string,
  payload: SetDeviceConfigPayload,
): Promise<{ device_id: string; remote_control_enabled: number; camera_name: string | null }> {
  return apiRequest(`/devices/${deviceId}`, { method: 'PUT', body: payload });
}

// ── delete_device ──
export async function deleteDevice(deviceId: string): Promise<Record<string, never>> {
  return apiRequest(`/devices/${deviceId}`, { method: 'DELETE' });
}

// ── set_devtoken ──
export async function setDevToken(
  deviceId: string,
  payload: { devtype: 1 | 2; devtoken: string },
): Promise<Record<string, never>> {
  return apiRequest(`/devices/${deviceId}/push-token`, { method: 'PUT', body: payload });
}

// ── sync_device: polling 3-5s, trả về pending_commands ──
export interface SyncDevicePayload {
  battery_level?: number;
  is_charging?: 0 | 1;
  storage_free?: number;
  temperature_state?: string;
  recording_state?: string;
  elapsed_ms?: number;
  upload_state?: string;
  upload_percent?: number;
  error_code?: string | null;
  last_command_id?: string;
}

export interface PendingCommand {
  command_id: string;
  type: 'start_record' | 'stop_record' | 'camera_config' | 'leave_room' | 'join_approved';
  payload: Record<string, unknown>;
  issued_at: string;
}

export interface SyncDeviceData {
  server_time: string;
  next_sync_in: number;
  room_status: { in_room: 0 | 1; room_id: string | null; session_id: string | null };
  pending_commands: PendingCommand[];
  session_revoked: 0 | 1;
}

export async function syncDevice(
  deviceId: string,
  payload: SyncDevicePayload,
): Promise<SyncDeviceData> {
  return apiRequest(`/devices/${deviceId}/sync`, { method: 'POST', body: payload });
}
