import type { EditorInput, ExportFormat } from '../shared/types/EditorTypes';
import type { Logger } from '../shared/logging/Logger';
import type { DocumentSession } from './use-cases/OpenDocumentUseCase';
import { OpenDocumentUseCase } from './use-cases/OpenDocumentUseCase';
import { SaveDocumentUseCase } from './use-cases/SaveDocumentUseCase';
import { ExportDocumentUseCase } from './use-cases/ExportDocumentUseCase';
import { EditorState } from '../domain/EditorState';
import { DisposableGroup, type Disposable } from '../shared/utils/Disposable';
import { EditorError, ErrorCode } from '../shared/errors/EditorError';

/**
 * 资源清理器接口
 */
export interface ResourceCleaner {
  /**
   * 清理文档资源
   */
  clearDocumentAssets(docId: string): void;

  /**
   * 撤销 Object URL
   */
  revokeObjectUrl(url: string | null): void;
}

/**
 * 编辑器编排器
 *
 * 核心职责：
 * 1. 协调各个用例（OpenDocument, SaveDocument, ExportDocument）
 * 2. 管理编辑器状态（State Machine）
 * 3. 管理文档会话生命周期
 * 4. 统一资源清理
 *
 * 这是替代原 createEditor.ts 上帝类的核心类，但职责更清晰：
 * - 不处理 DOM 操作（由外部 DocsAPI 管理）
 * - 不处理格式转换（委托给 Use Cases）
 * - 不管理下载逻辑（委托给 Use Cases）
 * - 只负责编排和协调
 *
 * @example
 * ```typescript
 * const orchestrator = new EditorOrchestrator(
 *   openUseCase,
 *   saveUseCase,
 *   exportUseCase,
 *   resourceCleaner,
 *   logger
 * );
 *
 * // 打开文档
 * await orchestrator.open(file);
 *
 * // 保存文档
 * const blob = await orchestrator.save();
 *
 * // 导出文档
 * const pdfBlob = await orchestrator.export('pdf');
 *
 * // 清理资源
 * orchestrator.dispose();
 * ```
 */
export class EditorOrchestrator implements Disposable {
  private session: DocumentSession | null = null;
  private readonly state: EditorState;
  private readonly disposables = new DisposableGroup();

  constructor(
    private readonly openUseCase: OpenDocumentUseCase,
    private readonly saveUseCase: SaveDocumentUseCase,
    private readonly exportUseCase: ExportDocumentUseCase,
    private readonly resourceCleaner: ResourceCleaner,
    private readonly logger: Logger
  ) {
    this.state = new EditorState();
    this.disposables.add(this.state);

    this.logger.info('EditorOrchestrator created');
  }

  /**
   * 打开文档
   *
   * @param input - 文档输入（File, Blob, ArrayBuffer, URL）
   * @throws {EditorError} 当状态不允许打开或打开失败时
   */
  async open(input: EditorInput): Promise<void> {
    // 检查状态
    if (!this.state.canOpen()) {
      throw new EditorError(
        ErrorCode.INVALID_OPERATION,
        `Cannot open document in ${this.state.currentState} state`,
        undefined,
        { currentState: this.state.currentState }
      );
    }

    await this.state.transition('loading');

    try {
      // 如果已有会话，先清理
      if (this.session) {
        this.logger.debug('Closing previous session before opening new document');
        await this.closeCurrentSession();
      }

      // 执行打开文档用例
      this.session = await this.openUseCase.execute(input);

      this.logger.info('Document session created', {
        docId: this.session.docId
      });

      // 转换到就绪状态
      await this.state.transition('ready');

    } catch (error) {
      await this.state.transition('error');
      throw error;
    }
  }

  /**
   * 保存文档
   *
   * @returns 保存的文档 Blob
   * @throws {EditorError} 当没有打开的文档或状态不允许保存时
   */
  async save(): Promise<Blob> {
    this.ensureSession();

    if (!this.state.canSave()) {
      throw new EditorError(
        ErrorCode.INVALID_OPERATION,
        `Cannot save document in ${this.state.currentState} state`,
        undefined,
        { currentState: this.state.currentState }
      );
    }

    await this.state.transition('saving');

    try {
      const blob = await this.saveUseCase.execute(this.session!);
      await this.state.transition('ready');
      return blob;

    } catch (error) {
      await this.state.transition('error');
      throw error;
    }
  }

  /**
   * 导出文档到指定格式
   *
   * @param format - 目标格式
   * @returns 导出的文档 Blob
   * @throws {EditorError} 当没有打开的文档或状态不允许导出时
   */
  async export(format: ExportFormat): Promise<Blob> {
    this.ensureSession();

    if (!this.state.canExport()) {
      throw new EditorError(
        ErrorCode.INVALID_OPERATION,
        `Cannot export document in ${this.state.currentState} state`,
        undefined,
        { currentState: this.state.currentState }
      );
    }

    await this.state.transition('exporting');

    try {
      // 如果导出格式是本地格式，先保存获取最新内容
      let sourceBlob: Blob | undefined;
      if (format === this.session!.nativeFormat) {
        sourceBlob = await this.saveUseCase.execute(this.session!);
      }

      const blob = await this.exportUseCase.execute(
        this.session!,
        format,
        sourceBlob
      );

      await this.state.transition('ready');
      return blob;

    } catch (error) {
      await this.state.transition('error');
      throw error;
    }
  }

  /**
   * 获取当前会话（只读）
   */
  getCurrentSession(): Readonly<DocumentSession> | null {
    return this.session;
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): string {
    return this.state.currentState;
  }

  /**
   * 关闭当前会话并清理资源
   */
  private async closeCurrentSession(): Promise<void> {
    if (!this.session) {
      return;
    }

    const { docId, converted, originUrl, imageUrls } = this.session;

    this.logger.debug('Closing session', { docId });

    // 清理文档资产
    this.resourceCleaner.clearDocumentAssets(docId);

    // 撤销 Object URLs
    this.resourceCleaner.revokeObjectUrl(converted.objectUrl);
    this.resourceCleaner.revokeObjectUrl(originUrl);

    // 撤销图片 URLs
    for (const url of imageUrls) {
      this.resourceCleaner.revokeObjectUrl(url);
    }

    this.session = null;

    this.logger.debug('Session closed', { docId });
  }

  /**
   * 确保有打开的会话
   */
  private ensureSession(): void {
    if (!this.session) {
      throw new EditorError(
        ErrorCode.NO_SESSION,
        'No document is open',
        undefined,
        { currentState: this.state.currentState }
      );
    }
  }

  /**
   * 释放所有资源
   */
  async dispose(): Promise<void> {
    this.logger.info('Disposing EditorOrchestrator');

    // 关闭当前会话
    if (this.session) {
      await this.closeCurrentSession();
    }

    // 释放所有可释放资源
    this.disposables.dispose();

    this.logger.info('EditorOrchestrator disposed');
  }
}
