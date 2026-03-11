import { describe, it, expect, beforeEach } from 'vitest';
import { I18nManager, t } from './I18nManager';

describe('I18nManager', () => {
  let i18n: I18nManager;

  beforeEach(() => {
    i18n = I18nManager.getInstance();
    // Reset state for each test
    i18n.init('en', {});
  });

  it('should return English translation by default', () => {
    expect(t('loading')).toBe('Loading...');
  });

  it('should return Chinese translation when locale is zh', () => {
    i18n.init('zh');
    expect(t('loading')).toBe('加载中...');
  });

  it('should support regional locales (zh-CN)', () => {
    i18n.init('zh-CN');
    expect(t('loading')).toBe('加载中...');
  });

  it('should fallback to English for unknown locales', () => {
    i18n.init('fr');
    expect(t('loading')).toBe('Loading...');
  });

  it('should support custom translation overrides', () => {
    i18n.init('en', { 'loading': 'Custom Loading' });
    expect(t('loading')).toBe('Custom Loading');
  });

  it('should support argument injection', () => {
    expect(t('editor_error', ['Test Error'])).toBe('Editor error: Test Error');
    
    i18n.init('zh');
    expect(t('editor_error', ['测试错误'])).toBe('编辑器错误: 测试错误');
  });

  it('should return the key if no translation is found', () => {
    expect(t('non_existent_key')).toBe('non_existent_key');
  });
});
