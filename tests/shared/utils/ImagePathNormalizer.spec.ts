import { describe, it, expect } from 'vitest';
import { ImagePathNormalizer } from '@/shared/utils/ImagePathNormalizer';

describe('ImagePathNormalizer', () => {
  describe('normalize', () => {
    it('should normalize path with ./ prefix', () => {
      expect(ImagePathNormalizer.normalize('./media/image.png')).toBe('media/image.png');
      expect(ImagePathNormalizer.normalize('./image.png')).toBe('media/image.png');
    });

    it('should keep path with media/ prefix', () => {
      expect(ImagePathNormalizer.normalize('media/image.png')).toBe('media/image.png');
      expect(ImagePathNormalizer.normalize('media/subdir/image.png')).toBe('media/subdir/image.png');
    });

    it('should add media/ prefix if missing', () => {
      expect(ImagePathNormalizer.normalize('image.png')).toBe('media/image.png');
      expect(ImagePathNormalizer.normalize('subdir/image.png')).toBe('media/subdir/image.png');
    });

    it('should handle empty string', () => {
      expect(ImagePathNormalizer.normalize('')).toBe('');
    });

    it('should handle complex paths', () => {
      expect(ImagePathNormalizer.normalize('./media/subdir/deep/image.png')).toBe('media/subdir/deep/image.png');
      expect(ImagePathNormalizer.normalize('subdir/deep/image.png')).toBe('media/subdir/deep/image.png');
    });

    it('should produce consistent output for different inputs', () => {
      const inputs = [
        './media/image.png',
        'media/image.png',
        './image.png' // 这个会变成 media/image.png
      ];

      const results = inputs.slice(0, 2).map(ImagePathNormalizer.normalize);

      // 前两个应该产生相同结果
      expect(results[0]).toBe('media/image.png');
      expect(results[1]).toBe('media/image.png');
      expect(results[0]).toBe(results[1]);
    });
  });

  describe('normalizeAll', () => {
    it('should normalize array of paths', () => {
      const paths = [
        './media/image1.png',
        'media/image2.png',
        './image3.png',
        'image4.png'
      ];

      const normalized = ImagePathNormalizer.normalizeAll(paths);

      expect(normalized).toEqual([
        'media/image1.png',
        'media/image2.png',
        'media/image3.png',
        'media/image4.png'
      ]);
    });

    it('should handle empty array', () => {
      expect(ImagePathNormalizer.normalizeAll([])).toEqual([]);
    });
  });

  describe('normalizeMap', () => {
    it('should normalize image map keys', () => {
      const images = {
        './media/image1.png': 'blob:url1',
        'media/image2.png': 'blob:url2',
        './image3.png': 'blob:url3',
        'image4.png': 'blob:url4'
      };

      const normalized = ImagePathNormalizer.normalizeMap(images);

      expect(normalized).toEqual({
        'media/image1.png': 'blob:url1',
        'media/image2.png': 'blob:url2',
        'media/image3.png': 'blob:url3',
        'media/image4.png': 'blob:url4'
      });
    });

    it('should handle duplicate normalized keys (last wins)', () => {
      const images = {
        './media/image.png': 'blob:url1',
        'media/image.png': 'blob:url2'
      };

      const normalized = ImagePathNormalizer.normalizeMap(images);

      // 因为两个 key 标准化后相同，后者会覆盖前者
      expect(normalized['media/image.png']).toBe('blob:url2');
      expect(Object.keys(normalized).length).toBe(1);
    });

    it('should handle empty object', () => {
      expect(ImagePathNormalizer.normalizeMap({})).toEqual({});
    });
  });

  describe('edge cases', () => {
    it('should handle paths with multiple ./ prefixes', () => {
      // 只移除第一个 ./
      expect(ImagePathNormalizer.normalize('./././image.png')).toBe('media/././image.png');
    });

    it('should handle paths with spaces', () => {
      expect(ImagePathNormalizer.normalize('./media/my image.png')).toBe('media/my image.png');
      expect(ImagePathNormalizer.normalize('my image.png')).toBe('media/my image.png');
    });

    it('should handle paths with special characters', () => {
      expect(ImagePathNormalizer.normalize('./media/图片.png')).toBe('media/图片.png');
      expect(ImagePathNormalizer.normalize('图片.png')).toBe('media/图片.png');
    });
  });
});
