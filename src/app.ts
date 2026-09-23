import { createEditor } from './application/EditorFactory';
import type { DocEditorConfig } from './shared/types/EditorTypes';
import { createBaseConfig } from './application/config/EditorConfigBuilder';

const editorHost = document.getElementById('editor');

if (!editorHost) {
  throw new Error('Editor container not found');
}

const editorContainer: HTMLElement = editorHost;

// 1. 解析 contextPath 和基础配置
const pathname = window.location.pathname;
console.log('[OfficeViewerApp] pathname:', pathname);

let contextPath = '';
const matchedPath = pathname.match(/^(.*)\/(preview|edit|open)$/);
if (matchedPath) {
  contextPath = matchedPath[1];
} else {
  contextPath = pathname.replace(/\/$/, '');
}
if (
  contextPath === '/' ||
  contextPath.endsWith('/index.html') ||
  contextPath.endsWith('/app.html')
) {
  contextPath = '';
}

const hostOrigin = window.location.origin;

// 默认 Logo 点击跳转地址与客户名称，可通过根目录 deployed.config.mjs 覆盖
const DEFAULT_LOGO_JUMP = 'https://www.airedgesoft.com';
const DEFAULT_CUSTOMER_NAME = '智研工软';

interface DeployedConfig {
  logoJump?: string;
  customerName?: string;
  showLogo?: boolean;
}

// 加载部署配置（与 public 同级的 deployed.config.mjs），支持部署后修改而无需重新构建
async function loadDeployedConfig(): Promise<DeployedConfig> {
  try {
    const mod = await import(/* @vite-ignore */ `${contextPath}/deployed.config.mjs`);
    return (mod?.deployedConfig ?? {}) as DeployedConfig;
  } catch (error) {
    console.warn('[OfficeViewerApp] 未加载 deployed.config.mjs，使用默认配置', error);
    return {};
  }
}

// 探测 Logo 资源是否存在，不存在时隐藏图片块，避免出现破损图
async function resourceExists(url: string): Promise<boolean> {
  try {
    let response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, { method: 'GET', cache: 'no-store' });
    }
    if (!response.ok) return false;
    // 部分后端（如 SPA 兜底）会把缺失资源返回为 index.html，这里通过 Content-Type 判定
    const contentType = response.headers.get('content-type') ?? '';
    return !contentType.startsWith('text/html');
  } catch (error) {
    console.warn('[OfficeViewerApp] Logo 资源探测失败，按不存在处理', error);
    return false;
  }
}

async function bootstrap() {
  const deployedConfig = await loadDeployedConfig();
  const logoJump = (deployedConfig.logoJump ?? '').trim() || DEFAULT_LOGO_JUMP;
  const customerName = (deployedConfig.customerName ?? '').trim() || DEFAULT_CUSTOMER_NAME;

  const logoUrl = `${hostOrigin}${contextPath}/logo.png`;
  // showLogo 显式控制是否展示 Logo，默认 true；为 false 时强制隐藏
  const showLogo = deployedConfig.showLogo !== false;
  const logoExists = showLogo && (await resourceExists(logoUrl));
  const baseConfig: DocEditorConfig = createBaseConfig({
    assetsPrefix: `${contextPath}/vendor/onlyoffice`,
    backendUrl: `${hostOrigin}${contextPath}`,
    mode: 'server',
    document: {
      permissions: {
        edit: true,
        print: true,
        download: true,
        fillForms: true,
        review: true,
        modifyFilter: false,
        modifyContentControl: false,
        chat: false,
      },
    },
    editorConfig: {
      lang: 'zh',
      customization: {
        about: true,
        comments: false,
        features: {
          spellcheck: false,
        },
        plugins: true,
        customer: {
          name: customerName,
          www: logoJump,
          ...(logoExists ? { logo: logoUrl, logoDark: logoUrl } : {}),
        },
        ...(logoExists
          ? {
              logo: {
                image: logoUrl,
                imageDark: logoUrl,
                imageLight: logoUrl,
                imageEmbedded: logoUrl,
                url: logoJump,
                visible: true,
              },
            }
          : {
              // 未提供 Logo 时显式隐藏，避免回退展示 OnlyOffice 内置 Logo
              logo: { visible: false },
            }),
      },
    },
  });

  // 2. 解析 URL 参数并构造权限
  const urlParams = new URLSearchParams(window.location.search);
  const fileUrl = urlParams.get('file');
  const fpStr = urlParams.get('fp');
  const titleStr = urlParams.get('title');

  const isPreview = pathname.endsWith('/preview');
  const isEdit = pathname.endsWith('/edit');

  function parsePermissionsFromFp(fp: number) {
    const edit = (fp & 2) !== 0;
    return {
      permissions: {
        edit: edit,
        download: (fp & 8) !== 0 || (fp & 32) !== 0,
        copy: (fp & 16) !== 0,
        print: (fp & 128) !== 0,
        comment: (fp & 64) !== 0,
        review: (fp & 256) !== 0,
        chat: (fp & 512) !== 0,
        fillForms: edit,
      },
      mode: edit ? ('edit' as const) : ('view' as const),
    };
  }

  let fp = 0;
  if (fpStr) {
    fp = parseInt(fpStr, 10);
  } else if (isPreview) {
    fp = 1; // 只读
  } else if (isEdit) {
    // 默认编辑权限
    fp = 1 | 2 | 8 | 16 | 32 | 64 | 128 | 256;
  }

  const parsed = parsePermissionsFromFp(fp);
  if (baseConfig.document) {
    baseConfig.document.permissions = {
      ...baseConfig.document.permissions,
      ...parsed.permissions,
    };
  }
  if (baseConfig.editorConfig) {
    baseConfig.editorConfig.mode = parsed.mode;
  }

  if (fp == 1) {
    baseConfig.type = 'embedded';
  }
  if (titleStr && baseConfig.document) {
    baseConfig.document.title = titleStr;
  }

  console.log(
    'title',
    titleStr,
    'fullConfig',
    baseConfig,
    '[OfficeViewerApp] fileUrl:',
    fileUrl,
    'permissions:',
    baseConfig.document?.permissions
  );

  const statusEl = document.getElementById('loading-status');
  const overlayEl = document.getElementById('loading-overlay');

  // 监听转码状态广播
  window.addEventListener('office-viewer-status', (e: any) => {
    if (statusEl) {
      statusEl.textContent = e.detail;
    }
  });

  const editor = createEditor(editorContainer, baseConfig);

  async function openInput(input: string) {
    try {
      if (statusEl) statusEl.textContent = '正在发起转码与渲染任务...';
      await editor.open(input);

      // 成功加载，渐隐 Loading
      if (statusEl) statusEl.textContent = '文档加载就绪，正在渲染页面...';
      setTimeout(() => {
        if (overlayEl) {
          overlayEl.classList.add('fade-out');
        }
      }, 300);
    } catch (error) {
      console.error('Open document failed:', error);
      if (statusEl) {
        statusEl.style.color = '#d9534f';
        statusEl.style.fontWeight = 'bold';
        statusEl.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  if (fileUrl) {
    await openInput(decodeURIComponent(fileUrl));
  } else {
    // 如果没有传入文件 URL，直接隐藏 loading 遮罩
    if (overlayEl) {
      overlayEl.classList.add('fade-out');
    }
  }
}

bootstrap();
