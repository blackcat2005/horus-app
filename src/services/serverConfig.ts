/**
 * Server Config Service
 * Lưu host/port của server trong AsyncStorage để không phải sửa app.json mỗi lần.
 * Có fallback về giá trị trong app.json (extra.wsHost / extra.wsPort).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { logger } from '../utils/logger';

export interface ServerConfig {
  host: string;
  port: string;
}

/** Phòng "mở trên LAN" chọn từ màn đăng nhập — Remote join mà không cần gõ mã. */
export interface LanRoom {
  room_id: string | null;
  room_name: string | null;
  invite_code: string;
  auto_approve: number;
  member_count?: number;
}

const STORAGE_KEY = 'server_config';
const LAN_ROOM_KEY = 'lan_room';

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  host: Constants.expoConfig?.extra?.wsHost ?? '192.168.1.101',
  port: Constants.expoConfig?.extra?.wsPort ?? '3000',
};

type Listener = (config: ServerConfig) => void;

class ServerConfigService {
  private config: ServerConfig | null = null;
  private listeners = new Set<Listener>();

  /**
   * Nạp cấu hình server: ưu tiên giá trị đã lưu trong AsyncStorage,
   * fallback về DEFAULT_SERVER_CONFIG. Kết quả được cache.
   */
  public async load(): Promise<ServerConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.config = {
          host: String(parsed.host || DEFAULT_SERVER_CONFIG.host),
          port: String(parsed.port || DEFAULT_SERVER_CONFIG.port),
        };
        logger.info('Server config loaded from storage', this.config);
        return this.config;
      }
    } catch (error) {
      logger.error('Failed to load server config', error);
    }

    this.config = { ...DEFAULT_SERVER_CONFIG };
    logger.info('Server config using default', this.config);
    return this.config;
  }

  /**
   * Lưu cấu hình mới và thông báo cho các component đang lắng nghe.
   */
  public async save(host: string, port: string): Promise<ServerConfig> {
    const next: ServerConfig = {
      host: host.trim(),
      port: port.trim(),
    };
    this.config = next;

    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      logger.info('Server config saved', next);
    } catch (error) {
      logger.error('Failed to save server config', error);
    }

    this.listeners.forEach(listener => {
      try {
        listener(next);
      } catch (error) {
        logger.error('Error in server config listener', error);
      }
    });

    return next;
  }

  /**
   * Đăng ký lắng nghe khi cấu hình thay đổi. Trả về hàm hủy đăng ký.
   */
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public wsUrl(config: ServerConfig): string {
    return `ws://${config.host}:${config.port}`;
  }

  public liveWsUrl(config: ServerConfig): string {
    // Live WS base64 tới server demo 3333 — dùng host từ API config nhưng port LIVE_WS_PORT
    const livePort = (Constants.expoConfig?.extra as any)?.liveWsPort ?? '3333';
    return `ws://${config.host}:${livePort}`;
  }

  public httpUrl(config: ServerConfig): string {
    return `http://${config.host}:${config.port}`;
  }

  /**
   * Base URL của API v1 trên multicam-server
   */
  public apiUrl(config: ServerConfig): string {
    return `${this.httpUrl(config)}/it4788/api/v1`;
  }

  /** Lưu phòng LAN đã chọn để Remote tự join sau đăng nhập. */
  public async saveLanRoom(room: LanRoom): Promise<void> {
    try {
      await AsyncStorage.setItem(LAN_ROOM_KEY, JSON.stringify(room));
      logger.info('Lan room saved', room);
    } catch (error) {
      logger.error('Failed to save lan room', error);
    }
  }

  public async loadLanRoom(): Promise<LanRoom | null> {
    try {
      const raw = await AsyncStorage.getItem(LAN_ROOM_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LanRoom;
      return parsed?.invite_code ? parsed : null;
    } catch (error) {
      logger.error('Failed to load lan room', error);
      return null;
    }
  }

  public async clearLanRoom(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LAN_ROOM_KEY);
    } catch (error) {
      logger.error('Failed to clear lan room', error);
    }
  }
}

// Export singleton instance
export const serverConfigService = new ServerConfigService();
