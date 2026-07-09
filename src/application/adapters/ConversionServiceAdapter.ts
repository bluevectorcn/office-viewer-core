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

const extensionToMime: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain',
  rtf: 'application/rtf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation',
  pdf: 'application/pdf',
};

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

  async prepareInput(input: EditorInput): Promise<UseCasePreparedInput> {
    if (typeof input === 'string') {
      const title = input.split('/').pop()?.split('?')[0] || 'document.docx';
      const fileType = this.getFileType(title);
      const mimeType = extensionToMime[fileType] || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      
      const fakeBlob = new Blob([], { type: mimeType });
      (fakeBlob as any)._remoteUrl = input; // 携带原始远程 URL
      (fakeBlob as any)._title = title;
      
      return {
        file: fakeBlob,
        title: title
      };
    }

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
    const file = prepared.file;
    const fileName = file instanceof File ? file.name : prepared.title || '';
    const isPdf = fileName.toLowerCase().endsWith('.pdf') || (file instanceof Blob && file.type === 'application/pdf');

    if (isPdf) {
      // PDF 不需要经过 x2t 转换，前端直接以 WASM 模式在本地处理（使用原生 Blob URL），无需向后端发起转换请求
      return this.convertWithWasm(prepared);
    }

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
   * 使用 Go 后端服务进行 file 转码和资源加载
   */
  private async convertWithBackend(prepared: UseCasePreparedInput): Promise<ConvertedDocument> {
    const remoteUrl = (prepared.file as any)._remoteUrl;
    const formData = new FormData();
    let fileName = prepared.title || 'document.docx';

    if (remoteUrl) {
      // 传递远程链接由后端抓取，解决 CORS 跨域问题
      formData.append('url', remoteUrl);
      formData.append('title', fileName);
    } else {
      const file = prepared.file instanceof File
        ? prepared.file
        : new File([prepared.file], fileName);
      formData.append('file', file);
      formData.append('title', file.name);
      fileName = file.name;
    }

    if (!this.config?.backendUrl) {
      throw new Error('后端转码服务未配置 backendUrl。请在编辑器配置中设置 backendUrl。');
    }

    // 状态汇报：开始提报后端转码
    window.dispatchEvent(new CustomEvent('office-viewer-status', {
      detail: remoteUrl 
        ? "正在连接服务器并拉取转换远程文档..." 
        : "正在上传并转换本地文档..."
    }));

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

    // 状态汇报：转码成功，拉取二进制中
    window.dispatchEvent(new CustomEvent('office-viewer-status', {
      detail: "文档转码成功，正在加载渲染缓存..."
    }));

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
      documentType: result.documentType || this.inferDocumentType(fileName),
      fileType: result.fileType || this.getFileType(fileName),
      images: result.images || {},
      mediaData: {} // 在后端模式下，图片直接远程加载，无需在前端内存中装载庞大的 mediaData，大幅节约内存
    };
  }

  private async convertWithWasm(prepared: UseCasePreparedInput): Promise<ConvertedDocument> {
    let file: File;
    const remoteUrl = (prepared.file as any)._remoteUrl;

    if (remoteUrl) {
      // 只有当被迫以降级或纯前端 WASM 模式加载此远程 URL 时，前端这才开始真正的 fetch 下载
      try {
        const legacy: LegacyPreparedInput = await legacyPrepareInput(remoteUrl);
        file = legacy.file instanceof File
          ? legacy.file
          : new File([legacy.file], legacy.title || 'document.docx');
      } catch (err) {
        throw new Error(`纯前端 WASM 模式下载远程文档失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      file = prepared.file instanceof File
        ? prepared.file
        : new File([prepared.file], prepared.title || 'document.docx');
    }

    // 构造旧 of PreparedInput 格式
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
