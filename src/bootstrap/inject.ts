import { FakeSocket, emitServerMessage } from "../socket/fake-socket";
import { createId } from "../core/lifecycle";
import type { DocEditorConfig, ExportFormat } from "../core/types";
import { exportWithX2T, initX2TModule } from "../export/x2t-export";
import { getDocumentAssets, registerDownloadUrl } from "../socket/assets";

const injectedWindows = new WeakSet<Window>();
const patchedWindows = new WeakSet<Window>();
const patchKey = "__ooIframeIoPatch";
const endpointPatchedWindows = new WeakSet<Window>();
const endpointPatchKey = "__ooLocalEndpointPatch";
const DEBUG_LOCAL_SAVE = Boolean((import.meta as any)?.env?.VITE_OO_DEBUG_LOCAL_SAVE);

type SaveSession = {
  docId: string;
  savekey: string;
  cmd: Record<string, unknown>;
  chunks: Uint8Array[];
};

const saveSessions = new Map<string, SaveSession>();

function debugLog(...args: unknown[]) {
  if (!DEBUG_LOCAL_SAVE) return;
  try {
    console.debug("[oo-local]", ...args);
  } catch {
    // Ignore logging failures.
  }
}

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

function shouldInterceptUrl(targetWindow: Window, rawUrl: string) {
  if (!/\/(downloadas|savefile)\//i.test(rawUrl)) return false;
  try {
    const parsed = new URL(rawUrl, targetWindow.location.href);
    return parsed.searchParams.has("cmd");
  } catch {
    return false;
  }
}

function parseUrlAndCmd(targetWindow: Window, rawUrl: string) {
  let parsed: URL | null = null;
  try {
    parsed = new URL(rawUrl, targetWindow.location.href);
  } catch {
    return { parsed: null, cmd: {} as Record<string, unknown> };
  }

  const cmdParam = parsed.searchParams.get("cmd");
  if (!cmdParam) {
    return { parsed, cmd: {} as Record<string, unknown> };
  }

  try {
    const cmd = JSON.parse(cmdParam) as Record<string, unknown>;
    return { parsed, cmd };
  } catch {
    return { parsed, cmd: {} as Record<string, unknown> };
  }
}

function extractDocId(parsed: URL, cmd: Record<string, unknown>) {
  const cmdId = cmd.id;
  if (typeof cmdId === "string" && cmdId) return cmdId;

  const parts = parsed.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last || parsed.href;
}

function getExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function ensureExtension(title: string, ext: string) {
  const current = getExtension(title);
  if (!current) return `${title}.${ext}`;
  if (current === ext) return title;
  return title.slice(0, -(current.length + 1)) + `.${ext}`;
}

function resolveOutputExtension(
  targetWindow: Window,
  cmd: Record<string, unknown>,
  assets: ReturnType<typeof getDocumentAssets> | undefined
) {
  const ugI = (targetWindow as typeof window & { AscCommon?: { UGi?: (value: unknown) => string } })
    .AscCommon?.UGi;

  const numericCandidates = [cmd.outputformat, cmd.outputtype, cmd.filetype, cmd.fileType];
  for (const candidate of numericCandidates) {
    if (typeof candidate === "number" && ugI) {
      const ext = ugI(candidate);
      if (ext) return ext.toLowerCase();
    }
  }

  const stringCandidates = [
    cmd.outputformat,
    cmd.outputtype,
    cmd.filetype,
    cmd.fileType,
    cmd.format,
    cmd.fileType,
  ];
  for (const candidate of stringCandidates) {
    if (typeof candidate === "string" && candidate) {
      if (ugI && /^\d+$/.test(candidate)) {
        const extFromCode = ugI(Number(candidate));
        if (extFromCode) return extFromCode.toLowerCase();
      }
      const ext = candidate.toLowerCase().replace(/^\./, "");
      if (ext) return ext;
    }
  }

  const title = typeof cmd.title === "string" ? cmd.title : assets?.title;
  const fromTitle = title ? getExtension(title) : null;
  if (fromTitle) return fromTitle;

  return (assets?.fileType ?? "docx").toLowerCase();
}

function toExportFormat(ext: string, assets: ReturnType<typeof getDocumentAssets> | undefined): ExportFormat {
  const normalized = ext.toLowerCase();
  if (normalized === "pdf") return "pdf";
  if (normalized === "docx") return "docx";
  if (normalized === "xlsx") return "xlsx";
  if (normalized === "pptx") return "pptx";

  const fallback = (assets?.fileType ?? "docx").toLowerCase();
  if (fallback === "xlsx") return "xlsx";
  if (fallback === "pptx") return "pptx";
  return "docx";
}

async function toUint8Array(body: unknown) {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Blob) {
    const buffer = await body.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array();
}

function concatChunks(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function toOwnedUint8Array(bytes: Uint8Array) {
  // Ensure the underlying buffer is a plain ArrayBuffer (not SharedArrayBuffer).
  return new Uint8Array(bytes);
}

function looksLikeZip(bytes: Uint8Array) {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function getSavetypeConstants(targetWindow: Window) {
  const atd = (targetWindow as typeof window & { AscCommon?: { atd?: Record<string, number> } })
    .AscCommon?.atd;
  return {
    first: atd?.Nkh ?? 0,
    middle: atd?.Mkh ?? 1,
    last: atd?.Ika ?? 2,
    single: atd?.EVg ?? 3,
  };
}

function buildResponse(
  cmd: Record<string, unknown>,
  data: unknown,
  fileType: string
) {
  const type = typeof cmd.c === "string" && cmd.c ? cmd.c : "save";
  return {
    type,
    status: "ok",
    data,
    filetype: fileType,
  };
}

function triggerDownload(targetWindow: Window, url: string, filename: string) {
  try {
    const doc = targetWindow.document ?? document;
    const link = doc.createElement("a");
    link.href = url;
    link.download = filename;
    doc.body?.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    console.warn("Failed to trigger download", error);
  }
}

function notifySaveComplete(docId: string, fileType: string) {
  const delivered = emitServerMessage(docId, {
    type: "documentOpen",
    data: {
      type: "save",
      status: "ok",
      data: "data:,",
      filetype: fileType,
      openedAt: Date.now(),
    },
  });
  debugLog("notifySaveComplete", { docId, fileType, delivered });
}

function resolveCommand(cmd: Record<string, unknown>) {
  const c = cmd.c;
  return typeof c === "string" ? c.toLowerCase() : "";
}

function resolveDocId(cmd: Record<string, unknown>) {
  const candidates = [cmd.id, cmd.key, cmd.docId, cmd.docid];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate);
    if (value) return value;
  }
  return "";
}

function resolveParentDocKey(targetWindow: Window) {
  try {
    const parentConfig = (targetWindow.parent as Window & {
      DocEditorConfig?: { document?: { key?: unknown } };
    }).DocEditorConfig;
    const key = parentConfig?.document?.key;
    return key ? String(key) : "";
  } catch {
    return "";
  }
}

function getFileTypeName(targetWindow: Window, value: unknown) {
  const asc = (targetWindow as typeof window & { Asc?: { c_oAscFileType?: Record<string, number> } }).Asc;
  const fileType = asc?.c_oAscFileType;
  if (!fileType) return "";
  if (typeof value === "number") {
    const entry = Object.entries(fileType).find(([, v]) => v === value);
    return entry?.[0]?.toLowerCase() ?? "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const entry = Object.entries(fileType).find(([, v]) => v === num);
      return entry?.[0]?.toLowerCase() ?? "";
    }
    return trimmed.toLowerCase();
  }
  return "";
}

