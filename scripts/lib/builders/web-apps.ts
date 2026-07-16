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

    // 修补漏复制的文件
    this.patchMissingFiles(targetDir);

    // 修补广告拦截冲突（重命名 Analytics.js）
    this.patchAdBlockConflict(targetDir);

    logger.success("Web Apps 复制完成");
    return true;
  }

    /**
     * 修补广告拦截冲突
     *
     * 背景：新版 OnlyOffice 的 RequireJS 路径 `analytics: 'common/Analytics'`
     * 会请求 `.../common/Analytics.js`。广告拦截插件按文件名 `Analytics.js`
     * 命中拦截规则，导致 require 回调永不触发，编辑器无法启动（30s 后超时弹窗）。
     *
     * Analytics 模块本身是死代码（`initialize` 被 `&& false` 屏蔽，
     * `trackEvent` 因 `_gaq` 未定义直接 return），但依赖必须保留可加载——
     * 各 controller 直接调用 `Common.component.Analytics.trackEvent(...)`，
     * 若模块加载失败会导致 `Common.component` 为 undefined 而抛错。
     *
     * 因此本补丁只改"触发拦截的 URL"，不改运行时行为：
     * 1. 重命名文件 `apps/common/Analytics.js` → `apps/common/component-stub.js`
     *    （新名不含 analytics/tracking/ads 等触发词）
     * 2. 重映射各 `app.js` 中的 RequireJS 路径值为 `'common/component-stub'`，
     *    保留别名键 `'analytics'` 与依赖数组不变。
     *
     * 仅修改构建产物，不触碰 submodule 源码；每次 build:onlyoffice 重跑幂等。
     * embed/mobile 变体不受影响——它们的 Analytics 模块已内联进打包 bundle，
     * 构建时 `<script src>` 标签已被 OnlyOffice 流水线剔除。
     */
    private patchAdBlockConflict(targetDir: string): void {
      const oldName = "Analytics.js";
      const newName = "component-stub.js";
      const oldRelative = `apps/common/${oldName}`;
      const newRelative = `apps/common/${newName}`;
      const oldPath = path.join(targetDir, oldRelative);
      const newPath = path.join(targetDir, newRelative);

      // 1. 重命名文件（幂等：源不存在则说明已处理或被移除）
      if (fs.existsSync(oldPath)) {
        // 目标已存在则先删除，避免 rename 覆盖到目录等情况
        if (fs.existsSync(newPath)) {
          fs.rmSync(newPath, { force: true });
        }
        fs.renameSync(oldPath, newPath);
        logger.success(`广告拦截补丁: 重命名 ${oldRelative} → ${newRelative}`);
      } else if (!fs.existsSync(newPath)) {
        logger.warn(`广告拦截补丁: 未找到 ${oldRelative}（可能已被处理或版本变动）`);
      }

      // 2. 重映射各 app.js 的 RequireJS 路径值
      //    匹配 analytics : 'common/Analytics'（含双引号、空格差异）
      const appJsRelatives = [
        "apps/documenteditor/main/app.js",
        "apps/presentationeditor/main/app.js",
        "apps/spreadsheeteditor/main/app.js",
        "apps/pdfeditor/main/app.js",
        "apps/visioeditor/main/app.js",
        "apps/documenteditor/forms/app.js",
      ];

      // 路径值：'common/Analytics' → 'common/component-stub'（保留原引号风格）
      const pathValueRegex = /(analytics\s*:\s*)(['"])common\/Analytics\2/g;

      let patchedCount = 0;
      for (const relative of appJsRelatives) {
        const filePath = path.join(targetDir, relative);
        if (!fs.existsSync(filePath)) {
          logger.debug(`广告拦截补丁: 跳过不存在的文件: ${relative}`);
          continue;
        }

        const content = fs.readFileSync(filePath, "utf-8");
        if (!pathValueRegex.test(content)) {
          // 已是目标路径或无此映射
          pathValueRegex.lastIndex = 0;
          continue;
        }
        pathValueRegex.lastIndex = 0;

        const updated = content.replace(pathValueRegex, `$1$2common/component-stub$2`);
        fs.writeFileSync(filePath, updated);
        patchedCount += 1;
        logger.debug(`广告拦截补丁: 已重映射 ${relative}`);
      }

      if (patchedCount > 0) {
        logger.success(`广告拦截补丁完成，共修补 ${patchedCount} 个 app.js 文件`);
      }
    }

    /** 修补编译时漏复制的文件 */
    private patchMissingFiles(targetDir: string): void {
    const { paths } = this.config;

    // 需要修补的文件列表：[源文件相对路径, 目标文件相对路径]
    const filesToPatch = [
      [
        "apps/common/main/resources/img/doc-formats/formats@2.5x.svg",
        "apps/common/main/resources/img/doc-formats/formats@2.5x.svg",
      ],
    ];

    for (const [srcRelative, destRelative] of filesToPatch) {
      const srcPath = path.join(paths.webApps, srcRelative);
      const destPath = path.join(targetDir, destRelative);

      // 如果目标已存在，跳过
      if (fs.existsSync(destPath)) {
        continue;
      }

      // 如果源文件存在，复制
      if (fs.existsSync(srcPath)) {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.cpSync(srcPath, destPath);
        logger.debug(`已修补: ${destRelative}`);
      }
    }
  }

  /** 清理仓库 */
  cleanup(): void {
    this.git.cleanRepo(this.config.paths.webApps);
  }
}
