/**
 * 让客户端产生的 blob: 图片在 PDF 渲染序列化时能被解析。
 *
 * 背景：PDF 导出走 renderer binary 路径（OnlyOffice 的 `ToRendererPart`）。
 * 该路径里 `Metafile.drawImage` 对 `blob:` 开头的 URL 优先走 blob 分支，调用
 * `g_oDocumentBlobUrls.getImageBase64(url)`；未注册时函数原样返回 `blob:...`
 * 字符串，后端 x2t 无法解析 → 导出的 PDF 缺图。
 *
 * 关键难点：release 构建里 `sdk-all-min.js` 把 `g_oDocumentBlobUrls`、
 * `getImageBase64`、`blobUrl2Data` 等符号全部 mangle 成短名，无法按源码里的
 * 属性名访问。
 *
 * 本方案：通过 `getImageBase64` 方法体里独有的特征字面量
 * （`data:image/jpeg;base64,`、`data:image/svg+xml;base64,`，mangle 后仍保留）
 * 定位到该方法，然后**对方法做一次性 monkey-patch**：调用时先查我们自己维护的
 * blobUrl→bytes 映射，命中则返回 inline base64，未命中则回退原方法。
 * 这样完全不依赖 mangle 后的字段名，对 patch 版本更稳健。
 *
 * 所有操作都做了防御性 try/catch 与可选链，AscCommon 不存在或检测失败时
 * 静默跳过，不影响主流程。
 */

type AscCommonLike = Record<string, unknown>;
type TargetWindow = Window & {
  AscCommon?: AscCommonLike;
};

/** `getImageBase64` 方法体的特征字面量。mangle 后仍保留，且全 SDK 各仅出现一次。 */
const GETIMAGEBASE64_MARKERS = ['data:image/jpeg;base64,', 'data:image/svg+xml;base64,'];

/** 我们自己维护的 blobUrl -> 字节/MIME 映射，patch 后的 getImageBase64 先查这里。 */
interface BlobImageEntry {
  type: number; // 3=jpeg、24=svg、其余=png
  data: Uint8Array;
}
const blobImageStore = new Map<string, BlobImageEntry>();

/** 缓存每个 AscCommon 是否已 patch 过 getImageBase64，避免重复 patch。 */
const patchedRegistries = new WeakSet<object>();

/**
 * 根据图片字节/MIME 推导 OnlyOffice 的类型码。
 *
 * `getImageBase64` 的 switch 仅区分：3→jpeg、24→svg、default→png 前缀。
 * 实际字节由 x2t 光栅库按字节头重新识别格式，前缀只是 data-URI 提示。
 */
function resolveImageType(bytes: Uint8Array, mime: string): number {
  const lower = (mime || '').split(';')[0].trim().toLowerCase();
  if (lower === 'image/svg+xml' || lower === 'image/svg') return 24;
  if (lower === 'image/jpeg' || lower === 'image/jpg') return 3;
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 3; // jpeg 字节头
  }
  return 4; // png 前缀（bmp/gif/webp/tiff/emf/wmf 等统一走 png 前缀）
}

/** 用我们维护的字节生成 data URI，前缀规则与 OnlyOffice getImageBase64 一致。 */
function buildDataUri(entry: BlobImageEntry, base64Encode: (bytes: Uint8Array) => string): string {
  let header: string;
  switch (entry.type) {
    case 3:
      header = 'data:image/jpeg;base64,';
      break;
    case 24:
      header = 'data:image/svg+xml;base64,';
      break;
    default:
      header = 'data:image/png;base64,';
  }
  return header + base64Encode(entry.data);
}

function looksLikeGetImageBase64(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  try {
    const src = String(fn);
    return GETIMAGEBASE64_MARKERS.every((m) => src.includes(m));
  } catch {
    return false;
  }
}

/**
 * 在某对象的原型链上（含自身，最多 4 层）查找 `getImageBase64` 特征方法，
 * 返回其持有者对象与属性名。
 */
