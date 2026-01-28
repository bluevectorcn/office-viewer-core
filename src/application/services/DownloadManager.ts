import type { ExportFormat } from '../../core/types';
import type { DownloadRequester } from '../use-cases/SaveDocumentUseCase';
import type { Logger } from '../../shared/logging/Logger';
import { EditorError, ErrorCode } from '../../shared/errors/EditorError';

/**
 * 待处理的下载请求
 */
interface PendingDownload {
  format: ExportFormat;
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
  timer: number;
}

/**
 * 内部下载标志（用于标识来自编辑器的下载）
 */
interface InternalDownloadFlag {
  docId: string;
  expiresAt: number;
}

/**
 * 编辑器实例接口
 */
interface DocEditorInstance {
  destroyEditor?: () => void;
  downloadAs?: (format: string | Record<string, unknown>) => void;
}

/**
 * 下载管理器
 *
 * 职责：
 * 1. 管理从编辑器请求下载的流程
 * 2. 处理 onDownloadAs 回调
 * 3. 管理下载超时
 * 4. 设置内部下载标志（防止自动下载）
 *
 * @example
 * ```typescript
 * const manager = new DownloadManager(logger);
 *
 * // 设置编辑器实例
 * manager.setEditorInstance(editorInstance);
 * manager.setDocId(docId);
 * manager.setDocumentTitle(title);
 *
 * // 请求下载
 * const blob = await manager.requestDownload('pdf');
 * ```
 */
export class DownloadManager implements DownloadRequester {
  private editorInstance: DocEditorInstance | null = null;
  private currentDocId: string | null = null;
  private documentTitle = 'document.docx';
  private pendingDownload: PendingDownload | null = null;

  private readonly DOWNLOAD_TIMEOUT_MS = 15000; // 15秒
  private readonly INTERNAL_DOWNLOAD_TTL_MS = 20000; // 20秒

  constructor(private readonly logger: Logger) {}

  /**
   * 设置编辑器实例
   */
  setEditorInstance(instance: DocEditorInstance | null): void {
    this.editorInstance = instance;
  }

  /**
   * 设置当前文档 ID
   */
  setDocId(docId: string | null): void {
    this.currentDocId = docId;
  }

  /**
   * 设置文档标题
   */
  setDocumentTitle(title: string): void {
    this.documentTitle = title;
  }

  /**
   * 请求从编辑器下载文档
   *
   * @param format - 导出格式
   * @returns 下载的文档 Blob
   * @throws {EditorError} 当编辑器不可用或下载失败时
   */
  async requestDownload(format: ExportFormat): Promise<Blob> {
    if (!this.editorInstance?.downloadAs) {
      throw new EditorError(
        ErrorCode.DOWNLOAD_FAILED,
        'DocEditor downloadAs is not available',
        undefined,
        { format }
      );
    }

    this.logger.debug('Requesting download from editor', { format });

    return new Promise<Blob>((resolve, reject) => {
      // 取消任何待处理的下载
      this.clearPendingDownload(
        new EditorError(
          ErrorCode.DOWNLOAD_FAILED,
          'Superseded by a new download request',
          undefined,
          { format }
        )
      );

      // 设置超时
      const timer = window.setTimeout(() => {
        this.clearPendingDownload(
          new EditorError(
            ErrorCode.DOWNLOAD_FAILED,
            `downloadAs(${format}) timed out`,
            undefined,
            { format, timeout: this.DOWNLOAD_TIMEOUT_MS }
          )
        );
      }, this.DOWNLOAD_TIMEOUT_MS);

      // 保存待处理的下载
      this.pendingDownload = { format, resolve, reject, timer };

      // 设置内部下载标志（防止编辑器自动触发浏览器下载）
      this.setInternalDownloadFlag(this.currentDocId);

      // 触发编辑器下载
      this.editorInstance!.downloadAs!(format);
    });
  }

