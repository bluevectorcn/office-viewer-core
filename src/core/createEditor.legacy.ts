import type { DocEditorConfig, EditorInput, ExportFormat, OnlyOfficeEditor } from "./types";
import { createId, createReadyLatch, revokeObjectUrl } from "./lifecycle";
import { injectGlobals, exposeDocEditorConfig } from "../bootstrap/inject";
import { prepareInput, convertWithX2T } from "../input/openFile";
import { exportWithX2T, initX2TModule } from "../x2t/service";
import { emptyDocx, emptyPptx, emptyXlsx } from "../x2t/empty";
import { registerDocumentAssets, clearDocumentAssets } from "../socket/assets";
import { loadDocsApi } from "./docsApi";
import { observeEditorIframes } from "./iframeObserver";
import { buildEditorConfig } from "./config";
import { setAssetsPrefix } from "./assets";

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

type InternalDownloadFlag = {
  docId: string;
  expiresAt: number;
};

const INTERNAL_DOWNLOAD_TTL_MS = 20_000;
type NewFileFormat = "docx" | "xlsx" | "pptx";

export function createEditor(container: HTMLElement, baseConfig: DocEditorConfig): OnlyOfficeEditor {
  injectGlobals();
  setAssetsPrefix(baseConfig.assetsPrefix);

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
  let lastNativeFormat: ExportFormat = "docx";
  let lastImageUrls: string[] = [];
  let pendingDownload: PendingDownload | null = null;

  const revokeImages = () => {
    lastImageUrls.forEach((url) => revokeObjectUrl(url));
    lastImageUrls = [];
  };

  function setInternalDownloadFlag(docId: string | null) {
    const win = window as Window & { __ooInternalDownload?: InternalDownloadFlag };
    if (!docId) {
      delete win.__ooInternalDownload;
      return;
    }
    win.__ooInternalDownload = {
      docId,
      expiresAt: Date.now() + INTERNAL_DOWNLOAD_TTL_MS,
    };
  }

  function clearInternalDownloadFlag(docId?: string | null) {
    const win = window as Window & { __ooInternalDownload?: InternalDownloadFlag };
    const current = win.__ooInternalDownload;
    if (!current) return;
    if (docId && current.docId !== docId) return;
    delete win.__ooInternalDownload;
  }

  function clearPendingDownload(error?: unknown) {
    if (!pendingDownload) return;
    clearTimeout(pendingDownload.timer);
    const current = pendingDownload;
    pendingDownload = null;
    clearInternalDownloadFlag(lastDocKey);
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
        clearInternalDownloadFlag(lastDocKey);
        current.resolve(blob);
      }
    } catch (error) {
      clearPendingDownload(error);
    }
  }

  function nativeFormatFromDocumentType(documentType: "word" | "cell" | "slide" | "pdf"): ExportFormat {
    if (documentType === "cell") return "xlsx";
    if (documentType === "slide") return "pptx";
    if (documentType === "pdf") return "pdf";
    return "docx";
  }

  function toBinaryBytes(data: string): Uint8Array {
    const buffer = new ArrayBuffer(data.length);
    const view = new Uint8Array(buffer);
    for (let index = 0; index < data.length; index += 1) {
      view[index] = data.charCodeAt(index);
    }
    return view;
  }

  function createEmptyFile(format: NewFileFormat): File {
    const mimeByFormat: Record<NewFileFormat, string> = {
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    const templateByFormat: Record<NewFileFormat, string> = {
      docx: emptyDocx,
      xlsx: emptyXlsx,
      pptx: emptyPptx,
    };

    const bytes = toBinaryBytes(templateByFormat[format]);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new File([buffer], `document.${format}`, { type: mimeByFormat[format] });
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
      setInternalDownloadFlag(lastDocKey);
      editorInstance.downloadAs(format);
    });
  }

  async function open(input: EditorInput) {
    injectGlobals();
    setAssetsPrefix(baseConfig.assetsPrefix);
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
    lastNativeFormat = nativeFormatFromDocumentType(resolved.documentType);
    clearInternalDownloadFlag();

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
    const config = buildEditorConfig(baseConfig, resolved, lastDocKey, {
      onAppReady: ready.resolve,
      onDocumentReady: ready.resolve,
      onDownloadAs: handleDownloadAs,
      onError: (error) => {
        console.error("OnlyOffice error", error);
      },
    });

    exposeDocEditorConfig(config);
    editorInstance = new window.DocsAPI!.DocEditor(hostId, config);

    await ready.promise;
  }

  async function save() {
    try {
      const downloaded = await requestDownload(lastNativeFormat);
      lastSourceBlob = downloaded;
      return downloaded;
    } catch (error) {
      console.warn(`downloadAs(${lastNativeFormat}) failed, falling back to source blob`, error);
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
    if (format === lastNativeFormat) {
      return await save();
    }

    if (format !== lastNativeFormat) {
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

  async function newFile(format: NewFileFormat) {
    const file = createEmptyFile(format);
    await open(file);
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
    clearInternalDownloadFlag();
    lastSourceBlob = null;
    host.remove();
    stopObservingFrames();
  }

  function shouldAutoOpen(url: unknown) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed === "data:," || trimmed.startsWith("data:,")) return false;
    try {
      const parsed = new URL(trimmed, window.location.href);
      return parsed.protocol !== "data:";
    } catch {
      return false;
    }
  }

  setTimeout(() => {
    const url = baseConfig?.document?.url;
    if (shouldAutoOpen(url)) {
      void open(url as string);
    }
  }, 0);

  return {
    open,
    newFile,
    save,
    export: exportDoc,
    destroy,
  };
}
