/**
 * 插件处理器模块
 * 解压 .plugin 文件并生成 plugins.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { BuildConfig } from "../types.js";
import { logger } from "../logger.js";
import { ensureDir, remove } from "../fs-utils.js";

export class PluginProcessor {
  private config: BuildConfig;

  constructor(config: BuildConfig) {
    this.config = config;
  }

  /** 获取所有 .plugin 文件 */
  private getPluginFiles(): string[] {
    const pluginsDir = path.join(this.config.rootDir, "plugins");
    if (!fs.existsSync(pluginsDir)) {
      return [];
    }

    return fs.readdirSync(pluginsDir)
      .filter((f) => f.endsWith(".plugin"))
      .map((f) => path.join(pluginsDir, f));
  }

  /** 解压单个插件 */
  private extractPlugin(pluginPath: string, targetDir: string): boolean {
    const pluginName = path.basename(pluginPath, ".plugin");
    const extractDir = path.join(targetDir, pluginName);

    // 创建目标目录
    ensureDir(extractDir);

    // 使用 unzip 解压
    const result = spawnSync("unzip", ["-o", "-q", pluginPath, "-d", extractDir], {
      stdio: "pipe",
    });

    if (result.status !== 0) {
      logger.warn(`解压插件失败: ${pluginName}`);
      return false;
    }

    logger.debug(`已解压: ${pluginName}`);
    return true;
  }

  /** 生成 plugins.json */
  private generatePluginsJson(pluginNames: string[]): void {
    const pluginsData = pluginNames.map(
      (name) => `../../../../plugins/${name}/config.json`
    );

    const content = {
      pluginsData,
    };

    const targetPath = path.join(this.config.paths.vendor, "plugins.json");
    fs.writeFileSync(targetPath, JSON.stringify(content, null, 2));
    logger.debug(`已生成: plugins.json`);
  }

  /** 处理插件 */
  process(): boolean {
    const pluginsSourceDir = path.join(this.config.rootDir, "plugins");
    const pluginsTargetDir = path.join(this.config.paths.vendor, "plugins");
    const pluginFiles = this.getPluginFiles();

    // 清理并创建目录
    remove(pluginsTargetDir);
    ensureDir(pluginsTargetDir);

    // 拷贝 v1 目录（如果存在）
    const v1Source = path.join(pluginsSourceDir, "v1");
    if (fs.existsSync(v1Source)) {
      const v1Target = path.join(pluginsTargetDir, "v1");
      fs.cpSync(v1Source, v1Target, { recursive: true });
      logger.debug("已拷贝: v1 目录");
    }

    if (pluginFiles.length === 0) {
      logger.info("未找到 .plugin 文件，跳过插件安装");
      return true;
    }

    logger.info(`安装 ${pluginFiles.length} 个插件...`);

    const extractedPlugins: string[] = [];

    for (const pluginFile of pluginFiles) {
      const pluginName = path.basename(pluginFile, ".plugin");
      if (this.extractPlugin(pluginFile, pluginsTargetDir)) {
        extractedPlugins.push(pluginName);
      }
    }

    // 生成 plugins.json
    if (extractedPlugins.length > 0) {
      this.generatePluginsJson(extractedPlugins);
      logger.success(`插件安装完成: ${extractedPlugins.join(", ")}`);
    }

    return true;
  }
}
