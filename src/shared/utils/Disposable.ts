/**
 * 资源释放接口
 *
 * 所有需要手动清理资源的对象都应该实现此接口
 */
export interface Disposable {
  /**
   * 释放资源
   *
   * 该方法应该是幂等的，多次调用应该安全
   */
  dispose(): void;
}

/**
 * 检查对象是否实现了 Disposable 接口
 */
export function isDisposable(obj: unknown): obj is Disposable {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'dispose' in obj &&
    typeof (obj as any).dispose === 'function'
  );
}

/**
 * Disposable 组，用于批量管理和释放资源
 *
 * @example
 * ```typescript
 * class MyComponent implements Disposable {
 *   private disposables = new DisposableGroup();
 *
 *   constructor() {
 *     this.disposables.add(resourceManager);
 *     this.disposables.add(socketRegistry);
 *   }
 *
 *   dispose() {
 *     this.disposables.dispose(); // 一次性释放所有资源
 *   }
 * }
 * ```
 */
export class DisposableGroup implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;

  /**
   * 添加一个 Disposable 对象到组中
   *
   * @returns 返回添加的对象本身，方便链式调用
   * @throws 如果组已被释放，抛出错误
   */
  add<T extends Disposable>(item: T): T {
    if (this.disposed) {
      throw new Error('Cannot add to disposed DisposableGroup');
    }

    this.items.push(item);
    return item;
  }

  /**
   * 添加一个清理函数
   *
   * @example
   * ```typescript
   * disposables.addCleanup(() => {
   *   clearInterval(timer);
   * });
   * ```
   */
  addCleanup(cleanup: () => void): void {
    this.add({
      dispose: cleanup
    });
  }

  /**
   * 释放所有资源（逆序释放，后进先出）
   *
   * 该方法是幂等的，多次调用安全
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    // 逆序释放（后进先出，类似栈）
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i].dispose();
      } catch (error) {
        // 继续释放其他资源，但记录错误
        console.error('Error disposing item:', error);
      }
    }

    this.items.length = 0;
  }

  /**
   * 检查是否已释放
   */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * 获取管理的资源数量
   */
  get count(): number {
    return this.items.length;
  }
}

/**
 * 创建一个简单的 Disposable 对象
 *
 * @example
 * ```typescript
 * const disposable = toDisposable(() => {
 *   console.log('cleaned up');
 * });
 * ```
 */
export function toDisposable(cleanup: () => void): Disposable {
  return {
    dispose: cleanup
  };
}

/**
 * 使用 using 语法糖的辅助函数（模拟 TC39 提案）
 *
 * @example
 * ```typescript
 * await using(createResource(), async (resource) => {
 *   // 使用资源
 * }); // 自动调用 dispose
 * ```
 */
export async function using<T extends Disposable, R>(
  resource: T,
  fn: (resource: T) => Promise<R>
): Promise<R> {
  try {
    return await fn(resource);
  } finally {
    resource.dispose();
  }
}
