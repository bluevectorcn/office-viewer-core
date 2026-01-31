/**
 * 构建脚本类型定义
 */

/** 日志级别 */
export type LogLevel = "debug" | "info" | "success" | "warn" | "error";

/** 构建步骤 */
export enum BuildStep {
  SYNC_REPOS = "sync_repos",
  BUILD_SDKJS = "build_sdkjs",
  BUILD_WEBAPPS = "build_webapps",
  PROCESS_FONTS = "process_fonts",
  COPY_WASM = "copy_wasm",
  INSTALL_PLUGINS = "install_plugins",
  INSTALL_THEMES = "install_themes",
  COMPRESS = "compress",
  COPY_SERVICE_WORKER = "copy_service_worker",
  CLEANUP = "cleanup",
}

/** 命令行选项 */
export interface BuildOptions {
  /** 跳过字体处理 */
  skipFonts: boolean;
  /** 跳过压缩 */
  skipCompress: boolean;
  /** 跳过 WASM 复制 */
  skipWasm: boolean;
  /** 静默模式 */
  quiet: boolean;
  /** 调试模式 */
  debug: boolean;
  /** 只同步仓库，不构建 */
  syncOnly: boolean;
  /** 包管理器 */
  packageManager: "npm" | "pnpm" | "yarn";
  /** 显示帮助 */
  help: boolean;
}

/** 版本信息 */
export interface VersionInfo {
  /** 完整版本号，如 9.3.0.74 */
  full: string;
  /** 产品版本号，如 9.3.0 */
  product: string;
  /** 构建编号，如 74 */
  build: number;
  /** Git tag，如 v9.3.0.74 */
  tag: string;
}

/** OnlyOffice 配置 (来自 package.json) */
export interface OnlyOfficeConfig {
  version: string;
  submodule: string;
  sdkjsSubmodule?: string;
}

/** 构建配置 */
export interface BuildConfig {
  /** 项目根目录 */
  rootDir: string;
  /** OnlyOffice 版本信息 */
  version: VersionInfo;
  /** 路径配置 */
  paths: {
    /** web-apps 子模块目录 */
    webApps: string;
    /** sdkjs 子模块目录 */
    sdkjs: string;
    /** vendor 输出目录 */
    vendor: string;
    /** 字体源目录 */
    fonts: string;
    /** WASM 源目录 */
    wasm: string;
  };
  /** 仓库 URL */
  repos: {
    webApps: string;
    sdkjs: string;
  };
  /** 构建选项 */
  options: BuildOptions;
}

/** 命令执行结果 */
export interface ExecResult {
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
  /** 是否成功 */
  success: boolean;
}

/** 构建步骤描述 */
export interface StepInfo {
  step: BuildStep;
  name: string;
  description: string;
}

/** 进度回调 */
export type ProgressCallback = (current: number, total: number, message: string) => void;
