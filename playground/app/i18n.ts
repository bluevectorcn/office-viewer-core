const translations: Record<string, Record<string, string>> = {
  en: {
    'app_title': 'Online Office',
    'nav_home': 'Home',
    'nav_recent': 'Recent Files',
    'nav_templates': 'Templates',
    'welcome': 'Welcome',
    'create_new': 'Create New',
    'word_doc': 'Word Document',
    'excel_sheet': 'Excel Workbook',
    'ppt_pres': 'PowerPoint',
    'open_existing': 'Open Existing',
    'open_local': 'Open Local File',
    'open_url': 'Open URL',
    'url_placeholder': 'Enter remote file URL...',
    'remote_file': 'Remote File',
    'source_local': 'Local',
    'source_url': 'URL',
    'source_template': 'Template',
    'source_new': 'New',
    'rename': 'Rename',
    'enter_new_name': 'Enter new name:',
    'drop_file': 'Drop file here to open...',
    'recent': 'Recent',
    'no_recent': 'No recent files found.',
    'remove': 'Remove',
    'custom_templates': 'Custom Templates',
    'preset_templates': 'Preset Templates',
    'no_custom_templates': 'No custom templates saved yet.',
    'system_preset': 'System Preset',
    'delete_template': 'Delete this template?',
    'back': 'Back',
    'save_template': 'Save as Template',
    'download': 'Download',
    'enter_template_name': 'Enter a name for the new template:',
    'template_saved': 'Template saved successfully!',
    'template_failed': 'Failed to save template.',
    'untitled': 'Untitled from {0}',
  },
  zh: {
    'app_title': '在线 Office',
    'nav_home': '首页',
    'nav_recent': '最近文件',
    'nav_templates': '模板',
    'welcome': '欢迎',
    'create_new': '新建',
    'word_doc': 'Word 文档',
    'excel_sheet': 'Excel 工作表',
    'ppt_pres': 'PowerPoint 演示文稿',
    'open_existing': '打开现有文件',
    'open_local': '打开本地文件',
    'open_url': '打开 URL',
    'url_placeholder': '输入远程文件 URL...',
    'remote_file': '远程文件',
    'source_local': '本地',
    'source_url': '链接',
    'source_template': '模板',
    'source_new': '新建',
    'rename': '重命名',
    'enter_new_name': '输入新名称：',
    'drop_file': '将文件拖到此处打开...',
    'recent': '最近记录',
    'no_recent': '未发现最近文件。',
    'remove': '移除',
    'custom_templates': '自定义模板',
    'preset_templates': '预设模板',
    'no_custom_templates': '暂无保存的自定义模板。',
    'system_preset': '系统预设',
    'delete_template': '删除此模板？',
    'back': '返回',
    'save_template': '存为模板',
    'download': '下载',
    'enter_template_name': '输入新模板名称：',
    'template_saved': '模板保存成功！',
    'template_failed': '保存模板失败。',
    'untitled': '来自 {0} 的无标题文件',
  }
};

const getLocale = () => {
  const lang = navigator.language.split('-')[0];
  return translations[lang] ? lang : 'en';
};

export const t = (key: string, args?: any[]): string => {
  const locale = getLocale();
  let text = translations[locale][key] || translations['en'][key] || key;
  
  if (args) {
    args.forEach((arg, i) => {
      text = text.replace(`{${i}}`, String(arg));
    });
  }
  
  return text;
};
