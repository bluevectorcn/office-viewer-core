import { DEFAULT_LOCALES, LocaleKey } from './Locales';

export class I18nManager {
  private static instance: I18nManager;
  private locale: string = 'en';
  private customTranslations: Record<string, string> = {};

  private constructor() {}

  public static getInstance(): I18nManager {
    if (!I18nManager.instance) {
      I18nManager.instance = new I18nManager();
    }
    return I18nManager.instance;
  }

  public init(locale?: string, customTranslations?: Record<string, string>): void {
    if (locale) {
      this.locale = locale.split('-')[0].toLowerCase(); // Basic normalization to 'en', 'zh', etc.
    }
    if (customTranslations) {
      this.customTranslations = customTranslations;
    }
  }

  public translate(key: LocaleKey | string, args?: any[]): string {
    // 1. Check custom overrides
    let text = this.customTranslations[key];

    // 2. Check default locales for the current locale
    if (!text) {
      const bundle = DEFAULT_LOCALES[this.locale] || DEFAULT_LOCALES['en'];
      text = bundle[key];
    }

    // 3. Fallback to English key
    if (!text && this.locale !== 'en') {
      text = DEFAULT_LOCALES['en'][key];
    }

    // 4. Return key itself if still not found
    if (!text) {
      return key;
    }

    // Handle simple argument injection {0}, {1}...
    if (args && args.length > 0) {
      args.forEach((arg, index) => {
        text = text.replace(`{${index}}`, String(arg));
      });
    }

    return text;
  }
}

export const t = (key: LocaleKey | string, args?: any[]) => I18nManager.getInstance().translate(key, args);
