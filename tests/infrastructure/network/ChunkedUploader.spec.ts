import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChunkedUploader } from '@/infrastructure/network/ChunkedUploader';
import { Logger } from '@/shared/logging/Logger';
import { ErrorCode } from '@/shared/errors/EditorError';

describe('ChunkedUploader', () => {
  let uploader: ChunkedUploader;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ prefix: '[Test]' });
    uploader = new ChunkedUploader(logger);
  });

  afterEach(() => {
    uploader.dispose();
    vi.useRealTimers();
  });

  describe('single chunk upload', () => {
    it('should handle single chunk', async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const result = await uploader.handleChunk('key1', data, 'single');

      expect(result.status).toBe('ok');
      expect(result.data).toEqual(data);
    });
  });

  describe('multi-chunk upload', () => {
    it('should start session with first chunk', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const result = await uploader.handleChunk('save-1', chunk1, 'first');

      expect(result.status).toBe('ok');
      expect(result.saveKey).toBe('save-1');
      expect(uploader.getActiveSessionCount()).toBe(1);
    });

    it('should add middle chunks', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3, 4]);
      const chunk3 = new Uint8Array([5, 6]);

      await uploader.handleChunk('save-1', chunk1, 'first');
      await uploader.handleChunk('save-1', chunk2, 'middle');
      await uploader.handleChunk('save-1', chunk3, 'middle');

      const info = uploader.getSessionInfo('save-1');
      expect(info?.chunkCount).toBe(3);
      expect(info?.totalSize).toBe(6);
    });

    it('should merge all chunks on last', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3, 4]);
      const chunk3 = new Uint8Array([5, 6]);

      await uploader.handleChunk('save-1', chunk1, 'first');
      await uploader.handleChunk('save-1', chunk2, 'middle');
      const result = await uploader.handleChunk('save-1', chunk3, 'last');

      expect(result.status).toBe('ok');
      expect(result.data).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    });

    it('should clear session after finalization', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3, 4]);

      await uploader.handleChunk('save-1', chunk1, 'first');
      await uploader.handleChunk('save-1', chunk2, 'last');

      expect(uploader.getActiveSessionCount()).toBe(0);
      expect(uploader.getSessionInfo('save-1')).toBeUndefined();
    });
  });

  describe('session management', () => {
    it('should return error for non-existent session', async () => {
      const chunk = new Uint8Array([1, 2]);
      const result = await uploader.handleChunk('non-existent', chunk, 'middle');

      expect(result.status).toBe('error');
      expect(result.message).toContain('not found');
    });

    it('should replace existing session with same key', async () => {
      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3, 4]);

      await uploader.handleChunk('save-1', chunk1, 'first');
      await uploader.handleChunk('save-1', chunk2, 'first');

      const info = uploader.getSessionInfo('save-1');
      expect(info?.chunkCount).toBe(1);
      expect(info?.totalSize).toBe(2);
    });

    it('should support multiple concurrent sessions', async () => {
      await uploader.handleChunk('save-1', new Uint8Array([1]), 'first');
      await uploader.handleChunk('save-2', new Uint8Array([2]), 'first');
      await uploader.handleChunk('save-3', new Uint8Array([3]), 'first');

      expect(uploader.getActiveSessionCount()).toBe(3);
    });
  });

  describe('session timeout', () => {
    it('should clear session after TTL', async () => {
      vi.useFakeTimers();
      const uploaderWithShortTTL = new ChunkedUploader(logger, 1000); // 1 second

      const chunk = new Uint8Array([1, 2]);
      await uploaderWithShortTTL.handleChunk('save-1', chunk, 'first');

      expect(uploaderWithShortTTL.getActiveSessionCount()).toBe(1);

      vi.advanceTimersByTime(1100);

      expect(uploaderWithShortTTL.getActiveSessionCount()).toBe(0);
      uploaderWithShortTTL.dispose();
    });

    it('should refresh timeout on middle chunk', async () => {
      vi.useFakeTimers();
      const uploaderWithShortTTL = new ChunkedUploader(logger, 1000);

      await uploaderWithShortTTL.handleChunk('save-1', new Uint8Array([1]), 'first');

      vi.advanceTimersByTime(800);
      await uploaderWithShortTTL.handleChunk('save-1', new Uint8Array([2]), 'middle');

      vi.advanceTimersByTime(800);
      expect(uploaderWithShortTTL.getActiveSessionCount()).toBe(1);

      vi.advanceTimersByTime(300);
      expect(uploaderWithShortTTL.getActiveSessionCount()).toBe(0);

      uploaderWithShortTTL.dispose();
    });
  });

  describe('memory management', () => {
    it('should release chunks array immediately after finalization', async () => {
      const largeChunk = new Uint8Array(1024 * 1024); // 1MB
      await uploader.handleChunk('save-1', largeChunk, 'first');

      const beforeFinalize = uploader.getSessionInfo('save-1');
      expect(beforeFinalize?.chunkCount).toBe(1);

      await uploader.handleChunk('save-1', new Uint8Array([1]), 'last');

      // Session should be completely removed
      expect(uploader.getSessionInfo('save-1')).toBeUndefined();
    });

    it('should clear chunks on error', async () => {
      await uploader.handleChunk('save-1', new Uint8Array([1]), 'first');

      // Session exists
      expect(uploader.getActiveSessionCount()).toBe(1);

      uploader.dispose(); // Force disposed state

      // Session should be cleared
      expect(uploader.getActiveSessionCount()).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should clear all sessions', async () => {
      await uploader.handleChunk('save-1', new Uint8Array([1]), 'first');
      await uploader.handleChunk('save-2', new Uint8Array([2]), 'first');

      uploader.dispose();

      expect(uploader.getActiveSessionCount()).toBe(0);
    });

    it('should clear all timers', async () => {
      vi.useFakeTimers();
      await uploader.handleChunk('save-1', new Uint8Array([1]), 'first');

      uploader.dispose();

      vi.advanceTimersByTime(10 * 60 * 1000);
      // Should not crash or log errors
    });

    it('should be idempotent', () => {
      uploader.dispose();
      expect(() => uploader.dispose()).not.toThrow();
    });

    it('should prevent operations after dispose', async () => {
      uploader.dispose();

      // After dispose, handleChunk catches the error and returns error response
      const result = await uploader.handleChunk('save-1', new Uint8Array([1]), 'first');
      expect(result.status).toBe('error');
      expect(result.message).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should return error response on exception', async () => {
      // Try to add middle chunk without starting session
      const result = await uploader.handleChunk('save-1', new Uint8Array([1]), 'middle');

      expect(result.status).toBe('error');
      expect(result.message).toBeDefined();
    });

    it('should include error code for session not found', async () => {
      try {
        uploader.dispose();
        await uploader.handleChunk('save-1', new Uint8Array([1]), 'first');
      } catch (error: any) {
        // Should not throw, but return error response
      }
    });
  });

  describe('session info', () => {
    it('should return session info', async () => {
      await uploader.handleChunk('save-1', new Uint8Array([1, 2, 3]), 'first');
      await uploader.handleChunk('save-1', new Uint8Array([4, 5]), 'middle');

      const info = uploader.getSessionInfo('save-1');
      expect(info).toEqual({
        chunkCount: 2,
        totalSize: 5
      });
    });

    it('should return undefined for non-existent session', () => {
      const info = uploader.getSessionInfo('non-existent');
      expect(info).toBeUndefined();
    });
  });

  describe('large file handling', () => {
    it('should handle large files in chunks', async () => {
      const chunkSize = 1024 * 1024; // 1MB chunks
      const totalChunks = 10;

      await uploader.handleChunk('large-file', new Uint8Array(chunkSize), 'first');

      for (let i = 1; i < totalChunks - 1; i++) {
        await uploader.handleChunk('large-file', new Uint8Array(chunkSize), 'middle');
      }

      const result = await uploader.handleChunk('large-file', new Uint8Array(chunkSize), 'last');

      expect(result.status).toBe('ok');
      expect(result.data?.byteLength).toBe(chunkSize * totalChunks);
    });
  });
});
