/**
 * 异步锁 - 用于保护并发访问的共享资源
 *
 * 解决 fake-socket.ts 中的锁管理问题（阶段 2.1）：
 * - 修复 getLock 后立即 releaseLocks 的 BUG
 * - 提供正确的异步锁机制
 * - 支持自动释放和手动释放两种模式
 *
 * @example
 * ```typescript
 * const lock = new AsyncLock();
 *
 * // 方式 1：手动控制
 * const release = await lock.acquire();
 * try {
 *   // 受保护的代码
 * } finally {
 *   release();
 * }
 *
 * // 方式 2：自动释放（推荐）
 * await lock.runExclusive(async () => {
 *   // 受保护的代码
 * });
 * ```
 */
export class AsyncLock {
  private locked = false;
  private queue: Array<() => void> = [];

  /**
   * 获取锁
   *
   * @returns 释放函数，调用后释放锁
   */
  async acquire(): Promise<() => void> {
    // 如果锁已被占用，加入队列等待
    while (this.locked) {
      await new Promise<void>(resolve => {
        this.queue.push(resolve);
      });
    }

    // 获取锁
    this.locked = true;

    // 返回释放函数
    return () => {
      this.release();
    };
  }

  /**
   * 释放锁
   *
   * @private
   */
  private release(): void {
    if (!this.locked) {
      throw new Error('AsyncLock: Cannot release an unlocked lock');
    }

    this.locked = false;

    // 唤醒队列中的下一个等待者
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * 在排他锁内执行函数
   *
   * 自动处理锁的获取和释放，即使函数抛出异常也能正确释放
   *
   * @param fn - 要执行的异步函数
   * @returns 函数的返回值
   */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * 检查锁是否被占用
   */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * 获取等待队列长度
   */
  get queueLength(): number {
    return this.queue.length;
  }
}
