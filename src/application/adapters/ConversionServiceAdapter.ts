import type { EditorInput } from '../../core/types';
import type {
  ConversionService,
  PreparedInput as UseCasePreparedInput,
  ConvertedDocument
} from '../use-cases/OpenDocumentUseCase';
import {
  prepareInput as legacyPrepareInput,
  convertWithX2T as legacyConvertWithX2T,
  type PreparedInput as LegacyPreparedInput,
  type ConvertedInput as LegacyConvertedInput
} from '../../input/openFile';

/**
 * 转换服务适配器
 *
 * 将旧的 prepareInput 和 convertWithX2T 函数适配到新的 ConversionService 接口
 *
 * 这个适配器是暂时的，用于逐步迁移。未来可以直接重构 openFile.ts 实现新接口。
 */
export class ConversionServiceAdapter implements ConversionService {
  /**
   * 准备输入（适配旧的 prepareInput）
   */
  async prepareInput(input: EditorInput): Promise<UseCasePreparedInput> {
    const legacy: LegacyPreparedInput = await legacyPrepareInput(input);

    // 适配返回类型
    return {
      file: legacy.file,
      title: legacy.title
    };
  }

  /**
   * 使用 X2T 转换文档（适配旧的 convertWithX2T）
   */
  async convertWithX2T(prepared: UseCasePreparedInput): Promise<ConvertedDocument> {
    // 确保 prepared.file 是 File 类型
    const file = prepared.file instanceof File
      ? prepared.file
      : new File([prepared.file], prepared.title || 'document.docx');

    // 构造旧的 PreparedInput 格式
    const legacyPrepared: LegacyPreparedInput = {
      file,
      title: prepared.title || 'document',
      fileType: this.getFileType(file.name),
      documentType: this.inferDocumentType(file.name)
    };

    const legacy: LegacyConvertedInput = await legacyConvertWithX2T(legacyPrepared);

    // 适配返回类型
    return {
      url: legacy.url,
      objectUrl: legacy.objectUrl,
      title: legacy.title,
      documentType: legacy.documentType,
      fileType: legacy.fileType,
      images: legacy.images,
      mediaData: legacy.mediaData
    };
  }

  /**
   * 从文件名获取文件类型
   */
  private getFileType(filename: string): string {
    const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] ?? 'docx';
  }

  /**
   * 推断文档类型
   */
  private inferDocumentType(filename: string): 'word' | 'cell' | 'slide' | 'pdf' {
    const ext = this.getFileType(filename);
    if (['docx', 'doc', 'odt', 'txt', 'rtf'].includes(ext)) return 'word';
    if (['xlsx', 'xls', 'ods', 'csv'].includes(ext)) return 'cell';
    if (['pptx', 'ppt', 'odp'].includes(ext)) return 'slide';
    if (['pdf'].includes(ext)) return 'pdf';
    return 'word';
  }
}
