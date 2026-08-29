/**
 * Application Configuration Constants
 */

// WebSocket Configuration
// ENABLE_SOCKET cho live WS base64 tới server demo 3333 (chạy được trên Expo Go, không cần webrtc)
export const ENABLE_SOCKET = true;
// LIVE_WS_PORT riêng cho server demo cũ (3333) — khác API port 3000 của multicam-server
export const LIVE_WS_PORT = '3333';
export const WS_RECONNECT_INTERVAL = 3000; // ms
export const WS_HEARTBEAT_INTERVAL = 30000; // ms
export const WS_MESSAGE_TIMEOUT = 10000; // ms

// Polling intervals theo Docs (next_sync_in 3s khi recording, 5s khi idle)
export const DEVICE_SYNC_INTERVAL_IDLE = 5000;
export const DEVICE_SYNC_INTERVAL_RECORDING = 3000;
export const ROOM_SYNC_INTERVAL_IDLE = 5000;
export const ROOM_SYNC_INTERVAL_RECORDING = 3000;

// Mediasoup preview defaults
export const DEFAULT_PREVIEW_QUALITY: 'low' | 'medium' = 'low';
export const DEFAULT_PREVIEW_PROTOCOL: 'hls' | 'webrtc' = 'webrtc';

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
