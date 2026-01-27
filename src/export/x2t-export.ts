import initX2T from "./x2t.js";
import type { ExportFormat } from "../core/types";

export interface X2TModule {
  instance?: WebAssembly.Instance;
  exports?: WebAssembly.Exports;
}

let initPromise: Promise<X2TModule> | null = null;

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

export async function initX2TModule() {
  if (!initPromise) {
    initPromise = initX2T({
      locateFile: (file: string) => `/wasm/x2t/${file}`,
    }) as Promise<X2TModule>;
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

function prepareWorkingDir(FS: any) {
  const tryRemove = (p: string) => {
    if (!FS.analyzePath(p).exists) return;
    if (FS.isDir(FS.stat(p).mode)) {
      FS.readdir(p)
        .filter((e: string) => e !== "." && e !== "..")
        .forEach((e: string) => tryRemove(`${p}/${e}`));
      if (p !== "/") FS.rmdir(p);
    } else {
      FS.unlink(p);
    }
  };
  const ensure = (p: string) => {
    try {
      FS.mkdir(p);
    } catch {
      // Directory already exists.
    }
  };

  tryRemove("/working");
  tryRemove("/tmp");
  ensure("/tmp");
  ensure("/working");
  ensure("/working/media");
  ensure("/working/fonts");
  ensure("/working/themes");
}

function buildParamsXml(fileFrom: string, fileTo: string) {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    "<m_sFontDir>/working/fonts/</m_sFontDir>",
    "<m_sThemeDir>/working/themes</m_sThemeDir>",
    `<m_sFileFrom>${fileFrom}</m_sFileFrom>`,
    `<m_sFileTo>${fileTo}</m_sFileTo>`,
    "<m_bIsNoBase64>false</m_bIsNoBase64>",
    "<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding>",
    "<m_nCsvDelimiter>4</m_nCsvDelimiter>",
    "</TaskQueueDataConvert>",
  ].join("");
}

function ensureDir(FS: any, dir: string) {
  const parts = dir.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      if (!FS.analyzePath(current).exists) {
        FS.mkdir(current);
      }
    } catch {
      // Directory may already exist or be invalid; ignore and continue.
    }
  }
}

function writeMediaFiles(FS: any, media?: Record<string, Uint8Array>) {
  if (!media) return;
  for (const [key, value] of Object.entries(media)) {
    const relative = key.replace(/^\.\/+/, "");
    const path = relative.startsWith("media/") ? `/working/${relative}` : `/working/media/${relative}`;
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

export async function exportWithX2T(
  source: Blob,
  format: ExportFormat,
  options?: { sourceName?: string; media?: Record<string, Uint8Array> }
) {
  const resolvedName = resolveSourceName(source, options?.sourceName);
  const ext = resolvedName.ext;
  // Only bypass conversion when the source name explicitly matches the target format.
  if (
    resolvedName.extFromName &&
    format === resolvedName.extFromName &&
    (format === "docx" || format === "xlsx" || format === "pptx")
  ) {
    return source;
  }

  const module = await initX2TModule();
  const FS = (module as { FS?: any }).FS;
  if (!FS) {
    throw new Error("x2t FS is not available");
  }

  const { name } = resolvedName;
  const sourcePath = `/working/${name}`;
  const outputPath = `/working/export.${format}`;

  prepareWorkingDir(FS);

  const arrayBuffer = await source.arrayBuffer();
  FS.writeFile(sourcePath, new Uint8Array(arrayBuffer));
  writeMediaFiles(FS, options?.media);

  const paramsXml = buildParamsXml(sourcePath, outputPath);
  FS.writeFile("/working/params.xml", paramsXml);

  const ccall = (module as { ccall?: (...args: unknown[]) => number }).ccall;
  if (!ccall) {
    throw new Error("x2t ccall is not available");
  }

  const result = ccall("main1", "number", ["string"], ["/working/params.xml"]);
  if (result !== 0) {
    throw new Error(`x2t conversion failed with code ${result}`);
  }

  const output = FS.readFile(outputPath);
  const mimeByFormat: Record<ExportFormat, string> = {
    pdf: "application/pdf",
    docx: defaultDocxMime,
    xlsx: defaultXlsxMime,
    pptx: defaultPptxMime,
  };
  const mime = mimeByFormat[format] ?? defaultDocxMime;
  return new Blob([output], { type: mime });
}
