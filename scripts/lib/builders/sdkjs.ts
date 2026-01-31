/**
 * SDKJS 构建器模块
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig } from "../types.js";
import { logger } from "../logger.js";
import { Executor } from "../executor.js";
import { GitOperations } from "../git.js";
import { findBuildOutput, moveDir } from "../fs-utils.js";

export class SdkjsBuilder {
  private config: BuildConfig;
  private executor: Executor;
  private git: GitOperations;

  constructor(config: BuildConfig) {
    this.config = config;
    this.executor = new Executor(config);
    this.git = new GitOperations(config.rootDir);
  }

  /** 同步仓库到指定版本 */
  sync(): boolean {
    const { paths, repos, version } = this.config;
    return this.git.syncRepo(repos.sdkjs, paths.sdkjs, version.tag);
  }

  /** 执行构建 */
  build(): boolean {
    const { paths } = this.config;
    const buildDir = path.join(paths.sdkjs, "build");

    if (!fs.existsSync(buildDir)) {
      logger.warn(`SDKJS 构建目录不存在: ${buildDir}`);
      return false;
    }

    // 安装依赖
    logger.info("安装 SDKJS 依赖...");
    const installResult = this.executor.npm("npm", ["install"], buildDir);
    if (!installResult.success) {
      logger.error("SDKJS 依赖安装失败");
      return false;
    }

    // 执行 grunt 构建
    logger.info("构建 SDKJS...");
    const buildResult = this.executor.npx(["grunt"], buildDir);
    if (!buildResult.success) {
      logger.error("SDKJS 构建失败");
      return false;
    }

    logger.success("SDKJS 构建完成");
    return true;
  }

  /** 复制构建产物到 vendor 目录 */
  copyOutput(): boolean {
    const { paths, rootDir } = this.config;
    const outputDir = findBuildOutput(paths.sdkjs, "sdkjs");

    if (!outputDir) {
      logger.warn("未找到 SDKJS 构建产物");
      return false;
    }

    const targetDir = path.join(paths.vendor, "sdkjs");
    logger.info(`复制 SDKJS 到 ${path.relative(rootDir, targetDir)}...`);

    moveDir(outputDir, targetDir);
    logger.success("SDKJS 复制完成");
    return true;
  }

  /** 清理仓库 */
  cleanup(): void {
    this.git.cleanRepo(this.config.paths.sdkjs);
  }
}
