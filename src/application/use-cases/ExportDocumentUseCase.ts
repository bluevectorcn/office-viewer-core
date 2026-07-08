import type { ExportFormat, DocumentType } from '../../shared/types/EditorTypes';
import type { Logger } from '../../shared/logging/Logger';
import type { DocumentSession } from './OpenDocumentUseCase';
import type { DownloadRequester } from './SaveDocumentUseCase';
import { EditorError, ErrorCode } from '../../shared/errors/EditorError';

/**
 * X2T 导出选项
 */
export interface X2TExportOptions {
  /**
   * 源文件名（含扩展名），用于让 x2t 正确识别源格式。
   * 当源是 Editor.bin 等 ".bin" 二进制时，需配合 documentType 使用。
   */
  sourceName?: string;
  /**
   * 文档类型（word/cell/slide/pdf），源为 Editor.bin 时必需，
   * 用于推导 Canvas 源格式码 (m_nFormatFrom)。
   */
  documentType?: DocumentType;
  /**
   * 嵌入的媒体资源（图片等）。
   */
  media?: Record<string, Uint8Array>;
}

/**
 * X2T 导出服务接口
 */
export interface X2TExportService {
  /**
   * 使用 X2T 导出文档到指定格式
   * @param source - 源文档 Blob
   * @param format - 目标格式
   * @param options - 导出选项（源名、文档类型、媒体等）
   * @returns 导出的文档 Blob
   */
  exportWithX2T(source: Blob, format: ExportFormat, options?: X2TExportOptions): Promise<Blob>;
}

/**
 * 导出文档用例
 *
 * 职责：
 * 1. 导出文档到指定格式
 * 2. 处理本地格式的特殊情况（直接保存）
 * 3. 使用编辑器 downloadAs 或 X2T 进行格式转换
 *
 * 导出策略：
 * 1. 如果目标格式 = 本地格式 → 调用 save()
 * 2. 尝试使用编辑器的 downloadAs API
 * 3. 回退到 X2T 转换
 *
 * @example
 * ```typescript
 * const useCase = new ExportDocumentUseCase(
 *   downloadRequester,
 *   x2tService,
 *   saveUseCase,
 *   logger
 * );
 *
 * const pdfBlob = await useCase.execute(session, 'pdf');
 * ```
 */
export class ExportDocumentUseCase {
  constructor(
    private readonly downloadRequester: DownloadRequester,
    private readonly x2tService: X2TExportService,
    private readonly logger: Logger
  ) {}

  /**
   * 执行导出文档操作
   *
   * @param session - 文档会话
   * @param format - 目标格式
   * @param sourceBlob - 可选的源 Blob（如果不提供，会从会话中获取）
   * @returns 导出的文档 Blob
   * @throws {EditorError} 当导出失败时
   */
  async execute(
    session: DocumentSession,
    format: ExportFormat,
    sourceBlob?: Blob
  ): Promise<Blob> {
    this.logger.info('Exporting document', {
      docId: session.docId,
      targetFormat: format,
      nativeFormat: session.nativeFormat
    });

    try {
      // 策略 1: 如果目标格式就是本地格式，直接使用源 Blob
      if (format === session.nativeFormat && sourceBlob) {
        this.logger.debug('Target format matches native format, using source blob');
        return sourceBlob;
      }

      // 策略 2: 尝试使用编辑器的 downloadAs API
      try {
        const downloaded = await this.downloadRequester.requestDownload(format);

        // 如果下载的是本地格式，更新会话的源 Blob
        if (format === session.nativeFormat) {
          session.sourceBlob = downloaded;
        }

        this.logger.info('Document exported successfully via downloadAs', {
          docId: session.docId,
          format,
          size: downloaded.size
        });

        return downloaded;

      } catch (downloadError) {
        this.logger.warn(
          `downloadAs(${format}) failed, falling back to X2T export`,
          downloadError instanceof Error ? { error: downloadError.message, stack: downloadError.stack } : { error: downloadError }
        );

        // PDF 无法在浏览器内用 wasm x2t 生成（doctrenderer 被裁剪），
        // downloadAs 失败意味着后端转码也不可用，直接抛错避免产出损坏文件。
        if (format === "pdf") {
          throw new EditorError(
            ErrorCode.EXPORT_FAILED,
            '导出 PDF 失败：需要后端转码服务（wasm 版 x2t 不含 PDF 渲染能力）。请配置 backendUrl 并将 mode 设为 server/auto。',
            undefined,
            { format, docId: session.docId }
          );
        }

        // 策略 3: 回退到 X2T 转换（非 PDF 格式）
        const source = sourceBlob || session.sourceBlob;

        if (!source || source.size === 0) {
          throw new EditorError(
            ErrorCode.EXPORT_FAILED,
            'No source document available for X2T export',
            undefined,
            { format, docId: session.docId }
          );
        }

        const exported = await this.x2tService.exportWithX2T(source, format, {
          sourceName: session.converted.title,
          documentType: session.converted.documentType,
        });

        this.logger.info('Document exported successfully via X2T', {
          docId: session.docId,
          format,
          size: exported.size
        });

        return exported;
      }

    } catch (error) {
      this.logger.error('Failed to export document', error);
      throw EditorError.from(
        error,
        ErrorCode.EXPORT_FAILED,
        `Failed to export document to ${format}`
      );
    }
  }
}