async function finalizeSave(
  targetWindow: Window,
  docId: string,
  cmd: Record<string, unknown>,
  bytes: Uint8Array
) {
  const assets = getDocumentAssets(docId);
  if (!assets) {
    debugLog("finalizeSave missing assets", { docId, command: resolveCommand(cmd) });
    return null;
  }
  const outputExt = resolveOutputExtension(targetWindow, cmd, assets);
  const exportFormat = toExportFormat(outputExt, assets);
  const baseTitle =
    (typeof cmd.title === "string" && cmd.title) ||
    assets?.title ||
    `document.${assets?.fileType ?? exportFormat}`;
  const title = ensureExtension(baseTitle, outputExt);
  debugLog("finalizeSave start", {
    docId,
    outputExt,
    exportFormat,
    title,
    bytes: bytes.byteLength,
    zip: looksLikeZip(bytes),
  });

  try {
    if (looksLikeZip(bytes) && (outputExt === "docx" || outputExt === "xlsx" || outputExt === "pptx")) {
      const ownedBytes = toOwnedUint8Array(bytes);
      const mimeByExt: Record<string, string> = {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };
      const blob = new Blob([ownedBytes], { type: mimeByExt[outputExt] ?? "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      registerDownloadUrl(docId, url);
      triggerDownload(targetWindow, url, title);
      notifySaveComplete(docId, outputExt);
      const response = buildResponse(cmd, url, outputExt);
      debugLog("finalizeSave zip passthrough", {
        docId,
        outputExt,
        url,
        size: blob.size,
        dataType: typeof response.data,
      });
      return response;
    }

    await initX2TModule();

    const ownedBytes = toOwnedUint8Array(bytes);
    const sourceFile = new File([ownedBytes], "Editor.bin", {
      type: "application/octet-stream",
    });
    const blob = await exportWithX2T(sourceFile, exportFormat, {
      sourceName: "Editor.bin",
      media: assets.mediaData,
    });
    const url = URL.createObjectURL(blob);
    registerDownloadUrl(docId, url);
    triggerDownload(targetWindow, url, title);
    notifySaveComplete(docId, outputExt);
    const response = buildResponse(cmd, url, outputExt);
    debugLog("finalizeSave success", {
      docId,
      outputExt,
      url,
      size: blob.size,
      dataType: typeof response.data,
    });
    return response;
  } catch (error) {
    console.error("x2t conversion failed, falling back to raw bytes", error);
    const ownedBytes = toOwnedUint8Array(bytes);
    const blob = new Blob([ownedBytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    registerDownloadUrl(docId, url);
    triggerDownload(targetWindow, url, title);
    notifySaveComplete(docId, outputExt);
    const response = buildResponse(cmd, url, outputExt);
    debugLog("finalizeSave fallback", {
      docId,
      outputExt,
      url,
      size: blob.size,
      dataType: typeof response.data,
    });
    return response;
  }
}

async function handleSaveCommand(
  targetWindow: Window,
  cmd: Record<string, unknown>,
  body: unknown
) {
  const command = resolveCommand(cmd);
  if (!command) return null;

  const docId = resolveDocId(cmd) || resolveParentDocKey(targetWindow);
  if (!docId) {
    debugLog("missing docId", { command, cmd });
    return null;
  }
  const saveTypes = getSavetypeConstants(targetWindow);
  const savetypeRaw = cmd.savetype;
  const savetypeCandidate =
    typeof savetypeRaw === "number"
      ? savetypeRaw
      : typeof savetypeRaw === "string"
        ? Number(savetypeRaw)
        : saveTypes.single;
  const savetype = Number.isFinite(savetypeCandidate) ? savetypeCandidate : saveTypes.single;
  const bytes = await toUint8Array(body);

  // Some non-save traffic (e.g. help docs) may hit /downloadas without a save command.
  // Let those requests pass through.
  if (command !== "save" && command !== "pathurl") {
    debugLog("skip non-save command", { command, docId });
    return null;
  }

  if (command === "pathurl") {
    const assets = getDocumentAssets(docId);
    if (!assets?.editorUrl) {
      debugLog("pathurl missing assets/editorUrl", { docId });
      return null;
    }
    const dataValue = typeof cmd.data === "string" ? cmd.data : "";
    if (/\.html?$/i.test(dataValue)) {
      // Help pages should not trigger a download response.
      debugLog("skip help pathurl", { dataValue });
      return null;
    }
    if (dataValue.startsWith("origin.")) {
      const originUrl = assets.originUrl ?? assets.editorUrl;
      const ext = assets.fileType ?? "docx";
      debugLog("pathurl -> origin", { docId, ext });
      return buildResponse(cmd, originUrl, ext);
    }
    const ext = assets.fileType ?? "docx";
    debugLog("pathurl -> editor", { docId, ext });
    return buildResponse(cmd, assets.editorUrl, ext);
  }

  // If we can infer the requested output file type name from the numeric format,
  // prefer it to avoid mismatches like HTML help files being treated as docx.
  const fileTypeName = getFileTypeName(targetWindow, cmd.outputformat ?? cmd.filetype ?? cmd.fileType);
  if (fileTypeName) {
    cmd.fileType = fileTypeName;
  }
  const outputExt = resolveOutputExtension(targetWindow, cmd, getDocumentAssets(docId));
  debugLog("save command", { docId, savetype, outputExt });

  if (savetype === saveTypes.single || cmd.savetype === undefined) {
    return await finalizeSave(targetWindow, docId, cmd, bytes);
  }

  if (savetype === saveTypes.first) {
    const savekey = createId("savekey");
    saveSessions.set(savekey, {
      docId,
      savekey,
      cmd,
      chunks: [bytes],
    });
    return buildResponse(cmd, savekey, outputExt);
  }

  const incomingKey = typeof cmd.savekey === "string" ? cmd.savekey : "";
  const session = incomingKey ? saveSessions.get(incomingKey) : undefined;
  if (!session) {
    return buildResponse(cmd, createId("savekey-missing"), outputExt);
  }

  session.chunks.push(bytes);

  if (savetype === saveTypes.middle) {
    return buildResponse(cmd, session.savekey, outputExt);
  }

  const allBytes = concatChunks(session.chunks);
  saveSessions.delete(session.savekey);
  return await finalizeSave(targetWindow, session.docId, session.cmd, allBytes);
}

async function handleSaveLikeRequest(targetWindow: Window, rawUrl: string, body: unknown) {
  const { parsed, cmd } = parseUrlAndCmd(targetWindow, rawUrl);
  if (!parsed) return null;
  const resolvedId = resolveDocId(cmd);
  if (!resolvedId) {
    const inferredId = extractDocId(parsed, cmd);
    if (inferredId) {
      cmd.id = inferredId;
    }
  }
  if (!resolveDocId(cmd)) {
    const parentKey = resolveParentDocKey(targetWindow);
    if (parentKey) {
      cmd.id = parentKey;
    }
  }
  return await handleSaveCommand(targetWindow, cmd, body);
}

function setXhrResponse(xhr: XMLHttpRequest, responseText: string) {
  const setReadonly = (key: keyof XMLHttpRequest, value: unknown) => {
    try {
      Object.defineProperty(xhr, key, {
        configurable: true,
        enumerable: true,
        get: () => value,
      });
    } catch {
      // Fall back to direct assignment where possible.
      try {
        (xhr as any)[key] = value;
      } catch {
        // Ignore assignment failures on read-only properties.
      }
    }
  };

  setReadonly("readyState", 4);
  setReadonly("status", 200);
  setReadonly("statusText", "OK");
  setReadonly("responseText", responseText);
  setReadonly("response", responseText);

  xhr.getAllResponseHeaders = () => "content-type: application/json\r\n";
  xhr.getResponseHeader = (name: string) =>
    name.toLowerCase() === "content-type" ? "application/json" : null;
}

function installLocalEndpointPatch(targetWindow: Window) {
  const marker = targetWindow as Window & { [endpointPatchKey]?: boolean };
  if (endpointPatchedWindows.has(targetWindow) || marker[endpointPatchKey]) return;
  marker[endpointPatchKey] = true;
  endpointPatchedWindows.add(targetWindow);

  const fetchRef = targetWindow.fetch?.bind(targetWindow);
  if (fetchRef) {
    targetWindow.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (shouldInterceptUrl(targetWindow, url)) {
        const body = init?.body;
        const result = await handleSaveLikeRequest(targetWindow, url, body);
        if (result) {
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          });
        }
      }
      return fetchRef(input, init);
    }) as typeof targetWindow.fetch;
  }

  const OriginalXHR = (targetWindow as unknown as typeof globalThis).XMLHttpRequest as typeof XMLHttpRequest;
  const open = OriginalXHR.prototype.open;
  const send = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function patchedOpen(
    this: XMLHttpRequest & { __ooUrl?: string },
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    const urlString = typeof url === "string" ? url : url.href;
    this.__ooUrl = urlString;
    return open.call(this, method, urlString, async ?? true, username, password);
  };

  OriginalXHR.prototype.send = function patchedSend(
    this: XMLHttpRequest & { __ooUrl?: string },
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    const url = this.__ooUrl;
    if (!url || !shouldInterceptUrl(targetWindow, url)) {
      return send.call(this, body);
    }

    void (async () => {
      try {
        const result = await handleSaveLikeRequest(targetWindow, url, body);
        if (!result) {
          send.call(this, body);
          return;
        }
        const responseText = JSON.stringify(result);
        setXhrResponse(this, responseText);
        queueMicrotask(() => {
          this.onreadystatechange?.call(this, new ProgressEvent("readystatechange"));
          this.onload?.call(this, new ProgressEvent("load"));
        });
      } catch (error) {
        console.error("Local save handler failed", error);
        send.call(this, body);
      }
    })();
  };

}

export function injectGlobals(targetWindow: Window = window) {
  if (injectedWindows.has(targetWindow)) return;
  if (targetWindow === window) {
    installIframeIoPatch(targetWindow);
  }
  installLocalEndpointPatch(targetWindow);
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
