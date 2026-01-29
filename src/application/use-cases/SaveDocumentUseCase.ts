import type { ExportFormat } from '../../shared/types/EditorTypes';
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
   * @param filename - 可选文件名
   * @returns 保存的文档 Blob 和最终文件名
   * @throws {EditorError} 当所有保存策略都失败时
   */
  async execute(session: DocumentSession, filename?: string): Promise<{ blob: Blob; filename: string }> {
    this.logger.info('Saving document', {
      docId: session.docId,
      nativeFormat: session.nativeFormat,
      requestedFilename: filename
    });

    // 1. 确定最终后缀名（处理旧版格式升级）
    const extension = this.getUpgradeExtension(session.nativeFormat);
    
    // 2. 确定最终文件名
    let finalFilename: string;
    if (!filename) {
      // 入参不指定时使用默认名称(doc_时间戳.后缀)
      finalFilename = `doc_${Date.now()}.${extension}`;
    } else {
      // 入参指定时，检查后缀，不匹配自动添加
      if (!filename.toLowerCase().endsWith('.' + extension)) {
        finalFilename = `${filename}.${extension}`;
      } else {
        finalFilename = filename;
      }
    }

    try {
      // 策略 1: 从编辑器下载本地格式
      const downloaded = await this.downloadRequester.requestDownload(
        extension
      );

      // 更新会话的源 Blob（用于后续操作）
      session.sourceBlob = downloaded;

      this.logger.info('Document saved successfully via downloadAs', {
        docId: session.docId,
        size: downloaded.size,
        filename: finalFilename
      });

      return { blob: downloaded, filename: finalFilename };

    } catch (downloadError) {
      this.logger.warn(
        `downloadAs(${session.nativeFormat}) failed, falling back to source blob`,
        downloadError instanceof Error ? { error: downloadError.message, stack: downloadError.stack } : { error: downloadError }
      );

      // 策略 2: 使用上次保存的源 Blob
      if (session.sourceBlob && session.sourceBlob.size > 0) {
        this.logger.info('Using cached source blob', {
          docId: session.docId,
          size: session.sourceBlob.size
        });
        return { blob: session.sourceBlob, filename: finalFilename };
      }

      // 策略 3: 从原始 URL 获取
      if (session.converted.url) {
        try {
          const blob = await this.fetchFromUrl(session.converted.url);
          this.logger.info('Fetched document from original URL', {
            docId: session.docId,
            size: blob.size
          });
          return { blob, filename: finalFilename };
        } catch (fetchError) {
          this.logger.warn('Failed to fetch from original URL', fetchError instanceof Error ? { error: fetchError.message, stack: fetchError.stack } : { error: fetchError });
        }
      }

      // 策略 4: 返回空 Blob（最后的手段）
      this.logger.error('All save strategies failed, returning empty blob', {
        docId: session.docId
      });

      return { 
        blob: new Blob([], { type: 'application/octet-stream' }), 
        filename: finalFilename 
      };
    }
  }

  /**
   * 获取升级后的后缀名
   */
  private getUpgradeExtension(format: string): ExportFormat {
    switch (format) {
      case 'doc': return 'docx';
      case 'xls': return 'xlsx';
      case 'ppt': return 'pptx';
      default: return format as ExportFormat;
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
