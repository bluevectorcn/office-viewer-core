/**
 * 配置管理模块
 * 从 package.json 读取配置并验证
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig, BuildOptions, OnlyOfficeConfig, VersionInfo } from "./types.js";
import { logger } from "./logger.js";

/** 默认构建选项 */
const defaultOptions: BuildOptions = {
  skipFonts: false,
  skipCompress: false,
  skipWasm: false,
  quiet: false,
  debug: false,
  syncOnly: false,
  packageManager: "pnpm",
  help: false,
};

/** 仓库 URL */
const REPOS = {
  webApps: "https://github.com/ONLYOFFICE/web-apps.git",
  sdkjs: "https://github.com/ONLYOFFICE/sdkjs.git",
};

/**
 * 解析版本号
 * @param fullVersion 完整版本号，如 "9.3.0.74"
 */
function parseVersion(fullVersion: string): VersionInfo {
  const parts = fullVersion.split(".");

  if (parts.length < 2) {
    throw new Error(`Invalid version format: ${fullVersion}. Expected format: x.y.z or x.y.z.b`);
  }

  // 最后一个部分是构建号
  const buildStr = parts.length > 3 ? parts.pop()! : "1";
  const build = parseInt(buildStr, 10);

  if (isNaN(build)) {
    throw new Error(`Invalid build number in version: ${fullVersion}`);
  }

  const product = parts.join(".");

  return {
    full: fullVersion,
    product,
    build,
    tag: `v${fullVersion}`,
  };
}

/**
 * 解析命令行参数
 */
export function parseArgs(args: string[]): Partial<BuildOptions> {
  const options: Partial<BuildOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--skip-fonts":
      case "--no-fonts":
        options.skipFonts = true;
        break;
      case "--skip-compress":
      case "--no-compress":
        options.skipCompress = true;
        break;
      case "--skip-wasm":
      case "--no-wasm":
        options.skipWasm = true;
        break;
      case "--quiet":
      case "-q":
        options.quiet = true;
        break;
      case "--debug":
      case "-d":
        options.debug = true;
        break;
      case "--sync-only":
        options.syncOnly = true;
        break;
      case "--pm":
      case "--package-manager":
        const pm = args[++i];
        if (pm === "npm" || pm === "pnpm" || pm === "yarn") {
          options.packageManager = pm;
        } else {
          throw new Error(`Invalid package manager: ${pm}. Use npm, pnpm, or yarn.`);
        }
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (arg.startsWith("-")) {
          logger.warn(`Unknown option: ${arg}`);
        }
    }
  }

  return options;
}

/**
 * 显示帮助信息
 */
export function showHelp(): void {
  console.log(`
OnlyOffice 构建脚本

用法: pnpm build:onlyoffice [选项]

选项:
  --skip-fonts, --no-fonts     跳过字体处理
  --skip-compress, --no-compress 跳过 Brotli 压缩
  --skip-wasm, --no-wasm       跳过 WASM 文件复制
  --sync-only                  只同步仓库，不执行构建
  --pm, --package-manager <pm> 指定包管理器 (npm|pnpm|yarn)，默认 pnpm
  -q, --quiet                  静默模式，只显示错误
  -d, --debug                  调试模式，显示详细日志
  -h, --help                   显示此帮助信息

示例:
  pnpm build:onlyoffice                    # 完整构建
  pnpm build:onlyoffice --skip-fonts       # 跳过字体处理
  pnpm build:onlyoffice --sync-only        # 只同步仓库
  pnpm build:onlyoffice --pm npm --quiet   # 使用 npm，静默模式
`);
}

/**
 * 加载构建配置
 */
export function loadConfig(rootDir: string, cliOptions: Partial<BuildOptions> = {}): BuildConfig {
  const pkgPath = path.join(rootDir, "package.json");

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const ooConfig: OnlyOfficeConfig = pkg.onlyoffice || {};

  // 验证必需配置
  if (!ooConfig.version) {
    throw new Error("Missing onlyoffice.version in package.json");
  }

  // 合并选项
  const options: BuildOptions = { ...defaultOptions, ...cliOptions };

  // 从环境变量读取包管理器
  if (process.env.ONLYOFFICE_PM) {
    const pm = process.env.ONLYOFFICE_PM;
    if (pm === "npm" || pm === "pnpm" || pm === "yarn") {
      options.packageManager = pm;
    }
  }

  // 解析版本
  const version = parseVersion(ooConfig.version);

  // 构建路径
  const submoduleBase = path.join(rootDir, "submodules", "onlyoffice");

  const config: BuildConfig = {
    rootDir,
    version,
    paths: {
      webApps: path.join(rootDir, ooConfig.submodule || "submodules/onlyoffice/web-apps"),
      sdkjs: path.join(rootDir, ooConfig.sdkjsSubmodule || "submodules/onlyoffice/sdkjs"),
      vendor: path.join(rootDir, "vendor", "onlyoffice"),
      fonts: path.join(rootDir, "fonts"),
      wasm: path.join(rootDir, "wasm"),
    },
    repos: REPOS,
    options,
  };

  return config;
}

/**
 * 打印配置信息
 */
export function printConfig(config: BuildConfig): void {
  logger.title("构建配置");
  logger.keyValue("版本", config.version.full);
  logger.keyValue("产品版本", config.version.product);
  logger.keyValue("构建号", String(config.version.build));
  logger.keyValue("Git Tag", config.version.tag);
  logger.keyValue("包管理器", config.options.packageManager);
  logger.separator();

  if (config.options.skipFonts) logger.keyValue("跳过", "字体处理");
  if (config.options.skipCompress) logger.keyValue("跳过", "压缩");
  if (config.options.skipWasm) logger.keyValue("跳过", "WASM");
  if (config.options.syncOnly) logger.keyValue("模式", "仅同步仓库");
}
