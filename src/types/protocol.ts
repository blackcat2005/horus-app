/**
 * Message Protocol Types
 * Định nghĩa các kiểu tin nhắn được gửi qua WebSocket
 */

export type DeviceType = 'controller' | 'remote';
export type MessageType =
  | 'DEVICE_REGISTER'
  | 'STREAM_START'
  | 'STREAM_FRAME'
  | 'STREAM_END'
  | 'RECORD_START'
  | 'RECORD_END'
  | 'COMMAND'
  | 'DEVICE_LIST'
  | 'ACK'
  | 'ERROR';

/**
 * Base message structure - tất cả tin nhắn đều tuân theo cấu trúc này
 */
export interface BaseMessage {
  type: MessageType;
  device_id: string;
  device_type: DeviceType;
  timestamp: number;
  [key: string]: any;
}

/**
 * Device registration message
 * Remote hoặc controller gửi khi kết nối để đăng ký device
 */
export interface DeviceRegisterMessage extends BaseMessage {
  type: 'DEVICE_REGISTER';
  device_name: string;
  device_model?: string;
}

/**
 * Stream start command
 * Controller gửi tới remote để bắt đầu streaming
 */
export interface StreamStartMessage extends BaseMessage {
  type: 'STREAM_START';
  frame_rate?: number; // fps, default 5
  quality?: number; // 0-1, default 0.8
}

/**
 * Stream frame message
 * Remote gửi frame video tới server
 */
export interface StreamFrameMessage extends BaseMessage {
  type: 'STREAM_FRAME';
  frame_data: string; // base64 encoded JPEG
  frame_width: number;
  frame_height: number;
  frame_index: number;
}

/**
 * Stream end command
 * Controller gửi tới remote để dừng streaming
 */
export interface StreamEndMessage extends BaseMessage {
  type: 'STREAM_END';
}

/**
 * Video record command
 * Controller gửi tới remote để bắt đầu/dừng quay video thật (mp4)
 */
export interface RecordStartMessage extends BaseMessage {
  type: 'RECORD_START';
  max_duration?: number; // giây, default 60
}

export interface RecordEndMessage extends BaseMessage {
  type: 'RECORD_END';
}

/**
 * Generic command message
 * Gửi các lệnh kiểm soát khác
 */
export interface CommandMessage extends BaseMessage {
  type: 'COMMAND';
  command: string;
  parameters?: Record<string, any>;
}

/**
 * Device list response
 * Server gửi danh sách các device đang kết nối
 */
export interface DeviceListMessage extends BaseMessage {
  type: 'DEVICE_LIST';
  devices: Array<{
    device_id: string;
    device_name: string;
    device_type: DeviceType;
    connected_at: number;
  }>;
}

/**
 * Acknowledgement message
 * Xác nhận nhận được tin nhắn
 */
export interface AckMessage extends BaseMessage {
  type: 'ACK';
  reference_type: MessageType;
}

/**
 * Error message
 * Thông báo lỗi
 */
export interface ErrorMessage extends BaseMessage {
  type: 'ERROR';
  error_code: string;
  error_message: string;
}

/**
 * Union type cho tất cả các message types
 */
export type Message =
  | DeviceRegisterMessage
  | StreamStartMessage
  | StreamFrameMessage
  | StreamEndMessage
  | RecordStartMessage
  | RecordEndMessage
  | CommandMessage
  | DeviceListMessage
  | AckMessage
  | ErrorMessage;

/**
 * Device registry entry - lưu thông tin về device khi đã kết nối
 */
export interface DeviceRegistry {
  device_id: string;
  device_name: string;
  device_type: DeviceType;
  connected_at: number;
  last_seen: number;
  is_streaming?: boolean;
}
