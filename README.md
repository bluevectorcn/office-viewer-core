# OnlyOffice WASM Core (onlyoffice-core)

这是一个基于 WebAssembly (WASM) 的 OnlyOffice 核心组件，旨在提供一个纯前端、无后端依赖的文档编辑黑盒。它可以轻松集成到 React、Vue 或其他前端框架中。

## 核心特性

- **零后端依赖**：通过注入全局 `window.io` (FakeSocket) 拦截网络请求，实现纯前端运行。
- **WASM 驱动**：利用 OnlyOffice `web-apps` 和 `x2t` 的 WASM 版本进行高效的文档处理和转换。
- **现代架构**：采用 Clean Architecture 设计模式，解耦业务逻辑、应用用例和基础设施实现。
- **全能编辑**：支持 DOCX, XLSX, PPTX 的在线编辑，以及多格式（PDF, DOCX 等）的导出。
- **灵活部署**：支持自定义静态资源前缀（`assetsPrefix`），适配各种 CDN 和静态服务器布局。

## 环境要求

- **Node.js**: 24.12.0+ (建议使用最新版本)
- **pnpm**: 9.12.3+
- **Git**: 用于管理 submodules

## 快速开始

### 1. 初始化项目

```bash
# 克隆仓库并初始化子模块
git clone <repository-url>
cd onlyoffice-core
git submodule update --init --recursive

# 安装依赖
pnpm install
```

### 2. 构建 OnlyOffice 运行时

该步骤会将子模块中的源码编译并同步到 `vendor/` 目录中：

```bash
pnpm build:onlyoffice
```

### 3. 运行开发服务器

```bash
pnpm dev
```

访问浏览器中显示的开发地址即可预览 DEMO。

## 项目架构

项目遵循简洁的领域驱动设计 (DDD) 理念：

```text
src/
├── application/          # 应用层：包含用例 (Use Cases)、编排器 (Orchestrator) 和工厂 (Factory)
│   ├── use-cases/        # 具体业务流程：打开、保存、导出
│   ├── config/           # 编辑器配置构建逻辑
│   └── adapters/         # 接口适配器
├── domain/               # 领域层：核心业务实体 (EditorState) 和逻辑
├── infrastructure/       # 基础设施层：外部集成 (DOM, Socket, 转换服务)
│   ├── conversion/       # x2t WASM 转换服务封装
│   ├── socket/           # FakeSocket 实现
│   └── external/         # 第三方脚本加载 (DocsAPI)
├── shared/               # 共享层：通用类型、常量和工具函数
└── main.ts               # Demo 入口
```

## API 使用说明

### 创建编辑器

```typescript
import { createEditor } from "./application/EditorFactory";
import { createBaseConfig } from "./application/config/EditorConfigBuilder";

const container = document.getElementById("editor-container");

// 1. 创建基础配置
const config = createBaseConfig({
  assetsPrefix: "/vendor/onlyoffice", // 静态资源路径
  editorConfig: {
    lang: "zh",
    customization: {
      about: false,
      // ... 更多自定义配置
    }
  }
});

// 2. 初始化编辑器
const editor = createEditor(container, config);

// 3. 打开文档 (支持 File, Blob, ArrayBuffer 或 URL)
await editor.open(fileBlob);
```

### IEditor 接口

`createEditor` 返回一个实现了 `IEditor` 接口的对象：

| 方法 | 描述 |
| :--- | :--- |
| `open(input)` | 打开文档，支持 `File`, `Blob`, `ArrayBuffer` 或远程 `URL` |
| `newFile(format)` | 创建并打开新文件，支持 `'docx'`, `'xlsx'`, `'pptx'` |
| `save()` | 将当前编辑的内容保存并返回 `Promise<Blob>` (DOCX 格式) |
| `export(format)` | 导出到特定格式，支持 `'pdf'`, `'docx'`, `'xlsx'`, `'pptx'` |
| `destroy()` | 销毁编辑器实例，清理内存并移除 DOM 元素 |

## 静态部署指南

由于使用了 SharedArrayBuffer 等 WASM 特性，部署时需要配置相应的 HTTP Header，且必须工作在安全上下文 (HTTPS) 下。

### Nginx 配置示例

```nginx
server {
    listen 443 ssl;
    # ... SSL 配置

    location /vendor/onlyoffice/ {
        alias /path/to/onlyoffice-core/vendor/onlyoffice/;
        
        # 必须：开启跨域隔离
        add_header Cross-Origin-Opener-Policy same-origin;
        add_header Cross-Origin-Embedder-Policy require-corp;
        
        # 允许跨域请求
        add_header Access-Control-Allow-Origin *;
    }
}
```

## 开发者脚本

- `pnpm dev`: 启动 Vite 开发服务器。
- `pnpm build`: 打包应用代码。
- `pnpm build:onlyoffice`: 从子模块构建 ONLYOFFICE 静态资源。
- `pnpm test`: 运行单元测试 (Vitest)。
- `pnpm lint`: 代码质量检查。
- `pnpm type-check`: TypeScript 类型检查。

## 详细配置参考

配置系统基于 `DocEditorConfig`，主要包含以下部分：

- `assetsPrefix`: 必填。指向 `vendor/onlyoffice` 的部署路径。
- `document`: 文档元数据和权限配置（如 `edit: true`）。
- `editorConfig`: 编辑器界面定制、语言设置等。

详情请参考 `src/shared/types/EditorTypes.ts`。
