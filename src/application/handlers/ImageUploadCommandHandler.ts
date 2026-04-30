import { registerDocumentImageAsset } from '../../infrastructure/socket/AssetsStore';
import { createId } from '../../shared/utils/LifecycleHelpers';

const UPLOAD_ENDPOINT_RE = /\/upload\/([^/?#]+)/i;

export type ImageUploadResponse = Record<string, string>;

type BlobLike = Blob & {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  name?: string;
  type?: string;
};

type ImageUploadBody = {
  bytes: Uint8Array;
  type: string;
  name: string;
};

export function shouldInterceptImageUploadUrl(targetWindow: Window, rawUrl: string) {
  try {
    const parsed = new URL(rawUrl, targetWindow.location.href);
    return UPLOAD_ENDPOINT_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

function parseDocId(targetWindow: Window, rawUrl: string) {
  try {
    const parsed = new URL(rawUrl, targetWindow.location.href);
    const match = parsed.pathname.match(UPLOAD_ENDPOINT_RE);
    return match?.[1] ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

async function resolveUploadBody(body: unknown): Promise<ImageUploadBody> {
  const formDataEntry = findFormDataImageEntry(body);
  if (formDataEntry) {
    return {
      bytes: await toUint8Array(formDataEntry),
      type: getBodyType(formDataEntry),
      name: getBodyName(formDataEntry),
    };
  }

  return {
    bytes: await toUint8Array(body),
    type: getBodyType(body),
    name: getBodyName(body),
  };
}

async function toUint8Array(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (isBlobLike(body)) return new Uint8Array(await readBlobAsArrayBuffer(body));
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array();
}

function findFormDataImageEntry(body: unknown) {
  if (!isFormDataLike(body)) return null;

  for (const [, value] of body.entries()) {
    if (isBlobLike(value)) {
      return value;
    }
  }

  return null;
}

function isFormDataLike(
  body: unknown
): body is { entries: () => IterableIterator<[string, unknown]> } {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as { entries?: unknown; append?: unknown };
  return typeof candidate.entries === 'function' && typeof candidate.append === 'function';
}

function isBlobLike(body: unknown): body is BlobLike {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as { arrayBuffer?: unknown; size?: unknown; slice?: unknown };
  return (
    typeof candidate.arrayBuffer === 'function' ||
    (typeof candidate.size === 'number' && typeof candidate.slice === 'function')
  );
}

function readBlobAsArrayBuffer(blob: BlobLike): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image blob'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

function getBodyType(body: unknown) {
  if (body && typeof body === 'object') {
    const type = (body as { type?: unknown }).type;
    if (typeof type === 'string' && type) {
      return type.toLowerCase();
    }
  }
  return '';
}

function getBodyName(body: unknown) {
  if (body && typeof body === 'object') {
    const name = (body as { name?: unknown }).name;
    if (typeof name === 'string' && name) {
      return name;
    }
  }
  return '';
}

function extensionFromMime(type: string) {
  const normalized = type.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/bmp': 'bmp',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
  };
  return map[normalized] ?? '';
}

function extensionFromName(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function extensionFromBytes(bytes: Uint8Array) {
  if (bytes.length >= 8) {
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (isPng) return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp';
  }
  return '';
}

function resolveImageExtension(body: unknown, bytes: Uint8Array) {
  return (
    extensionFromMime(getBodyType(body)) ||
    extensionFromName(getBodyName(body)) ||
    extensionFromBytes(bytes) ||
    'bin'
  );
}

function resolveParentDocKey(targetWindow: Window) {
  try {
    const parentConfig = (
      targetWindow.parent as Window & {
        DocEditorConfig?: { document?: { key?: unknown } };
      }
    ).DocEditorConfig;
    const key = parentConfig?.document?.key;
    return key ? String(key) : '';
  } catch {
    return '';
  }
}

export async function handleImageUploadRequest(
  targetWindow: Window,
  rawUrl: string,
  body: unknown
): Promise<ImageUploadResponse | null> {
  const docId = parseDocId(targetWindow, rawUrl) || resolveParentDocKey(targetWindow);
  if (!docId) return null;

  const uploadBody = await resolveUploadBody(body);
  const bytes = uploadBody.bytes;
  if (!bytes.byteLength) return {};

  const ext = resolveImageExtension(uploadBody, bytes);
  const imagePath = `media/${createId('image')}.${ext}`;
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const blob = new Blob([blobBytes], {
    type: uploadBody.type || 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);

  const registered = registerDocumentImageAsset(docId, imagePath, url, bytes);
  if (!registered) {
    URL.revokeObjectURL(url);
    return null;
  }

  return {
    [imagePath]: url,
  };
}
