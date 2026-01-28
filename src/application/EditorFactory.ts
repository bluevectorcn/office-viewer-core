import type { DocEditorConfig, EditorInput, ExportFormat, IEditor } from '../shared/types/EditorTypes';
import { OpenDocumentUseCase } from './use-cases/OpenDocumentUseCase';
import { SaveDocumentUseCase } from './use-cases/SaveDocumentUseCase';
import { ExportDocumentUseCase } from './use-cases/ExportDocumentUseCase';
import { EditorOrchestrator } from './EditorOrchestrator';
import { ConversionServiceAdapter } from './adapters/ConversionServiceAdapter';
import { AssetsRegistryAdapter } from './adapters/AssetsRegistryAdapter';
import { X2TExportServiceAdapter } from './adapters/X2TExportServiceAdapter';
import { ResourceCleanerAdapter } from './adapters/ResourceCleanerAdapter';
import { DownloadManager } from './services/DownloadManager';
import { defaultLogger } from '../shared/logging/Logger';
import { createId, createReadyLatch } from '../shared/utils/LifecycleHelpers';
import { loadDocsApi } from '../infrastructure/external/DocsApiProvider';
import { initX2TModule } from '../infrastructure/conversion/X2TService';
import { buildEditorConfig } from './config/EditorConfigBuilder';
import { observeEditorIframes } from '../infrastructure/dom/IframeObserver';
import { injectGlobals, exposeDocEditorConfig } from '../application/initialization/GlobalInjector';
import { setAssetsPrefix } from '../infrastructure/socket/AssetsPrefix';
import { emptyDocx, emptyPptx, emptyXlsx } from '../infrastructure/conversion/EmptyDocumentTemplates';

/**
 * 新文件格式
 */
type NewFileFormat = 'docx' | 'xlsx' | 'pptx';

/**
 * 编辑器工厂
 *
 * 职责：
 * 1. 创建和配置所有依赖（依赖注入容器）
 * 2. 初始化 DocsAPI 和 X2T
 * 3. 管理 DOM 容器
 * 4. 提供向后兼容的 API
 *
 * @example
 * ```typescript
 * const factory = new EditorFactory();
 * const editor = await factory.create(container, baseConfig);
 * await editor.open(file);
 * ```
 */
