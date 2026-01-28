import { revokeObjectUrl } from "../core/lifecycle";
import { ResourceManager } from "@/domain/ResourceManager";
import { Logger } from "@/shared/logging/Logger";

export type DocumentAssets = {
  editorUrl: string;
  originUrl?: string;
  images: Record<string, string>;
  mediaData?: Record<string, Uint8Array>;
  fileType?: string;
  title?: string;
  downloads?: string[];
};

/**
 * 文档资产存储
 *
 * 架构改进（阶段 1.2）：
 * - 使用 ResourceManager 管理所有 ObjectURL，防止内存泄漏
 * - 保持全局函数接口，向后兼容
 * - 内部完全使用 ResourceManager 实例管理资源
 */

const logger = new Logger({ prefix: '[Assets]' });

// 资产元数据存储（不包含大对象，只存储引用）
const assetsStore = new Map<string, DocumentAssets>();

// 为每个文档创建独立的 ResourceManager
const resourceManagers = new Map<string, ResourceManager>();

/**
 * 获取或创建 ResourceManager
 */
function getOrCreateResourceManager(docId: string): ResourceManager {
  let manager = resourceManagers.get(docId);
  if (!manager) {
    manager = new ResourceManager(docId, logger, {
      maxCacheSize: 100 * 1024 * 1024, // 100MB
      cacheTTL: 0 // 不过期（由手动清理控制）
    });
    resourceManagers.set(docId, manager);
  }
  return manager;
}

/**
 * 注册文档资产
 * 所有 ObjectURL 会自动注册到 ResourceManager，确保在清理时正确释放
 */
export function registerDocumentAssets(docId: string, assets: DocumentAssets) {
  const manager = getOrCreateResourceManager(docId);

  const normalized: DocumentAssets = {
    ...assets,
    downloads: assets.downloads ?? [],
  };

  // 注册所有 ObjectURL 到 ResourceManager
  if (normalized.editorUrl) {
    manager.registerObjectUrl(normalized.editorUrl);
  }
  if (normalized.originUrl) {
    manager.registerObjectUrl(normalized.originUrl);
  }

  // 注册所有图片 URL
  for (const imageUrl of Object.values(normalized.images)) {
    manager.registerObjectUrl(imageUrl);
  }

  // 注册下载 URL
  if (normalized.downloads) {
    for (const downloadUrl of normalized.downloads) {
      manager.registerObjectUrl(downloadUrl);
    }
  }

  // 存储资产元数据
  assetsStore.set(docId, normalized);
  if (normalized.editorUrl) {
    assetsStore.set(normalized.editorUrl, normalized);
  }

  logger.debug('Document assets registered', {
    docId,
    editorUrl: normalized.editorUrl,
    imageCount: Object.keys(normalized.images).length,
    hasOriginUrl: !!normalized.originUrl,
    downloadCount: normalized.downloads?.length ?? 0
  });
}

/**
 * 获取文档资产
 *
 * @param docId - 文档ID（可以是 docId、editorUrl、key 等）
 * @returns 文档资产，如果不存在则返回 undefined
 */
export function getDocumentAssets(docId: string): DocumentAssets | undefined {
  return assetsStore.get(docId);
}

/**
 * 注册下载 URL
 * 会清理旧的下载 URL 并注册新的
 */
export function registerDownloadUrl(docId: string, url: string) {
  const assets = assetsStore.get(docId);
  if (!assets) {
    logger.warn('registerDownloadUrl: assets not found', { docId });
    return;
  }

  const manager = getOrCreateResourceManager(docId);

  // 清理旧的下载 URL（通过 ResourceManager）
  const previous = assets.downloads ?? [];
  previous.forEach((oldUrl) => {
    manager.unregisterObjectUrl(oldUrl);
  });

  // 注册新的下载 URL
  manager.registerObjectUrl(url);
  assets.downloads = [url];

  logger.debug('Download URL registered', { docId, url });
}

/**
 * 清理文档资产
 * 释放所有关联的 ObjectURL，防止内存泄漏
 */
export function clearDocumentAssets(docId: string) {
  const assets = assetsStore.get(docId);

  if (!assets) {
    logger.debug('clearDocumentAssets: no assets found', { docId });
  }

  // 使用 ResourceManager 统一清理所有资源
  // ResourceManager.dispose() 会自动 revoke 所有注册的 ObjectURL
  const manager = resourceManagers.get(docId);
  if (manager) {
    manager.dispose();
    resourceManagers.delete(docId);
    logger.info('Document assets cleared via ResourceManager', { docId });
  } else {
    // 降级处理：如果没有 ResourceManager，使用旧方法清理（向后兼容）
    logger.warn('clearDocumentAssets: no ResourceManager, using legacy cleanup', { docId });
    assets?.downloads?.forEach((url) => revokeObjectUrl(url));
    revokeObjectUrl(assets?.originUrl);
    // 注意：images 中的 URL 也应该被清理
    if (assets?.images) {
      Object.values(assets.images).forEach((url) => revokeObjectUrl(url));
    }
  }

  // 清理元数据存储
  assetsStore.delete(docId);
  if (assets?.editorUrl) {
    assetsStore.delete(assets.editorUrl);
  }
}
