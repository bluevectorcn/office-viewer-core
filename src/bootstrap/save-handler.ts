import { emitServerMessage } from "../socket/fake-socket";
import { createId } from "../core/lifecycle";
import { type ExportFormat, getFileExtensionByType } from "../core/types";
import { exportWithX2T, initX2TModule } from "../x2t/service";
import { getDocumentAssets, registerDownloadUrl } from "../socket/assets";
import { ChunkedUploader } from "@/infrastructure/network/ChunkedUploader";
import { Logger } from "@/shared/logging/Logger";

const DEBUG_LOCAL_SAVE = Boolean((import.meta as any)?.env?.VITE_OO_DEBUG_LOCAL_SAVE);
const SAVE_ENDPOINT_RE = /\/(downloadas|savefile)\//i;

type SaveSession = {
  docId: string;
  savekey: string;
  cmd: SaveCommand;
  chunks: Uint8Array[];
};

export type SaveCommand = Record<string, unknown>;

export type SaveResponse = {
  type: string;
  status: "ok";
  data: unknown;
  filetype: string;
};

// 使用 ChunkedUploader 替代全局 Map，防止内存泄漏
const logger = new Logger({ prefix: '[SaveHandler]' });
const chunkedUploader = new ChunkedUploader(logger);

// 保留旧的 Map 用于存储会话元数据（不包含 chunks）
const sessionMetadata = new Map<string, Omit<SaveSession, 'chunks'>>();

type InternalDownloadFlag = {
  docId: string;
  expiresAt: number;
};

function debugLog(...args: unknown[]) {
  if (!DEBUG_LOCAL_SAVE) return;
  try {
    console.debug("[oo-local]", ...args);
  } catch {
    // Ignore logging failures.
  }
}

export function shouldInterceptUrl(targetWindow: Window, rawUrl: string) {
  if (!SAVE_ENDPOINT_RE.test(rawUrl)) return false;
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
    return { parsed: null, cmd: {} as SaveCommand };
  }

  const cmdParam = parsed.searchParams.get("cmd");
  if (!cmdParam) {
    return { parsed, cmd: {} as SaveCommand };
  }

  try {
    const cmd = JSON.parse(cmdParam) as SaveCommand;
    return { parsed, cmd };
  } catch {
    return { parsed, cmd: {} as SaveCommand };
  }
}

