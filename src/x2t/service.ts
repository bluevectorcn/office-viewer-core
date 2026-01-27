import type { ExportFormat } from "../core/types";
import { resolveAssetPath } from "../core/assets";

export interface X2TModule {
  instance?: WebAssembly.Instance;
  exports?: WebAssembly.Exports;
}

type X2TFS = {
  analyzePath: (path: string) => { exists: boolean };
  stat: (path: string) => { mode: number };
  isDir: (mode: number) => boolean;
  readdir: (path: string) => string[];
  rmdir: (path: string) => void;
  unlink: (path: string) => void;
  mkdir: (path: string) => void;
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (path: string) => Uint8Array;
};

type X2TRuntime = X2TModule & {
  FS?: X2TFS;
  ccall?: (ident: string, returnType: string, argTypes: string[], args: string[]) => number;
};

export type MediaCollection = {
  images: Record<string, string>;
  mediaData: Record<string, Uint8Array>;
};

let initPromise: Promise<X2TModule> | null = null;
const X2T_SCRIPT_ID = "__oo-x2t-script";

type X2TGlobalModule = X2TModule & {
  locateFile?: (path: string, prefix: string) => string;
  onRuntimeInitialized?: () => void;
  calledRun?: boolean;
  _main?: unknown;
  asm?: unknown;
  [key: string]: unknown;
};

type X2TWindow = Window & { Module?: X2TGlobalModule };

const defaultDocxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const defaultXlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const defaultPptxMime =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const supportedExtensions = new Set([
  "docx",
  "doc",
  "odt",
  "txt",
  "rtf",
  "bin",
  "xlsx",
  "xls",
  "ods",
  "csv",
  "pptx",
  "ppt",
  "odp",
]);

const mimeToExtension: Record<string, string> = {
  [defaultDocxMime]: "docx",
  "application/msword": "doc",
  "application/vnd.oasis.opendocument.text": "odt",
  "text/plain": "txt",
  "application/rtf": "rtf",
  "application/x-rtf": "rtf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.oasis.opendocument.presentation": "odp",
};

const mimeByFormat: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: defaultDocxMime,
  xlsx: defaultXlsxMime,
  pptx: defaultPptxMime,
};

const WORKING_ROOT = "/working";
const WORKING_MEDIA = "/working/media";
const WORKING_FONTS = "/working/fonts/";
const WORKING_THEMES = "/working/themes";
const PARAMS_PATH = "/working/params.xml";
const EDITOR_BIN_PATH = "/working/Editor.bin";
// Match office-website's doc -> docx intermediate naming: fromPath + ".docx"
const DOC_VIA_PATH = "/working/doc.doc.docx";

export async function initX2TModule() {
  if (!initPromise) {
    initPromise = new Promise<X2TModule>((resolve, reject) => {
      if (typeof window === "undefined" || typeof document === "undefined") {
        reject(new Error("x2t requires a browser window"));
        return;
      }

      const win = window as X2TWindow;
      const existing = win.Module ?? {};
      const isReady =
        existing.calledRun === true ||
        existing._main !== undefined ||
        existing.asm !== undefined;
      if (isReady) {
        resolve(existing);
        return;
      }

      const scriptUrl = resolveAssetPath("/x2t/x2t.js");
      const moduleConfig: X2TGlobalModule = {
        ...existing,
        locateFile:
          existing.locateFile ??
          ((file: string) => resolveAssetPath(`/x2t/${file}`)),
        onRuntimeInitialized: () => resolve(moduleConfig),
      };
      win.Module = moduleConfig;

      const existingScript = document.getElementById(X2T_SCRIPT_ID) as HTMLScriptElement | null;
      if (existingScript) {
        // If the script is already present, rely on onRuntimeInitialized to resolve.
        return;
      }

      const script = document.createElement("script");
      script.id = X2T_SCRIPT_ID;
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => {
        const readyAfterLoad =
          moduleConfig.calledRun === true ||
          moduleConfig._main !== undefined ||
          moduleConfig.asm !== undefined;
        if (readyAfterLoad) {
          resolve(moduleConfig);
        }
      };
      script.onerror = () => reject(new Error("Failed to load x2t.js"));
      document.head.appendChild(script);
    });
  }
  return initPromise;
}

function getExtensionFromName(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function inferExtensionFromMime(mime: string) {
  const normalized = mime.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") {
    return "docx";
  }
  return mimeToExtension[normalized] ?? null;
}

