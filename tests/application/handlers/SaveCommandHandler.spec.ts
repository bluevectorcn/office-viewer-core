import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  handleSaveLikeRequest,
  shouldInterceptUrl,
} from '../../../src/application/handlers/SaveCommandHandler';
import {
  clearDocumentAssets,
  registerDocumentAssets,
  getDocumentAssets,
} from '../../../src/infrastructure/socket/AssetsStore';
import * as X2TService from '../../../src/infrastructure/conversion/X2TService';
import * as FakeSocketModule from '../../../src/infrastructure/socket/FakeSocket';

describe('SaveCommandHandler', () => {
  beforeEach(() => {
    registerDocumentAssets('doc-test-1', {
      editorUrl: 'blob:editor-1',
      originUrl: 'blob:origin-1',
      images: {},
      mediaData: {},
      fileType: 'docx',
      title: 'main.docx',
    });
  });

  afterEach(() => {
    clearDocumentAssets('doc-test-1');
    vi.restoreAllMocks();
  });

  it('identifies save endpoints that should be intercepted', () => {
    const validUrl = 'http://localhost:5173/downloadas/doc-test-1?cmd=%7B%22c%22%3A%22save%22%7D';
    expect(shouldInterceptUrl(window, validUrl)).toBe(true);

    const normalUrl = 'http://localhost:5173/vendor/onlyoffice/web-apps/apps/documenteditor/main/index.html';
    expect(shouldInterceptUrl(window, normalUrl)).toBe(false);
  });

  it('handles outputurls request for document comparison without triggering download or socket save notifications', async () => {
    const emitServerMessageSpy = vi.spyOn(FakeSocketModule, 'emitServerMessage');
    const createElementSpy = vi.spyOn(document, 'createElement');

    // Mock convertToEditorBin to avoid calling real WASM in unit test
    const fakeBinBlob = new Blob([new Uint8Array([1, 2, 3])]);
    const mockConvert = vi.spyOn(X2TService, 'convertToEditorBin').mockResolvedValue({
      blob: fakeBinBlob,
      objectUrl: 'blob:output-bin-url',
      media: {
        images: {
          'media/image1.png': 'blob:image-1-url',
        },
        mediaData: {
          'media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        },
      },
    });

    const cmd = {
      c: 'save',
      id: 'doc-test-1',
      outputurls: true,
      format: 'docx',
      outputformat: 65,
      savetype: 3, // single
    };
    const url = `http://localhost:5173/downloadas/doc-test-1?cmd=${encodeURIComponent(JSON.stringify(cmd))}`;
    const dummyFileBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // docx PK zip header

    const response = await handleSaveLikeRequest(window, url, dummyFileBytes);

    expect(response).toBeTruthy();
    expect(response?.status).toBe('ok');
    expect(response?.type).toBe('save');

    // 验证返回给编辑器的 data 包含 output.bin 和图片映射
    const data = response?.data as Record<string, string>;
    expect(data).toBeDefined();
    expect(data['output.bin']).toBe('blob:output-bin-url');
    expect(data['media/image1.png']).toBe('blob:image-1-url');

    // 关键验证：严禁触发下载（不创建 <a> 标签进行点击下载）
    expect(createElementSpy).not.toHaveBeenCalledWith('a');

    // 关键验证：严禁向 Socket 发送 save 完成通知（否则会触发外部 onDownloadAs 误下载）
    expect(emitServerMessageSpy).not.toHaveBeenCalled();

    // 验证图片资产同步到了主文档资产中
    const assets = getDocumentAssets('doc-test-1');
    expect(assets?.images['media/image1.png']).toBe('blob:image-1-url');
    expect(assets?.mediaData?.['media/image1.png']).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    mockConvert.mockRestore();
  });

  it('handles chunked outputurls request correctly and resolves on last chunk', async () => {
    const mockConvert = vi.spyOn(X2TService, 'convertToEditorBin').mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])]),
      objectUrl: 'blob:chunked-output-bin',
      media: {
        images: {},
        mediaData: {},
      },
    });

    // Chunk 1: first (savetype: 0)
    const cmdFirst = {
      c: 'save',
      id: 'doc-test-1',
      outputurls: true,
      format: 'docx',
      savetype: 0,
    };
    const urlFirst = `http://localhost:5173/downloadas/doc-test-1?cmd=${encodeURIComponent(JSON.stringify(cmdFirst))}`;
    const chunk1 = new Uint8Array([1, 2]);
    const resFirst = await handleSaveLikeRequest(window, urlFirst, chunk1);
    expect(resFirst?.status).toBe('ok');
    const savekey = resFirst?.data as string;
    expect(savekey).toBeDefined();

    // Chunk 2: middle (savetype: 1)
    const cmdMiddle = {
      c: 'save',
      id: 'doc-test-1',
      outputurls: true,
      savekey,
      savetype: 1,
    };
    const urlMiddle = `http://localhost:5173/downloadas/doc-test-1?cmd=${encodeURIComponent(JSON.stringify(cmdMiddle))}`;
    const chunk2 = new Uint8Array([3, 4]);
    const resMiddle = await handleSaveLikeRequest(window, urlMiddle, chunk2);
    expect(resMiddle?.status).toBe('ok');
    expect(resMiddle?.data).toBe(savekey);

    // Chunk 3: last (savetype: 2)
    const cmdLast = {
      c: 'save',
      id: 'doc-test-1',
      outputurls: true,
      savekey,
      savetype: 2,
    };
    const urlLast = `http://localhost:5173/downloadas/doc-test-1?cmd=${encodeURIComponent(JSON.stringify(cmdLast))}`;
    const chunk3 = new Uint8Array([5, 6]);
    const resLast = await handleSaveLikeRequest(window, urlLast, chunk3);

    expect(resLast?.status).toBe('ok');
    const data = resLast?.data as Record<string, string>;
    expect(data['output.bin']).toBe('blob:chunked-output-bin');

    mockConvert.mockRestore();
  });

  it('fetches remote url when outputurls provides url instead of body bytes', async () => {
    const mockConvert = vi.spyOn(X2TService, 'convertToEditorBin').mockResolvedValue({
      blob: new Blob([new Uint8Array([1])]),
      objectUrl: 'blob:remote-output-bin',
      media: {
        images: {},
        mediaData: {},
      },
    });

    const remoteContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(remoteContent, { status: 200 })
    );

    const cmd = {
      c: 'save',
      id: 'doc-test-1',
      outputurls: true,
      url: 'http://example.com/remote-compare.docx',
      format: 'docx',
      savetype: 3,
    };
    const url = `http://localhost:5173/downloadas/doc-test-1?cmd=${encodeURIComponent(JSON.stringify(cmd))}`;

    const response = await handleSaveLikeRequest(window, url, new Uint8Array(0));
    expect(response?.status).toBe('ok');
    const data = response?.data as Record<string, string>;
    expect(data['output.bin']).toBe('blob:remote-output-bin');
    expect(fetchSpy).toHaveBeenCalledWith('http://example.com/remote-compare.docx');

    fetchSpy.mockRestore();
    mockConvert.mockRestore();
  });
});