function extractDocId(parsed: URL, cmd: SaveCommand) {
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
  cmd: SaveCommand,
  assets: ReturnType<typeof getDocumentAssets> | undefined
) {
  const numericCandidates = [cmd.outputformat, cmd.outputtype, cmd.filetype, cmd.fileType];
  for (const candidate of numericCandidates) {
    if (typeof candidate === "number") {
      const ext = getFileExtensionByType(candidate);
      if (ext) return ext.toLowerCase();
    }
  }

  const stringCandidates = [
    cmd.outputformat,
    cmd.outputtype,
    cmd.filetype,
    cmd.fileType,
    cmd.format,
  ];
  for (const candidate of stringCandidates) {
    if (typeof candidate === "string" && candidate) {
      if (/^\d+$/.test(candidate)) {
        const extFromCode = getFileExtensionByType(Number(candidate));
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
  return {
    first: 0,
    middle: 1,
    last: 2,
    single: 3,
  };
}

function buildResponse(cmd: SaveCommand, data: unknown, fileType: string): SaveResponse {
  const type = typeof cmd.c === "string" && cmd.c ? cmd.c : "save";
  return {
    type,
    status: "ok",
    data,
    filetype: fileType,
  };
}

function readInternalDownloadFlag(targetWindow: Window): InternalDownloadFlag | null {
  try {
    const parent = targetWindow.parent as Window & {
      __ooInternalDownload?: InternalDownloadFlag;
    };
    return parent.__ooInternalDownload ?? null;
  } catch {
    return null;
  }
}

function isInternalDownload(targetWindow: Window, docId: string) {
  const flag = readInternalDownloadFlag(targetWindow);
  if (!flag) return false;
  if (!flag.docId || flag.docId !== docId) return false;
  return flag.expiresAt > Date.now();
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

function notifySaveComplete(docId: string, fileType: string, dataUrl: string) {
  const delivered = emitServerMessage(docId, {
    type: "documentOpen",
    data: {
      type: "save",
      status: "ok",
      data: dataUrl,
      filetype: fileType,
      openedAt: Date.now(),
    },
  });
  debugLog("notifySaveComplete", { docId, fileType, delivered, dataUrl });
}

function resolveCommand(cmd: SaveCommand) {
  const c = cmd.c;
  return typeof c === "string" ? c.toLowerCase() : "";
}

function resolveDocId(cmd: SaveCommand) {
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

function completeSave(
  targetWindow: Window,
  docId: string,
  cmd: SaveCommand,
  outputExt: string,
  title: string,
  blob: Blob,
  debugLabel: string
): SaveResponse {
  const url = URL.createObjectURL(blob);
  registerDownloadUrl(docId, url);
  const internal = isInternalDownload(targetWindow, docId);
  if (!internal) {
    triggerDownload(targetWindow, url, title);
  } else {
    debugLog("skip auto download for internal request", { docId, title });
  }
  const saveDataUrl = internal ? url : "data:,";
  notifySaveComplete(docId, outputExt, saveDataUrl);
  const response = buildResponse(cmd, url, outputExt);
  debugLog(debugLabel, {
    docId,
    outputExt,
    url,
    size: blob.size,
    dataType: typeof response.data,
  });
  return response;
}

async function finalizeSave(
  targetWindow: Window,
  docId: string,
  cmd: SaveCommand,
  bytes: Uint8Array
): Promise<SaveResponse | null> {
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
      return completeSave(targetWindow, docId, cmd, outputExt, title, blob, "finalizeSave zip passthrough");
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
    return completeSave(targetWindow, docId, cmd, outputExt, title, blob, "finalizeSave success");
  } catch (error) {
    console.error("x2t conversion failed, falling back to raw bytes", error);
    const ownedBytes = toOwnedUint8Array(bytes);
    const blob = new Blob([ownedBytes], { type: "application/octet-stream" });
    return completeSave(targetWindow, docId, cmd, outputExt, title, blob, "finalizeSave fallback");
  }
}

async function handleSaveCommand(
  targetWindow: Window,
  cmd: SaveCommand,
  body: unknown
): Promise<SaveResponse | null> {
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
    // 使用 ChunkedUploader 处理第一个分块
    await chunkedUploader.handleChunk(savekey, bytes, 'first');
    // 保存会话元数据（不包含 chunks）
    sessionMetadata.set(savekey, {
      docId,
      savekey,
      cmd,
    });
    return buildResponse(cmd, savekey, outputExt);
  }

  const incomingKey = typeof cmd.savekey === "string" ? cmd.savekey : "";
  const session = incomingKey ? sessionMetadata.get(incomingKey) : undefined;
  if (!session) {
    return buildResponse(cmd, createId("savekey-missing"), outputExt);
  }

  if (savetype === saveTypes.middle) {
    // 使用 ChunkedUploader 处理中间分块
    await chunkedUploader.handleChunk(session.savekey, bytes, 'middle');
    return buildResponse(cmd, session.savekey, outputExt);
  }

  // 处理最后一个分块，获取合并后的数据
  const result = await chunkedUploader.handleChunk(session.savekey, bytes, 'last');
  sessionMetadata.delete(session.savekey);

  if (result.status === 'error' || !result.data) {
    logger.error('Failed to finalize chunked upload', result.message);
    return buildResponse(cmd, createId("savekey-error"), outputExt);
  }

  return await finalizeSave(targetWindow, session.docId, session.cmd, result.data);
}

export async function handleSaveLikeRequest(
  targetWindow: Window,
  rawUrl: string,
  body: unknown
): Promise<SaveResponse | null> {
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
