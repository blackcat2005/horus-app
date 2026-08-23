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

const STORAGE_KEY = 'server_config';

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

  public httpUrl(config: ServerConfig): string {
    return `http://${config.host}:${config.port}`;
  }

  /**
   * Base URL của API v1 trên multicam-server
   */
  public apiUrl(config: ServerConfig): string {
    return `${this.httpUrl(config)}/it4788/api/v1`;
  }
}

// Export singleton instance
export const serverConfigService = new ServerConfigService();
