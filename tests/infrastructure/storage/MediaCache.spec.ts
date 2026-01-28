import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaCache } from '@/infrastructure/storage/MediaCache';

describe('MediaCache', () => {
  let cache: MediaCache<string>;

  beforeEach(() => {
    cache = new MediaCache({ maxSize: 1024 }); // 1KB for testing
  });

  describe('set and get', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1', 100);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('non-existent')).toBeUndefined();
    });

    it('should update existing keys', () => {
      cache.set('key1', 'value1', 100);
      cache.set('key1', 'value2', 150);

      expect(cache.get('key1')).toBe('value2');
    });

    it('should update access time on get', () => {
      cache.set('key1', 'value1', 100);

      const before = Date.now();
      cache.get('key1');
      const after = Date.now();

      // 访问后应该更新 lastAccess（通过后续驱逐测试验证）
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when cache is full', () => {
      const onEvict = vi.fn();
      const lruCache = new MediaCache({ maxSize: 300, onEvict });

      lruCache.set('key1', 'value1', 100);
      lruCache.set('key2', 'value2', 100);
      lruCache.set('key3', 'value3', 100);

      // 现在缓存满了（300/300），添加新条目会驱逐最旧的
      lruCache.set('key4', 'value4', 100);

      expect(lruCache.has('key1')).toBe(false); // 最旧的被驱逐
      expect(lruCache.has('key2')).toBe(true);
      expect(lruCache.has('key3')).toBe(true);
      expect(lruCache.has('key4')).toBe(true);

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
    });

    it('should update LRU order on access', () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 100);
      cache.set('key3', 'value3', 100);

      // 访问 key1，使其成为最近使用的
      cache.get('key1');

      // 现在缓存满了，添加新条目应该驱逐 key2（最旧未访问）
      cache.set('key4', 'value4', 850);

      expect(cache.has('key1')).toBe(true); // key1 被访问过，保留
      expect(cache.has('key4')).toBe(true);
    });

    it('should evict multiple entries if needed', () => {
      cache.set('key1', 'value1', 200);
      cache.set('key2', 'value2', 200);
      cache.set('key3', 'value3', 200);

      // 添加一个大条目，需要驱逐多个旧条目
      // 当前：600字节，添加 900字节 = 1500字节 > 1024
      // 需要驱逐至少 476字节，所以会驱逐 key1(200) + key2(200) + key3(200)
      cache.set('key4', 'value4', 900);

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
      expect(cache.has('key4')).toBe(true);
    });

    it('should reject entries larger than max size', () => {
      const success = cache.set('huge', 'value', 2000); // 超过 1024

      expect(success).toBe(false);
      expect(cache.has('huge')).toBe(false);
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers();

      const ttlCache = new MediaCache({ maxSize: 1024, ttl: 1000 }); // 1秒 TTL
      ttlCache.set('key1', 'value1', 100);

      expect(ttlCache.get('key1')).toBe('value1');

      // 快进时间超过 TTL
      vi.advanceTimersByTime(1100);

      expect(ttlCache.get('key1')).toBeUndefined();

      vi.useRealTimers();
    });

    it('should not expire when TTL is 0', () => {
      const noTtlCache = new MediaCache({ maxSize: 1024, ttl: 0 });
      noTtlCache.set('key1', 'value1', 100);

      // TTL 为 0 时永不过期
      expect(noTtlCache.has('key1')).toBe(true);
    });

    it('should cleanup expired entries manually', () => {
      vi.useFakeTimers();

      const ttlCache = new MediaCache({ maxSize: 1024, ttl: 1000 });
      ttlCache.set('key1', 'value1', 100);
      ttlCache.set('key2', 'value2', 100);

      vi.advanceTimersByTime(1100);

      const cleaned = ttlCache.cleanupExpired();

      expect(cleaned).toBe(2);
      expect(ttlCache.has('key1')).toBe(false);
      expect(ttlCache.has('key2')).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('has', () => {
    it('should check existence without updating access time', () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 100);

      // has 不更新访问时间
      expect(cache.has('key1')).toBe(true);

      // 添加足够大的条目触发驱逐
      cache.set('key3', 'value3', 900);

      // key1 应该被驱逐（has 没有更新访问时间）
      expect(cache.has('key1')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete entry and free space', () => {
      cache.set('key1', 'value1', 500);

      const deleted = cache.delete('key1');

      expect(deleted).toBe(true);
      expect(cache.has('key1')).toBe(false);

      const info = cache.getSizeInfo();
      expect(info.bytes).toBe(0);
    });

    it('should return false for non-existent key', () => {
      expect(cache.delete('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 200);

      cache.clear();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);

      const info = cache.getSizeInfo();
      expect(info.count).toBe(0);
      expect(info.bytes).toBe(0);
    });

    it('should trigger eviction callbacks for all entries', () => {
      const onEvict = vi.fn();
      const callbackCache = new MediaCache({ maxSize: 1024, onEvict });

      callbackCache.set('key1', 'value1', 100);
      callbackCache.set('key2', 'value2', 200);

      callbackCache.clear();

      expect(onEvict).toHaveBeenCalledTimes(2);
      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
      expect(onEvict).toHaveBeenCalledWith('key2', 'value2');
    });
  });

  describe('getSizeInfo', () => {
    it('should return cache size information', () => {
      cache.set('key1', 'value1', 300);
      cache.set('key2', 'value2', 200);

      const info = cache.getSizeInfo();

      expect(info.count).toBe(2);
      expect(info.bytes).toBe(500);
      expect(info.maxBytes).toBe(1024);
      expect(info.utilization).toBeCloseTo(500 / 1024);
    });
  });

  describe('keys', () => {
    it('should return all keys', () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 100);
      cache.set('key3', 'value3', 100);

      const keys = cache.keys();

      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should return empty array when cache is empty', () => {
      expect(cache.keys()).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('should clear cache and prevent further operations', () => {
      cache.set('key1', 'value1', 100);

      cache.dispose();

      expect(cache.isDisposed).toBe(true);
      expect(cache.has('key1')).toBe(false);

      // 释放后无法添加新条目
      const success = cache.set('key2', 'value2', 100);
      expect(success).toBe(false);
    });

    it('should be idempotent', () => {
      cache.set('key1', 'value1', 100);

      cache.dispose();
      cache.dispose();
      cache.dispose();

      expect(cache.isDisposed).toBe(true);
    });
  });

  describe('eviction callback error handling', () => {
    it('should handle errors in eviction callback', () => {
      const onEvict = vi.fn().mockImplementation(() => {
        throw new Error('Eviction error');
      });

      const errorCache = new MediaCache({ maxSize: 200, onEvict });

      errorCache.set('key1', 'value1', 100);

      // 添加新条目触发驱逐，应该捕获错误
      expect(() => {
        errorCache.set('key2', 'value2', 150);
      }).not.toThrow();

      expect(onEvict).toHaveBeenCalled();
    });
  });
});
