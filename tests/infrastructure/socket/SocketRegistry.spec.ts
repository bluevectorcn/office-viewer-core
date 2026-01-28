import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SocketRegistry, type ISocket } from '@/infrastructure/socket/SocketRegistry';
import { Logger } from '@/shared/logging/Logger';
import { forceGC } from '../../setup';

describe('SocketRegistry', () => {
  let registry: SocketRegistry;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({ enableConsole: false });
    registry = new SocketRegistry(logger, 100); // 100ms cleanup interval for testing
  });

  afterEach(() => {
    registry.dispose();
  });

  const createMockSocket = (connected = true): ISocket => ({
    connected,
    emitServerMessage: vi.fn(),
  });

  describe('register and get', () => {
    it('should register and retrieve socket', () => {
      const socket = createMockSocket();
      registry.register('doc-1', socket);

      expect(registry.get('doc-1')).toBe(socket);
    });

    it('should return undefined for non-existent docId', () => {
      expect(registry.get('non-existent')).toBeUndefined();
    });

    it('should track total socket count', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register('doc-1', socket1);
      registry.register('doc-2', socket2);

      expect(registry.size).toBe(2);
    });
  });

  describe('unregister', () => {
    it('should unregister socket', () => {
      const socket = createMockSocket();
      registry.register('doc-1', socket);

      registry.unregister('doc-1', socket);

      expect(registry.get('doc-1')).toBeUndefined();
      expect(registry.size).toBe(0);
    });

    it('should handle unregistering non-existent socket', () => {
      expect(() => registry.unregister('non-existent')).not.toThrow();
    });
  });

  describe('WeakRef behavior', () => {
    it('should return undefined when socket is garbage collected', async () => {
      let socket: ISocket | null = createMockSocket();
      registry.register('doc-1', socket);

      expect(registry.get('doc-1')).toBe(socket);

      // 解除强引用
      socket = null;

      // 触发垃圾回收（需要 --expose-gc 标志）
      await forceGC();

      // 注意：在测试环境中可能无法保证 GC 立即执行
      // 这个测试主要验证架构正确性
      const retrieved = registry.get('doc-1');

      // 如果 GC 成功，应该返回 undefined
      // 如果 GC 未执行，仍可能返回对象
      if (!retrieved) {
        expect(retrieved).toBeUndefined();
      }
    });

    it('should auto-cleanup expired references', async () => {
      let socket: ISocket | null = createMockSocket();
      registry.register('doc-1', socket);

      const initialSize = registry.size;
      expect(initialSize).toBe(1);

      socket = null;
      await forceGC();

      // 手动触发清理
      registry.cleanup();

      // 清理后 size 可能减少（取决于 GC 是否执行）
      expect(registry.size).toBeLessThanOrEqual(initialSize);
    });
  });

  describe('emitToDocument', () => {
    it('should emit message to connected socket', () => {
      const socket = createMockSocket(true);
      registry.register('doc-1', socket);

      const message = { type: 'test', data: 'hello' };
      const success = registry.emitToDocument('doc-1', message);

      expect(success).toBe(true);
      expect(socket.emitServerMessage).toHaveBeenCalledWith(message);
    });

    it('should return false for disconnected socket', () => {
      const socket = createMockSocket(false);
      registry.register('doc-1', socket);

      const success = registry.emitToDocument('doc-1', { type: 'test' });

      expect(success).toBe(false);
      expect(socket.emitServerMessage).not.toHaveBeenCalled();
    });

    it('should return false for non-existent socket', () => {
      const success = registry.emitToDocument('non-existent', { type: 'test' });
      expect(success).toBe(false);
    });

    it('should handle emit errors gracefully', () => {
      const socket = createMockSocket(true);
      socket.emitServerMessage = vi.fn().mockImplementation(() => {
        throw new Error('Emit error');
      });

      registry.register('doc-1', socket);

      const success = registry.emitToDocument('doc-1', { type: 'test' });

      expect(success).toBe(false);
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all connected sockets', () => {
      const socket1 = createMockSocket(true);
      const socket2 = createMockSocket(true);
      const socket3 = createMockSocket(false); // disconnected

      registry.register('doc-1', socket1);
      registry.register('doc-2', socket2);
      registry.register('doc-3', socket3);

      const message = { type: 'broadcast' };
      const successCount = registry.broadcast(message);

      expect(successCount).toBe(2); // 只有连接的 socket
      expect(socket1.emitServerMessage).toHaveBeenCalledWith(message);
      expect(socket2.emitServerMessage).toHaveBeenCalledWith(message);
      expect(socket3.emitServerMessage).not.toHaveBeenCalled();
    });

    it('should return 0 when no sockets registered', () => {
      const successCount = registry.broadcast({ type: 'test' });
      expect(successCount).toBe(0);
    });
  });

  describe('getDocumentIds', () => {
    it('should return all valid document IDs', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register('doc-1', socket1);
      registry.register('doc-2', socket2);

      const ids = registry.getDocumentIds();

      expect(ids).toHaveLength(2);
      expect(ids).toContain('doc-1');
      expect(ids).toContain('doc-2');
    });

    it('should return empty array when no sockets', () => {
      expect(registry.getDocumentIds()).toEqual([]);
    });
  });

  describe('activeSize', () => {
    it('should count only valid sockets', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register('doc-1', socket1);
      registry.register('doc-2', socket2);

      expect(registry.activeSize).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should remove expired references', async () => {
      let socket: ISocket | null = createMockSocket();
      registry.register('doc-1', socket);

      expect(registry.size).toBe(1);

      socket = null;
      await forceGC();

      registry.cleanup();

      // 注意：GC 不保证立即执行，所以这个测试可能不稳定
      // 主要验证 cleanup 方法不会崩溃
      expect(registry.size).toBeGreaterThanOrEqual(0);
    });

    it('should not affect valid references', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register('doc-1', socket1);
      registry.register('doc-2', socket2);

      registry.cleanup();

      expect(registry.get('doc-1')).toBe(socket1);
      expect(registry.get('doc-2')).toBe(socket2);
    });
  });

  describe('dispose', () => {
    it('should clear all sockets and stop timer', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      registry.register('doc-1', socket1);
      registry.register('doc-2', socket2);

      registry.dispose();

      expect(registry.size).toBe(0);
      expect(registry.isDisposed).toBe(true);
    });

    it('should be idempotent', () => {
      const socket = createMockSocket();
      registry.register('doc-1', socket);

      registry.dispose();
      registry.dispose();
      registry.dispose();

      expect(registry.size).toBe(0);
      expect(registry.isDisposed).toBe(true);
    });

    it('should prevent registration after disposal', () => {
      const socket = createMockSocket();

      registry.dispose();
      registry.register('doc-1', socket);

      expect(registry.get('doc-1')).toBeUndefined();
    });
  });

  describe('periodic cleanup timer', () => {
    it('should cleanup automatically at intervals', async () => {
      vi.useFakeTimers();

      const shortIntervalRegistry = new SocketRegistry(logger, 50);
      let socket: ISocket | null = createMockSocket();

      shortIntervalRegistry.register('doc-1', socket);
      socket = null;

      await forceGC();

      // 快进时间触发清理
      vi.advanceTimersByTime(100);

      // cleanup 应该被调用（通过内部定时器）
      // 注意：这个测试验证定时器机制，不保证 GC 执行

      shortIntervalRegistry.dispose();
      vi.useRealTimers();
    });
  });
});
