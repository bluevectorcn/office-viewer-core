import type { ExportFormat } from '../../shared/types/EditorTypes';
import type { X2TExportService } from '../use-cases/ExportDocumentUseCase';
import { exportWithX2T as legacyExportWithX2T } from '../../infrastructure/conversion/X2TService';

/**
 * X2T 导出服务适配器
 *
 * 将旧的 exportWithX2T 函数适配到新的 X2TExportService 接口
 */
export class X2TExportServiceAdapter implements X2TExportService {
  async exportWithX2T(source: Blob, format: ExportFormat): Promise<Blob> {
    return await legacyExportWithX2T(source, format);
  }
}
