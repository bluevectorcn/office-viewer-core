export type DocumentAssets = {
  editorUrl: string;
  images: Record<string, string>;
  fileType?: string;
};

const assetsStore = new Map<string, DocumentAssets>();

export function registerDocumentAssets(docId: string, assets: DocumentAssets) {
  assetsStore.set(docId, assets);
  if (assets.editorUrl) {
    assetsStore.set(assets.editorUrl, assets);
  }
}

export function getDocumentAssets(docId: string) {
  return assetsStore.get(docId);
}

export function clearDocumentAssets(docId: string) {
  const assets = assetsStore.get(docId);
  assetsStore.delete(docId);
  if (assets?.editorUrl) {
    assetsStore.delete(assets.editorUrl);
  }
}
