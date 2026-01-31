/**
 * 文件系统工具模块
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "./logger.js";

/**
 * 确保目录存在
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 移动目录（支持跨设备）
 */
export function moveDir(source: string, target: string): void {
  // 确保目标父目录存在
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // 删除目标（如果存在）
  fs.rmSync(target, { recursive: true, force: true });

  try {
    // 尝试重命名（同一设备上更快）
    fs.renameSync(source, target);
  } catch {
    // 跨设备移动：复制后删除
    fs.cpSync(source, target, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

/**
 * 复制目录
 */
export function copyDir(source: string, target: string, options?: { force?: boolean }): void {
  const { force = true } = options || {};

  if (!fs.existsSync(source)) {
    logger.warn(`源目录不存在: ${source}`);
    return;
  }

  ensureDir(target);
  fs.cpSync(source, target, { recursive: true, force });
}

/**
 * 复制文件
 */
export function copyFile(source: string, target: string): void {
  if (!fs.existsSync(source)) {
    logger.warn(`源文件不存在: ${source}`);
    return;
  }

  ensureDir(path.dirname(target));
  fs.cpSync(source, target, { force: true });
}

/**
 * 删除目录或文件
 */
export function remove(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * 查找构建输出目录
 * 支持 deploy, build, dist, out 等常见目录名
 */
export function findBuildOutput(baseDir: string, type: "webApps" | "sdkjs"): string | null {
  const candidates = ["deploy", "build", "dist", "out"];

  for (const candidate of candidates) {
    const resolved = path.join(baseDir, candidate);
    if (!fs.existsSync(resolved)) continue;

    if (type === "webApps") {
      // Web Apps 特征文件
      if (fs.existsSync(path.join(resolved, "apps/documenteditor/main/index.html"))) {
        return resolved;
      }
      if (fs.existsSync(path.join(resolved, "web-apps/apps/documenteditor/main/index.html"))) {
        return path.join(resolved, "web-apps");
      }
    } else if (type === "sdkjs") {
      // SDKJS 特征文件
      const sdkjsPath = path.join(resolved, "sdkjs");
      if (fs.existsSync(path.join(resolved, "sdkjs/word/sdk-all.js"))) {
        return sdkjsPath;
      }
      if (fs.existsSync(path.join(resolved, "sdkjs/cell/sdk-all.js"))) {
        return sdkjsPath;
      }
      if (fs.existsSync(path.join(resolved, "sdkjs/common/Native/native.js"))) {
        return sdkjsPath;
      }
    }
  }

  return null;
}

/**
 * 遍历目录中的所有文件
 */
export function walkDir(dir: string): Array<{ path: string; isFile: boolean }> {
  const results: Array<{ path: string; isFile: boolean }> = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push({ path: fullPath, isFile: false });
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push({ path: fullPath, isFile: true });
    }
  }

  return results;
}

/**
 * 获取目录大小（字节）
 */
export function getDirSize(dir: string): number {
  let size = 0;

  for (const { path: filePath, isFile } of walkDir(dir)) {
    if (isFile) {
      try {
        const stats = fs.statSync(filePath);
        size += stats.size;
      } catch {
        // 忽略无法访问的文件
      }
    }
  }

  return size;
}

/**
 * 格式化文件大小
 */
export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
