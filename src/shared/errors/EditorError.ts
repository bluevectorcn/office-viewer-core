/**
 * 编辑器错误码枚举
 */
export enum ErrorCode {
  // 文档操作错误
  OPEN_FAILED = 'OPEN_FAILED',
  SAVE_FAILED = 'SAVE_FAILED',
  EXPORT_FAILED = 'EXPORT_FAILED',
  CONVERSION_FAILED = 'CONVERSION_FAILED',

  // 资源错误
  RESOURCE_DISPOSED = 'RESOURCE_DISPOSED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',

  // 会话错误
  NO_SESSION = 'NO_SESSION',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // 状态错误
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
  INVALID_OPERATION = 'INVALID_OPERATION',

  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',

  // X2T 错误
  X2T_INIT_FAILED = 'X2T_INIT_FAILED',
  X2T_CONVERSION_FAILED = 'X2T_CONVERSION_FAILED',

  // 配置错误
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_DEPENDENCY = 'MISSING_DEPENDENCY'
}

/**
 * 统一的编辑器错误类
 *
 * @example
 * ```typescript
 * throw new EditorError(
 *   ErrorCode.OPEN_FAILED,
 *   'Failed to open document',
 *   originalError
 * );
 * ```
 */
export class EditorError extends Error {
  /**
   * @param code - 错误码
   * @param message - 错误消息
   * @param cause - 原始错误对象（可选）
   * @param context - 额外的上下文信息（可选）
   */
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EditorError';

    // 保持原型链正确（TypeScript 继承 Error 的问题）
    Object.setPrototypeOf(this, EditorError.prototype);
  }

  /**
   * 将错误转换为 JSON 格式
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause instanceof Error ? {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack
      } : this.cause,
      context: this.context,
      stack: this.stack
    };
  }

  /**
   * 判断是否为特定错误码
   */
  is(code: ErrorCode): boolean {
    return this.code === code;
  }

  /**
   * 创建错误的工厂方法
   */
  static create(
    code: ErrorCode,
    message: string,
    cause?: unknown,
    context?: Record<string, unknown>
  ): EditorError {
    return new EditorError(code, message, cause, context);
  }

  /**
   * 从未知错误转换为 EditorError
   */
  static from(error: unknown, code: ErrorCode, defaultMessage: string): EditorError {
    if (error instanceof EditorError) {
      return error;
    }

    const message = error instanceof Error ? error.message : defaultMessage;
    return new EditorError(code, message, error);
  }
}
