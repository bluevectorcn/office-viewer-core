/**
 * 图片路径标准化工具
 *
 * 解决 fake-socket.ts 中的图片路径冲突问题（阶段 2.2）：
 * - 将各种格式的图片路径统一为标准格式：media/xxx.png
 * - 避免一张图片生成 4-6 个不同的键
 * - 确保路径映射的一致性
 *
 * @example
 * ```typescript
 * ImagePathNormalizer.normalize('./media/image.png')  // => 'media/image.png'
 * ImagePathNormalizer.normalize('media/image.png')    // => 'media/image.png'
 * ImagePathNormalizer.normalize('./image.png')        // => 'media/image.png'
 * ImagePathNormalizer.normalize('image.png')          // => 'media/image.png'
 * ```
 */
export class ImagePathNormalizer {
  /**
   * 标准化图片路径为 media/xxx.png 格式
   *
   * @param path - 原始图片路径
   * @returns 标准化后的路径
   */
  static normalize(path: string): string {
    if (!path) return '';

    // 1. 移除开头的 './'
    let normalized = path.replace(/^\.\//, '');

    // 2. 确保以 media/ 开头
    if (!normalized.startsWith('media/')) {
      normalized = `media/${normalized}`;
    }

    return normalized;
  }

  /**
   * 批量标准化图片路径
   *
   * @param paths - 原始路径数组
   * @returns 标准化后的路径数组
   */
  static normalizeAll(paths: string[]): string[] {
    return paths.map(path => this.normalize(path));
  }

  /**
   * 标准化图片路径映射
   *
   * @param images - 原始图片映射 { path: url }
   * @returns 标准化后的映射 { normalizedPath: url }
   */
  static normalizeMap(images: Record<string, string>): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [path, url] of Object.entries(images)) {
      const normalizedPath = this.normalize(path);
      normalized[normalizedPath] = url;
    }

    return normalized;
  }
}
