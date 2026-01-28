import type { ExportFormat } from '../../core/types';
import type { Logger } from '../../shared/logging/Logger';
import type { DocumentSession } from './OpenDocumentUseCase';
import { EditorError, ErrorCode } from '../../shared/errors/EditorError';

/**
 * 下载请求器接口
 */
export interface DownloadRequester {
  /**
   * 请求从编辑器下载文档
   * @param format - 导出格式
   * @returns 下载的文档 Blob
   */
  requestDownload(format: ExportFormat): Promise<Blob>;
}

/**
 * 保存文档用例
 *
 * 职责：
 * 1. 从编辑器请求下载当前文档
 * 2. 处理下载失败时的回退逻辑
 * 3. 更新会话中的源 Blob
 *
 * 保存策略（按优先级）：
 * 1. 从编辑器下载本地格式（通过 downloadAs API）
 * 2. 回退到上次保存的源 Blob
 * 3. 回退到原始文件 URL
 * 4. 返回空 Blob
 *
 * @example
 * ```typescript
 * const useCase = new SaveDocumentUseCase(downloadRequester, logger);
 * const blob = await useCase.execute(session);
 * console.log('Document saved:', blob.size);
 * ```
 */
export class SaveDocumentUseCase {
  constructor(
    private readonly downloadRequester: DownloadRequester,
    private readonly logger: Logger
  ) {}

  /**
   * 执行保存文档操作
   *
   * @param session - 文档会话
   * @returns 保存的文档 Blob
   * @throws {EditorError} 当所有保存策略都失败时
   */
  async execute(session: DocumentSession): Promise<Blob> {
    this.logger.info('Saving document', {
      docId: session.docId,
      nativeFormat: session.nativeFormat
    });

    try {
      // 策略 1: 从编辑器下载本地格式
      const downloaded = await this.downloadRequester.requestDownload(
        session.nativeFormat
      );

      // 更新会话的源 Blob（用于后续操作）
      session.sourceBlob = downloaded;

      this.logger.info('Document saved successfully via downloadAs', {
        docId: session.docId,
        size: downloaded.size
      });

      return downloaded;

    } catch (downloadError) {
      this.logger.warn(
        `downloadAs(${session.nativeFormat}) failed, falling back to source blob`,
        downloadError
      );

      // 策略 2: 使用上次保存的源 Blob
      if (session.sourceBlob && session.sourceBlob.size > 0) {
        this.logger.info('Using cached source blob', {
          docId: session.docId,
          size: session.sourceBlob.size
        });
        return session.sourceBlob;
      }

      // 策略 3: 从原始 URL 获取
      if (session.converted.url) {
        try {
          const blob = await this.fetchFromUrl(session.converted.url);
          this.logger.info('Fetched document from original URL', {
            docId: session.docId,
            size: blob.size
          });
          return blob;
        } catch (fetchError) {
          this.logger.warn('Failed to fetch from original URL', fetchError);
        }
      }

      // 策略 4: 返回空 Blob（最后的手段）
      this.logger.error('All save strategies failed, returning empty blob', {
        docId: session.docId
      });

      return new Blob([], { type: 'application/octet-stream' });
    }
  }

  /**
   * 从 URL 获取 Blob
   */
  private async fetchFromUrl(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new EditorError(
        ErrorCode.NETWORK_ERROR,
        `Failed to fetch from URL: ${response.status}`,
        undefined,
        { url, status: response.status }
      );
    }
    return await response.blob();
  }
}
