# Office Viewer Core (office-viewer-core)

这是一个基于 WebAssembly (WASM) 的 OnlyOffice 核心组件，旨在提供一个纯前端、无后端依赖的文档编辑黑盒。它可以轻松集成到 React、Vue 或其他前端框架中。

## 核心特性

- **WASM 驱动**：利用 OnlyOffice `web-apps` 和 `x2t` 的 WASM 版本进行高效的文档处理和转换。
- **现代架构**：采用 Clean Architecture 设计模式，解耦业务逻辑、应用用例和基础设施实现。
- **全能编辑**：支持 DOCX, XLSX, PPTX 的在线编辑，以及多格式（PDF, DOCX 等）的导出。
- **灵活部署**：支持自定义静态资源前缀（`assetsPrefix`），适配各种 CDN 和静态服务器布局。
- **自定义字体支持**：支持通过 Docker 自动生成并集成自定义字体。
- **在线预览**：[https://office.851621.xyz/](https://office.851621.xyz/)

## 环境要求

- **Node.js**: 24.12.0+ (建议使用最新版本)
- **pnpm**: 9.12.3+
- **Git**: 用于下载 OnlyOffice 源码
- **Docker**: 用于生成自定义字体
- **Windows**: Windows 10 或更高版本 (PowerShell 5.0+)

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

#### 1.2 添加插件 (可选)

1. 从 [ONLYOFFICE/onlyoffice.github.io Releases](https://github.com/ONLYOFFICE/onlyoffice.github.io/releases) 下载所需的 `*.plugin` 文件
2. 将下载的 `.plugin` 文件拷贝到项目根目录的 `plugins/` 目录下

#### 2 构建 OnlyOffice 运行时

该步骤会自动按需下载 `package.json` 中指定的 OnlyOffice 源码并进行编译，最后同步到 `vendor/` 目录中：

```bash
# 查看命令说明
pnpm build:onlyoffice --help

# 完整构建
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
import { createEditor } from './application/EditorFactory';
import { createBaseConfig } from './application/config/EditorConfigBuilder';

const container = document.getElementById('editor-container');

// 1. 创建基础配置
const config = createBaseConfig({
  assetsPrefix: '/vendor/onlyoffice', // 静态资源路径
  editorConfig: {
    lang: 'zh',
    customization: {
      about: false,
      // ... 更多自定义配置
    },
  },
});

// 2. 初始化编辑器
const editor = createEditor(container, config);

// 3. 打开文档 (支持 File, Blob, ArrayBuffer 或 URL)
await editor.open(fileBlob);
```

### IEditor 接口

`createEditor` 返回一个实现了 `IEditor` 接口的对象：

| 方法              | 描述                                                             |
| :---------------- | :--------------------------------------------------------------- |
| `open(input)`     | 打开文档，支持 `File`, `Blob`, `ArrayBuffer` 或远程 `URL`        |
| `newFile(format)` | 创建并打开新文件，支持 `'docx'`, `'xlsx'`, `'pptx'`              |
| `save(filename?)` | 将当前内容保存，返回 `Promise<{ blob: Blob, filename: string }>` |
| `export(format)`  | 导出到特定格式，支持 `'pdf'`, `'docx'`, `'xlsx'`, `'pptx'`       |
| `destroy()`       | 销毁编辑器实例，清理内存并移除 DOM 元素                          |

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

### 部署配置（deployed.config.mjs）

仓库根目录（与 `public` 同级）的 `deployed.config.mjs` 用于自定义部署级参数（Logo 图片、点击跳转地址、关于信息中的客户名称等）：

| 字段 | 说明 |
| --- | --- |
| `logoJump` | 点击编辑器内 Logo 时跳转的地址。留空则使用默认地址 `https://www.airedgesoft.com` |
| `customerName` | 客户名称，显示在编辑器“关于”弹窗中。留空则使用默认名称 `智研工软` |
| `showLogo` | 是否展示编辑器 Logo，默认 `true`。设为 `false` 时强制隐藏（即使 `public/logo.png` 存在） |

该文件会在构建时被自动拷贝到 `dist/deployed.config.mjs`，并由 `app.html` 入口在运行时动态加载。因此：
- **物理部署**：部署后可直接修改 `dist/deployed.config.mjs` 而无需重新构建。
- **Docker 容器部署**：支持在 `docker run` 时通过卷挂载（`-v`）直接覆盖容器内的 `/app/dist/deployed.config.mjs`，同时可挂载外部 Logo 图片替换 `/app/dist/logo.png`。

配置文件内容示例：

```js
export const deployedConfig = {
  logoJump: 'https://your-site.example.com',
  customerName: '您的公司名称',
  showLogo: true,
};
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
    editorConfig: { lang: 'zh' },
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
    editorConfig: { lang: 'zh' },
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
  editorConfig: { lang: 'zh' },
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

## Docker 部署

项目提供两种镜像，覆盖"开箱即用"与"外挂字体最小镜像"两种场景。镜像同时承载 Go 后端（负责 PDF 转换）与前端预览资源，启动时由入口脚本统一生成 x2t 与 web 端所需的字体产物。

> **架构限制**：内置的 `x2t` 为 x86-64 原生二进制，镜像仅支持 `linux/amd64`。

| 镜像                        | Dockerfile         | 字体             | 适用场景                                        |
| :-------------------------- | :----------------- | :--------------- | :---------------------------------------------- |
| `office-viewer-core:latest` | `Dockerfile`       | 内置（开箱即用） | 默认部署，也支持运行时挂载外挂字体覆盖          |
| `office-viewer-core:slim`   | `Dockerfile.fonts` | 不含（剥离）     | 镜像最小，**必须**挂载外挂字体才能使用转换/预览 |

### 构建镜像

使用 `scripts/docker-build.sh` 统一构建：

```bash
# 构建内置字体镜像（开箱即用）
./scripts/docker-build.sh full

# 构建外挂字体瘦身镜像
./scripts/docker-build.sh slim

# 一次构建两种
./scripts/docker-build.sh all

# 指定镜像名/标签，或推送到远端仓库
./scripts/docker-build.sh full ghcr.io/bluevectorcn/office-viewer-core:latest
PUSH=1 ./scripts/docker-build.sh full ghcr.io/bluevectorcn/office-viewer-core:latest
```

环境变量：

| 变量       | 默认          | 说明                         |
| :--------- | :------------ | :--------------------------- |
| `PLATFORM` | `linux/amd64` | 构建平台（x2t 仅支持 amd64） |
| `NO_CACHE` | `0`           | 设为 `1` 禁用构建缓存        |
| `PUSH`     | `0`           | 设为 `1` 构建后推送镜像      |

### 容器运行环境变量

容器运行时（`server-go`）支持通过以下环境变量定制服务行为：

| 变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP 服务监听端口 |
| `CONTEXT_PATH` | 空 (`""`) | **子路径部署前缀**（如 `/office`）。当服务通过反向代理（如 Nginx）挂载在子路径下，或调用方通过带前缀的集成路由（如 `/office/open`、`/office/preview`）访问时，**必须**配置该变量。若未配置会导致页面路由匹配失败并错误回退到 Playground 首页，且引发静态资源 MIME 类型错误 |
| `MAX_CONCURRENT_TASKS` | `4` | 最大并发转码任务数，防止 CPU 耗尽 |
| `TEMP_DIR` | `/app/temp` | 文档转换任务的临时工作目录 |
| `FONTS_DIR` | `/app/assets/fonts` | 字体源文件目录，启动脚本基于此目录生成字体产物 |

### 运行

**1. 内置字体镜像**（开箱即用，默认部署在根路径）：

```bash
docker run -d -p 3000:3000 ghcr.io/bluevectorcn/office-viewer-core:latest
```

**2. 子路径部署（配置 `CONTEXT_PATH`）**：

若您通过子路径（例如 `http://your-domain.com/office/open?...`）访问服务，或通过 Nginx 保留前缀反代，需通过 `-e CONTEXT_PATH=/office` 启动：

```bash
docker run -d -p 3000:3000 \
  -e CONTEXT_PATH=/office \
  ghcr.io/bluevectorcn/office-viewer-core:latest
```

**3. 运行时外部替换 Logo 与部署配置（`deployed.config.mjs`）**：

无需重新构建镜像，直接通过挂载外部配置文件与 Logo 即可实现客户定制化：

```bash
docker run -d -p 3000:3000 \
  -e CONTEXT_PATH=/office \
  -v /path/to/your/deployed.config.mjs:/app/dist/deployed.config.mjs \
  -v /path/to/your/logo.png:/app/dist/logo.png \
  ghcr.io/bluevectorcn/office-viewer-core:latest
```

**4. 外挂字体**（两种镜像均支持，挂载到 `/app/assets/fonts` 即可覆盖字体源）：

```bash
docker run -d -p 3000:3000 \
  -v /path/to/your/fonts:/app/assets/fonts \
  ghcr.io/bluevectorcn/office-viewer-core:slim
```

字体目录中放置 `.ttf` / `.otf` 文件即可。容器启动时 `docker-entrypoint.sh` 会自动生成 x2t 与 web 端所需的全部字体产物（`AllFonts.js`、`font_selection.bin`、字体分片、缩略图）。

### 字体工作机制

- **服务端（PDF 转换）**：x2t 从 `/app/assets/fonts` 读取物理字体，并加载同目录的 `AllFonts.js` 与 `font_selection.bin`（路径由 `server-go/x2t/DoctRenderer.config` 指定）。
- **前端（页面预览）**：浏览器从 `dist/vendor/onlyoffice/` 下加载 web 版字体与 `AllFonts.js`。
- **启动脚本**根据 `FONTS_DIR`（默认 `/app/assets/fonts`）一次性生成上述所有产物并分发到对应目录。

## 开发者脚本

- `pnpm dev`: 启动 Vite 开发服务器。
- `pnpm build`: 打包应用代码。
- `pnpm build:lib`: 打包库代码供 NPM 使用 (输出到 `dist-lib`)。
- `pnpm build:onlyoffice`: 从子模块构建 ONLYOFFICE 静态资源。
- `pnpm test`: 运行单元测试 (Vitest)。
- `pnpm lint`: 代码质量检查。
- `pnpm type-check`: TypeScript 类型检查。
- `./scripts/docker-build.sh <full|slim|all>`: 构建 Docker 镜像（详见 [Docker 部署](#docker-部署)）。

## 详细配置参考

配置系统基于 `DocEditorConfig`，主要包含以下部分：

- `assetsPrefix`: 必填。指向 `vendor/onlyoffice` 的部署路径。
- `document`: 文档元数据和权限配置（如 `edit: true`）。
- `editorConfig`: 编辑器界面定制、语言设置等。

详情请参考 `src/shared/types/EditorTypes.ts`。

## 致谢

只有优秀的开源项目才让 `office-viewer-core` 成为可能：

- [cryptpad/onlyoffice-x2t-wasm](https://github.com/cryptpad/onlyoffice-x2t-wasm) (x2t.wasm)
- [ONLYOFFICE/core](https://github.com/ONLYOFFICE/core)
- [ONLYOFFICE/sdkjs](https://github.com/ONLYOFFICE/sdkjs)
- [ONLYOFFICE/web-apps](https://github.com/ONLYOFFICE/web-apps)
- [ONLYOFFICE/dictionaries](https://github.com/ONLYOFFICE/dictionaries)

### 开启拼写检查

如需开启编辑器的拼写检查功能，请下载 [dictionaries](https://github.com/ONLYOFFICE/dictionaries) 项目的内容，并将其拷贝到部署目录的 `vendor/onlyoffice/dictionaries` 下。

## License

本项目采用 [AGPL-3.0](LICENSE) 许可证。