export class EditorFactory {
  /**
   * 创建编辑器实例
   *
   * @param container - DOM 容器元素
   * @param baseConfig - 编辑器基础配置
   * @returns OnlyOfficeEditor 实例（向后兼容的 API）
   */
  create(container: HTMLElement, baseConfig: DocEditorConfig): IEditor {
    // 1. 初始化全局环境
    injectGlobals();
    setAssetsPrefix(baseConfig.assetsPrefix);

    // 2. 创建 DOM host
    const host = document.createElement('div');
    host.className = 'editor-host';
    const hostId = createId('oo-editor');
    host.id = hostId;
    container.appendChild(host);

    // 3. 观察 iframe
    const stopObservingFrames = observeEditorIframes(document.documentElement || host);

    // 4. 创建 Logger
    const logger = defaultLogger.createChild({
      prefix: '[Editor]',
      editorId: hostId
    });

    // 5. 创建服务和适配器
    const conversionService = new ConversionServiceAdapter();
    const assetsRegistry = new AssetsRegistryAdapter();
    const x2tService = new X2TExportServiceAdapter();
    const resourceCleaner = new ResourceCleanerAdapter();
    const downloadManager = new DownloadManager(logger);

    // 6. 创建用例
    const openUseCase = new OpenDocumentUseCase(
      conversionService,
      assetsRegistry,
      logger,
      () => createId('doc')
    );

    const saveUseCase = new SaveDocumentUseCase(
      downloadManager,
      logger
    );

    const exportUseCase = new ExportDocumentUseCase(
      downloadManager,
      x2tService,
      logger
    );

    // 7. 创建编排器
    const orchestrator = new EditorOrchestrator(
      openUseCase,
      saveUseCase,
      exportUseCase,
      resourceCleaner,
      logger
    );

    // 8. 创建 DocsAPI 编辑器实例的引用
    let docEditorInstance: any = null;

    // 9. 实现打开文档的完整流程（包括加载 DocsAPI）
    const openDocument = async (input: EditorInput): Promise<void> => {
      logger.info('Opening document');

      // 初始化 DocsAPI 和 X2T
      await loadDocsApi();
      await initX2TModule();

      // 使用编排器打开文档
      await orchestrator.open(input);

      // 获取会话信息
      const session = orchestrator.getCurrentSession();
      if (!session) {
        throw new Error('Session not created');
      }

      // 销毁旧的编辑器实例
      if (docEditorInstance?.destroyEditor) {
        docEditorInstance.destroyEditor();
      }

      // 更新下载管理器
      downloadManager.setDocId(session.docId);
      downloadManager.setDocumentTitle(session.converted.title);

      // 创建就绪 latch
      const ready = createReadyLatch();

      // 构建编辑器配置（适配 ConvertedInput 类型）
      const convertedInput = {
        ...session.converted,
        blob: new Blob([]),
        mediaData: session.converted.mediaData || {}
      };

      const config = buildEditorConfig(baseConfig, convertedInput, session.docId, {
        onAppReady: ready.resolve,
        onDocumentReady: ready.resolve,
        onDownloadAs: (event) => downloadManager.handleDownloadAs(event),
        onError: (error) => {
          logger.error('OnlyOffice error', error);
        }
      });

      // 暴露配置（用于调试）
      exposeDocEditorConfig(config);

      // 创建 DocsAPI 编辑器实例
      docEditorInstance = new window.DocsAPI!.DocEditor(hostId, config);
      downloadManager.setEditorInstance(docEditorInstance);

      // 等待编辑器就绪
      await ready.promise;

      logger.info('Document opened and editor ready');
    };

    // 10. 实现 newFile
    const newFile = async (format: NewFileFormat): Promise<void> => {
      const file = this.createEmptyFile(format);
      await openDocument(file);
    };

    // 11. 实现 destroy
    const destroy = (): void => {
      logger.info('Destroying editor');

      // 销毁 DocsAPI 编辑器
      if (docEditorInstance?.destroyEditor) {
        docEditorInstance.destroyEditor();
      }
      docEditorInstance = null;

      // 清理下载管理器
      downloadManager.cleanup();

      // 释放编排器资源
      orchestrator.dispose();

      // 移除 DOM
      host.remove();

      // 停止观察 iframe
      stopObservingFrames();

      logger.info('Editor destroyed');
    };

    // 12. 自动打开配置中的文档
    setTimeout(() => {
      const url = baseConfig?.document?.url;
      if (this.shouldAutoOpen(url)) {
        void openDocument(url as string);
      }
    }, 0);

    // 13. 返回向后兼容的 API
    return {
      open: openDocument,
      newFile,
      save: () => orchestrator.save(),
      export: (format: ExportFormat) => orchestrator.export(format),
      destroy
    };
  }

  /**
   * 创建空文件
   */
  private createEmptyFile(format: NewFileFormat): File {
    const mimeByFormat: Record<NewFileFormat, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    };

    const templateByFormat: Record<NewFileFormat, string> = {
      docx: emptyDocx,
      xlsx: emptyXlsx,
      pptx: emptyPptx
    };

    const bytes = this.toBinaryBytes(templateByFormat[format]);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    return new File([buffer], `document.${format}`, {
      type: mimeByFormat[format]
    });
  }

  /**
   * 将字符串转换为二进制字节
   */
  private toBinaryBytes(data: string): Uint8Array {
    const buffer = new ArrayBuffer(data.length);
    const view = new Uint8Array(buffer);
    for (let index = 0; index < data.length; index += 1) {
      view[index] = data.charCodeAt(index);
    }
    return view;
  }

  /**
   * 检查是否应该自动打开
   */
  private shouldAutoOpen(url: unknown): boolean {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed === 'data:,' || trimmed.startsWith('data:,')) return false;
    try {
      const parsed = new URL(trimmed, window.location.href);
      return parsed.protocol !== 'data:';
    } catch {
      return false;
    }
  }
}

export function createEditor(
  container: HTMLElement,
  baseConfig: DocEditorConfig
): IEditor {
  // 使用工厂模式创建编辑器实例
  // 工厂负责：
  // 1. 创建和配置所有依赖（依赖注入）
  // 2. 初始化 DocsAPI 和 X2T
  // 3. 管理 DOM 容器
  // 4. 返回向后兼容的 API
  const factory = new EditorFactory();
  return factory.create(container, baseConfig);
}
