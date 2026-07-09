import { createEditor } from "./application/EditorFactory";
import type { DocEditorConfig } from "./shared/types/EditorTypes";
import { createBaseConfig } from "./application/config/EditorConfigBuilder";

const editorHost = document.getElementById("editor");

if (!editorHost) {
  throw new Error("Editor container not found");
}

// 1. 解析 contextPath 和基础配置
const pathname = window.location.pathname;
console.log("[OfficeViewerApp] pathname:", pathname);

let contextPath = "";
const matchedPath = pathname.match(/^(.*)\/(preview|edit|open)$/);
if (matchedPath) {
  contextPath = matchedPath[1];
} else {
  contextPath = pathname.replace(/\/$/, "");
}
if (contextPath === "/" || contextPath.endsWith("/index.html") || contextPath.endsWith("/app.html")) {
  contextPath = "";
}

const hostOrigin = window.location.origin;
const baseConfig: DocEditorConfig = createBaseConfig({
  assetsPrefix: `${contextPath}/vendor/onlyoffice`,
  backendUrl: `${hostOrigin}${contextPath}`,
  mode: "server",
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
    lang: "zh",
    customization: {
      about: true,
      comments: false,
      features: {
        spellcheck: false,
      },
      plugins: true,
    },
  },
});

// 2. 解析 URL 参数并构造权限
const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get("file");
const fpStr = urlParams.get("fp");

const isPreview = pathname.endsWith("/preview");
const isEdit = pathname.endsWith("/edit");

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
    mode: edit ? ("edit" as const) : ("view" as const),
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

console.log("[OfficeViewerApp] fileUrl:", fileUrl, "permissions:", baseConfig.document?.permissions);

const statusEl = document.getElementById("loading-status");
const overlayEl = document.getElementById("loading-overlay");

// 监听转码状态广播
window.addEventListener('office-viewer-status', (e: any) => {
  if (statusEl) {
    statusEl.textContent = e.detail;
  }
});

const editor = createEditor(editorHost, baseConfig);

async function openInput(input: string) {
  try {
    if (statusEl) statusEl.textContent = "正在发起转码与渲染任务...";
    await editor.open(input);
    
    // 成功加载，渐隐 Loading
    if (statusEl) statusEl.textContent = "文档加载就绪，正在渲染页面...";
    setTimeout(() => {
      if (overlayEl) {
        overlayEl.classList.add("fade-out");
      }
    }, 300);
  } catch (error) {
    console.error("Open document failed:", error);
    if (statusEl) {
      statusEl.style.color = "#d9534f";
      statusEl.style.fontWeight = "bold";
      statusEl.textContent = `加载失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

if (fileUrl) {
  openInput(decodeURIComponent(fileUrl));
} else {
  // 如果没有传入文件 URL，直接隐藏 loading 遮罩
  if (overlayEl) {
    overlayEl.classList.add("fade-out");
  }
}
