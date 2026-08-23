/**
 * Auth Store
 * Lưu phiên đăng nhập (token + user) trong AsyncStorage và phát thông báo khi thay đổi.
 * Chỉ quản lý trạng thái — mọi lời gọi mạng nằm ở src/api/*.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../utils/logger';
import { AccountRole, AuthUser } from '../api/types';

export interface AuthSession {
  user: AuthUser;
  accountRole: AccountRole;
  accessToken: string;
  refreshToken: string;
  /** Thời điểm hết hạn access token (epoch ms) */
  expiresAt: number;
  deviceId: string;
}

const SESSION_KEY = 'auth_session';

type Listener = (session: AuthSession | null) => void;

class AuthStoreService {
  private session: AuthSession | null = null;
  private loadPromise: Promise<AuthSession | null> | null = null;
  private listeners = new Set<Listener>();

  /**
   * Nạp phiên từ storage (chỉ đọc disk 1 lần).
   * Luôn trả về this.session hiện tại — nếu setSession/updateTokens đã chạy
   * thì trả về phiên mới, không phải kết quả đọc cũ bị cache.
   */
  public async load(): Promise<AuthSession | null> {
    if (this.session) {
      return this.session;
    }
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await AsyncStorage.getItem(SESSION_KEY);
          if (raw) {
            this.session = JSON.parse(raw) as AuthSession;
            logger.info('Auth session restored', {
              userId: this.session.user.id,
              role: this.session.accountRole,
            });
          }
        } catch (error) {
          logger.error('Failed to restore auth session', error);
        }
        return this.session;
      })();
    }
    await this.loadPromise;
    return this.session;
  }

  public getSessionSync(): AuthSession | null {
    return this.session;
  }

  public async setSession(session: AuthSession): Promise<void> {
    this.session = session;
    try {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (error) {
      logger.error('Failed to persist auth session', error);
    }
    this.notify();
  }

  /**
   * Cập nhật token sau khi refresh (giữ nguyên user/role)
   */
  public async updateTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): Promise<void> {
    if (!this.session) return;
    this.session = {
      ...this.session,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    try {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    } catch (error) {
      logger.error('Failed to persist refreshed tokens', error);
    }
  }

  public async clear(): Promise<void> {
    this.session = null;
    try {
      await AsyncStorage.removeItem(SESSION_KEY);
    } catch (error) {
      logger.error('Failed to clear auth session', error);
    }
    this.notify();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.session);
      } catch (error) {
        logger.error('Error in auth listener', error);
      }
    });
  }
}

export const authStore = new AuthStoreService();
