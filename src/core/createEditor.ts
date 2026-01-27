import type { CreateEditorOptions, DocEditorConfig, EditorInput, OnlyOfficeEditor } from "./types";
import { createId, createReadyLatch, revokeObjectUrl } from "./lifecycle";
import { injectGlobals, exposeDocEditorConfig, injectIntoIframe } from "../bootstrap/inject";
import { prepareInput, convertWithX2T } from "../input/openFile";
import { exportWithX2T, initX2TModule } from "../export/x2t-export";
import { registerDocumentAssets, clearDocumentAssets } from "../socket/assets";

const DOCS_API_URL = "/vendor/onlyoffice/web-apps/apps/api/documents/api.js";

let docsApiPromise: Promise<void> | null = null;

function loadDocsApi() {
  if (window.DocsAPI?.DocEditor) return Promise.resolve();
  if (docsApiPromise) return docsApiPromise;

  docsApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = DOCS_API_URL;
    script.async = true;
    script.onload = () => {
      if (window.DocsAPI?.DocEditor) {
        resolve();
      } else {
        reject(new Error("DocsAPI failed to initialize"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load DocsAPI"));
    document.head.appendChild(script);
  });

  return docsApiPromise;
}

function buildConfig(
  input: {
    url: string;
    fileType: string;
    title: string;
    documentType: "word" | "cell" | "slide";
  },
  options: CreateEditorOptions | undefined,
  docKey: string,
  onReady: () => void
): DocEditorConfig {
  const lang = options?.lang ?? "zh";
  return {
    width: "100%",
    height: "100%",
    type: "desktop",
    documentType: input.documentType,
    document: {
      url: input.url,
      fileType: input.fileType,
      title: input.title,
      key: docKey,
      permissions: {
        edit: true,
        print: true,
        download: true,
        fillForms: true,
        review: true,
        comment: true,
        modifyFilter: true,
        modifyContentControl: true,
        chat: true
      },
    },
    editorConfig: {
        mode: "edit",
        lang,
        user: {
          id: "1",
          name: "user",
          group: "user"
        },
        customization: {
          compactHeader: true,
          forcesave: false,
          uiTheme: "theme-classic-light",
        },
        coEditing: {
          mode: "fast",
          change: true
        }
      },
    events: {
      onAppReady: onReady,
      onDocumentReady: onReady,
      onError: (error) => {
        console.error("OnlyOffice error", error);
      },
    },
  };
}

function observeEditorIframes(container: HTMLElement) {
  const seen = new WeakSet<HTMLIFrameElement>();

  const handleFrame = (frame: HTMLIFrameElement) => {
    if (seen.has(frame)) return;
    seen.add(frame);
    injectIntoIframe(frame);
  };

  const scanNode = (node: Node) => {
    if (node instanceof HTMLIFrameElement) {
      handleFrame(node);
      return;
    }
    if (node instanceof HTMLElement) {
      node.querySelectorAll("iframe").forEach(handleFrame);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scanNode);
    }
  });

  observer.observe(container, { childList: true, subtree: true });
  container.querySelectorAll("iframe").forEach(handleFrame);

  return () => observer.disconnect();
}

export function createEditor(
  container: HTMLElement,
  options?: CreateEditorOptions
): OnlyOfficeEditor {
  injectGlobals();

  const host = document.createElement("div");
  host.className = "editor-host";
  const hostId = createId("oo-editor");
  host.id = hostId;
  container.appendChild(host);
  const stopObservingFrames = observeEditorIframes(document.documentElement || host);

  let editorInstance: { destroyEditor?: () => void } | null = null;
  let lastObjectUrl: string | null = null;
  let lastSourceBlob: Blob | null = null;
  let lastUrl: string | null = null;
  let lastTitle = "document.docx";
  let lastDocKey: string | null = null;
  let lastImageUrls: string[] = [];

  const revokeImages = () => {
    lastImageUrls.forEach((url) => revokeObjectUrl(url));
    lastImageUrls = [];
  };

  async function open(input: EditorInput) {
    injectGlobals();
    await loadDocsApi();
    await initX2TModule();

    const prepared = await prepareInput(input);
    const resolved = await convertWithX2T(prepared);

    revokeObjectUrl(lastObjectUrl);
    revokeImages();
    if (lastDocKey) {
      clearDocumentAssets(lastDocKey);
    }
    lastObjectUrl = resolved.objectUrl;
    lastSourceBlob = prepared.file;
    lastUrl = resolved.url;
    lastTitle = resolved.title;
    lastDocKey = createId("doc");
    lastImageUrls = Object.values(resolved.images);
    registerDocumentAssets(lastDocKey, {
      editorUrl: resolved.url,
      images: resolved.images,
      fileType: resolved.fileType,
    });

    if (editorInstance?.destroyEditor) {
      editorInstance.destroyEditor();
    }

    const ready = createReadyLatch();
    const config = buildConfig(resolved, options, lastDocKey, ready.resolve);
    exposeDocEditorConfig(config);

    editorInstance = new window.DocsAPI!.DocEditor(hostId, config);

    await ready.promise;
  }

  async function save() {
    if (lastSourceBlob) return lastSourceBlob;
    if (lastUrl) {
      try {
        const response = await fetch(lastUrl);
        if (response.ok) {
          return await response.blob();
        }
      } catch {
        // Ignore fetch errors and fall through to an empty blob.
      }
    }
    return new Blob([], { type: "application/octet-stream" });
  }

  async function exportDoc(format: "pdf" | "docx") {
    const source = await save();
    return await exportWithX2T(source, format);
  }

  function destroy() {
    if (editorInstance?.destroyEditor) {
      editorInstance.destroyEditor();
    }
    editorInstance = null;
    revokeObjectUrl(lastObjectUrl);
    lastObjectUrl = null;
    revokeImages();
    if (lastDocKey) {
      clearDocumentAssets(lastDocKey);
    }
    lastDocKey = null;
    lastSourceBlob = null;
    host.remove();
    stopObservingFrames();
  }

  return {
    open,
    save,
    export: exportDoc,
    destroy,
  };
}
