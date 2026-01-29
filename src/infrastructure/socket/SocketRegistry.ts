import type { Disposable } from '@/shared/utils/Disposable';
import type { Logger } from '@/shared/logging/Logger';
import { defaultLogger } from '@/shared/logging/Logger';

/**
 * Socket 接口（最小化依赖，避免循环引用）
 */
export interface ISocket {
  connected: boolean;
  emitServerMessage(message: unknown): void;
}

/**
 * Socket 注册表 - 使用 WeakRef 避免内存泄漏
 *
 * 关键改进：
 * 1. 使用 WeakRef 替代强引用，允许垃圾回收
 * 2. 定期清理失效的弱引用
 * 3. 支持多实例隔离
 *
 * @example
 * ```typescript
 * const registry = new SocketRegistry();
 * registry.register('doc-123', socket);
 *
 * // Socket 被销毁后会自动从注册表清除
 * socket = null;
 * await forceGC();
 * registry.get('doc-123'); // undefined
 * ```
 */
export class SocketRegistry implements Disposable {
  private sockets = new Map<string, WeakRef<ISocket> | ISocket>();
  private finalizationRegistry: FinalizationRegistry<string> | null = null;
  private readonly useWeakRef: boolean;
  private cleanupTimer: number | null = null;
  private disposed = false;

  constructor(
    private readonly logger: Logger = defaultLogger,
    private readonly cleanupIntervalMs: number = 60_000 // 1 分钟
  ) {
    this.useWeakRef = typeof WeakRef !== 'undefined';

    // 创建 FinalizationRegistry 用于自动清理（若环境支持）
    if (typeof FinalizationRegistry !== 'undefined') {
      this.finalizationRegistry = new FinalizationRegistry((docId: string) => {
        this.sockets.delete(docId);
        this.logger.debug('Socket auto-cleaned from registry', { docId });
      });
    }

    // 启动定期清理任务
    this.startCleanupTimer();
  }

  /**
   * 注册 Socket 到指定文档 ID
   */
  register(docId: string, socket: ISocket): void {
    if (this.disposed) {
      this.logger.warn('Attempted to register socket on disposed registry', { docId });
      return;
    }

    if (this.useWeakRef) {
      const weakRef = new WeakRef(socket);
      this.sockets.set(docId, weakRef);
      // 注册到 FinalizationRegistry，当 socket 被 GC 时自动清理
      this.finalizationRegistry?.register(socket, docId, socket);
    } else {
      this.sockets.set(docId, socket);
    }

    this.logger.debug('Socket registered', { docId, totalSockets: this.sockets.size });
  }

  /**
   * 取消注册 Socket
   */
  unregister(docId: string, socket?: ISocket): void {
    const removed = this.sockets.delete(docId);

    if (socket) {
      this.finalizationRegistry?.unregister(socket);
    }

    if (removed) {
      this.logger.debug('Socket unregistered', { docId, totalSockets: this.sockets.size });
    }
  }

  /**
   * 获取指定文档的 Socket（如果已被 GC 则返回 undefined）
   */
  get(docId: string): ISocket | undefined {
    const ref = this.sockets.get(docId);
    if (!ref) {
      return undefined;
    }

    if (!this.useWeakRef) {
      return ref as ISocket;
    }

    const socket = (ref as WeakRef<ISocket>).deref();
    if (!socket) {
      // Socket 已被 GC，清理引用
      this.sockets.delete(docId);
      this.logger.debug('Socket reference expired', { docId });
      return undefined;
    }

    return socket;
  }

  /**
   * 向指定文档发送消息
   *
   * @returns 是否成功发送
   */
  emitToDocument(docId: string, message: unknown): boolean {
    const socket = this.get(docId);
    if (!socket || !socket.connected) {
      this.logger.debug('Cannot emit to document - socket unavailable', { docId });
      return false;
    }

    try {
      socket.emitServerMessage(message);
      this.logger.debug('Message emitted to document', { docId });
      return true;
    } catch (error) {
      this.logger.error('Failed to emit message to document', error);
      return false;
    }
  }

  /**
   * 广播消息到所有连接的 Socket
   *
   * @returns 成功发送的数量
   */
  broadcast(message: unknown): number {
    let successCount = 0;

    for (const [docId] of this.sockets) {
      if (this.emitToDocument(docId, message)) {
        successCount++;
      }
    }

    this.logger.debug('Broadcast completed', { successCount, totalSockets: this.sockets.size });
    return successCount;
  }

  /**
   * 获取所有有效的文档 ID
   */
  getDocumentIds(): string[] {
    const validIds: string[] = [];

    for (const [docId, ref] of this.sockets) {
      if (!this.useWeakRef) {
        const socket = ref as ISocket;
        if (socket.connected) {
          validIds.push(docId);
        }
        continue;
      }

      const socket = (ref as WeakRef<ISocket>).deref();
      if (socket) {
        validIds.push(docId);
      }
    }

    return validIds;
  }

  /**
   * 获取当前注册的 Socket 数量（包括已失效的）
   */
  get size(): number {
    return this.sockets.size;
  }

  /**
   * 获取有效的 Socket 数量
   */
  get activeSize(): number {
    return this.getDocumentIds().length;
  }

  /**
   * 手动触发清理失效的弱引用
   */
  cleanup(): void {
    const before = this.sockets.size;
    const toDelete: string[] = [];

    for (const [docId, ref] of this.sockets) {
      if (!this.useWeakRef) {
        if (!(ref as ISocket).connected) {
          toDelete.push(docId);
        }
        continue;
      }

      if (!(ref as WeakRef<ISocket>).deref()) {
        toDelete.push(docId);
      }
    }

    toDelete.forEach((docId) => this.sockets.delete(docId));

    const after = this.sockets.size;
    if (toDelete.length > 0) {
      this.logger.debug('Cleanup completed', {
        removed: toDelete.length,
        before,
        after,
      });
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupTimer(): void {
    if (typeof window === 'undefined') {
      return; // 非浏览器环境
    }

    this.cleanupTimer = window.setInterval(() => {
      this.cleanup();
    }, this.cleanupIntervalMs);
  }

  /**
   * 停止清理任务
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.stopCleanupTimer();
    this.sockets.clear();

    this.logger.info('SocketRegistry disposed');
  }

  /**
   * 检查是否已释放
   */
  get isDisposed(): boolean {
    return this.disposed;
  }
}
