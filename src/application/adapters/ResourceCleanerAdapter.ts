import type { ResourceCleaner } from '../EditorOrchestrator';
import { clearDocumentAssets as legacyClearAssets } from '../../socket/assets';
import { revokeObjectUrl as legacyRevokeUrl } from '../../core/lifecycle';

/**
 * 资源清理器适配器
 *
 * 将旧的清理函数适配到新的 ResourceCleaner 接口
 */
export class ResourceCleanerAdapter implements ResourceCleaner {
  clearDocumentAssets(docId: string): void {
    legacyClearAssets(docId);
  }

  revokeObjectUrl(url: string | null): void {
    if (url) {
      legacyRevokeUrl(url);
    }
  }
}
