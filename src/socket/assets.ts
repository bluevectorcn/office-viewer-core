import { revokeObjectUrl } from "../core/lifecycle";

export type DocumentAssets = {
  editorUrl: string;
  originUrl?: string;
  images: Record<string, string>;
  mediaData?: Record<string, Uint8Array>;
  fileType?: string;
  title?: string;
  downloads?: string[];
};

const assetsStore = new Map<string, DocumentAssets>();

export function registerDocumentAssets(docId: string, assets: DocumentAssets) {
  const normalized: DocumentAssets = {
    ...assets,
    downloads: assets.downloads ?? [],
  };
  assetsStore.set(docId, normalized);
  if (normalized.editorUrl) {
    assetsStore.set(normalized.editorUrl, normalized);
  }
}

export function getDocumentAssets(docId: string) {
  return assetsStore.get(docId);
}

export function registerDownloadUrl(docId: string, url: string) {
  const assets = assetsStore.get(docId);
  if (!assets) return;
  const previous = assets.downloads ?? [];
  previous.forEach((entry) => revokeObjectUrl(entry));
  assets.downloads = [url];
}

export function clearDocumentAssets(docId: string) {
  const assets = assetsStore.get(docId);
  assets?.downloads?.forEach((url) => revokeObjectUrl(url));
  revokeObjectUrl(assets?.originUrl);
  assetsStore.delete(docId);
  if (assets?.editorUrl) {
    assetsStore.delete(assets.editorUrl);
  }
}
