/**
 * Devices API
 * POST /devices (register) | GET /devices (list)
 */

import { apiRequest } from './client';
import { DeviceInfo } from './types';

export interface RegisterDevicePayload {
  device_id: string;
  device_type: 1 | 2 | 3 | 4;
  device_name: string;
  model?: string;
  os_version?: string;
  capabilities?: string[];
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
