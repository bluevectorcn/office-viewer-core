import type { EditorInput } from "../core/types";
import { initX2TModule } from "../export/x2t-export";

export interface PreparedInput {
  file: File;
  title: string;
  fileType: string;
  documentType: "word" | "cell" | "slide";
}

export interface ConvertedInput {
  url: string;
  title: string;
  fileType: string;
  documentType: "word" | "cell" | "slide";
  blob: Blob;
  objectUrl: string;
  images: Record<string, string>;
}

const defaultDocxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function getExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "docx";
}

function inferDocumentType(ext: string): "word" | "cell" | "slide" | null {
  const normalized = ext.toLowerCase();
  if (["docx", "doc", "odt", "txt", "rtf"].includes(normalized)) return "word";
  if (["xlsx", "xls", "ods", "csv"].includes(normalized)) return "cell";
  if (["pptx", "ppt", "odp"].includes(normalized)) return "slide";
  return null;
}

async function fetchAsFile(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.statusText}`);
  }
  const blob = await response.blob();
  return new File([blob], filename, { type: blob.type || defaultDocxMime });
}

export async function prepareInput(input: EditorInput): Promise<PreparedInput> {
  if (typeof input === "string") {
    const title = input.split("/").pop()?.split("?")[0] || "document.docx";
    const fileType = getExtension(title);
    const documentType = inferDocumentType(fileType);
    if (!documentType) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    const file = await fetchAsFile(input, title);
    return { file, title, fileType, documentType };
  }

  if (input instanceof File) {
    const fileType = getExtension(input.name);
    const documentType = inferDocumentType(fileType);
    if (!documentType) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    return { file: input, title: input.name, fileType, documentType };
  }

  if (input instanceof Blob) {
    const file = new File([input], "document.docx", { type: input.type || defaultDocxMime });
    return { file, title: "document.docx", fileType: "docx", documentType: "word" };
  }

  const bufferBlob = new Blob([input], { type: defaultDocxMime });
  const file = new File([bufferBlob], "document.docx", { type: defaultDocxMime });
  return { file, title: "document.docx", fileType: "docx", documentType: "word" };
}

function prepareWorkingDir(FS: any) {
  const tryRemove = (p: string) => {
    if (!FS.analyzePath(p).exists) return;
    if (FS.isDir(FS.stat(p).mode)) {
      FS.readdir(p).filter((e: string) => e !== "." && e !== "..").forEach((e: string) => tryRemove(`${p}/${e}`));
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

export async function convertWithX2T(input: PreparedInput): Promise<ConvertedInput> {
  const module = await initX2TModule();
  const FS = (module as { FS?: any }).FS;
  if (!FS) {
    throw new Error("x2t FS is not available");
  }

  prepareWorkingDir(FS);

  const arrayBuffer = await input.file.arrayBuffer();
  FS.writeFile(`/working/${input.title}`, new Uint8Array(arrayBuffer));

  const params = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    "<m_sFontDir>/working/fonts/</m_sFontDir>",
    "<m_sThemeDir>/working/themes</m_sThemeDir>",
    `<m_sFileFrom>/working/${input.title}</m_sFileFrom>`,
    "<m_sFileTo>/working/Editor.bin</m_sFileTo>",
    "<m_bIsNoBase64>false</m_bIsNoBase64>",
    "<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding>",
    "<m_nCsvDelimiter>4</m_nCsvDelimiter>",
    "</TaskQueueDataConvert>",
  ].join("");

  FS.writeFile("/working/params.xml", params);

  const ccall = (module as { ccall?: (...args: unknown[]) => number }).ccall;
  if (!ccall) {
    throw new Error("x2t ccall is not available");
  }

  const result = ccall("main1", "number", ["string"], ["/working/params.xml"]);
  if (result !== 0) {
    throw new Error(`x2t conversion failed with code ${result}`);
  }

  const bin = FS.readFile("/working/Editor.bin");
  const blob = new Blob([bin], { type: "application/octet-stream" });
  const objectUrl = URL.createObjectURL(blob);
  const images = collectImages(FS);

  return {
    url: objectUrl,
    title: input.title,
    fileType: input.fileType,
    documentType: input.documentType,
    blob,
    objectUrl,
    images,
  };
}

function collectImages(FS: any) {
  const root = "/working/media";
  const images: Record<string, string> = {};

  const guessMime = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".bmp")) return "image/bmp";
    if (lower.endsWith(".svg")) return "image/svg+xml";
    if (lower.endsWith(".webp")) return "image/webp";
    return "application/octet-stream";
  };

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
      const blob = new Blob([data], { type: guessMime(relPath) });
      images[relPath] = URL.createObjectURL(blob);
    }
  };

  try {
    if (FS.analyzePath(root).exists) {
      readDir(root, "");
    }
  } catch {
    // No media output.
  }

  return images;
}
