/**
 * Web Apps 构建器模块
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig } from "../types.js";
import { logger } from "../logger.js";
import { Executor } from "../executor.js";
import { GitOperations } from "../git.js";
import { findBuildOutput, moveDir } from "../fs-utils.js";

export class WebAppsBuilder {
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
    return this.git.syncRepo(repos.webApps, paths.webApps, version.tag);
  }

  /** 修补配置文件 */
  patchConfigs(): void {
    const { paths, version } = this.config;
    const buildDir = path.join(paths.webApps, "build");

    // 1. 修复版本号
    if (fs.existsSync(buildDir)) {
      const jsonFiles = fs.readdirSync(buildDir).filter((f) => f.endsWith(".json") && f !== "package.json");

      for (const file of jsonFiles) {
        const filePath = path.join(buildDir, file);
        try {
          const config = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (config.version !== undefined) {
            config.version = version.product;
            config.build = version.build;
            fs.writeFileSync(filePath, JSON.stringify(config, null, 4));
            logger.debug(`已更新版本: ${file}`);
          }
        } catch (e) {
          logger.debug(`跳过非 JSON 文件: ${file}`);
        }
      }
    }

    // 2. Webpack 5 ESM 补丁
    const framework7ConfigPath = path.join(paths.webApps, "vendor/framework7-react/build/webpack.config.js");
    if (fs.existsSync(framework7ConfigPath)) {
      let content = fs.readFileSync(framework7ConfigPath, "utf-8");
      if (!content.includes("fullySpecified: false")) {
        content = content.replace(/(rules:\s*\[)/, "$1 { test: /\\.js$/, resolve: { fullySpecified: false } },");
        content = content.replace(
          /(test:\s*\/\\\.\(mjs\|js\|jsx\)\\\$\/,)/,
          "$1 resolve: { fullySpecified: false },"
        );
        fs.writeFileSync(framework7ConfigPath, content);
        logger.debug("已应用 Webpack ESM 补丁");
      }
    }

    logger.info("配置文件修补完成");
  }

  /** 执行构建 */
  build(): boolean {
    const { paths, options } = this.config;
    const buildDir = path.join(paths.webApps, "build");
    const pm = options.packageManager;

    // 确定工作目录
    const cwd = fs.existsSync(path.join(buildDir, "package.json")) ? buildDir : paths.webApps;

    // 安装依赖
    logger.info(`安装 Web Apps 依赖 (${pm})...`);
    const installResult = this.executor.npm(pm, ["install"], cwd);
    if (!installResult.success) {
      logger.error("Web Apps 依赖安装失败");
      return false;
    }

    // 检查构建命令
    const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, "package.json"), "utf-8"));

    if (pkg.scripts?.build) {
      logger.info("构建 Web Apps (npm run build)...");
      const buildResult = this.executor.npm(pm, ["run", "build"], cwd);
      if (!buildResult.success) {
        logger.error("Web Apps 构建失败");
        return false;
      }
    } else {
      logger.info("构建 Web Apps (grunt)...");
      const buildResult = this.executor.npx(["grunt"], cwd);
      if (!buildResult.success) {
        logger.error("Web Apps 构建失败");
        return false;
      }
    }

    logger.success("Web Apps 构建完成");
    return true;
  }

  /** 复制构建产物到 vendor 目录 */
  copyOutput(): boolean {
    const { paths, rootDir } = this.config;
    const outputDir = findBuildOutput(paths.webApps, "webApps");

    if (!outputDir) {
      logger.warn("未找到 Web Apps 构建产物");
      return false;
    }

    const targetDir = path.join(paths.vendor, "web-apps");
    logger.info(`复制 Web Apps 到 ${path.relative(rootDir, targetDir)}...`);

    moveDir(outputDir, targetDir);
    logger.success("Web Apps 复制完成");
    return true;
  }

  /** 清理仓库 */
  cleanup(): void {
    this.git.cleanRepo(this.config.paths.webApps);
  }
}
