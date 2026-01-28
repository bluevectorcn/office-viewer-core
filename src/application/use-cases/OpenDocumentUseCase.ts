import type { EditorInput, DocumentType, ExportFormat } from '../../core/types';
import type { Logger } from '../../shared/logging/Logger';
import { EditorError, ErrorCode } from '../../shared/errors/EditorError';

/**
 * 文档转换结果
 */
export interface ConvertedDocument {
  /** 编辑器文件的 Object URL */
  url: string;
  /** 编辑器文件的 Object URL（别名） */
  objectUrl: string;
  /** 文档标题 */
  title: string;
  /** 文档类型 */
  documentType: DocumentType;
  /** 文件类型扩展名 */
  fileType: string;
  /** 图片资源映射 */
  images: Record<string, string>;
  /** 媒体数据（原始字节） */
  mediaData?: Record<string, Uint8Array>;
}

/**
 * 准备后的输入
 */
export interface PreparedInput {
  file: Blob;
  title?: string;
}

/**
 * 文档会话信息
 */
export interface DocumentSession {
  /** 文档 ID */
  docId: string;
  /** 转换后的文档 */
  converted: ConvertedDocument;
  /** 原始文件 */
  sourceBlob: Blob;
  /** 原始文件的 Object URL */
  originUrl: string;
  /** 本地格式（docx, xlsx, pptx 等） */
  nativeFormat: ExportFormat;
  /** 图片 URLs（用于清理） */
  imageUrls: string[];
}

/**
 * 文档转换服务接口
 */
export interface ConversionService {
  /**
   * 准备输入（将各种格式统一为 Blob）
   */
  prepareInput(input: EditorInput): Promise<PreparedInput>;

  /**
   * 使用 X2T 转换文档
   */
  convertWithX2T(prepared: PreparedInput): Promise<ConvertedDocument>;
}

/**
 * 资产注册器接口
 */
export interface AssetsRegistry {
  /**
   * 注册文档资产
   */
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
  ): void;
}

/**
 * 打开文档用例
 *
 * 职责：
 * 1. 准备和转换文档
 * 2. 注册文档资源
 * 3. 创建文档会话
 *
 * @example
 * ```typescript
 * const useCase = new OpenDocumentUseCase(
 *   conversionService,
 *   assetsRegistry,
 *   logger
 * );
 *
 * const session = await useCase.execute(file);
 * console.log('Document opened:', session.docId);
 * ```
 */
export class OpenDocumentUseCase {
  constructor(
    private readonly conversionService: ConversionService,
    private readonly assetsRegistry: AssetsRegistry,
    private readonly logger: Logger,
    private readonly createDocId: () => string
  ) {}

  /**
   * 执行打开文档操作
   *
   * @param input - 文档输入（File, Blob, ArrayBuffer, URL）
   * @returns 文档会话信息
   * @throws {EditorError} 当转换或注册失败时
   */
  async execute(input: EditorInput): Promise<DocumentSession> {
    this.logger.info('Opening document', {
      inputType: this.getInputType(input)
    });

    try {
      // 1. 准备输入
      const prepared = await this.conversionService.prepareInput(input);
      this.logger.debug('Input prepared', {
        size: prepared.file.size,
        title: prepared.title
      });

      // 2. 转换文档
      const converted = await this.conversionService.convertWithX2T(prepared);
      this.logger.debug('Document converted', {
        documentType: converted.documentType,
        fileType: converted.fileType,
        imageCount: Object.keys(converted.images).length
      });

      // 3. 生成文档 ID
      const docId = this.createDocId();

      // 4. 创建原始文件的 Object URL
      const originUrl = URL.createObjectURL(prepared.file);

      // 5. 提取图片 URLs（用于后续清理）
      const imageUrls = Object.values(converted.images);

      // 6. 注册文档资产
      this.assetsRegistry.registerDocumentAssets(docId, {
        editorUrl: converted.url,
        originUrl,
        images: converted.images,
        mediaData: converted.mediaData,
        fileType: converted.fileType,
        title: converted.title
      });

      this.logger.debug('Assets registered', { docId });

      // 7. 确定本地格式
      const nativeFormat = this.nativeFormatFromDocumentType(converted.documentType);

      // 8. 创建文档会话
      const session: DocumentSession = {
        docId,
        converted,
        sourceBlob: prepared.file,
        originUrl,
        nativeFormat,
        imageUrls
      };

      this.logger.info('Document opened successfully', {
        docId,
        nativeFormat,
        title: converted.title
      });

      return session;

    } catch (error) {
      this.logger.error('Failed to open document', error);
      throw EditorError.from(
        error,
        ErrorCode.OPEN_FAILED,
        'Failed to open document'
      );
    }
  }

  /**
   * 根据文档类型确定本地格式
   */
  private nativeFormatFromDocumentType(documentType: DocumentType): ExportFormat {
    switch (documentType) {
      case 'cell':
        return 'xlsx';
      case 'slide':
        return 'pptx';
      case 'pdf':
        return 'pdf';
      case 'word':
      default:
        return 'docx';
    }
  }

  /**
   * 获取输入类型（用于日志）
   */
  private getInputType(input: EditorInput): string {
    if (input instanceof File) return 'File';
    if (input instanceof Blob) return 'Blob';
    if (input instanceof ArrayBuffer) return 'ArrayBuffer';
    if (typeof input === 'string') return 'URL';
    return 'Unknown';
  }
}
