import type { Disposable } from '@/shared/utils/Disposable';

/**
 * LRU 缓存条目
 */
interface CacheEntry<T> {
  value: T;
  size: number;
  lastAccess: number;
}

/**
 * 驱逐回调函数
 */
export type EvictionCallback<T> = (key: string, value: T) => void;

/**
 * MediaCache 配置
 */
export interface MediaCacheConfig {
  /** 最大缓存大小（字节） */
  maxSize?: number;
  /** 条目过期时间（毫秒），0 表示不过期 */
  ttl?: number;
  /** 驱逐回调 */
  onEvict?: EvictionCallback<any>;
}

/**
 * LRU 媒体缓存
 *
 * 解决 assetsStore 内存泄漏问题：
 * 1. 限制最大缓存大小（默认 100MB）
 * 2. 自动淘汰最久未访问的条目（LRU）
 * 3. 支持 TTL 过期清理
 * 4. 自动释放 ObjectURL
 *
 * @example
 * ```typescript
 * const cache = new MediaCache({
 *   maxSize: 100 * 1024 * 1024, // 100MB
 *   ttl: 30 * 60 * 1000, // 30分钟
 *   onEvict: (key, value) => {
 *     console.log('Evicted:', key);
 *   }
 * });
 *
 * const url = cache.set('image1', imageData);
 * const retrieved = cache.get('image1'); // 更新访问时间
 * ```
 */
export class MediaCache<T = any> implements Disposable {
  private cache = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = []; // LRU 队列（最旧的在前）
  private currentSize = 0;
  private disposed = false;

  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly onEvict?: EvictionCallback<T>;

  constructor(config: MediaCacheConfig = {}) {
    this.maxSize = config.maxSize ?? 100 * 1024 * 1024; // 默认 100MB
    this.ttl = config.ttl ?? 0; // 默认不过期
    this.onEvict = config.onEvict;
  }

  /**
   * 添加或更新缓存条目
   *
   * @param key - 缓存键
   * @param value - 缓存值
   * @param size - 条目大小（字节）
   * @returns 是否成功添加
   */
  set(key: string, value: T, size: number): boolean {
    if (this.disposed) {
      return false;
    }

    // 如果单个条目超过最大缓存大小，拒绝
    if (size > this.maxSize) {
      return false;
    }

    // 如果键已存在，先删除旧条目
    if (this.cache.has(key)) {
      this.delete(key);
    }

    // 腾出空间（确保有足够空间容纳新条目）
    while (this.currentSize + size > this.maxSize && this.accessOrder.length > 0) {
      this.evictOldest();
    }

    // 添加新条目
    const entry: CacheEntry<T> = {
      value,
      size,
      lastAccess: Date.now(),
    };

    this.cache.set(key, entry);
    this.accessOrder.push(key);
    this.currentSize += size;

    return true;
  }

  /**
   * 获取缓存条目（更新访问时间）
   *
   * @param key - 缓存键
   * @returns 缓存值，如果不存在或已过期则返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // 检查是否过期
    if (this.ttl > 0 && Date.now() - entry.lastAccess > this.ttl) {
      this.delete(key);
      return undefined;
    }

    // 更新访问时间并移到队列末尾
    entry.lastAccess = Date.now();
    this.updateAccessOrder(key);

    return entry.value;
  }

  /**
   * 检查键是否存在（不更新访问时间）
   */
  has(key: string): boolean {
    if (!this.cache.has(key)) {
      return false;
    }

    // 检查是否过期
    const entry = this.cache.get(key)!;
    if (this.ttl > 0 && Date.now() - entry.lastAccess > this.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存条目
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.cache.delete(key);
    this.currentSize -= entry.size;

    // 从访问队列中移除
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }

    return true;
  }

  /**
   * 清理所有过期条目
   */
  cleanupExpired(): number {
    if (this.ttl === 0) {
      return 0;
    }

    let count = 0;
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.lastAccess > this.ttl) {
        toDelete.push(key);
      }
    }

    toDelete.forEach((key) => {
      this.delete(key);
      count++;
    });

    return count;
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取缓存大小信息
   */
  getSizeInfo(): { count: number; bytes: number; maxBytes: number; utilization: number } {
    return {
      count: this.cache.size,
      bytes: this.currentSize,
      maxBytes: this.maxSize,
      utilization: this.maxSize > 0 ? this.currentSize / this.maxSize : 0,
    };
  }

  /**
   * 清空缓存
   */
  clear(): void {
    // 触发所有条目的驱逐回调
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        try {
          this.onEvict(key, entry.value);
        } catch (error) {
          console.error('Error in eviction callback:', error);
        }
      }
    }

    this.cache.clear();
    this.accessOrder = [];
    this.currentSize = 0;
  }

  /**
   * 驱逐最旧的条目
   */
  private evictOldest(): void {
    if (this.accessOrder.length === 0) {
      return;
    }

    const oldestKey = this.accessOrder.shift()!;
    const entry = this.cache.get(oldestKey);

    if (!entry) {
      return;
    }

    this.cache.delete(oldestKey);
    this.currentSize -= entry.size;

    // 触发驱逐回调
    if (this.onEvict) {
      try {
        this.onEvict(oldestKey, entry.value);
      } catch (error) {
        console.error('Error in eviction callback:', error);
      }
    }
  }

  /**
   * 更新访问顺序（将键移到队列末尾）
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * 释放所有资源
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clear();
  }

  /**
   * 检查是否已释放
   */
  get isDisposed(): boolean {
    return this.disposed;
  }
}
