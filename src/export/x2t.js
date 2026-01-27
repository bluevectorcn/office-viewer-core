let initPromise = null;

function loadLegacyX2T(options = {}) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Legacy x2t.js requires a browser window"));
  }

  return new Promise((resolve, reject) => {
    const existing = window.Module && typeof window.Module === "object" ? window.Module : {};
    const moduleConfig = {
      ...existing,
      ...options,
      locateFile: options.locateFile || existing.locateFile,
      onRuntimeInitialized: () => resolve(moduleConfig),
    };

    window.Module = moduleConfig;

    const script = document.createElement("script");
    script.src = "/wasm/x2t/x2t.js";
    script.async = true;
    script.onload = () => {
      if (moduleConfig.calledRun || moduleConfig._main || moduleConfig.asm) {
        resolve(moduleConfig);
      }
    };
    script.onerror = () => reject(new Error("Failed to load legacy x2t.js"));
    document.head.appendChild(script);
  });
}

export default function initX2T(options = {}) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const mod = await import("../../wasm/x2t/x2t.js");
      if (typeof mod.default === "function") {
        return await mod.default(options);
      }
      if (mod.default) {
        return mod.default;
      }
    } catch {
      // Fall back to legacy loader.
    }
    return loadLegacyX2T(options);
  })();
  return initPromise;
}