function locateGetImageBase64(owner: object): { holder: object; prop: string; fn: Function } | null {
  let proto: object | null = owner;
  for (let depth = 0; depth < 4 && proto; depth++) {
    const obj = proto as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(obj);
    for (const name of names) {
      if (name === 'constructor') continue;
      let fn: unknown;
      try {
        fn = obj[name];
      } catch {
        continue;
      }
      if (looksLikeGetImageBase64(fn)) {
        return { holder: obj, prop: name, fn: fn as Function };
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return null;
}

/**
 * 遍历 `AscCommon` 找到挂载 `getImageBase64` 的 `ZlibImageBlobs` 实例，
 * 并对方法做一次性 patch（命中我们的 blobUrl 时返回 inline base64）。
 *
 * 返回是否已成功 patch（或已 patch 过）。
 */
function ensureBlobRegistryPatched(asc: AscCommonLike): boolean {
  for (const key of Object.keys(asc)) {
    let value: unknown;
    try {
      value = asc[key];
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const instance = value as object;
    if (patchedRegistries.has(instance)) return true;

    const located = locateGetImageBase64(instance);
    if (!located) continue;

    const original = located.fn as (url: string) => string;
    const holder = located.holder as Record<string, unknown>;

    // OnlyOffice 内部用 AscCommon.QN.encode（即 Base64.encode）做 base64。
    // 这里沿用宿主已有的 Base64 工具，避免重复实现。优先复用原方法闭包能访问到的
    // 编码器；若取不到则回退到自实现的 btoa 路径。
    const patched = function (this: unknown, url: string): string {
      const entry = blobImageStore.get(url);
      if (entry) {
        return buildDataUri(entry, encodeBase64);
      }
      return original.call(this, url);
    };
    try {
      // 保留原方法引用，便于排障
      (patched as unknown as { __original?: Function }).__original = original;
      Object.defineProperty(holder, located.prop, {
        value: patched,
        writable: true,
        configurable: true,
      });
      patchedRegistries.add(instance);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** base64 编码，优先用宿主 OnlyOffice 的 AscCommon Base64，回退 btoa。 */
function encodeBase64(bytes: Uint8Array): string {
  // OnlyOffice 的 Base64 编码器（mangle 后名不定，但 AscCommon.Base64 暴露 encode）
  try {
    const anyAsc = (window as unknown as { AscCommon?: Record<string, unknown> }).AscCommon;
    const enc = (anyAsc as { Base64?: { encode?: (b: unknown) => string } } | undefined)?.Base64
      ?.encode;
    if (typeof enc === 'function') {
      const r = enc(bytes);
      if (typeof r === 'string' && r) return r;
    }
  } catch {
    // 回退
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let s = '';
    for (let j = 0; j < slice.length; j++) s += String.fromCharCode(slice[j]);
    binary += s;
  }
  return btoa(binary);
}

/**
 * 把一张 blob 图片注册进来：写入我们的 blobImageStore，并确保 OnlyOffice 的
 * `getImageBase64` 已被 patch（patch 后命中本表即返回 inline base64）。
 *
 * @param targetWindow OnlyOffice iframe 的 contentWindow（注入 patch 时传入）
 * @param blobUrl      `URL.createObjectURL` 产生的 blob: URL
 * @param bytes        图片原始字节（会拷贝一份，避免外部 revoke 后失效）
 * @param mime         图片 MIME（可选）
 * @returns true 表示成功；false 表示环境不具备（无 AscCommon / 未找到 getImageBase64）。
 */
export function registerBlobImageInOnlyOffice(
  targetWindow: Window | undefined | null,
  blobUrl: string,
  bytes: Uint8Array,
  mime?: string
): boolean {
  if (!targetWindow || !blobUrl || !blobUrl.startsWith('blob:') || bytes.byteLength === 0) {
    return false;
  }

  try {
    const asc = (targetWindow as TargetWindow).AscCommon;
    if (!asc) {
      console.warn('[BlobRegistry] AscCommon not found on targetWindow; blob image will not embed in PDF', { blobUrl: blobUrl.slice(0, 40) });
      return false;
    }

    if (!ensureBlobRegistryPatched(asc)) {
      console.warn('[BlobRegistry] getImageBase64 not located; blob image will not embed in PDF', { blobUrl: blobUrl.slice(0, 40) });
      return false;
    }

    // 拷贝一份独立 buffer，避免引用外部可能被 revoke/复用的字节
    const owned = new Uint8Array(bytes.byteLength);
    owned.set(bytes);

    blobImageStore.set(blobUrl, {
      type: resolveImageType(bytes, mime || ''),
      data: owned,
    });
    return true;
  } catch {
    // 注入失败不应阻断图片上传主流程
    return false;
  }
}
