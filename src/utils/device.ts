/**
 * Device ID Utility
 * Lưu deviceId cố định trong AsyncStorage để mọi file chụp/quay nằm chung 1 thư mục Minio
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

const DEVICE_ID_KEY = 'app_device_id';

const generateDeviceId = (): string =>
  `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const deviceIdPromise: Promise<string> = (async () => {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      logger.info('Loaded existing deviceId', { deviceId: stored });
      return stored;
    }
  } catch (error) {
    logger.error('Failed to read deviceId from storage', error);
  }

  const newId = generateDeviceId();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    logger.info('Generated new deviceId', { deviceId: newId });
  } catch (error) {
    logger.error('Failed to persist deviceId', error);
  }

  return newId;
})();

/**
 * Lấy deviceId cố định (async, một lần duy nhất)
 */
export function getDeviceId(): Promise<string> {
  return deviceIdPromise;
}