function resolveSourceName(source: Blob, sourceNameHint?: string) {
  const hintExt = sourceNameHint ? getExtensionFromName(sourceNameHint) : null;

  if (source instanceof File) {
    const extFromName = hintExt ?? getExtensionFromName(source.name);
    const extFromMime = inferExtensionFromMime(source.type);
    const ext = extFromName ?? extFromMime ?? "docx";
    if (!supportedExtensions.has(ext)) {
      throw new Error(`Unsupported source file type: ${ext}`);
    }
    const name = extFromName ? (sourceNameHint ?? source.name) : `document.${ext}`;
    return { name, ext, extFromName };
  }

  const extFromMime = inferExtensionFromMime(source.type);
  const ext = hintExt ?? extFromMime;
  if (!ext) {
    throw new Error(`Unsupported source MIME type: ${source.type || "(empty)"}`);
  }
  if (!supportedExtensions.has(ext)) {
    throw new Error(`Unsupported source file type: ${ext}`);
  }
  const name = sourceNameHint ?? `document.${ext}`;
  return { name, ext, extFromName: hintExt };
}

function ensureDir(FS: X2TFS, dir: string) {
  const parts = dir.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      if (!FS.analyzePath(current).exists) {
        FS.mkdir(current);
      }
    } catch {
      // Ignore directory creation errors to keep the conversion flow robust.
    }
  }
}

function removePath(FS: X2TFS, path: string) {
  if (!FS.analyzePath(path).exists) return;
  if (FS.isDir(FS.stat(path).mode)) {
    FS.readdir(path)
      .filter((entry) => entry !== "." && entry !== "..")
      .forEach((entry) => removePath(FS, `${path}/${entry}`));
    if (path !== "/") {
      FS.rmdir(path);
    }
    return;
  }
  FS.unlink(path);
}

function prepareWorkingDir(FS: X2TFS) {
  removePath(FS, WORKING_ROOT);
  removePath(FS, "/tmp");
  ensureDir(FS, "/tmp");
  ensureDir(FS, WORKING_ROOT);
  ensureDir(FS, WORKING_MEDIA);
  ensureDir(FS, WORKING_FONTS);
  ensureDir(FS, WORKING_THEMES);
}

type ParamsXmlOptions = {
  formatFrom?: number | null;
  formatTo?: number | null;
};

function buildParamsXml(fileFrom: string, fileTo: string, options?: ParamsXmlOptions) {
  const formatFrom =
    typeof options?.formatFrom === "number" ? `<m_nFormatFrom>${options.formatFrom}</m_nFormatFrom>` : "";
  const formatTo =
    typeof options?.formatTo === "number" ? `<m_nFormatTo>${options.formatTo}</m_nFormatTo>` : "";

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `<m_sFontDir>${WORKING_FONTS}/</m_sFontDir>`,
    `<m_sThemeDir>${WORKING_THEMES}</m_sThemeDir>`,
    `<m_sFileFrom>${fileFrom}</m_sFileFrom>`,
    `<m_sFileTo>${fileTo}</m_sFileTo>`,
    formatFrom,
    formatTo,
    "<m_bIsNoBase64>false</m_bIsNoBase64>",
    "<m_nCsvTxtEncoding>65001</m_nCsvTxtEncoding>",
    "<m_nCsvDelimiter>4</m_nCsvDelimiter>",
    "<m_sCsvDelimiterChar>,</m_sCsvDelimiterChar>",
    "</TaskQueueDataConvert>",
  ].join("");
}

function runX2TCode(runtime: X2TRuntime, paramsPath: string) {
  const ccall = runtime.ccall;
  if (!ccall) {
    throw new Error("x2t ccall is not available");
  }
  return ccall("main1", "number", ["string"], [paramsPath]);
}

function runX2T(runtime: X2TRuntime, paramsPath: string) {
  const result = runX2TCode(runtime, paramsPath);
  if (result !== 0) {
    throw new Error(`x2t conversion failed with code ${result}`);
  }
}

function tryRunX2T(runtime: X2TRuntime, paramsPath: string) {
  try {
    runX2T(runtime, paramsPath);
    return true;
  } catch {
    return false;
  }
}

function pathExists(FS: X2TFS, path: string) {
  try {
    return FS.analyzePath(path).exists;
  } catch {
    return false;
  }
}

