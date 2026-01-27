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
const WORKING_FONTS = "/working/fonts";
const WORKING_THEMES = "/working/themes";
const PARAMS_PATH = "/working/params.xml";
const EDITOR_BIN_PATH = "/working/Editor.bin";

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

function buildParamsXml(fileFrom: string, fileTo: string) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `<m_sFontDir>${WORKING_FONTS}/</m_sFontDir>`,
    `<m_sThemeDir>${WORKING_THEMES}</m_sThemeDir>`,
    `<m_sFileFrom>${fileFrom}</m_sFileFrom>`,
    `<m_sFileTo>${fileTo}</m_sFileTo>`,
    "<m_nCsvTxtEncoding>65001</m_nCsvTxtEncoding>",
    "<m_nCsvDelimiter>4</m_nCsvDelimiter>",
    "<m_sCsvDelimiterChar>,</m_sCsvDelimiterChar>",
    "</TaskQueueDataConvert>",
  ].join("");
}

function runX2T(runtime: X2TRuntime, paramsPath: string) {
  const ccall = runtime.ccall;
  if (!ccall) {
    throw new Error("x2t ccall is not available");
  }
  const result = ccall("main1", "number", ["string"], [paramsPath]);
  if (result !== 0) {
    throw new Error(`x2t conversion failed with code ${result}`);
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

export async function convertToEditorBin(input: File, title: string) {
  const module = await initX2TModule();
  const runtime = getRuntime(module);
  const FS = runtime.FS;
  if (!FS) {
    throw new Error("x2t FS is not available");
  }

  prepareWorkingDir(FS);

  const sourcePath = `${WORKING_ROOT}/${title}`;
  const paramsXml = buildParamsXml(sourcePath, EDITOR_BIN_PATH);
  const arrayBuffer = await input.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  FS.writeFile(sourcePath, bytes);
  FS.writeFile(PARAMS_PATH, paramsXml);

  runX2T(runtime, PARAMS_PATH);

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
  const paramsXml = buildParamsXml(sourcePath, outputPath);
  const arrayBuffer = await source.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  FS.writeFile(sourcePath, bytes);
  writeMediaFiles(FS, options?.media);
  FS.writeFile(PARAMS_PATH, paramsXml);

  runX2T(runtime, PARAMS_PATH);

  const output = FS.readFile(outputPath);
  const ownedOutput = new Uint8Array(output);
  const mime = mimeByFormat[format] ?? defaultDocxMime;
  return new Blob([ownedOutput], { type: mime });
}
