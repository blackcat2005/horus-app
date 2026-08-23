/**
 * Auth API
 * POST /auth/login | /auth/refresh | /auth/logout
 */

import { apiRequest } from './client';
import { authStore } from '../services/authStore';
import { AuthData } from './types';

export interface LoginParams {
  /** Số điện thoại hoặc email */
  identifier: string;
  password: string;
  deviceId: string;
  deviceType: 1 | 2 | 3 | 4;
  deviceName: string;
}

const isPhone = (value: string): boolean => /^0\d{9}$/.test(value);

export async function login(params: LoginParams): Promise<AuthData> {
  const body: Record<string, unknown> = {
    password: params.password,
    device_id: params.deviceId,
    device_type: params.deviceType,
    device_name: params.deviceName,
  };
  if (isPhone(params.identifier.trim())) {
    body.phone = params.identifier.trim();
  } else {
    body.email = params.identifier.trim();
  }

  const data = await apiRequest<AuthData>('/auth/login', {
    method: 'POST',
    body,
    auth: false,
  });

  await authStore.setSession({
    user: data.user,
    accountRole: data.account_role,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 900) * 1000,
    deviceId: params.deviceId,
  });

  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch {
    // Dù server lỗi vẫn xóa phiên ở client
  }
  await authStore.clear();
}
