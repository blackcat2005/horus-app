/**
 * Logging Utility
 */

import { LOG_LEVEL, LOG_PREFIX } from '../constants/config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isLogLevelEnabled = (level: LogLevel): boolean => {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  return levels[level] >= levels[LOG_LEVEL as LogLevel];
};

export const logger = {
  debug: (message: string, data?: any) => {
    if (isLogLevelEnabled('debug')) {
      console.log(`${LOG_PREFIX} [DEBUG]`, message, data ?? '');
    }
  },
  info: (message: string, data?: any) => {
    if (isLogLevelEnabled('info')) {
      console.log(`${LOG_PREFIX} [INFO]`, message, data ?? '');
    }
  },
  warn: (message: string, data?: any) => {
    if (isLogLevelEnabled('warn')) {
      console.warn(`${LOG_PREFIX} [WARN]`, message, data ?? '');
    }
  },
  error: (message: string, error?: any) => {
    if (isLogLevelEnabled('error')) {
      console.error(`${LOG_PREFIX} [ERROR]`, message, error ?? '');
    }
  },
};
