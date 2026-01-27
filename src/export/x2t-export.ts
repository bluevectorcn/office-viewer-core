import initX2T from "./x2t.js";
import type { ExportFormat } from "../core/types";

export interface X2TModule {
  instance?: WebAssembly.Instance;
  exports?: WebAssembly.Exports;
}

let initPromise: Promise<X2TModule> | null = null;

export async function initX2TModule() {
  if (!initPromise) {
    initPromise = initX2T({
      locateFile: (file: string) => `/wasm/x2t/${file}`,
    }) as Promise<X2TModule>;
  }
  return initPromise;
}

export async function exportWithX2T(source: Blob, format: ExportFormat) {
  await initX2TModule();
  if (format === "docx") return source;
  return source;
}
