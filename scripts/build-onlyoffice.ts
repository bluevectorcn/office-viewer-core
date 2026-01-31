#!/usr/bin/env npx tsx
/**
 * OnlyOffice 构建脚本
 *
 * 用法: pnpm build:onlyoffice [选项]
 *
 * 选项:
 *   --skip-fonts        跳过字体处理
 *   --skip-compress     跳过 Brotli 压缩
 *   --skip-wasm         跳过 WASM 复制
 *   --sync-only         只同步仓库，不构建
 *   --pm <npm|pnpm|yarn> 指定包管理器
 *   -q, --quiet         静默模式
 *   -d, --debug         调试模式
 *   -h, --help          显示帮助
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { BuildStep } from "./lib/types.js";
import { loadConfig, parseArgs, printConfig, showHelp } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { createProgressTracker } from "./lib/progress.js";
import { Executor } from "./lib/executor.js";
import { SdkjsBuilder } from "./lib/builders/sdkjs.js";
import { WebAppsBuilder } from "./lib/builders/web-apps.js";
import { FontProcessor } from "./lib/processors/fonts.js";
import { WasmProcessor } from "./lib/processors/wasm.js";
import { PluginProcessor } from "./lib/processors/plugins.js";
import { ThemeProcessor } from "./lib/processors/themes.js";
import { compressAssets } from "./lib/compressor.js";
import { remove, copyFile } from "./lib/fs-utils.js";

// ─────────────────────────────────────────────────────────────────────────────
// 主程序
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const rootDir = process.cwd();

  // 解析命令行参数
  const cliOptions = parseArgs(process.argv.slice(2));

  // 显示帮助
  if (cliOptions.help) {
    showHelp();
    return 0;
  }

  // 加载配置
  const config = loadConfig(rootDir, cliOptions);

  // 配置日志
  logger.setQuiet(config.options.quiet);
  logger.setDebug(config.options.debug);

  // 打印配置信息
  printConfig(config);

  // 创建进度跟踪器
  const progress = createProgressTracker(config.options);

  // 创建构建器和处理器
  const executor = new Executor(config);
  const sdkjsBuilder = new SdkjsBuilder(config);
  const webAppsBuilder = new WebAppsBuilder(config);
  const fontProcessor = new FontProcessor(config);
  const wasmProcessor = new WasmProcessor(config);
  const pluginProcessor = new PluginProcessor(config);
  const themeProcessor = new ThemeProcessor(config);

  let success = true;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Step 1: 清理 vendor 目录
    // ─────────────────────────────────────────────────────────────────────────
    logger.info("清理 vendor/onlyoffice 目录...");
    remove(config.paths.vendor);

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2: 同步仓库
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.SYNC_REPOS);

    if (!sdkjsBuilder.sync()) {
      throw new Error("SDKJS 仓库同步失败");
    }

    if (!webAppsBuilder.sync()) {
      throw new Error("Web Apps 仓库同步失败");
    }

    progress.endStep();

    // 如果只同步仓库，则到此结束
    if (config.options.syncOnly) {
      logger.success("仓库同步完成");
      return 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3: 构建 SDKJS
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.BUILD_SDKJS);

    if (!sdkjsBuilder.build()) {
      throw new Error("SDKJS 构建失败");
    }

    if (!sdkjsBuilder.copyOutput()) {
      logger.warn("SDKJS 产物复制失败，继续构建...");
    }

    progress.endStep();

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4: 构建 Web Apps
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.BUILD_WEBAPPS);

    webAppsBuilder.patchConfigs();

    if (!webAppsBuilder.build()) {
      throw new Error("Web Apps 构建失败");
    }

    if (!webAppsBuilder.copyOutput()) {
      throw new Error("Web Apps 产物复制失败");
    }

    progress.endStep();

    // ─────────────────────────────────────────────────────────────────────────
    // Step 5: 处理字体
    // ─────────────────────────────────────────────────────────────────────────
    if (config.options.skipFonts) {
      progress.skipStep(BuildStep.PROCESS_FONTS, "用户跳过");
    } else {
      progress.startStep(BuildStep.PROCESS_FONTS);
      fontProcessor.process();
      progress.endStep();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 6: 复制 WASM
    // ─────────────────────────────────────────────────────────────────────────
    if (config.options.skipWasm) {
      progress.skipStep(BuildStep.COPY_WASM, "用户跳过");
    } else {
      progress.startStep(BuildStep.COPY_WASM);
      wasmProcessor.copy();
      progress.endStep();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 7: 复制 Service Worker
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.COPY_SERVICE_WORKER);

    const swSource = path.join(config.paths.vendor, "sdkjs", "common", "serviceworker", "document_editor_service_worker.js");
    const swTarget = path.join(config.paths.vendor, "document_editor_service_worker.js");

    if (fs.existsSync(swSource)) {
      copyFile(swSource, swTarget);
      logger.success("Service Worker 复制完成");
    } else {
      logger.warn(`Service Worker 未找到: ${swSource}`);
    }

    progress.endStep();

    // ─────────────────────────────────────────────────────────────────────────
    // Step 8: 安装插件
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.INSTALL_PLUGINS);
    pluginProcessor.process();
    progress.endStep();

    // ─────────────────────────────────────────────────────────────────────────
    // Step 9: 安装主题
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.INSTALL_THEMES);
    themeProcessor.process();
    progress.endStep();

    // ─────────────────────────────────────────────────────────────────────────
    // Step 10: 压缩资源
    // ─────────────────────────────────────────────────────────────────────────
    if (config.options.skipCompress) {
      progress.skipStep(BuildStep.COMPRESS, "用户跳过");
    } else {
      progress.startStep(BuildStep.COMPRESS);
      compressAssets(config.paths.vendor);
      progress.endStep();
    }
  } catch (error) {
    success = false;
    if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error(String(error));
    }
  } finally {
    // ─────────────────────────────────────────────────────────────────────────
    // 清理
    // ─────────────────────────────────────────────────────────────────────────
    progress.startStep(BuildStep.CLEANUP);

    sdkjsBuilder.cleanup();
    webAppsBuilder.cleanup();
    executor.cleanup();

    progress.endStep();
    progress.finish(success);
  }

  return success ? 0 : 1;
}

// 运行主程序
main().then((exitCode) => {
  process.exit(exitCode);
});
