/**
 * Device Info — lấy model/OS của điện thoại thật (expo-device)
 * Dùng để khai báo device_name/model khi đăng ký và ghi vào metadata file quay.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export interface DeviceInfo {
  /** "Samsung SM-G991B" / "iPhone 14" — kết hợp brand + model */
  model: string;
  osVersion: string;
}

function normalizeModel(): string {
  try {
    const brand = (Device.brand ?? '').trim();
    const modelName = (Device.modelName ?? '').trim();
    if (!brand && !modelName) return '';
    return `${brand} ${modelName}`.trim();
  } catch {
    return '';
  }
}

export function getDeviceInfo(): DeviceInfo {
  return {
    model: normalizeModel() || Platform.select({ ios: 'iPhone', default: 'Android' }),
    osVersion: Device.osVersion ?? '',
  };
}