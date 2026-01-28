import { describe, it, expect, vi } from 'vitest';
import { AsyncLock } from '@/shared/concurrency/AsyncLock';

describe('AsyncLock', () => {
  describe('acquire and release', () => {
    it('should acquire and release lock', async () => {
      const lock = new AsyncLock();

      expect(lock.isLocked).toBe(false);

      const release = await lock.acquire();
      expect(lock.isLocked).toBe(true);

      release();
      expect(lock.isLocked).toBe(false);
    });

    it('should throw error when releasing unlocked lock', async () => {
      const lock = new AsyncLock();
      const release = await lock.acquire();

      release();

      expect(() => release()).toThrow('Cannot release an unlocked lock');
    });
  });

  describe('concurrent access', () => {
    it('should prevent concurrent access', async () => {
      const lock = new AsyncLock();
      const order: number[] = [];

      const task1 = lock.runExclusive(async () => {
        order.push(1);
        await delay(50);
        order.push(2);
      });

      const task2 = lock.runExclusive(async () => {
        order.push(3);
        await delay(10);
        order.push(4);
      });

      await Promise.all([task1, task2]);

      // task2 必须等待 task1 完成
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('should queue multiple waiters', async () => {
      const lock = new AsyncLock();
      const order: number[] = [];

      const tasks = [
        lock.runExclusive(async () => {
          order.push(1);
          await delay(20);
        }),
        lock.runExclusive(async () => {
          order.push(2);
        }),
        lock.runExclusive(async () => {
          order.push(3);
        })
      ];

      await Promise.all(tasks);

      expect(order).toEqual([1, 2, 3]);
      expect(lock.queueLength).toBe(0);
    });

    it('should track queue length', async () => {
      const lock = new AsyncLock();

      expect(lock.queueLength).toBe(0);

      const release = await lock.acquire();
      expect(lock.queueLength).toBe(0);

      const promise1 = lock.acquire();
      const promise2 = lock.acquire();

      await delay(10);
      expect(lock.queueLength).toBe(2);

      release();
      await promise1.then(r => r());

      expect(lock.queueLength).toBe(0);

      await promise2.then(r => r());
    });
  });

  describe('error handling', () => {
    it('should release lock even if function throws', async () => {
      const lock = new AsyncLock();

      await expect(
        lock.runExclusive(async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(lock.isLocked).toBe(false);
    });

    it('should allow next waiter when function throws', async () => {
      const lock = new AsyncLock();
      const order: number[] = [];

      const task1 = lock.runExclusive(async () => {
        order.push(1);
        throw new Error('Error in task1');
      }).catch(() => {});

      const task2 = lock.runExclusive(async () => {
        order.push(2);
      });

      await Promise.all([task1, task2]);

      expect(order).toEqual([1, 2]);
    });
  });

  describe('return value', () => {
    it('should return function result', async () => {
      const lock = new AsyncLock();

      const result = await lock.runExclusive(async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should support synchronous functions', async () => {
      const lock = new AsyncLock();

      const result = await lock.runExclusive(() => {
        return 'sync result';
      });

      expect(result).toBe('sync result');
    });
  });

  describe('performance', () => {
    it('should handle many concurrent tasks', async () => {
      const lock = new AsyncLock();
      let counter = 0;

      const tasks = Array.from({ length: 100 }, (_, i) =>
        lock.runExclusive(async () => {
          const current = counter;
          await delay(1);
          counter = current + 1;
        })
      );

      await Promise.all(tasks);

      expect(counter).toBe(100);
    });
  });
});

// Helper function
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
