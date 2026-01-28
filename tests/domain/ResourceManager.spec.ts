import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResourceManager } from '@/domain/ResourceManager';
import { Logger } from '@/shared/logging/Logger';
import { ErrorCode } from '@/shared/errors/EditorError';

describe('ResourceManager', () => {
  let manager: ResourceManager;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ prefix: '[Test]' });
    manager = new ResourceManager('test-owner', logger);
  });

  describe('initialization', () => {
    it('should create with default options', () => {
      expect(manager).toBeDefined();
      expect(manager.isDisposed()).toBe(false);
    });

    it('should create with custom options', () => {
      const customManager = new ResourceManager('custom-owner', logger, {
        maxCacheSize: 50 * 1024 * 1024,
        cacheTTL: 1000
      });
      expect(customManager).toBeDefined();
    });
  });

  describe('ObjectURL management', () => {
    it('should register ObjectURL', () => {
      const blob = new Blob(['test']);
      const url = URL.createObjectURL(blob);

      manager.registerObjectUrl(url);
      const stats = manager.getStats();

      expect(stats.objectUrlCount).toBe(1);
    });

    it('should unregister ObjectURL', () => {
      const blob = new Blob(['test']);
      const url = URL.createObjectURL(blob);

      manager.registerObjectUrl(url);
      manager.unregisterObjectUrl(url);

      const stats = manager.getStats();
      expect(stats.objectUrlCount).toBe(0);
    });

    it('should handle unregistering non-existent URL', () => {
      expect(() => {
        manager.unregisterObjectUrl('blob:invalid');
      }).not.toThrow();
    });
  });

  describe('media management', () => {
    it('should register media data', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const url = manager.registerMedia('test.png', data);

      expect(url).toMatch(/^blob:/);
      expect(manager.hasMedia('test.png')).toBe(true);
    });

    it('should retrieve media data', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      manager.registerMedia('test.png', data);

      const retrieved = manager.getMedia('test.png');
      expect(retrieved).toEqual(data);
    });

    it('should return undefined for non-existent media', () => {
      const retrieved = manager.getMedia('non-existent.png');
      expect(retrieved).toBeUndefined();
    });

    it('should delete media', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      manager.registerMedia('test.png', data);

      const deleted = manager.deleteMedia('test.png');
      expect(deleted).toBe(true);
      expect(manager.hasMedia('test.png')).toBe(false);
    });

    it('should return false when deleting non-existent media', () => {
      const deleted = manager.deleteMedia('non-existent.png');
      expect(deleted).toBe(false);
    });

    it('should get all media keys', () => {
      manager.registerMedia('image1.png', new Uint8Array([1]));
      manager.registerMedia('image2.png', new Uint8Array([2]));

      const keys = manager.getMediaKeys();
      expect(keys).toHaveLength(2);
      expect(keys).toContain('image1.png');
      expect(keys).toContain('image2.png');
    });
  });

  describe('statistics', () => {
    it('should return correct stats', () => {
      const blob = new Blob(['test']);
      const url = URL.createObjectURL(blob);
      manager.registerObjectUrl(url);
      manager.registerMedia('test.png', new Uint8Array([1, 2, 3]));

      const stats = manager.getStats();
      expect(stats.ownerId).toBe('test-owner');
      expect(stats.objectUrlCount).toBe(2); // 1 registered + 1 from media
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired entries', () => {
      const managerWithTTL = new ResourceManager('test', logger, {
        cacheTTL: 100
      });

      managerWithTTL.registerMedia('test.png', new Uint8Array([1]));

      // Wait for expiration
      vi.useFakeTimers();
      vi.advanceTimersByTime(150);

      const cleaned = managerWithTTL.cleanupExpired();
      expect(cleaned).toBe(1);

      vi.useRealTimers();
      managerWithTTL.dispose();
    });
  });

  describe('dispose', () => {
    it('should dispose all resources', () => {
      const blob = new Blob(['test']);
      const url = URL.createObjectURL(blob);
      manager.registerObjectUrl(url);
      manager.registerMedia('test.png', new Uint8Array([1, 2, 3]));

      manager.dispose();

      expect(manager.isDisposed()).toBe(true);
      const stats = manager.getStats();
      expect(stats.objectUrlCount).toBe(0);
    });

    it('should be idempotent', () => {
      manager.dispose();
      expect(() => manager.dispose()).not.toThrow();
    });

    it('should prevent operations after dispose', () => {
      manager.dispose();

      expect(() => {
        manager.registerObjectUrl('blob:test');
      }).toThrow();

      expect(() => {
        manager.registerMedia('test.png', new Uint8Array([1]));
      }).toThrow();
    });

    it('should throw EditorError with correct code', () => {
      manager.dispose();

      try {
        manager.registerObjectUrl('blob:test');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.RESOURCE_DISPOSED);
        expect(error.message).toContain('ResourceManager has been disposed');
      }
    });
  });

  describe('error handling', () => {
    it('should handle ObjectURL revoke errors gracefully', () => {
      // Register invalid URL
      manager.registerObjectUrl('invalid-url');

      // Should not throw even if revoke fails
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('integration', () => {
    it('should track media URLs in objectUrls', () => {
      manager.registerMedia('image1.png', new Uint8Array([1]));
      manager.registerMedia('image2.png', new Uint8Array([2]));

      const stats = manager.getStats();
      expect(stats.objectUrlCount).toBeGreaterThanOrEqual(2);
    });

    it('should remove media URLs when deleted', () => {
      manager.registerMedia('test.png', new Uint8Array([1]));

      const deleted = manager.deleteMedia('test.png');

      expect(deleted).toBe(true);
      expect(manager.hasMedia('test.png')).toBe(false);
    });
  });
});
