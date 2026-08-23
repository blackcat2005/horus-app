/**
 * Application Configuration Constants
 */

// WebSocket Configuration
// Tạm tắt socket (multicam-server v1 chưa có WS). Bật lại = true.
export const ENABLE_SOCKET = false;
export const WS_RECONNECT_INTERVAL = 3000; // ms
export const WS_HEARTBEAT_INTERVAL = 30000; // ms
export const WS_MESSAGE_TIMEOUT = 10000; // ms

// Camera Configuration
export const CAMERA_PHOTO_QUALITY = 0.8; // 0-1
export const CAMERA_PREVIEW_QUALITY = 0.6; // Lower quality for preview
export const DEFAULT_FRAME_RATE = 10; // fps for streaming
export const MAX_FRAME_RATE = 30; // Maximum allowed fps

// Video Recording Configuration
export const CAMERA_VIDEO_MAX_DURATION = 60; // giây tối đa cho một đoạn quay
export const VIDEO_UPLOAD_MAX_SIZE_MB = 50; // giới hạn body upload

// Video Streaming Configuration
export const FRAME_BUFFER_SIZE = 30; // Keep last N frames in memory
export const FRAME_BATCH_SIZE = 100; // Batch frames before uploading to Minio
export const FRAME_BATCH_TIMEOUT = 5000; // ms - upload frames every 5 seconds even if batch not full

// Frame Size Limits
export const MAX_FRAME_WIDTH = 1280;
export const MAX_FRAME_HEIGHT = 720;
export const MIN_FRAME_WIDTH = 320;
export const MIN_FRAME_HEIGHT = 240;

// Device Configuration
export const DEVICE_HEARTBEAT_TIMEOUT = 60000; // ms - consider device offline after 60s

// Logging
export const LOG_LEVEL = 'debug'; // 'debug', 'info', 'warn', 'error'
export const LOG_PREFIX = '[REMOTE_APP]';

// Storage
export const TEMP_PHOTO_DIRECTORY = 'expo-app-photos';
