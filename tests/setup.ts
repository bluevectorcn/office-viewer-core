import { afterEach, beforeEach } from 'vitest';

// 全局测试设置
beforeEach(() => {
  // 每个测试前清理环境
});

afterEach(() => {
  // 每个测试后清理
});

// 模拟 import.meta.env
if (typeof global !== 'undefined') {
  (global as any).import = {
    meta: {
      env: {
        VITE_USE_NEW_ARCH: 'true',
        VITE_NEW_SOCKET: 'true'
      }
    }
  };
}

// 导出测试工具函数
export function forceGC(): Promise<void> {
  return new Promise((resolve) => {
    if (global.gc) {
      global.gc();
      setTimeout(resolve, 100);
    } else {
      resolve();
    }
  });
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function waitForCleanup(): Promise<void> {
  return delay(200);
}

export function getObjectUrlCount(): number {
  // 这是一个模拟函数，实际实现需要跟踪 URL.createObjectURL 调用
  return 0;
}
