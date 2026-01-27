import { FakeSocket } from "../socket/fake-socket";
import type { DocEditorConfig } from "../core/types";

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

export function injectGlobals(targetWindow: Window = window) {
  if (injectedWindows.has(targetWindow)) return;
  if (targetWindow === window) {
    installIframeIoPatch(targetWindow);
  }
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
