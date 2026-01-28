import { EditorError, ErrorCode } from '../shared/errors/EditorError';
import type { Disposable } from '../shared/utils/Disposable';

/**
 * 编辑器状态枚举
 */
export type EditorStateType =
  | 'idle'           // 空闲状态（未加载文档）
  | 'loading'        // 正在加载文档
  | 'ready'          // 文档已就绪，可以操作
  | 'saving'         // 正在保存
  | 'exporting'      // 正在导出
  | 'error'          // 错误状态
  | 'disposed';      // 已释放

/**
 * 状态转换监听器
 */
export type StateTransitionListener = (
  from: EditorStateType,
  to: EditorStateType
) => void;

/**
 * 允许的状态转换
 */
const ALLOWED_TRANSITIONS: Record<EditorStateType, EditorStateType[]> = {
  idle: ['loading', 'disposed'],
  loading: ['ready', 'error', 'disposed'],
  ready: ['saving', 'exporting', 'loading', 'error', 'disposed'],
  saving: ['ready', 'error', 'disposed'],
  exporting: ['ready', 'error', 'disposed'],
  error: ['loading', 'disposed'],
  disposed: [] // 终态，不能再转换
};

/**
 * 编辑器状态机
 *
 * 管理编辑器的生命周期状态，确保状态转换的合法性
 *
 * @example
 * ```typescript
 * const state = new EditorState();
 *
 * // 监听状态变化
 * state.onTransition((from, to) => {
 *   console.log(`State: ${from} → ${to}`);
 * });
 *
 * // 转换状态
 * await state.transition('loading');
 * await state.transition('ready');
 *
 * // 检查状态
 * if (state.canSave()) {
 *   await state.transition('saving');
 * }
 * ```
 */
export class EditorState implements Disposable {
  private current: EditorStateType = 'idle';
  private listeners = new Set<StateTransitionListener>();

  /**
   * 获取当前状态
   */
  get currentState(): EditorStateType {
    return this.current;
  }

  /**
   * 转换到新状态
   *
   * @param to - 目标状态
   * @throws {EditorError} 当转换不合法时
   */
  async transition(to: EditorStateType): Promise<void> {
    if (this.current === to) {
      // 已经是目标状态，不需要转换
      return;
    }

    // 检查转换是否合法
    if (!this.canTransitionTo(to)) {
      throw new EditorError(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Cannot transition from ${this.current} to ${to}`,
        undefined,
        { from: this.current, to }
      );
    }

    const from = this.current;
    this.current = to;

    // 通知所有监听器
    this.notifyListeners(from, to);
  }

  /**
   * 检查是否可以转换到指定状态
   */
  canTransitionTo(to: EditorStateType): boolean {
    const allowed = ALLOWED_TRANSITIONS[this.current];
    return allowed.includes(to);
  }

  /**
   * 检查是否可以保存
   */
  canSave(): boolean {
    return this.current === 'ready';
  }

  /**
   * 检查是否可以导出
   */
  canExport(): boolean {
    return this.current === 'ready';
  }

  /**
   * 检查是否可以打开新文档
   */
  canOpen(): boolean {
    return this.current === 'idle' || this.current === 'ready' || this.current === 'error';
  }

  /**
   * 检查是否处于空闲状态
   */
  isIdle(): boolean {
    return this.current === 'idle';
  }

  /**
   * 检查是否已就绪
   */
  isReady(): boolean {
    return this.current === 'ready';
  }

  /**
   * 检查是否正在加载
   */
  isLoading(): boolean {
    return this.current === 'loading';
  }

  /**
   * 检查是否处于错误状态
   */
  isError(): boolean {
    return this.current === 'error';
  }

  /**
   * 检查是否已释放
   */
  isDisposed(): boolean {
    return this.current === 'disposed';
  }

  /**
   * 添加状态转换监听器
   *
   * @returns 移除监听器的函数
   */
  onTransition(listener: StateTransitionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(from: EditorStateType, to: EditorStateType): void {
    for (const listener of this.listeners) {
      try {
        listener(from, to);
      } catch (error) {
        // 防止监听器错误影响状态转换
        console.error('State transition listener error:', error);
      }
    }
  }

  /**
   * 清除所有监听器
   */
  clearListeners(): void {
    this.listeners.clear();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    if (this.current !== 'disposed') {
      const from = this.current;
      this.current = 'disposed';
      this.notifyListeners(from, 'disposed');
    }
    this.clearListeners();
  }
}
