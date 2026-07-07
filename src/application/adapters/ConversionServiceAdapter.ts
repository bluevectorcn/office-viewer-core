import type { DocEditorConfig, EditorInput } from '../../shared/types/EditorTypes';
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
} from '../services/InputProcessingService';

/**
 * 转换服务适配器
 *
 * 实现了双模式架构（纯前端 WASM 模式 & 后端辅助转码服务模式）
 */
export class ConversionServiceAdapter implements ConversionService {
  private config?: DocEditorConfig;

  constructor(config?: DocEditorConfig) {
    this.config = config;
  }

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
   * 使用 X2T 转换文档（通过路由切换 WASM 或 Go 后端辅助转码）
   */
  async convertWithX2T(prepared: UseCasePreparedInput): Promise<ConvertedDocument> {
    const mode = this.config?.mode || 'wasm';

    if (mode === 'server') {
      try {
        return await this.convertWithBackend(prepared);
      } catch (err) {
        throw new Error(`后端辅助转码服务失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (mode === 'auto') {
      try {
        return await this.convertWithBackend(prepared);
      } catch (err) {
        console.warn('后端辅助转码服务失败，自动降级至本地 WASM 转换模式', err);
        return await this.convertWithWasm(prepared);
      }
    }

    // 默认为纯前端 WASM 模式
    return await this.convertWithWasm(prepared);
  }

  /**
   * 使用 Go 后端服务进行文件转码和资源加载
   */
  private async convertWithBackend(prepared: UseCasePreparedInput): Promise<ConvertedDocument> {
    const file = prepared.file instanceof File
      ? prepared.file
      : new File([prepared.file], prepared.title || 'document.docx');

    if (!this.config?.backendUrl) {
      throw new Error('后端转码服务未配置 backendUrl。请在编辑器配置中设置 backendUrl。');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name);

    // 1. 发送 HTTP POST 请求至 Go 服务接口进行转换
    const response = await fetch(`${this.config.backendUrl}/api/convert`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorMsg = await response.text();
      throw new Error(`服务器响应失败: ${response.statusText} (${errorMsg})`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`服务器转码业务失败: ${result.error || '未知错误'}`);
    }

    // 2. 在前端拉取转换完成的 Editor.bin 并缓存为本地 Object URL，确保兼容性
    const binResponse = await fetch(result.editorBinUrl);
    if (!binResponse.ok) {
      throw new Error(`下载转码产物 Editor.bin 失败: ${binResponse.statusText}`);
    }
    const binBlob = await binResponse.blob();
    const objectUrl = URL.createObjectURL(binBlob);

    // 3. 返回转换结果，使用后端托管的远程绝对图片 URL 替换本地 ObjectURL
    return {
      url: result.editorBinUrl,
      objectUrl: objectUrl,
      title: prepared.title || 'document',
      documentType: result.documentType || this.inferDocumentType(file.name),
      fileType: result.fileType || this.getFileType(file.name),
      images: result.images || {},
      mediaData: {} // 在后端模式下，图片直接远程加载，无需在前端内存中装载庞大的 mediaData，大幅节约内存
    };
  }

  /**
   * 纯前端本地 WASM 转换逻辑（封装原有的 convertWithX2T 逻辑）
   */
  private async convertWithWasm(prepared: UseCasePreparedInput): Promise<ConvertedDocument> {
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
