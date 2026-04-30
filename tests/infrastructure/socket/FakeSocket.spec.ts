import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeSocket } from '../../../src/infrastructure/socket/FakeSocket';
import {
  clearDocumentAssets,
  getDocumentAssets,
  registerDocumentAssets,
} from '../../../src/infrastructure/socket/AssetsStore';

describe('FakeSocket', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearDocumentAssets('doc-remote');
    clearDocumentAssets('doc-message-id');
  });

  function mockRemoteImageFetch() {
    vi.stubGlobal('__ONLYOFFICE_VERSION__', '9.3.0');
    vi.stubGlobal('__ONLYOFFICE_BUILD_NUMBER__', 83);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      )
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:remote-image');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  it('downloads remote image URLs requested through wrapped openDocument imgurls messages', async () => {
    mockRemoteImageFetch();

    registerDocumentAssets('doc-remote', {
      editorUrl: 'blob:editor',
      originUrl: 'blob:origin',
      images: {},
      mediaData: {},
      fileType: 'docx',
      title: 'test.docx',
    });

    const socket = new FakeSocket();
    socket.emit('message', {
      type: 'auth',
      openCmd: {
        key: 'doc-remote',
        url: 'blob:editor',
        format: 'docx',
      },
      user: { id: 'user-1' },
    });

    const responsePromise = new Promise<Record<string, unknown>>((resolve) => {
      socket.on('message', (message) => {
        if ((message as { type?: unknown }).type === 'imgurls') {
          resolve(message as Record<string, unknown>);
        }
      });
    });

    socket.emit('message', {
      type: 'openDocument',
      message: {
        id: 'doc-remote',
        c: 'imgurls',
        userid: '1',
        saveindex: 2,
        data: ['https://example.com/remote.jpg'],
      },
    });

    const response = await responsePromise;
    expect(response).toMatchObject({
      type: 'imgurls',
      status: 'ok',
      id: 'doc-remote',
    });

    const data = response.data as { urls: Array<{ path: string; url: string | null }> };
    expect(data.urls).toHaveLength(2);
    expect(data.urls[0].path).toBe('https://example.com/remote.jpg');
    expect(data.urls[0].url).toBe('blob:remote-image');
    expect(data.urls[1].path).toMatch(/^media\/image-[a-z0-9]+\.jpg$/);
    expect(data.urls[1].url).toBe('blob:remote-image');

    const assets = getDocumentAssets('doc-remote');
    expect(assets?.images[data.urls[1].path]).toBe('blob:remote-image');
    expect(Array.from(assets?.mediaData?.[data.urls[1].path] ?? [])).toEqual([0xff, 0xd8, 0xff]);
  });

  it('uses wrapped imgurls message id to find document assets when auth openCmd is unavailable', async () => {
    mockRemoteImageFetch();

    registerDocumentAssets('doc-message-id', {
      editorUrl: 'blob:editor-message-id',
      originUrl: 'blob:origin-message-id',
      images: {},
      mediaData: {},
      fileType: 'docx',
      title: 'test.docx',
    });

    const socket = new FakeSocket();
    const responsePromise = new Promise<Record<string, unknown>>((resolve) => {
      socket.on('message', (message) => {
        if ((message as { type?: unknown }).type === 'imgurls') {
          resolve(message as Record<string, unknown>);
        }
      });
    });

    socket.emit('message', {
      type: 'openDocument',
      message: {
        id: 'doc-message-id',
        c: 'imgurls',
        userid: '1',
        saveindex: 2,
        data: ['https://example.com/remote.jpg'],
      },
    });

    const response = await responsePromise;
    expect(response).toMatchObject({
      type: 'imgurls',
      status: 'ok',
      id: 'doc-message-id',
    });

    const data = response.data as { urls: Array<{ path: string; url: string | null }> };
    expect(data.urls).toHaveLength(2);
    expect(data.urls[0].path).toBe('https://example.com/remote.jpg');
    expect(data.urls[0].url).toBe('blob:remote-image');
    expect(data.urls[1].path).toMatch(/^media\/image-[a-z0-9]+\.jpg$/);
    expect(data.urls[1].url).toBe('blob:remote-image');

    const assets = getDocumentAssets('doc-message-id');
    expect(assets?.images[data.urls[1].path]).toBe('blob:remote-image');
    expect(Array.from(assets?.mediaData?.[data.urls[1].path] ?? [])).toEqual([0xff, 0xd8, 0xff]);
  });
});