  /**
   * 处理 onDownloadAs 回调
   *
   * 这个方法应该在编辑器配置的 onDownloadAs 回调中调用
   */
  async handleDownloadAs(event: unknown): Promise<void> {
    const url = this.extractUrlFromEvent(event);
    const fileType = this.extractFileTypeFromEvent(event);

    if (!url) {
      if (this.pendingDownload) {
        this.clearPendingDownload(
          new EditorError(
            ErrorCode.DOWNLOAD_FAILED,
            'onDownloadAs missing url',
            undefined,
            { event }
          )
        );
      }
      return;
    }

    // 如果没有待处理的下载，说明是用户手动下载，触发浏览器下载
    if (!this.pendingDownload) {
      this.logger.debug('User-initiated download, triggering browser download', { fileType });
      this.triggerBrowserDownload(url, fileType as ExportFormat);
      return;
    }

    // 从 URL 获取 Blob
    try {
      this.logger.debug('Fetching download from URL', { url });
      const response = await fetch(url);

      if (!response.ok) {
        throw new EditorError(
          ErrorCode.NETWORK_ERROR,
          `Download fetch failed: ${response.status}`,
          undefined,
          { url, status: response.status }
        );
      }

      const rawBlob = await response.blob();
      const current = this.pendingDownload;
      this.pendingDownload = null;

      if (current) {
        clearTimeout(current.timer);
        this.clearInternalDownloadFlag(this.currentDocId);

        // 确保 Blob 具有正确的 MIME type
        const correctMimeType = this.getMimeTypeForFormat(current.format);
        const blob = new Blob([rawBlob], { type: correctMimeType });

        this.logger.info('Download completed successfully', {
          format: current.format,
          size: blob.size,
          mimeType: correctMimeType
        });
        current.resolve(blob);
      }

    } catch (error) {
      this.clearPendingDownload(error);
    }
  }

  /**
   * 清理所有待处理的下载
   */
  cleanup(): void {
    this.clearPendingDownload();
    this.clearInternalDownloadFlag();
    this.editorInstance = null;
    this.currentDocId = null;
  }

  /**
   * 从事件中提取 URL
   */
  private extractUrlFromEvent(event: unknown): string {
    const payload =
      event && typeof event === 'object' && 'data' in event
        ? (event as { data?: unknown }).data ?? event
        : event;

    const url =
      payload && typeof payload === 'object' && 'url' in payload
        ? String((payload as { url?: unknown }).url ?? '')
        : '';

    return url;
  }

  /**
   * 从事件中提取文件类型
   */
  private extractFileTypeFromEvent(event: unknown): string {
    const payload =
      event && typeof event === 'object' && 'data' in event
        ? (event as { data?: unknown }).data ?? event
        : event;

    // OnlyOffice 编辑器在 onDownloadAs 事件中会提供 fileType 字段
    const fileType =
      payload && typeof payload === 'object' && 'fileType' in payload
        ? String((payload as { fileType?: unknown }).fileType ?? '')
        : '';

    return fileType;
  }

  /**
   * 触发浏览器下载
   */
  private triggerBrowserDownload(url: string, format?: ExportFormat): void {
    const link = document.createElement('a');
    link.href = url;
    // 确保文件名有正确的扩展名
    link.download = format
      ? this.ensureCorrectExtension(this.documentTitle, format)
      : this.documentTitle;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /**
   * 确保文件名有正确的扩展名
   */
  private ensureCorrectExtension(filename: string, format: ExportFormat): string {
    // 移除现有扩展名
    const withoutExt = filename.replace(/\.(docx|xlsx|pptx|pdf|doc|xls|ppt)$/i, '');
    // 添加正确的扩展名
    return `${withoutExt}.${format}`;
  }

  /**
   * 清除待处理的下载
   */
  private clearPendingDownload(error?: unknown): void {
    if (!this.pendingDownload) return;

    clearTimeout(this.pendingDownload.timer);
    const current = this.pendingDownload;
    this.pendingDownload = null;
    this.clearInternalDownloadFlag(this.currentDocId);

    if (error !== undefined) {
      this.logger.warn('Download request cleared', error);
      current.reject(error);
    }
  }

  /**
   * 设置内部下载标志
   */
  private setInternalDownloadFlag(docId: string | null): void {
    const win = window as Window & { __ooInternalDownload?: InternalDownloadFlag };
    if (!docId) {
      delete win.__ooInternalDownload;
      return;
    }
    win.__ooInternalDownload = {
      docId,
      expiresAt: Date.now() + this.INTERNAL_DOWNLOAD_TTL_MS
    };
  }

  /**
   * 清除内部下载标志
   */
  private clearInternalDownloadFlag(docId?: string | null): void {
    const win = window as Window & { __ooInternalDownload?: InternalDownloadFlag };
    const current = win.__ooInternalDownload;
    if (!current) return;
    if (docId !== undefined && docId !== null && current.docId !== docId) return;
    delete win.__ooInternalDownload;
  }

  /**
   * 根据格式获取正确的 MIME type
   */
  private getMimeTypeForFormat(format: ExportFormat): string {
    const mimeTypes: Record<ExportFormat, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pdf: 'application/pdf'
    };
    return mimeTypes[format] || 'application/octet-stream';
  }
}
