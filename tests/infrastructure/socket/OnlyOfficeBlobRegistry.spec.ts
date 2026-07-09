import { describe, it, expect } from 'vitest';
import { registerBlobImageInOnlyOffice } from '../../../src/infrastructure/socket/OnlyOfficeBlobRegistry';

/**
 * 模拟 release 构建下被 mangle 的 ZlibImageBlobs：
 *   constructor: this.E4e={}; this.dWf={}; this.xRd={}; this.z2i=1
 *   proto.W7f = getImageBase64  (mangled name)
 * 方法体里含特征字面量 data:image/jpeg;base64, 等（mangle 后保留）。
 */
function createMangledRegistry() {
  function ZlibImageBlobs(this: any) {
    this.E4e = {};
    this.dWf = {};
    this.xRd = {};
    this.z2i = 1;
  }
  (ZlibImageBlobs.prototype as any).W7f = function (url: string) {
    if (this.xRd[url]) return this.xRd[url];
    const obj = this.dWf[url];
    if (!obj) return url;
    let header = '';
    switch (obj.type) {
      case 3: header = 'data:image/jpeg;base64,'; break;
      case 24: header = 'data:image/svg+xml;base64,'; break;
      default: header = 'data:image/png;base64,';
    }
    let binary = '';
    const data = obj.data as Uint8Array;
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    this.xRd[url] = header + btoa(binary);
    return this.xRd[url];
  };
  return new (ZlibImageBlobs as any)();
}

describe('registerBlobImageInOnlyOffice (mangle-resistant method patch)', () => {
  it('patches getImageBase64 by feature detection; registered blob returns data URI', () => {
    const registry = createMangledRegistry();
    const asc: any = { someUtil: { a: 1 }, qre: registry, other: [1, 2, 3] };
    const w = { AscCommon: asc } as any;

    // BEFORE patch: W7f returns blob url unchanged (the bug)
    expect((registry as any).W7f('blob:test-1')).toBe('blob:test-1');

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(registerBlobImageInOnlyOffice(w, 'blob:test-1', pngBytes, 'image/png')).toBe(true);

    // AFTER patch: registered url returns data URI
    const result = (registry as any).W7f('blob:test-1');
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
    expect(result).not.toBe('blob:test-1');

    // unregistered url 仍回退原逻辑
    expect((registry as any).W7f('blob:other')).toBe('blob:other');
  });

  it('maps jpeg->3, svg->24, others->4 by prefix', () => {
    const registry = createMangledRegistry();
    const w = { AscCommon: { zzz: registry } } as any;
    registerBlobImageInOnlyOffice(w, 'blob:jpg', new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg');
    registerBlobImageInOnlyOffice(w, 'blob:svg', new Uint8Array([1]), 'image/svg+xml');
    registerBlobImageInOnlyOffice(w, 'blob:gif', new Uint8Array([1]), 'image/gif');

    expect((registry as any).W7f('blob:jpg').startsWith('data:image/jpeg;base64,')).toBe(true);
    expect((registry as any).W7f('blob:svg').startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect((registry as any).W7f('blob:gif').startsWith('data:image/png;base64,')).toBe(true);
  });

  it('only patches once per registry (idempotent)', () => {
    const registry = createMangledRegistry();
    const w = { AscCommon: { qre: registry } } as any;
    expect(registerBlobImageInOnlyOffice(w, 'blob:a', new Uint8Array([0x89]), 'image/png')).toBe(true);
    expect(registerBlobImageInOnlyOffice(w, 'blob:b', new Uint8Array([0x89]), 'image/png')).toBe(true);
    expect((registry as any).W7f('blob:a').startsWith('data:image/png;base64,')).toBe(true);
    expect((registry as any).W7f('blob:b').startsWith('data:image/png;base64,')).toBe(true);
  });

  it('is a no-op when AscCommon is absent', () => {
    expect(registerBlobImageInOnlyOffice(window, 'blob:t', new Uint8Array([1]), 'image/png')).toBe(false);
  });

  it('ignores non-blob urls and empty bytes', () => {
    expect(registerBlobImageInOnlyOffice(window, 'http://x', new Uint8Array([1]), '')).toBe(false);
    const registry = createMangledRegistry();
    const w = { AscCommon: { qre: registry } } as any;
    expect(registerBlobImageInOnlyOffice(w, 'blob:t', new Uint8Array(0), '')).toBe(false);
  });

  it('does not throw when AscCommon has no matching registry', () => {
    const w = { AscCommon: { foo: 1, bar: 'x', baz: { qux: 1 } } } as any;
    expect(() => registerBlobImageInOnlyOffice(w, 'blob:t', new Uint8Array([1]), 'image/png')).not.toThrow();
    expect(registerBlobImageInOnlyOffice(w, 'blob:t', new Uint8Array([1]), 'image/png')).toBe(false);
  });
});
