import type { DocEditorConfig, OnlyOfficeEditor } from "./types";
import { EditorFactory } from "../application/EditorFactory";

/**
 * 创建 OnlyOffice 编辑器实例
 *
 * 这是 onlyoffice-wasm-core 的主入口函数，提供向后兼容的 API。
 *
 * 重构说明：
 * - 原来的 335 行上帝类已被拆分为清晰的分层架构
 * - 此文件现在是轻量级的 Facade，委托给 EditorFactory
 * - API 签名保持 100% 向后兼容
 *
 * 新架构：
 * ```
 * createEditor (Facade)
 *   └─> EditorFactory (依赖注入容器)
 *       └─> EditorOrchestrator (协调器)
 *           ├─> OpenDocumentUseCase
 *           ├─> SaveDocumentUseCase
 *           └─> ExportDocumentUseCase
 * ```
 *
 * @param container - 编辑器的 DOM 容器元素
 * @param baseConfig - 编辑器配置
 * @returns OnlyOfficeEditor 实例，提供以下方法：
 *   - `open(input)` - 打开文档（File, Blob, ArrayBuffer, URL）
 *   - `newFile(format)` - 创建新文档（docx, xlsx, pptx）
 *   - `save()` - 保存文档为原始格式
 *   - `export(format)` - 导出文档到指定格式（pdf, docx, xlsx, pptx）
 *   - `destroy()` - 销毁编辑器并释放资源
 *
 * @example
 * ```typescript
 * // 创建编辑器
 * const editor = createEditor(container, {
 *   documentType: 'word',
 *   editorConfig: { mode: 'edit' }
 * });
 *
 * // 打开文档
 * await editor.open(fileOrUrl);
 *
 * // 保存文档
 * const blob = await editor.save();
 *
 * // 导出为 PDF
 * const pdfBlob = await editor.export('pdf');
 *
 * // 销毁编辑器
 * editor.destroy();
 * ```
 */
export function createEditor(
  container: HTMLElement,
  baseConfig: DocEditorConfig
): OnlyOfficeEditor {
  // 使用工厂模式创建编辑器实例
  // 工厂负责：
  // 1. 创建和配置所有依赖（依赖注入）
  // 2. 初始化 DocsAPI 和 X2T
  // 3. 管理 DOM 容器
  // 4. 返回向后兼容的 API
  const factory = new EditorFactory();
  return factory.create(container, baseConfig);
}
