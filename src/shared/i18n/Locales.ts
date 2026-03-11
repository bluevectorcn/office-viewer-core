export const DEFAULT_LOCALES: Record<string, Record<string, string>> = {
  en: {
    'loading': 'Loading...',
    'loading_scripts': 'Loading scripts...',
    'processing_document': 'Processing document...',
    'initializing_editor': 'Initializing editor...',
    'ready': 'Ready',
    'error': 'Error',
    'unknown_error': 'Unknown error',
    'editor_error': 'Editor error: {0}',
    'session_not_created': 'Session not created',
    'container_unavailable': 'Viewer container is unavailable.'
  },
  zh: {
    'loading': '加载中...',
    'loading_scripts': '正在加载脚本...',
    'processing_document': '正在处理文档...',
    'initializing_editor': '正在初始化编辑器...',
    'ready': '就绪',
    'error': '错误',
    'unknown_error': '未知错误',
    'editor_error': '编辑器错误: {0}',
    'session_not_created': '会话未创建',
    'container_unavailable': '视图容器不可用'
  }
};

export type LocaleKey = keyof typeof DEFAULT_LOCALES.en;
