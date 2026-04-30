import { describe, expect, it, vi } from 'vitest';
import {
  handleImageUploadRequest,
  shouldInterceptImageUploadUrl,
} from '../../../src/application/handlers/ImageUploadCommandHandler';
import {
  clearDocumentAssets,
  getDocumentAssets,
  registerDocumentAssets,
} from '../../../src/infrastructure/socket/AssetsStore';

describe('ImageUploadCommandHandler', () => {
  it('intercepts OnlyOffice image upload endpoints', () => {
    expect(
      shouldInterceptImageUploadUrl(
        window,
        'http://localhost:5173/vendor/onlyoffice/upload/doc-1?shardkey=doc-1'
      )
    ).toBe(true);
    expect(
      shouldInterceptImageUploadUrl(window, 'http://localhost:5173/vendor/onlyoffice/sdk.js')
    ).toBe(false);
  });

  it('registers uploaded image bytes and returns OnlyOffice url map', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:uploaded');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    registerDocumentAssets('doc-1', {
      editorUrl: 'blob:editor',
      originUrl: 'blob:origin',
      images: {},
      mediaData: {},
      fileType: 'docx',
      title: 'test.docx',
    });

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'local.png', {
      type: 'image/png',
    });
    const response = await handleImageUploadRequest(
      window,
      'http://localhost:5173/vendor/onlyoffice/upload/doc-1?shardkey=doc-1',
      file
    );

    expect(response).toBeTruthy();
    const [path, url] = Object.entries(response!)[0];
    expect(path).toMatch(/^media\/image-[a-z0-9]+\.png$/);
    expect(url).toBe('blob:uploaded');

    const assets = getDocumentAssets('doc-1');
    expect(assets?.images[path]).toBe('blob:uploaded');
    expect(Array.from(assets?.mediaData?.[path] ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(createObjectURL).toHaveBeenCalled();

    clearDocumentAssets('doc-1');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('extracts image files from multipart form data uploads', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:form-uploaded');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    registerDocumentAssets('doc-form', {
      editorUrl: 'blob:editor-form',
      originUrl: 'blob:origin-form',
      images: {},
      mediaData: {},
      fileType: 'docx',
      title: 'test.docx',
    });

    const formData = new FormData();
    formData.append(
      'file',
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'remote.jpg', {
        type: 'image/jpeg',
      })
    );

    const response = await handleImageUploadRequest(
      window,
      'http://localhost:5173/vendor/onlyoffice/upload/doc-form?shardkey=doc-form',
      formData
    );

    expect(response).toBeTruthy();
    const [path, url] = Object.entries(response!)[0];
    expect(path).toMatch(/^media\/image-[a-z0-9]+\.jpg$/);
    expect(url).toBe('blob:form-uploaded');
    expect(Array.from(getDocumentAssets('doc-form')?.mediaData?.[path] ?? [])).toEqual([
      0xff, 0xd8, 0xff,
    ]);

    clearDocumentAssets('doc-form');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });
});
