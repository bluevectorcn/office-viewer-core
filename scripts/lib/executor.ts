/**
 * 命令执行器模块
 * 封装 spawnSync，统一环境变量和 polyfill 注入
 */

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig, ExecResult } from "./types.js";
import { logger } from "./logger.js";

/** Node.js util polyfill 内容 */
const POLYFILL_CONTENT = `
const util = require('util');
if (!util.isRegExp) util.isRegExp = (obj) => Object.prototype.toString.call(obj) === '[object RegExp]';
if (!util.isArray) util.isArray = Array.isArray;
`;

export class Executor {
  private polyfillPath: string;
  private productVersion: string;
  private buildNumber: string;

  constructor(config: BuildConfig) {
    this.polyfillPath = path.join(config.rootDir, ".polyfill.cjs");
    this.productVersion = config.version.product;
    this.buildNumber = String(config.version.build);
  }

  /** 创建 polyfill 文件 */
  private ensurePolyfill(): void {
    if (!fs.existsSync(this.polyfillPath)) {
      fs.writeFileSync(this.polyfillPath, POLYFILL_CONTENT);
    }
  }

  /** 清理 polyfill 文件 */
  cleanup(): void {
    if (fs.existsSync(this.polyfillPath)) {
      fs.unlinkSync(this.polyfillPath);
    }
  }

  /**
   * 执行命令
   * @param command 命令
   * @param args 参数
   * @param cwd 工作目录
   * @param options 额外选项
   */
  run(
    command: string,
    args: string[],
    cwd: string,
    options?: {
      /** 额外环境变量 */
      env?: Record<string, string>;
      /** 是否注入构建环境 */
      injectBuildEnv?: boolean;
      /** 是否静默执行 */
      silent?: boolean;
      /** 是否捕获输出 */
      captureOutput?: boolean;
    }
  ): ExecResult {
    const { env = {}, injectBuildEnv = true, silent = false, captureOutput = false } = options || {};

    // 准备 polyfill
    if (injectBuildEnv) {
      this.ensurePolyfill();
    }

    // 构建环境变量
    const processEnv: Record<string, string | undefined> = { ...process.env };

    if (injectBuildEnv) {
      processEnv.PRODUCT_VERSION = this.productVersion;
      processEnv.BUILD_NUMBER = this.buildNumber;
      processEnv.npm_config_legacy_peer_deps = "true";

      const existingNodeOptions = process.env.NODE_OPTIONS ?? "";
      processEnv.NODE_OPTIONS = `--require ${this.polyfillPath} --openssl-legacy-provider ${existingNodeOptions}`;
    }

    // 合并额外环境变量
    Object.assign(processEnv, env);

    const spawnOptions: SpawnSyncOptions = {
      cwd,
      env: processEnv,
      stdio: captureOutput ? "pipe" : silent ? "ignore" : "inherit",
    };

    logger.debug(`执行命令: ${command} ${args.join(" ")}`);
    logger.debug(`工作目录: ${cwd}`);

    const result = spawnSync(command, args, spawnOptions);

    const execResult: ExecResult = {
      exitCode: result.status ?? 1,
      success: result.status === 0,
      stdout: result.stdout?.toString(),
      stderr: result.stderr?.toString(),
    };

    if (!execResult.success && result.error) {
      logger.error(`命令执行失败: ${result.error.message}`);
    }

    return execResult;
  }

  /**
   * 执行命令并在失败时抛出异常
   */
  runOrThrow(
    command: string,
    args: string[],
    cwd: string,
    options?: Parameters<Executor["run"]>[3]
  ): ExecResult {
    const result = this.run(command, args, cwd, options);
    if (!result.success) {
      throw new Error(`Command failed: ${command} ${args.join(" ")} (exit code: ${result.exitCode})`);
    }
    return result;
  }

  /**
   * 执行 npm/pnpm/yarn 命令
   */
  npm(pm: "npm" | "pnpm" | "yarn", args: string[], cwd: string): ExecResult {
    return this.run(pm, args, cwd, { injectBuildEnv: true });
  }

  /**
   * 执行 npx 命令
   */
  npx(args: string[], cwd: string): ExecResult {
    return this.run("npx", args, cwd, { injectBuildEnv: true });
  }
}
