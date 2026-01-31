/**
 * Git 操作模块
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "./logger.js";

export class GitOperations {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /**
   * 克隆指定 tag 到目录
   * @param repoUrl 仓库 URL
   * @param targetDir 目标目录
   * @param tag Git tag
   */
  cloneTag(repoUrl: string, targetDir: string, tag: string): boolean {
    const parentDir = path.dirname(targetDir);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    logger.info(`克隆 ${repoUrl} 到 ${path.relative(this.rootDir, targetDir)} (tag: ${tag})...`);

    const result = spawnSync("git", ["clone", "--depth", "1", "--branch", tag, repoUrl, targetDir], {
      stdio: "inherit",
    });

    if (result.status !== 0) {
      logger.error(`克隆失败: ${repoUrl} at ${tag}`);
      return false;
    }

    logger.success(`克隆完成: ${path.basename(targetDir)}`);
    return true;
  }

  /**
   * 获取当前所在的 tag
   */
  getCurrentTag(repoDir: string): string | null {
    const result = spawnSync("git", ["describe", "--tags", "--exact-match"], {
      cwd: repoDir,
      encoding: "utf-8",
    });

    if (result.status === 0 && result.stdout) {
      return result.stdout.trim();
    }
    return null;
  }

  /**
   * 检出到指定 tag
   */
  checkoutTag(repoDir: string, tag: string): boolean {
    const relativePath = path.relative(this.rootDir, repoDir);

    // 检查是否已在该 tag
    const currentTag = this.getCurrentTag(repoDir);
    if (currentTag === tag) {
      logger.info(`${relativePath} 已在 ${tag}`);
      return true;
    }

    logger.info(`更新 ${relativePath} 到 ${tag}...`);

    // 获取 tag
    spawnSync("git", ["fetch", "--tags", "--depth", "1", "origin", tag], {
      cwd: repoDir,
    });

    // 重置工作区
    spawnSync("git", ["checkout", "."], { cwd: repoDir });
    spawnSync("git", ["clean", "-fd"], { cwd: repoDir });

    // 检出 tag
    const result = spawnSync("git", ["checkout", tag], { cwd: repoDir });

    if (result.status !== 0) {
      logger.warn(`无法检出 ${tag} in ${relativePath}`);
      return false;
    }

    logger.success(`成功检出 ${tag} in ${relativePath}`);
    return true;
  }

  /**
   * 同步仓库到指定版本
   * 如果目录不存在则克隆，否则检出到指定 tag
   */
  syncRepo(repoUrl: string, targetDir: string, tag: string): boolean {
    if (!fs.existsSync(targetDir)) {
      return this.cloneTag(repoUrl, targetDir, tag);
    }
    return this.checkoutTag(targetDir, tag);
  }

  /**
   * 清理仓库（重置所有更改）
   */
  cleanRepo(repoDir: string): void {
    if (!fs.existsSync(repoDir)) return;

    const relativePath = path.relative(this.rootDir, repoDir);
    logger.debug(`清理仓库: ${relativePath}`);

    spawnSync("git", ["checkout", "."], { cwd: repoDir });
    spawnSync("git", ["clean", "-fd"], { cwd: repoDir });
  }
}
