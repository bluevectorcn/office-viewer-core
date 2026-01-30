import { FakeSocket } from "../../infrastructure/socket/FakeSocket";
import type { DocEditorConfig } from "../../shared/types/EditorTypes";
import { installLocalEndpointPatch } from "../../infrastructure/network/NetworkPatch";

const injectedWindows = new WeakSet<Window>();
const patchedWindows = new WeakSet<Window>();
const patchKey = "__ooIframeIoPatch";

function preInjectFrame(frame: HTMLIFrameElement) {
  try {
    const win = frame.contentWindow;
    if (win) {
      injectGlobals(win);
      return;
    }
  } catch {
    // Ignore cross-origin or access errors.
  }
}

function installIframeIoPatch(targetWindow: Window) {
  const marker = targetWindow as Window & { [patchKey]?: boolean };
  if (patchedWindows.has(targetWindow) || marker[patchKey]) return;
  marker[patchKey] = true;
  patchedWindows.add(targetWindow);

  const proto = (
    targetWindow as typeof window & { HTMLIFrameElement?: typeof HTMLIFrameElement }
  ).HTMLIFrameElement?.prototype;
  if (!proto) return;

  const srcDescriptor = Object.getOwnPropertyDescriptor(proto, "src");
  if (srcDescriptor?.configurable) {
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: srcDescriptor.enumerable ?? true,
      get() {
        return srcDescriptor.get?.call(this);
      },
      set(value) {
        preInjectFrame(this);
        try {
          injectIntoIframe(this);
        } catch {
          // Ignore injection failures.
        }
        srcDescriptor.set?.call(this, value);
      },
    });
  }

  const originalSetAttribute = proto.setAttribute;
  proto.setAttribute = function patchedSetAttribute(this: HTMLIFrameElement, name: string, value: string) {
    if (name.toLowerCase() === "src") {
      preInjectFrame(this);
      try {
        injectIntoIframe(this);
      } catch {
        // Ignore injection failures.
      }
    }
    return originalSetAttribute.call(this, name, value);
  };
}

/**
 * 运行时修复 Button.js Bug
 *
 * Button.prototype.updateHint 和 createHint 缺失对 hint 的空值检查。
 * 当 lang!=en 时，部分按钮（如评论按钮）的提示文字可能为 undefined，导致尝试读取 hint[0] 时崩溃。
 */
function installButtonPatch(targetWindow: Window) {
  const win = targetWindow as any;
  const patch = () => {
    const Button = win.Common?.UI?.Button;
    if (Button && Button.prototype && !Button.prototype.__patched) {
      const originalUpdateHint = Button.prototype.updateHint;
      Button.prototype.updateHint = function (this: any, hint: any, isHtml: boolean) {
        // 防御性处理：如果 hint 为空，转为空字符串防止 hint[0] 报错
        const safeHint = hint === undefined || hint === null ? "" : hint;
        return originalUpdateHint.call(this, safeHint, isHtml);
      };

      const originalCreateHint = Button.prototype.createHint;
      Button.prototype.createHint = function (this: any, hint: any, isHtml: boolean) {
        const safeHint = hint === undefined || hint === null ? (this.options?.hint || "") : hint;
        return originalCreateHint.call(this, safeHint, isHtml);
      };

      Button.prototype.__patched = true;
    } else if (!Button) {
      // 轮询直到 Common.UI.Button 被加载（OnlyOffice 内部是异步加载组件的）
      setTimeout(patch, 50);
    }
  };
  patch();
}

export function injectGlobals(targetWindow: Window = window) {
  if (injectedWindows.has(targetWindow)) return;
  if (targetWindow === window) {
    installIframeIoPatch(targetWindow);
  }

  installLocalEndpointPatch(targetWindow);
  installButtonPatch(targetWindow);

  const globalWindow = targetWindow as typeof window & {
    io?: (options?: unknown) => FakeSocket;
  };

  const factory = function io(options?: unknown) {
    return new FakeSocket(options as ConstructorParameters<typeof FakeSocket>[0]);
  };

  try {
    Object.defineProperty(globalWindow, "io", {
      configurable: true,
      enumerable: true,
      get: () => factory,
      set: () => {
        // Keep the injected factory to block later overrides.
      },
    });
  } catch {
    globalWindow.io = factory;
  }

  injectedWindows.add(targetWindow);
}

export function injectIntoIframe(iframe: HTMLIFrameElement) {
  let tries = 0;
  const maxTries = 60;

  const apply = () => {
    const win = iframe.contentWindow;
    if (win) {
      injectGlobals(win);
      return true;
    }
    return false;
  };

  const retry = () => {
    if (apply()) return;
    tries += 1;
    if (tries < maxTries) {
      requestAnimationFrame(retry);
    }
  };

  retry();
  iframe.addEventListener("load", () => {
    apply();
  });
}

export function exposeDocEditorConfig(config: DocEditorConfig) {
  (window as typeof window & { DocEditorConfig?: DocEditorConfig }).DocEditorConfig = config;
}
