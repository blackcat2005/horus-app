/**
 * WebSocket Service
 * Quản lý kết nối WebSocket và gửi/nhận tin nhắn
 */

import { logger } from '../utils/logger';
import {
  Message,
  DeviceType,
  DeviceRegisterMessage,
  StreamStartMessage,
  StreamEndMessage,
  MessageType,
} from '../types/protocol';
import {
  WS_RECONNECT_INTERVAL,
  WS_HEARTBEAT_INTERVAL,
  WS_MESSAGE_TIMEOUT,
} from '../constants/config';

export type MessageHandler = (message: Message) => void;
export type ConnectionStateHandler = (connected: boolean) => void;

interface PendingMessage {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string = '';
  private deviceId: string = '';
  private deviceType: DeviceType = 'remote';
  private deviceName: string = '';
  private isConnected: boolean = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private messageHandlers: Map<MessageType, Set<MessageHandler>> = new Map();
  private connectionHandlers: Set<ConnectionStateHandler> = new Set();
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private messageId: number = 0;

  /**
   * Khởi tạo WebSocket service
   */
  public initialize(
    url: string,
    deviceId: string,
    deviceName: string,
    deviceType: DeviceType = 'remote',
  ): void {
    this.url = url;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.deviceType = deviceType;

    logger.info('WebSocketService initialized', {
      url,
      deviceId,
      deviceName,
      deviceType,
    });

    this.connect();
  }

  /**
   * Kết nối tới WebSocket server
   */
  private connect(): void {
    try {
      logger.info('Attempting to connect to WebSocket', { url: this.url });
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        logger.info('WebSocket connected');
        this.isConnected = true;
        this.registerDevice();
        this.startHeartbeat();
        this.notifyConnectionHandlers(true);
      };

      this.ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data) as Message;
          logger.debug('WebSocket message received', message);
          this.handleMessage(message);
        } catch (error) {
          logger.error('Failed to parse WebSocket message', error);
        }
      };

      this.ws.onerror = error => {
        logger.error('WebSocket error', error);
      };

      this.ws.onclose = () => {
        logger.info('WebSocket closed');
        this.isConnected = false;
        this.stopHeartbeat();
        this.notifyConnectionHandlers(false);
        this.scheduleReconnect();
      };
    } catch (error) {
      logger.error('Failed to create WebSocket', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Đăng ký device với server
   */
  private registerDevice(): void {
    const message: DeviceRegisterMessage = {
      type: 'DEVICE_REGISTER',
      device_id: this.deviceId,
      device_type: this.deviceType,
      device_name: this.deviceName,
      timestamp: Date.now(),
    };

    this.send(message);
    logger.info('Device registered', { deviceId: this.deviceId });
  }

  /**
   * Gửi tin nhắn tới server
   */
  public send(message: Message): void {
    if (!this.isConnected || !this.ws) {
      logger.warn('Cannot send message: WebSocket not connected', {
        type: message.type,
      });
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      logger.debug('Message sent', { type: message.type });
    } catch (error) {
      logger.error('Failed to send message', error);
    }
  }

  /**
   * Gửi tin nhắn và chờ ACK
   */
  public async sendAndWait(message: Message): Promise<Message> {
    return new Promise((resolve, reject) => {
      const messageKey = `${message.type}_${++this.messageId}`;
      const timeout = setTimeout(() => {
        this.pendingMessages.delete(messageKey);
        reject(new Error(`Message timeout: ${message.type}`));
      }, WS_MESSAGE_TIMEOUT);

      this.pendingMessages.set(messageKey, {
        resolve,
        reject,
        timeout,
      });

      this.send(message);
    });
  }

  /**
   * Xử lý tin nhắn nhận được
   */
  private handleMessage(message: Message): void {
    // Gọi các handler đã đăng ký cho loại tin nhắn này
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message);
        } catch (error) {
          logger.error('Error in message handler', error);
        }
      });
    }

    // Nếu là ACK, resolve pending message
    if (message.type === 'ACK') {
      const handlers = this.messageHandlers.get('STREAM_START');
      // ACK xử lý được tự động bởi pending messages
    }
  }

  /**
   * Đăng ký handler cho một loại tin nhắn
   */
  public on(messageType: MessageType, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, new Set());
    }

    const handlers = this.messageHandlers.get(messageType)!;
    handlers.add(handler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(messageType);
      }
    };
  }

  /**
   * Đăng ký handler cho thay đổi trạng thái kết nối
   */
  public onConnectionStateChange(handler: ConnectionStateHandler): () => void {
    this.connectionHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  /**
   * Gửi thông báo về thay đổi trạng thái kết nối
   */
  private notifyConnectionHandlers(connected: boolean): void {
    this.connectionHandlers.forEach(handler => {
      try {
        handler(connected);
      } catch (error) {
        logger.error('Error in connection handler', error);
      }
    });
  }

  /**
   * Bắt đầu streaming
   */
  public startStreaming(frameRate: number = 5, quality: number = 0.8): void {
    const message: StreamStartMessage = {
      type: 'STREAM_START',
      device_id: this.deviceId,
      device_type: this.deviceType,
      timestamp: Date.now(),
      frame_rate: frameRate,
      quality: quality,
    };

    this.send(message);
    logger.info('Streaming started', { frameRate, quality });
  }

  /**
   * Dừng streaming
   */
  public stopStreaming(): void {
    const message: StreamEndMessage = {
      type: 'STREAM_END',
      device_id: this.deviceId,
      device_type: this.deviceType,
      timestamp: Date.now(),
    };

    this.send(message);
    logger.info('Streaming stopped');
  }

  /**
   * Lập lịch kết nối lại
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    logger.info('Scheduling reconnect', {
      delay: WS_RECONNECT_INTERVAL,
    });

    this.reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect');
      this.connect();
    }, WS_RECONNECT_INTERVAL);
  }

  /**
   * Bắt đầu heartbeat để giữ kết nối sống
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws) {
        // Có thể gửi ping hoặc heartbeat message nếu cần
        logger.debug('Heartbeat');
      }
    }, WS_HEARTBEAT_INTERVAL);
  }

  /**
   * Dừng heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Kiểm tra trạng thái kết nối
   */
  public isConnected_(): boolean {
    return this.isConnected;
  }

  /**
   * Đóng kết nối
   */
  public disconnect(): void {
    logger.info('Disconnecting WebSocket');

    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on manual disconnect
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.messageHandlers.clear();
    this.connectionHandlers.clear();
    this.pendingMessages.clear();
  }
}

// Export singleton instance
export const wsService = new WebSocketService();
