/**
 * Application Configuration Constants
 */

// Camera Configuration
export const CAMERA_PHOTO_QUALITY = 0.8; // 0-1

// Video Recording Configuration
export const CAMERA_VIDEO_MAX_DURATION = 60; // giây tối đa cho một đoạn quay
export const CAMERA_VIDEO_MAX_FILE_SIZE = 1_000_000_000; // byte — dưới giới hạn 1 GiB của server

// Logging
export const LOG_LEVEL = __DEV__ ? 'debug' : 'info'; // 'debug', 'info', 'warn', 'error'
export const LOG_PREFIX = '[REMOTE_APP]';
