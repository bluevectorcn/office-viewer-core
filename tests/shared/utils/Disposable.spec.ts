import { describe, it, expect, beforeEach } from 'vitest';
import {
  Disposable,
  DisposableGroup,
  isDisposable,
  toDisposable,
  using
} from '@/shared/utils/Disposable';

describe('Disposable', () => {
  describe('isDisposable', () => {
    it('should return true for objects with dispose method', () => {
      const obj = { dispose: () => {} };
      expect(isDisposable(obj)).toBe(true);
    });

    it('should return false for objects without dispose method', () => {
      expect(isDisposable({})).toBe(false);
      expect(isDisposable(null)).toBe(false);
      expect(isDisposable(undefined)).toBe(false);
      expect(isDisposable(42)).toBe(false);
    });
  });

  describe('DisposableGroup', () => {
    let group: DisposableGroup;

    beforeEach(() => {
      group = new DisposableGroup();
    });

    it('should add and dispose items in reverse order', () => {
      const order: number[] = [];

      group.add({ dispose: () => order.push(1) });
      group.add({ dispose: () => order.push(2) });
      group.add({ dispose: () => order.push(3) });

      group.dispose();

      expect(order).toEqual([3, 2, 1]); // LIFO
    });

    it('should return added item', () => {
      const item = { dispose: () => {} };
      const returned = group.add(item);

      expect(returned).toBe(item);
    });

    it('should be idempotent when disposing', () => {
      let count = 0;
      group.add({ dispose: () => count++ });

      group.dispose();
      group.dispose();
      group.dispose();

      expect(count).toBe(1);
    });

    it('should throw when adding to disposed group', () => {
      group.dispose();

      expect(() => {
        group.add({ dispose: () => {} });
      }).toThrow('Cannot add to disposed DisposableGroup');
    });

    it('should handle errors in dispose gracefully', () => {
      const order: number[] = [];

      group.add({ dispose: () => order.push(1) });
      group.add({ dispose: () => { throw new Error('Dispose error'); } });
      group.add({ dispose: () => order.push(3) });

      expect(() => group.dispose()).not.toThrow();
      expect(order).toEqual([3, 1]); // 即使中间出错，其他仍会释放
    });

    it('should track disposed state', () => {
      expect(group.isDisposed).toBe(false);
      group.dispose();
      expect(group.isDisposed).toBe(true);
    });

    it('should track item count', () => {
      expect(group.count).toBe(0);
      group.add({ dispose: () => {} });
      expect(group.count).toBe(1);
      group.add({ dispose: () => {} });
      expect(group.count).toBe(2);
      group.dispose();
      expect(group.count).toBe(0);
    });

    it('should support addCleanup for functions', () => {
      let cleaned = false;
      group.addCleanup(() => {
        cleaned = true;
      });

      group.dispose();
      expect(cleaned).toBe(true);
    });
  });

  describe('toDisposable', () => {
    it('should create disposable from function', () => {
      let cleaned = false;
      const disposable = toDisposable(() => {
        cleaned = true;
      });

      expect(isDisposable(disposable)).toBe(true);
      disposable.dispose();
      expect(cleaned).toBe(true);
    });
  });

  describe('using', () => {
    it('should auto-dispose after async function', async () => {
      let disposed = false;
      const resource = {
        value: 42,
        dispose: () => { disposed = true; }
      };

      const result = await using(resource, async (r) => {
        expect(disposed).toBe(false);
        return r.value * 2;
      });

      expect(result).toBe(84);
      expect(disposed).toBe(true);
    });

    it('should dispose even when function throws', async () => {
      let disposed = false;
      const resource = {
        dispose: () => { disposed = true; }
      };

      await expect(
        using(resource, async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(disposed).toBe(true);
    });
  });
});