function writeMediaFiles(FS: X2TFS, media?: Record<string, Uint8Array>) {
  if (!media) return;
  for (const [key, value] of Object.entries(media)) {
    const relative = key.replace(/^\.\/+/, "");
    const path = relative.startsWith("media/")
      ? `${WORKING_ROOT}/${relative}`
      : `${WORKING_MEDIA}/${relative}`;
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir) {
      ensureDir(FS, dir);
    }
    try {
      FS.writeFile(path, value);
    } catch (error) {
      console.warn("Failed to write media file", key, error);
    }
  }
}

function guessMime(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function collectMedia(FS: X2TFS): MediaCollection {
  const images: Record<string, string> = {};
  const mediaData: Record<string, Uint8Array> = {};

  const readDir = (dir: string, prefix: string) => {
    const entries = FS.readdir(dir) as string[];
    for (const entry of entries) {
      if (entry === "." || entry === "..") continue;
      const fullPath = `${dir}/${entry}`;
      const relPath = prefix ? `${prefix}/${entry}` : entry;
      const stat = FS.stat(fullPath);
      if (FS.isDir(stat.mode)) {
        readDir(fullPath, relPath);
        continue;
      }
      const data = FS.readFile(fullPath);
      const owned = new Uint8Array(data);
      mediaData[relPath] = owned;
      const blob = new Blob([owned], { type: guessMime(relPath) });
      images[relPath] = URL.createObjectURL(blob);
    }
  };

  try {
    if (FS.analyzePath(WORKING_MEDIA).exists) {
      readDir(WORKING_MEDIA, "");
    }
  } catch {
    // No media output.
  }

  return { images, mediaData };
}

function getRuntime(module: X2TModule): X2TRuntime {
  return module as X2TRuntime;
}

const wordExts = new Set(["docx", "doc", "odt", "txt", "rtf"]);
const cellExts = new Set(["xlsx", "xls", "ods", "csv"]);
const slideExts = new Set(["pptx", "ppt", "odp"]);

type CanvasKey = "CANVAS_WORD" | "CANVAS_SPREADSHEET" | "CANVAS_PRESENTATION";

function getCanvasKeyFromExt(ext: string): CanvasKey {
  const normalized = ext.toLowerCase();
  if (cellExts.has(normalized)) return "CANVAS_SPREADSHEET";
  if (slideExts.has(normalized)) return "CANVAS_PRESENTATION";
  return "CANVAS_WORD";
}

function getAscFileTypeMap(): Record<string, number> | null {
  try {
    const asc = (window as typeof window & { Asc?: { c_oAscFileType?: Record<string, number> } }).Asc;
    return asc?.c_oAscFileType ?? null;
  } catch {
    return null;
  }
}

function getAscFileTypeCode(key: string): number | null {
  const map = getAscFileTypeMap();
  if (!map) return null;
  const value = map[key];
  return typeof value === "number" ? value : null;
}

function getFormatFromExt(ext: string): number | null {
  const key = ext.toUpperCase();
  return getAscFileTypeCode(key);
}

function getFormatToCanvas(ext: string): number | null {
  const canvasKey = getCanvasKeyFromExt(ext);
  return getAscFileTypeCode(canvasKey);
}

export async function convertToEditorBin(input: File, title: string) {
  const module = await initX2TModule();
  const runtime = getRuntime(module);
  const FS = runtime.FS;
  if (!FS) {
    throw new Error("x2t FS is not available");
  }

  prepareWorkingDir(FS);

  const sourceExt = getExtensionFromName(title) ?? inferExtensionFromMime(input.type) ?? "docx";
  // Some legacy formats (notably .doc) appear sensitive to complex filenames.
  const workingSourceName = sourceExt === "doc" ? "doc.doc" : `document.${sourceExt}`;
  const sourcePath = `${WORKING_ROOT}/${workingSourceName}`;
  const formatFrom = getFormatFromExt(sourceExt);
  const formatToCanvas = getFormatToCanvas(sourceExt);
  const arrayBuffer = await input.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  FS.writeFile(sourcePath, bytes);

  // Office-website bypasses x2t for PDFs and feeds the bytes directly as Editor.bin.
  if (sourceExt === "pdf") {
    FS.writeFile(EDITOR_BIN_PATH, bytes);
  } else if (sourceExt === "doc") {
    // Align with the online example: run 3 times without m_nFormatFrom/To.
    // 1) doc -> Editor.bin (best-effort)
    // const docToBinParams = buildParamsXml(sourcePath, EDITOR_BIN_PATH);
    // FS.writeFile(PARAMS_PATH, docToBinParams);
    // const directCode = runX2TCode(runtime, PARAMS_PATH);

    // 2) doc -> docx
    const docToDocxParams = buildParamsXml(sourcePath, DOC_VIA_PATH);
    FS.writeFile(PARAMS_PATH, docToDocxParams);
    const viaCode = runX2TCode(runtime, PARAMS_PATH);

    // 3) docx -> Editor.bin
    const docxToBinParams = buildParamsXml(DOC_VIA_PATH, EDITOR_BIN_PATH);
    FS.writeFile(PARAMS_PATH, docxToBinParams);
    const hasViaDocx = pathExists(FS, DOC_VIA_PATH);
    const finalCode = hasViaDocx ? runX2TCode(runtime, PARAMS_PATH) : null;

    const hasEditorBin = pathExists(FS, EDITOR_BIN_PATH);
    if (!hasEditorBin) {
      const codes = { viaCode, finalCode, hasViaDocx };
      throw new Error(`x2t doc pipeline did not produce Editor.bin: ${JSON.stringify(codes)}`);
    }

    if (viaCode !== 0 || (finalCode !== null && finalCode !== 0)) {
      console.warn("x2t doc pipeline returned non-zero codes but produced Editor.bin", {
        viaCode,
        finalCode,
        hasViaDocx,
      });
    }
  } else {
    const paramsXml = buildParamsXml(sourcePath, EDITOR_BIN_PATH, {
      formatFrom,
      formatTo: formatToCanvas,
    });
    FS.writeFile(PARAMS_PATH, paramsXml);
    if (sourceExt === "csv") {
      const code = runX2TCode(runtime, PARAMS_PATH);
      const hasEditorBin = pathExists(FS, EDITOR_BIN_PATH);
      if (!hasEditorBin) {
        throw new Error(`x2t csv conversion did not produce Editor.bin (code ${code})`);
      }
      if (code !== 0) {
        console.warn("x2t csv conversion returned non-zero code but produced Editor.bin", { code });
      }
    } else {
      runX2T(runtime, PARAMS_PATH);
    }
  }

  const bin = FS.readFile(EDITOR_BIN_PATH);
  const ownedBin = new Uint8Array(bin);
  const blob = new Blob([ownedBin], { type: "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  const media = collectMedia(FS);

  return {
    blob,
    objectUrl,
    media,
  };
}

export async function exportWithX2T(
  source: Blob,
  format: ExportFormat,
  options?: { sourceName?: string; media?: Record<string, Uint8Array> }
) {
  const resolvedName = resolveSourceName(source, options?.sourceName);
  if (
    resolvedName.extFromName &&
    format === resolvedName.extFromName &&
    (format === "docx" || format === "xlsx" || format === "pptx")
  ) {
    return source;
  }

  const module = await initX2TModule();
  const runtime = getRuntime(module);
  const FS = runtime.FS;
  if (!FS) {
    throw new Error("x2t FS is not available");
  }

  prepareWorkingDir(FS);

  const sourcePath = `${WORKING_ROOT}/${resolvedName.name}`;
  const outputPath = `${WORKING_ROOT}/export.${format}`;
  const arrayBuffer = await source.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  FS.writeFile(sourcePath, bytes);
  writeMediaFiles(FS, options?.media);

  // Mirror office-website's two-step handling for legacy .doc inputs.
  if (resolvedName.ext === "doc") {
    const docToDocxParams = buildParamsXml(sourcePath, DOC_VIA_PATH);
    FS.writeFile(PARAMS_PATH, docToDocxParams);
    runX2T(runtime, PARAMS_PATH);

    if (format !== "docx") {
      const docxToOutputParams = buildParamsXml(DOC_VIA_PATH, outputPath);
      FS.writeFile(PARAMS_PATH, docxToOutputParams);
      runX2T(runtime, PARAMS_PATH);
    }
  } else {
    const paramsXml = buildParamsXml(sourcePath, outputPath);
    FS.writeFile(PARAMS_PATH, paramsXml);
    runX2T(runtime, PARAMS_PATH);
  }

  const finalPath = resolvedName.ext === "doc" && format === "docx" ? DOC_VIA_PATH : outputPath;
  const output = FS.readFile(finalPath);
  const ownedOutput = new Uint8Array(output);
  const mime = mimeByFormat[format] ?? defaultDocxMime;
  return new Blob([ownedOutput], { type: mime });
}
