/**
 * 彩色日志工具
 * 使用 ANSI 转义码，无外部依赖
 */

import type { LogLevel } from "./types.js";

// ANSI 颜色代码
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // 前景色
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

// 日志级别配置
const levelConfig: Record<LogLevel, { color: string; prefix: string }> = {
  debug: { color: colors.gray, prefix: "🔍" },
  info: { color: colors.blue, prefix: "ℹ️ " },
  success: { color: colors.green, prefix: "✅" },
  warn: { color: colors.yellow, prefix: "⚠️ " },
  error: { color: colors.red, prefix: "❌" },
};

export class Logger {
  private quiet = false;
  private debugMode = false;

  constructor(options?: { quiet?: boolean; debug?: boolean }) {
    this.quiet = options?.quiet ?? false;
    this.debugMode = options?.debug ?? false;
  }

  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
  }

  setDebug(debug: boolean): void {
    this.debugMode = debug;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const config = levelConfig[level];
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    return `${colors.dim}[${timestamp}]${colors.reset} ${config.prefix} ${config.color}${message}${colors.reset}`;
  }

  private log(level: LogLevel, message: string): void {
    if (this.quiet && level !== "error") return;
    if (level === "debug" && !this.debugMode) return;

    const formatted = this.formatMessage(level, message);
    if (level === "error") {
      console.error(formatted);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string): void {
    this.log("debug", message);
  }

  info(message: string): void {
    this.log("info", message);
  }

  success(message: string): void {
    this.log("success", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  error(message: string): void {
    this.log("error", message);
  }

  /** 打印分隔线 */
  separator(char = "─", length = 50): void {
    if (this.quiet) return;
    console.log(colors.dim + char.repeat(length) + colors.reset);
  }

  /** 打印标题 */
  title(message: string): void {
    if (this.quiet) return;
    console.log();
    console.log(`${colors.bold}${colors.cyan}▶ ${message}${colors.reset}`);
    this.separator();
  }

  /** 打印步骤 */
  step(current: number, total: number, message: string): void {
    if (this.quiet) return;
    const progress = `[${current}/${total}]`;
    console.log(`${colors.bold}${colors.magenta}${progress}${colors.reset} ${message}`);
  }

  /** 打印键值对 */
  keyValue(key: string, value: string): void {
    if (this.quiet) return;
    console.log(`  ${colors.dim}${key}:${colors.reset} ${value}`);
  }
}

/** 全局日志实例 */
export const logger = new Logger();
