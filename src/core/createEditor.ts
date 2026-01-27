import type {
  CreateEditorOptions,
  DocEditorConfig,
  EditorInput,
  ExportFormat,
  OnlyOfficeEditor,
} from "./types";
import { createId, createReadyLatch, revokeObjectUrl } from "./lifecycle";
import { injectGlobals, exposeDocEditorConfig, injectIntoIframe } from "../bootstrap/inject";
import { prepareInput, convertWithX2T } from "../input/openFile";
import { exportWithX2T, initX2TModule } from "../x2t/service";
import { registerDocumentAssets, clearDocumentAssets } from "../socket/assets";

const DOCS_API_URL = "/vendor/onlyoffice/web-apps/apps/api/documents/api.js";

let docsApiPromise: Promise<void> | null = null;

type DocEditorInstance = {
  destroyEditor?: () => void;
  downloadAs?: (format: string | Record<string, unknown>) => void;
};

type PendingDownload = {
  format: ExportFormat;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  timer: number;
};

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
  onReady: () => void,
  onDownloadAs: (event: unknown) => void
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
        chat: false
      },
    },
    editorConfig: {
        mode: "edit",
        lang,
        canCoAuthoring: false,
        user: {
          id: "1",
          name: "user",
          group: "user"
        },
        customization: {
          compactHeader: true,
          spellcheck: false,
          // logo: {
          //     "image": "https://res.airrnd.com/disk/load/20260123/031605/dfvn5170hz4ikx.png",
          //     "url": "https://www.baidu.com",
          //     visible: true
          // },
          // customer: {
          //   name: 'SuperPuper',
          //   address: 'New-York, 125f-25',
          //   mail: 'support@gmail.com',
          //   www: 'www.superpuper.com',
          //   phone: '1234567890',
          //   info: 'Some info',
          //   logo: '',
          //   logoDark: '', // logo for dark theme
          // },
        },
        coEditing: {
          mode: "strict",
          change: false
        }
      },
    events: {
      onAppReady: onReady,
      onDocumentReady: onReady,
      onDownloadAs,
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

  let editorInstance: DocEditorInstance | null = null;
  let lastObjectUrl: string | null = null;
  let lastSourceBlob: Blob | null = null;
  let lastUrl: string | null = null;
  let lastTitle = "document.docx";
  let lastDocKey: string | null = null;
  let lastImageUrls: string[] = [];
  let pendingDownload: PendingDownload | null = null;

  const revokeImages = () => {
    lastImageUrls.forEach((url) => revokeObjectUrl(url));
    lastImageUrls = [];
  };

  function clearPendingDownload(error?: unknown) {
    if (!pendingDownload) return;
    clearTimeout(pendingDownload.timer);
    const current = pendingDownload;
    pendingDownload = null;
    if (error !== undefined) {
      current.reject(error);
    }
  }

  async function handleDownloadAs(event: unknown) {
    const payload =
      event && typeof event === "object" && "data" in event
        ? (event as { data?: unknown }).data ?? event
        : event;
    const url =
      payload && typeof payload === "object" && "url" in payload
        ? String((payload as { url?: unknown }).url ?? "")
        : "";

    if (!url) {
      if (pendingDownload) {
        clearPendingDownload(new Error("onDownloadAs missing url"));
      }
      return;
    }

    if (!pendingDownload) {
      const link = document.createElement("a");
      link.href = url;
      link.download = lastTitle || "document.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download fetch failed: ${response.status}`);
      }
      const blob = await response.blob();
      const current = pendingDownload;
      pendingDownload = null;
      if (current) {
        clearTimeout(current.timer);
        current.resolve(blob);
      }
    } catch (error) {
      clearPendingDownload(error);
    }
  }

  function requestDownload(format: ExportFormat) {
    return new Promise<Blob>((resolve, reject) => {
      if (!editorInstance?.downloadAs) {
        reject(new Error("DocEditor downloadAs is not available"));
        return;
      }

      clearPendingDownload(new Error("Superseded by a new download request"));
      const timer = window.setTimeout(() => {
        clearPendingDownload(new Error(`downloadAs(${format}) timed out`));
      }, 15000);

      pendingDownload = { format, resolve, reject, timer };
      editorInstance.downloadAs(format);
    });
  }

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
    const originUrl = URL.createObjectURL(prepared.file);
    lastImageUrls = Object.values(resolved.images);
    registerDocumentAssets(lastDocKey, {
      editorUrl: resolved.url,
      originUrl,
      images: resolved.images,
      mediaData: resolved.mediaData,
      fileType: resolved.fileType,
      title: resolved.title,
    });

    if (editorInstance?.destroyEditor) {
      editorInstance.destroyEditor();
    }

    const ready = createReadyLatch();
    const config = buildConfig(resolved, options, lastDocKey, ready.resolve, handleDownloadAs);
    exposeDocEditorConfig(config);

    editorInstance = new window.DocsAPI!.DocEditor(hostId, config);

    await ready.promise;
  }

  async function save() {
    try {
      const downloaded = await requestDownload("docx");
      lastSourceBlob = downloaded;
      return downloaded;
    } catch (error) {
      console.warn("downloadAs(docx) failed, falling back to source blob", error);
    }

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

  async function exportDoc(format: ExportFormat) {
    if (format !== "docx") {
      try {
        const downloaded = await requestDownload(format);
        lastSourceBlob = downloaded;
        return downloaded;
      } catch (error) {
        console.warn(`downloadAs(${format}) failed, falling back to x2t export`, error);
      }
    }

    const source = await save();
    return await exportWithX2T(source, format);
  }

  function destroy() {
    if (editorInstance?.destroyEditor) {
      editorInstance.destroyEditor();
    }
    editorInstance = null;
    clearPendingDownload();
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
