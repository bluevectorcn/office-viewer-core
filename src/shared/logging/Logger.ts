/**
 * 日志级别
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志条目
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  editorId?: string;
  prefix?: string;
}

/**
 * 日志处理器
 */
export type LogHandler = (entry: LogEntry) => void;

/**
 * Logger 配置
 */
export interface LoggerConfig {
  /** 最低日志级别 */
  minLevel?: LogLevel;
  /** 日志前缀 */
  prefix?: string;
  /** 编辑器 ID */
  editorId?: string;
  /** 是否启用控制台输出 */
  enableConsole?: boolean;
}

/**
 * 日志级别优先级
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * 结构化日志系统
 *
 * @example
 * ```typescript
 * const logger = new Logger({
 *   prefix: '[Editor]',
 *   editorId: 'editor-123',
 *   minLevel: 'info'
 * });
 *
 * logger.info('Document opened', { docId: 'doc-456', size: 1024 });
 * logger.error('Failed to save', new Error('Network error'));
 *
 * // 添加自定义处理器
 * logger.onLog((entry) => {
 *   sendToAnalytics(entry);
 * });
 * ```
 */
export class Logger {
  private handlers = new Set<LogHandler>();
  private config: Required<LoggerConfig>;

  constructor(config: LoggerConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? 'debug',
      prefix: config.prefix ?? '',
      editorId: config.editorId ?? '',
      enableConsole: config.enableConsole ?? true
    };

    // 默认添加控制台处理器
    if (this.config.enableConsole) {
      this.handlers.add(this.consoleHandler);
    }
  }

  /**
   * 记录调试信息
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log('debug', message, metadata);
  }

  /**
   * 记录一般信息
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log('info', message, metadata);
  }

  /**
   * 记录警告
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log('warn', message, metadata);
  }

  /**
   * 记录错误
   */
  error(message: string, error?: unknown): void {
    const metadata: Record<string, unknown> = {};

    if (error instanceof Error) {
      metadata.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    } else if (error !== undefined) {
      metadata.error = error;
    }

    this.log('error', message, metadata);
  }

  /**
   * 内部日志方法
   */
  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    // 检查日志级别
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      metadata,
      editorId: this.config.editorId,
      prefix: this.config.prefix
    };

    // 调用所有处理器
    for (const handler of this.handlers) {
      try {
        handler(entry);
      } catch (error) {
        // 忽略处理器错误，防止日志系统本身崩溃
        console.error('Log handler error:', error);
      }
    }
  }

  /**
   * 检查日志级别是否启用
   */
  private isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel];
  }

  /**
   * 添加日志处理器
   *
   * @returns 返回一个函数，调用后移除该处理器
   */
  onLog(handler: LogHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * 移除所有处理器
   */
  clearHandlers(): void {
    this.handlers.clear();
  }

  /**
   * 创建子 Logger（继承配置）
   */
  createChild(config: Partial<LoggerConfig> = {}): Logger {
    return new Logger({
      minLevel: config.minLevel ?? this.config.minLevel,
      prefix: config.prefix ?? this.config.prefix,
      editorId: config.editorId ?? this.config.editorId,
      enableConsole: false // 子 Logger 不自动添加控制台处理器
    });
  }

  /**
   * 默认控制台处理器
   */
  private consoleHandler: LogHandler = (entry) => {
    const prefix = entry.prefix ? `${entry.prefix} ` : '';
    const editorId = entry.editorId ? `[${entry.editorId}] ` : '';
    const timestamp = new Date(entry.timestamp).toISOString();
    const fullMessage = `${timestamp} ${prefix}${editorId}${entry.message}`;

    switch (entry.level) {
      case 'debug':
        console.debug(fullMessage, entry.metadata ?? '');
        break;
      case 'info':
        console.info(fullMessage, entry.metadata ?? '');
        break;
      case 'warn':
        console.warn(fullMessage, entry.metadata ?? '');
        break;
      case 'error':
        console.error(fullMessage, entry.metadata ?? '');
        break;
    }
  };
}

/**
 * 全局默认 Logger 实例
 */
export const defaultLogger = new Logger({
  prefix: '[OnlyOffice]'
});
