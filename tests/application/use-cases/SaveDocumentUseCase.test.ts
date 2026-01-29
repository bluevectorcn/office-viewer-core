import { describe, it, expect, vi } from 'vitest';
import { SaveDocumentUseCase, type DownloadRequester } from '../../../src/application/use-cases/SaveDocumentUseCase';
import type { DocumentSession } from '../../../src/application/use-cases/OpenDocumentUseCase';
import type { Logger } from '../../../src/shared/logging/Logger';

describe('SaveDocumentUseCase', () => {
    const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    } as unknown as Logger;

    const mockDownloadRequester = {
        requestDownload: vi.fn()
    } as unknown as DownloadRequester;

    const createMockSession = (nativeFormat: any = 'docx'): DocumentSession => ({
        docId: 'test-doc',
        nativeFormat,
        sourceBlob: new Blob(['original']),
        originUrl: 'blob:abc',
        converted: {
            url: 'blob:def',
            objectUrl: 'blob:def',
            title: 'test',
            documentType: 'word',
            fileType: 'docx',
            images: {}
        },
        imageUrls: []
    });

    it('should generate a default filename with timestamp when no filename is provided', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('docx');
        const mockBlob = new Blob(['saved']);
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(mockBlob);

        const result = await useCase.execute(session);

        expect(result.blob).toBe(mockBlob);
        expect(result.filename).toMatch(/^doc_\d+\.docx$/);
    });

    it('should upgrade doc to docx in filename', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('doc');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session);

        expect(result.filename).toMatch(/^doc_\d+\.docx$/);
    });

    it('should upgrade xls to xlsx in filename', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('xls');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session);

        expect(result.filename).toMatch(/^doc_\d+\.xlsx$/);
    });

    it('should upgrade ppt to pptx in filename', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('ppt');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session);

        expect(result.filename).toMatch(/^doc_\d+\.pptx$/);
    });

    it('should append correct extension when filename is provided without it', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('docx');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session, 'my-document');

        expect(result.filename).toBe('my-document.docx');
    });

    it('should NOT append extension when filename already has the correct one', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('xlsx');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session, 'report.xlsx');

        expect(result.filename).toBe('report.xlsx');
    });

    it('should handle extension case-insensitively', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('pptx');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session, 'presentation.PPTX');

        expect(result.filename).toBe('presentation.PPTX');
    });
    
    it('should append extension if it does not match (case-insensitive check for base)', async () => {
        const useCase = new SaveDocumentUseCase(mockDownloadRequester, mockLogger);
        const session = createMockSession('docx');
        vi.mocked(mockDownloadRequester.requestDownload).mockResolvedValue(new Blob(['saved']));

        const result = await useCase.execute(session, 'document.pdf');

        expect(result.filename).toBe('document.pdf.docx');
    });
});
