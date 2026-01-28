import { resolveAssetPath } from "../socket/AssetsPrefix";

let docsApiPromise: Promise<void> | null = null;

export function loadDocsApi() {
  if (window.DocsAPI?.DocEditor) {
    return Promise.resolve();
  }
  if (docsApiPromise) {
    return docsApiPromise;
  }

  docsApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = resolveAssetPath("/web-apps/apps/api/documents/api.js");
    script.async = true;
    script.onload = () => {
      if (window.DocsAPI?.DocEditor) {
        resolve();
        return;
      }
      reject(new Error("DocsAPI failed to initialize"));
    };
    script.onerror = () => reject(new Error("Failed to load DocsAPI"));
    document.head.appendChild(script);
  });

  return docsApiPromise;
}
