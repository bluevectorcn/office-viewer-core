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
    'container_unavailable': 'Viewer container is unavailable.',
    'csv_delimiter_title': 'Select CSV Options',
    'csv_delimiter_desc': 'Please select the column delimiter for opening the CSV file:',
    'csv_delimiter_comma': 'Comma (,)',
    'csv_delimiter_semicolon': 'Semicolon (;)',
    'csv_delimiter_tab': 'Tab (Tab)',
    'csv_delimiter_space': 'Space ( )',
    'csv_delimiter_colon': 'Colon (:)',
    'csv_delimiter_encoding': 'Text Encoding',
    'csv_delimiter_encoding_auto': 'Auto Detect',
    'csv_delimiter_confirm': 'Confirm'
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
    'container_unavailable': '视图容器不可用',
    'csv_delimiter_title': '选择 CSV 选项',
    'csv_delimiter_desc': '请选择打开该 CSV 文件所需的列分隔符：',
    'csv_delimiter_comma': '逗号 (,)',
    'csv_delimiter_semicolon': '分号 (;)',
    'csv_delimiter_tab': '制表符 (Tab)',
    'csv_delimiter_space': '空格 ( )',
    'csv_delimiter_colon': '冒号 (:)',
    'csv_delimiter_encoding': '文本编码',
    'csv_delimiter_encoding_auto': '自动探测',
    'csv_delimiter_confirm': '确认'
  }
};

export type LocaleKey = keyof typeof DEFAULT_LOCALES.en;
