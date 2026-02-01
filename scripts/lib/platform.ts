/**
 * 跨平台工具模块
 * 提供跨 macOS、Windows、Linux 的兼容方法
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { logger } from "./logger.js";

/** 获取当前操作系统类型 */
export type Platform = "windows" | "macos" | "linux";

export function getPlatform(): Platform {
  const platform = os.platform();
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/** 检查是否是 Windows */
export function isWindows(): boolean {
  return os.platform() === "win32";
}

/**
 * 跨平台解压 ZIP 文件
 * - Windows: 使用 PowerShell Expand-Archive
 * - macOS/Linux: 使用 unzip 命令
 */
export function extractZip(zipPath: string, targetDir: string): boolean {
  try {
    if (!fs.existsSync(zipPath)) {
      logger.error(`ZIP 文件不存在: ${zipPath}`);
      return false;
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let result;

    if (isWindows()) {
      // Windows: 使用 PowerShell
      result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${targetDir}" -Force`,
        ],
        { stdio: "pipe" }
      );
    } else {
      // macOS/Linux: 使用 unzip
      result = spawnSync("unzip", ["-o", "-q", zipPath, "-d", targetDir], {
        stdio: "pipe",
      });
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() || "";
      logger.debug(`解压错误: ${stderr}`);
      return false;
    }

    return true;
  } catch (e) {
    logger.error(`解压失败: ${e}`);
    return false;
  }
}

/**
 * 转换路径为 Docker 挂载格式
 * Windows 上需要将 C:\path 转换为 /c/path
 */
export function toDockerPath(hostPath: string): string {
  if (!isWindows()) {
    return hostPath;
  }

  // C:\Users\xxx -> /c/Users/xxx
  const normalized = hostPath.replace(/\\/g, "/");
  const match = normalized.match(/^([a-zA-Z]):(.*)/);
  if (match) {
    return `/${match[1].toLowerCase()}${match[2]}`;
  }
  return normalized;
}

/**
 * 获取用户 UID/GID（仅 Unix 系统）
 * Windows 上返回 0
 */
export function getUserIds(): { uid: number; gid: number } {
  if (isWindows()) {
    return { uid: 0, gid: 0 };
  }
  return {
    uid: process.getuid?.() ?? 0,
    gid: process.getgid?.() ?? 0,
  };
}

/**
 * 获取 Docker 用户参数
 * Windows 上不需要指定 --user
 */
export function getDockerUserArgs(): string[] {
  if (isWindows()) {
    return [];
  }
  const { uid, gid } = getUserIds();
  return ["--user", `${uid}:${gid}`];
}
