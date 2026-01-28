import type { EditorInput } from "../../shared/types/EditorTypes";
import { convertToEditorBin } from "../../infrastructure/conversion/X2TService";

export interface PreparedInput {
  file: File;
  title: string;
  fileType: string;
  documentType: "word" | "cell" | "slide" | "pdf";
}

export interface ConvertedInput {
  url: string;
  title: string;
  fileType: string;
  documentType: "word" | "cell" | "slide" | "pdf";
  blob: Blob;
  objectUrl: string;
  images: Record<string, string>;
  mediaData: Record<string, Uint8Array>;
}

const defaultDocxMime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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

function getExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "docx";
}

function inferExtensionFromMime(mime: string) {
  const normalized = mime.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") {
    return "docx";
  }
  return mimeToExtension[normalized] ?? null;
}

function inferDocumentType(ext: string): "word" | "cell" | "slide" | "pdf" | null {
  const normalized = ext.toLowerCase();
  if (["docx", "doc", "odt", "txt", "rtf"].includes(normalized)) return "word";
  if (["xlsx", "xls", "ods", "csv"].includes(normalized)) return "cell";
  if (["pptx", "ppt", "odp"].includes(normalized)) return "slide";
  if (["pdf"].includes(normalized)) return "pdf";
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
    const fileType = inferExtensionFromMime(input.type);
    if (!fileType) {
      throw new Error(`Unsupported blob MIME type: ${input.type || "(empty)"}`);
    }
    const documentType = inferDocumentType(fileType);
    if (!documentType) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
    const title = `document.${fileType}`;
    const file = new File([input], title, { type: input.type || defaultDocxMime });
    return { file, title, fileType, documentType };
  }

  const bufferBlob = new Blob([input], { type: defaultDocxMime });
  const file = new File([bufferBlob], "document.docx", { type: defaultDocxMime });
  return { file, title: "document.docx", fileType: "docx", documentType: "word" };
}

export async function convertWithX2T(input: PreparedInput): Promise<ConvertedInput> {
  const { blob, objectUrl, media } = await convertToEditorBin(input.file, input.title);

  return {
    url: objectUrl,
    title: input.title,
    fileType: input.fileType,
    documentType: input.documentType,
    blob,
    objectUrl,
    images: media.images,
    mediaData: media.mediaData,
  };
}
