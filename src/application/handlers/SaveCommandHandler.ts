import { emitServerMessage } from "../../infrastructure/socket/FakeSocket";
import { createId } from "../../shared/utils/LifecycleHelpers";
import { type ExportFormat, getFileExtensionByType } from "../../shared/types/EditorTypes";
import { exportWithX2T, exportPdfViaBackend, initX2TModule } from "../../infrastructure/conversion/X2TService";
import { getDocumentAssets, registerDownloadUrl } from "../../infrastructure/socket/AssetsStore";
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
const sessionTimers = new Map<string, number>();
const SESSION_TTL_MS = 5 * 60 * 1000; // 与 ChunkedUploader 默认 TTL 保持一致

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

function clearSessionTimer(savekey: string) {
  const timer = sessionTimers.get(savekey);
  if (timer) {
    clearTimeout(timer);
    sessionTimers.delete(savekey);
  }
}

function scheduleSessionCleanup(savekey: string) {
  clearSessionTimer(savekey);
  const timer = window.setTimeout(() => {
    sessionMetadata.delete(savekey);
    sessionTimers.delete(savekey);
    logger.warn('Save session expired', { savekey, ttl: SESSION_TTL_MS });
  }, SESSION_TTL_MS);
  sessionTimers.set(savekey, timer);
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

/**
 * 从父窗口的 DocEditorConfig 读取后端转码配置（mode + backendUrl）。
 * "另存为 PDF" 的请求由 OnlyOffice iframe 发出，被 NetworkPatch 拦截后
 * 进入本处理器；此处需要从挂载在父窗口的配置中取出后端地址。
 */
function resolveBackendConfig(targetWindow: Window): { mode?: string; backendUrl?: string } {
  try {
    const parentConfig = (targetWindow.parent as Window & {
      DocEditorConfig?: { mode?: string; backendUrl?: string };
    }).DocEditorConfig;
    return { mode: parentConfig?.mode, backendUrl: parentConfig?.backendUrl };
  } catch {
    return {};
  }
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

async function fetchEditorBin(editorUrl: string): Promise<Uint8Array> {
  const response = await fetch(editorUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Editor.bin: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * 确保所有媒体资源（图片等）的字节数据可用，用于另存为时喂给 x2t。
 *
 * assets.images 包含文档引用的全部图片 key → URL 映射（既包含打开时
 * 后端返回的远程 URL，也包含编辑过程中客户端新增的 blob URL）。
 * assets.mediaData 只在客户端有字节数据时才填充——后端模式下打开时
 * 原有图片的 mediaData 为空（仅存远程 URL），编辑新增的图片才有字节。
 *
 * 因此不能仅凭 mediaData 是否为空判断：必须以 images 的 key 为准，
 * 逐个检查 mediaData 是否已有字节，缺失的才从 URL 拉取。否则会出现
 * "编辑过的文档另存为时丢失原有图片"的问题。
 */
async function ensureMediaData(
  assets: ReturnType<typeof getDocumentAssets>
): Promise<Record<string, Uint8Array> | undefined> {
  if (!assets) return undefined;
  if (!assets.images || Object.keys(assets.images).length === 0) {
    // 没有图片引用；若 mediaData 有数据（理论上不该有）也直接返回
    return assets.mediaData && Object.keys(assets.mediaData).length > 0
      ? assets.mediaData
      : undefined;
  }

  if (!assets.mediaData) {
    assets.mediaData = {};
  }
  const mediaData = assets.mediaData;

  // 找出缺失字节数据的图片，从对应 URL 拉取
  const missing = Object.entries(assets.images).filter(
    ([key]) => !mediaData[key]
  );
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async ([key, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`Failed to fetch media "${key}": ${response.status}`);
            return;
          }
          const buffer = await response.arrayBuffer();
          mediaData[key] = new Uint8Array(buffer);
        } catch (error) {
          console.warn(`Failed to fetch media "${key}"`, error);
        }
      })
    );
  }

  return Object.keys(mediaData).length > 0 ? mediaData : undefined;
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
  const outputExt = resolveOutputExtension(cmd, assets);
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

    // PDF 专用路径：wasm 版 x2t 裁剪了 doctrenderer（依赖 V8），无法在浏览器内
    // 把 Editor.bin 渲染成 PDF。必须依赖 Go 后端的原生 x2t（带完整 doctrenderer +
    // PdfFile 库）来完成 Editor.bin → PDF 转换。
    if (exportFormat === "pdf") {
      const { mode, backendUrl } = resolveBackendConfig(targetWindow);
      if (!backendUrl) {
        throw new Error(
          "导出 PDF 需要后端转码服务支持（wasm 版 x2t 不含 PDF 渲染能力）。请在编辑器配置中设置 backendUrl 并将 mode 设为 'server' 或 'auto'。"
        );
      }
      if (mode === "wasm") {
        throw new Error(
          "当前转码模式为 'wasm'，无法导出 PDF。请将 mode 改为 'server' 或 'auto' 并配置 backendUrl。"
        );
      }
      const documentType = assets.documentType ?? "word";
      const editorBin = await fetchEditorBin(assets.editorUrl);
      const blob = await exportPdfViaBackend(editorBin, documentType, backendUrl, assets.title);
      return completeSave(targetWindow, docId, cmd, outputExt, title, blob, "finalizeSave pdf via backend");
    }

    await initX2TModule();

    const ownedBytes = toOwnedUint8Array(bytes);
    const sourceFile = new File([ownedBytes], "Editor.bin", {
      type: "application/octet-stream",
    });
    // 后端模式下 mediaData 为空（图片是远程 URL），另存为时需拉取字节喂给 x2t
    const mediaData = await ensureMediaData(assets);
    const blob = await exportWithX2T(sourceFile, exportFormat, {
      sourceName: "Editor.bin",
      media: mediaData,
      documentType: assets.documentType,
    });
    return completeSave(targetWindow, docId, cmd, outputExt, title, blob, "finalizeSave success");
  } catch (error) {
    console.error("finalizeSave failed", error);
    // PDF 导出失败时不能回退到原始字节（那是 pdf.bin 渲染数据或 Editor.bin，不是合法 PDF，
    // 会产出无法打开的文件）。向上抛错，让编辑器向用户展示失败信息。
    if (exportFormat === "pdf") {
      throw error;
    }
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

  const fileTypeName = getFileExtensionByType(cmd.outputformat as number);
  if (fileTypeName) {
    cmd.fileType = fileTypeName;
  }
  const outputExt = resolveOutputExtension(cmd, getDocumentAssets(docId));
  debugLog("save command", { docId, savetype, outputExt });

  if (savetype === saveTypes.single || cmd.savetype === undefined) {
    return await finalizeSave(targetWindow, docId, cmd, bytes);
  }

  if (savetype === saveTypes.first) {
    const savekey = createId("savekey");
    // 使用 ChunkedUploader 处理第一个分块
    const firstResult = await chunkedUploader.handleChunk(savekey, bytes, 'first');
    if (firstResult.status === 'error') {
      logger.error('Failed to start chunked upload', firstResult.message);
      return buildResponse(cmd, createId("savekey-error"), outputExt);
    }
    // 保存会话元数据（不包含 chunks）
    sessionMetadata.set(savekey, {
      docId,
      savekey,
      cmd,
    });
    scheduleSessionCleanup(savekey);
    return buildResponse(cmd, savekey, outputExt);
  }

  const incomingKey = typeof cmd.savekey === "string" ? cmd.savekey : "";
  const session = incomingKey ? sessionMetadata.get(incomingKey) : undefined;
  if (!session) {
    return buildResponse(cmd, createId("savekey-missing"), outputExt);
  }

  if (savetype === saveTypes.middle) {
    // 使用 ChunkedUploader 处理中间分块
    const middleResult = await chunkedUploader.handleChunk(session.savekey, bytes, 'middle');
    if (middleResult.status === 'error') {
      logger.error('Failed to append chunked upload', middleResult.message);
      sessionMetadata.delete(session.savekey);
      clearSessionTimer(session.savekey);
      return buildResponse(cmd, createId("savekey-error"), outputExt);
    }
    scheduleSessionCleanup(session.savekey);
    return buildResponse(cmd, session.savekey, outputExt);
  }

  // 处理最后一个分块，获取合并后的数据
  const result = await chunkedUploader.handleChunk(session.savekey, bytes, 'last');
  sessionMetadata.delete(session.savekey);
  clearSessionTimer(session.savekey);

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
