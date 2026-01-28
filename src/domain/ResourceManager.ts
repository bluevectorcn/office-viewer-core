import type { Disposable } from '@/shared/utils/Disposable';
import type { Logger } from '@/shared/logging/Logger';
import { MediaCache } from '@/infrastructure/storage/MediaCache';
import { EditorError, ErrorCode } from '@/shared/errors/EditorError';

/**
 * 媒体缓存条目
 * 包含原始数据、ObjectURL 和大小信息
 */
interface MediaEntry {
  data: Uint8Array;
  url: string;
  size: number;
}

/**
 * 资源管理器 - 统一管理编辑器的所有资源
 *
 * 职责：
 * 1. 管理所有 ObjectURL（图片、媒体、下载链接等）
 * 2. 管理媒体缓存（LRU 策略，自动淘汰）
 * 3. 确保 dispose 时所有资源释放，防止内存泄漏
 *
 * @example
 * const manager = new ResourceManager('editor-123', logger);
 *
 * // 注册图片 URL
 * const imageUrl = URL.createObjectURL(blob);
 * manager.registerObjectUrl(imageUrl);
 *
 * // 注册媒体数据（自动 LRU 管理）
 * const mediaUrl = manager.registerMedia('image.png', uint8Array);
 *
 * // 释放所有资源
 * manager.dispose();
 */
export class ResourceManager implements Disposable {
  private objectUrls = new Set<string>();
  private mediaCache: MediaCache<MediaEntry>;
  private disposed = false;

  constructor(
    private readonly ownerId: string,
    private readonly logger: Logger,
    options: {
      maxCacheSize?: number; // 最大缓存大小（字节），默认 100MB
      cacheTTL?: number; // 缓存过期时间（毫秒），0 表示不过期
    } = {}
  ) {
    const { maxCacheSize = 100 * 1024 * 1024, cacheTTL = 0 } = options;

    this.mediaCache = new MediaCache<MediaEntry>({
      maxSize: maxCacheSize,
      ttl: cacheTTL,
      onEvict: (key, entry) => {
        // 媒体被淘汰时，立即释放 ObjectURL 并从注册表移除
        try {
          URL.revokeObjectURL(entry.url);
        } catch (error) {
          this.logger.error('Failed to revoke ObjectURL during eviction', error);
        }
        this.objectUrls.delete(entry.url);
        this.logger.debug('Media evicted from cache', {
          ownerId: this.ownerId,
          key,
          size: entry.size,
          url: entry.url
        });
      }
    });
  }

  /**
   * 注册 ObjectURL
   * 注册后，dispose 时会自动 revoke
   */
  registerObjectUrl(url: string): void {
    this.ensureNotDisposed();
    this.objectUrls.add(url);
    this.logger.debug('ObjectURL registered', { ownerId: this.ownerId, url });
  }

  /**
   * 注销 ObjectURL
   * 立即 revoke 并从注册表移除
   */
  unregisterObjectUrl(url: string): void {
    if (this.objectUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(url);
      this.logger.debug('ObjectURL unregistered', { ownerId: this.ownerId, url });
    }
  }

  /**
   * 注册媒体数据
   * 数据存储在 LRU 缓存中，自动淘汰旧数据
   *
   * @param key - 媒体的唯一标识（如文件名）
   * @param data - 媒体的原始字节数据
   * @returns ObjectURL
   */
  registerMedia(key: string, data: Uint8Array): string {
    this.ensureNotDisposed();

    // 创建 Blob 和 ObjectURL
    const blob = new Blob([data as BlobPart]);
    const url = URL.createObjectURL(blob);

    // 创建包含完整信息的媒体条目
    const entry: MediaEntry = {
      data,
      url,
      size: data.byteLength
    };

    // 存储到 LRU 缓存（如果容量不足会自动淘汰旧条目）
    this.mediaCache.set(key, entry, entry.size);
    this.objectUrls.add(url);

    this.logger.debug('Media registered', {
      ownerId: this.ownerId,
      key,
      size: entry.size,
      url
    });

    return url;
  }

  /**
   * 获取媒体数据
   *
   * @returns 原始字节数据，如果不存在或已过期则返回 undefined
   */
  getMedia(key: string): Uint8Array | undefined {
    const entry = this.mediaCache.get(key);
    return entry?.data;
  }

  /**
   * 检查媒体是否存在
   */
  hasMedia(key: string): boolean {
    return this.mediaCache.has(key);
  }

  /**
   * 删除媒体
   * 会立即释放 ObjectURL
   */
  deleteMedia(key: string): boolean {
    const entry = this.mediaCache.get(key);
    if (entry) {
      // 先释放 ObjectURL
      try {
        URL.revokeObjectURL(entry.url);
      } catch (error) {
        this.logger.error('Failed to revoke ObjectURL during delete', error);
      }
      this.objectUrls.delete(entry.url);

      // 从缓存中删除
      const deleted = this.mediaCache.delete(key);

      this.logger.debug('Media deleted', {
        ownerId: this.ownerId,
        key,
        url: entry.url
      });

      return deleted;
    }
    return false;
  }

  /**
   * 获取所有媒体键
   */
  getMediaKeys(): string[] {
    return this.mediaCache.keys();
  }

  /**
   * 获取资源统计信息
   */
  getStats(): ResourceStats {
    return {
      ownerId: this.ownerId,
      objectUrlCount: this.objectUrls.size
    };
  }

  /**
   * 清理过期的媒体缓存
   */
  cleanupExpired(): number {
    return this.mediaCache.cleanupExpired();
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    if (this.disposed) {
      this.logger.warn('ResourceManager already disposed', { ownerId: this.ownerId });
      return;
    }

    const stats = this.getStats();
    this.logger.info('ResourceManager disposing', {
      ownerId: this.ownerId,
      stats
    });

    // 释放所有 ObjectURL
    for (const url of this.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        this.logger.error('Failed to revoke ObjectURL', error);
      }
    }
    this.objectUrls.clear();

    // 清理媒体缓存
    this.mediaCache.dispose();

    this.disposed = true;
    this.logger.info('ResourceManager disposed', { ownerId: this.ownerId });
  }

  /**
   * 检查是否已释放
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * 确保未释放，否则抛出异常
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new EditorError(
        ErrorCode.RESOURCE_DISPOSED,
        'ResourceManager has been disposed',
        undefined,
        { ownerId: this.ownerId }
      );
    }
  }
}

/**
 * 资源统计信息
 */
export interface ResourceStats {
  ownerId: string;
  objectUrlCount: number;
}
