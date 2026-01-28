import type { AssetsRegistry } from '../use-cases/OpenDocumentUseCase';
import { registerDocumentAssets as legacyRegisterAssets } from '../../infrastructure/socket/AssetsStore';

/**
 * 资产注册器适配器
 *
 * 将旧的 registerDocumentAssets 函数适配到新的 AssetsRegistry 接口
 */
export class AssetsRegistryAdapter implements AssetsRegistry {
  registerDocumentAssets(
    docId: string,
    assets: {
      editorUrl: string;
      originUrl: string;
      images: Record<string, string>;
      mediaData?: Record<string, Uint8Array>;
      fileType: string;
      title: string;
    }
  ): void {
    legacyRegisterAssets(docId, assets);
  }
}
