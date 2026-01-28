export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createReadyLatch(timeoutMs = 6000) {
  let resolved = false;
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
  });

  const timer = setTimeout(() => {
    resolveFn();
  }, timeoutMs);

  const resolve = () => {
    if (resolved) return;
    clearTimeout(timer);
    resolveFn();
  };

  return { promise, resolve };
}

export function revokeObjectUrl(url?: string | null) {
  if (!url) return;
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}
