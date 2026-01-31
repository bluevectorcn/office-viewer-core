# Office Viewer Core (office-viewer-core)

这是一个基于 WebAssembly (WASM) 的 OnlyOffice 核心组件，旨在提供一个纯前端、无后端依赖的文档编辑黑盒。它可以轻松集成到 React、Vue 或其他前端框架中。

## 核心特性

- **WASM 驱动**：利用 OnlyOffice `web-apps` 和 `x2t` 的 WASM 版本进行高效的文档处理和转换。
- **现代架构**：采用 Clean Architecture 设计模式，解耦业务逻辑、应用用例和基础设施实现。
- **全能编辑**：支持 DOCX, XLSX, PPTX 的在线编辑，以及多格式（PDF, DOCX 等）的导出。
- **灵活部署**：支持自定义静态资源前缀（`assetsPrefix`），适配各种 CDN 和静态服务器布局。
- **自定义字体支持**：支持通过 Docker 自动生成并集成自定义字体。

## 环境要求

- **Node.js**: 24.12.0+ (建议使用最新版本)
- **pnpm**: 9.12.3+
- **Git**: 用于下载 OnlyOffice 源码
- **Docker**: (可选) 用于生成自定义字体

## 快速开始

### 1. 初始化项目

```bash
# 克隆仓库
git clone <repository-url>
cd office-viewer-core

# 安装依赖
pnpm install
```


#### 1.1 添加字体

将您的字体文件（.ttf, .otf）放入项目根目录下的 `fonts/` 目录中。

#### 1.2 添加 wasm

- 下载x2t：[这里](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases) (建议使用7.3的版本), 也可自行基于 [onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm) 进行编译
- 拷贝 x2t.js 和 x2t.wasm 到项目根目录 `wasm/x2t` 下。

#### 1.3 添加插件 (可选)

1. 从 [ONLYOFFICE/onlyoffice.github.io Releases](https://github.com/ONLYOFFICE/onlyoffice.github.io/releases) 下载所需的 `*.plugin` 文件
2. 将下载的 `.plugin` 文件拷贝到项目根目录的 `plugins/` 目录下

#### 2 构建 OnlyOffice 运行时

该步骤会自动按需下载 `package.json` 中指定的 OnlyOffice 源码并进行编译，最后同步到 `vendor/` 目录中：

```bash
pnpm build:onlyoffice
```

可单独运行以下命令安装插件和主题：

```bash
pnpm install:plugins
```

编译库

```bash
pnpm build:lib
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
| `save(filename?)` | 将当前内容保存，返回 `Promise<{ blob: Blob, filename: string }>` |
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
        alias /path/to/office-viewer-core/vendor/onlyoffice/;
        
        # 必须：开启跨域隔离
        add_header Cross-Origin-Opener-Policy same-origin;
        add_header Cross-Origin-Embedder-Policy require-corp;
        
        # 允许跨域请求
        add_header Access-Control-Allow-Origin *;
    }
}
```

## NPM 包集成指南

本项目已发布至 NPM，支持作为依赖集成到您的前端项目中。

### 1. 安装

```bash
pnpm add office-viewer-core
# 或
npm install office-viewer-core
```

### 2. 重要：静态资源配置

由于 OnlyOffice 核心是一个复杂的二进制黑盒，它需要大量的静态资源（WASM, Workers, JS 插件）。

**您必须确保 `vendor/onlyoffice` 目录下的内容被部署到您的静态服务器或 CDN 上，并能被浏览器通过 URL 访问。**

- 在 Vite 项目中，您可以将 `vendor/onlyoffice` 拷贝到 `public/vendor/onlyoffice`。
- 在部署时，请确保配置了正确的 [跨域隔离与 Nginx 响应头](#静态部署指南)。

---

### 3. 集成示例

#### Web Component (通用)

适用于所有现代 Web 框架或原生 HTML/JS 项目。

```html
<script type="module">
  import 'office-viewer-core/web-component';
  // 必须引入基础样式（包含编辑器容器排版）
  import 'office-viewer-core/dist-lib/style.css';
  import { createBaseConfig } from 'office-viewer-core';

  const viewer = document.getElementById('viewer');
  const config = createBaseConfig({
    // 指向您部署的静态资源路径
    assetsPrefix: '/vendor/onlyoffice', 
    editorConfig: { lang: 'zh' }
  });
  
  viewer.init(config).then(() => {
    viewer.newFile('docx');
  });
</script>

<onlyoffice-viewer id="viewer" style="height: 600px; display: block;"></onlyoffice-viewer>
```

#### React 集成

```tsx
import { OnlyOfficeViewer } from 'office-viewer-core/react';
import { createBaseConfig } from 'office-viewer-core';
import 'office-viewer-core/dist-lib/style.css';

function App() {
  const config = createBaseConfig({
    assetsPrefix: '/vendor/onlyoffice',
    editorConfig: { lang: 'zh' }
  });

  return (
    <div style={{ height: '800px', width: '100%' }}>
      <OnlyOfficeViewer 
        config={config} 
        onEditorReady={(editor) => {
          console.log('编辑器已就绪', editor);
          editor.newFile('docx');
        }} 
      />
    </div>
  );
}
```

#### Vue 3 集成

```vue
<template>
  <div style="height: 800px; width: 100%">
    <OnlyOfficeViewer :config="config" @ready="onReady" />
  </div>
</template>

<script setup>
import { OnlyOfficeViewer } from 'office-viewer-core/vue';
import { createBaseConfig } from 'office-viewer-core';
import 'office-viewer-core/dist-lib/style.css';

const config = createBaseConfig({
  assetsPrefix: '/vendor/onlyoffice',
  editorConfig: { lang: 'zh' }
});

const onReady = (editor) => {
  console.log('编辑器已就绪', editor);
  editor.newFile('xlsx');
};
</script>
```

### Playground 示例

项目中包含一个简单的 Playground 示例：

1. 运行 `pnpm build:lib` 构建库。
2. 打开 `playground/index.html` (需通过 HTTP 服务器访问，例如使用 Live Server 或 `npx serve .`)。

### API 参考

所有组件均通过 Ref 或回调暴露 `IEditor` 接口，支持 `open`, `newFile`, `save`, `export` 等操作。

## 开发者脚本

- `pnpm dev`: 启动 Vite 开发服务器。
- `pnpm build`: 打包应用代码。
- `pnpm build:lib`: 打包库代码供 NPM 使用 (输出到 `dist-lib`)。
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

## 致谢

只有优秀的开源项目才让 `office-viewer-core` 成为可能：

- [cryptpad/onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm) (x2t.wasm)
- [ONLYOFFICE/sdkjs](https://github.com/ONLYOFFICE/sdkjs)
- [ONLYOFFICE/web-apps](https://github.com/ONLYOFFICE/web-apps)
- [ONLYOFFICE/dictionaries](https://github.com/ONLYOFFICE/dictionaries)

### 开启拼写检查

如需开启编辑器的拼写检查功能，请下载 [dictionaries](https://github.com/ONLYOFFICE/dictionaries) 项目的内容，并将其拷贝到部署目录的 `vendor/onlyoffice/dictionaries` 下。

## License

本项目采用 [AGPL-3.0](LICENSE) 许可证。
