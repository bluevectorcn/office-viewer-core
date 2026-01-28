import type { Disposable } from '@/shared/utils/Disposable';
import type { Logger } from '@/shared/logging/Logger';
import { EditorError, ErrorCode } from '@/shared/errors/EditorError';

/**
 * 上传会话
 */
interface UploadSession {
  chunks: Uint8Array[];
  createdAt: number;
  totalSize: number;
}

/**
 * 保存类型
 */
export type SaveType = 'first' | 'middle' | 'last' | 'single';

/**
 * 分块响应
 */
export interface ChunkResponse {
  saveKey?: string;
  data?: Uint8Array;
  status: 'ok' | 'error';
  message?: string;
}

/**
 * 分块上传器 - 管理分块保存会话
 *
 * 解决 saveSessions 内存泄漏问题：
 * 1. 自动超时清理（默认 5 分钟）
 * 2. finalize 后立即释放 chunks 数组
 * 3. 防止无限累积导致内存膨胀
 *
 * @example
 * ```typescript
 * const uploader = new ChunkedUploader(logger);
 *
 * // 开始新会话
 * await uploader.handleChunk('save-123', firstChunk, 'first');
 *
 * // 添加中间块
 * await uploader.handleChunk('save-123', chunk2, 'middle');
 * await uploader.handleChunk('save-123', chunk3, 'middle');
 *
 * // 完成会话，获取合并后的数据
 * const result = await uploader.handleChunk('save-123', lastChunk, 'last');
 * const merged = result.data; // Uint8Array
 * ```
 */
export class ChunkedUploader implements Disposable {
  private sessions = new Map<string, UploadSession>();
  private sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(
    private readonly logger: Logger,
    private readonly sessionTTL: number = 5 * 60 * 1000 // 默认 5 分钟
  ) {}

  /**
   * 处理分块数据
   */
  async handleChunk(
    saveKey: string,
    chunk: Uint8Array,
    type: SaveType
  ): Promise<ChunkResponse> {
    try {
      this.ensureNotDisposed();

      if (type === 'single') {
        return this.processSingleChunk(chunk);
      }

      if (type === 'first') {
        return this.startSession(saveKey, chunk);
      }

      const session = this.sessions.get(saveKey);
      if (!session) {
        throw new EditorError(
          ErrorCode.SESSION_NOT_FOUND,
          `Upload session not found: ${saveKey}`
        );
      }

      session.chunks.push(chunk);
      session.totalSize += chunk.byteLength;
      this.refreshTimeout(saveKey);

      if (type === 'last') {
        return await this.finalizeSession(saveKey);
      }

      return { saveKey, status: 'ok' };
    } catch (error) {
      this.logger.error('ChunkedUploader error', error);
      return {
        saveKey,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 处理单个完整块
   */
  private processSingleChunk(chunk: Uint8Array): ChunkResponse {
    return {
      data: chunk,
      status: 'ok'
    };
  }

  /**
   * 开始新会话
   */
  private startSession(saveKey: string, firstChunk: Uint8Array): ChunkResponse {
    // 如果已存在会话，先清理
    if (this.sessions.has(saveKey)) {
      this.clearSession(saveKey);
      this.logger.warn('Existing session replaced', { saveKey });
    }

    const session: UploadSession = {
      chunks: [firstChunk],
      createdAt: Date.now(),
      totalSize: firstChunk.byteLength
    };

    this.sessions.set(saveKey, session);
    this.setSessionTimeout(saveKey);

    this.logger.debug('Upload session started', {
      saveKey,
      chunkSize: firstChunk.byteLength
    });

    return { saveKey, status: 'ok' };
  }

  /**
   * 完成会话并返回合并后的数据
   */
  private async finalizeSession(saveKey: string): Promise<ChunkResponse> {
    const session = this.sessions.get(saveKey)!;
    this.clearSessionTimeout(saveKey);

    try {
      const merged = this.mergeChunks(session.chunks);

      this.logger.info('Upload session finalized', {
        saveKey,
        totalChunks: session.chunks.length,
        totalSize: session.totalSize,
        duration: Date.now() - session.createdAt
      });

      // 立即释放 chunks 数组内存
      session.chunks.length = 0;
      this.sessions.delete(saveKey);

      return { data: merged, status: 'ok' };
    } catch (error) {
      // 即使失败也要清理会话
      this.clearSession(saveKey);
      throw error;
    }
  }

  /**
   * 合并所有分块
   */
  private mergeChunks(chunks: Uint8Array[]): Uint8Array {
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(totalSize);

    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return merged;
  }

  /**
   * 设置会话超时
   */
  private setSessionTimeout(saveKey: string): void {
    const timer = setTimeout(() => {
      this.clearSession(saveKey);
      this.logger.warn('Upload session expired', {
        saveKey,
        ttl: this.sessionTTL
      });
    }, this.sessionTTL);

    this.sessionTimeouts.set(saveKey, timer);
  }

  /**
   * 清除会话超时定时器
   */
  private clearSessionTimeout(saveKey: string): void {
    const timer = this.sessionTimeouts.get(saveKey);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimeouts.delete(saveKey);
    }
  }

  /**
   * 刷新会话超时
   */
  private refreshTimeout(saveKey: string): void {
    this.clearSessionTimeout(saveKey);
    this.setSessionTimeout(saveKey);
  }

  /**
   * 清理单个会话
   */
  private clearSession(saveKey: string): void {
    const session = this.sessions.get(saveKey);
    if (session) {
      session.chunks.length = 0;
      this.sessions.delete(saveKey);
    }
    this.clearSessionTimeout(saveKey);
  }

  /**
   * 获取活动会话数量
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取会话信息
   */
  getSessionInfo(saveKey: string): { chunkCount: number; totalSize: number } | undefined {
    const session = this.sessions.get(saveKey);
    if (!session) return undefined;

    return {
      chunkCount: session.chunks.length,
      totalSize: session.totalSize
    };
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    if (this.disposed) return;

    this.logger.info('ChunkedUploader disposing', {
      activeSessions: this.sessions.size
    });

    // 清理所有超时定时器
    for (const timer of this.sessionTimeouts.values()) {
      clearTimeout(timer);
    }
    this.sessionTimeouts.clear();

    // 清理所有会话
    for (const session of this.sessions.values()) {
      session.chunks.length = 0;
    }
    this.sessions.clear();

    this.disposed = true;
    this.logger.info('ChunkedUploader disposed');
  }

  /**
   * 确保未释放
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new EditorError(
        ErrorCode.RESOURCE_DISPOSED,
        'ChunkedUploader has been disposed'
      );
    }
  }
}
