/**
 * WASM 处理器模块
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig } from "../types.js";
import { logger } from "../logger.js";
import { copyDir, remove } from "../fs-utils.js";

export class WasmProcessor {
  private config: BuildConfig;

  constructor(config: BuildConfig) {
    this.config = config;
  }

  /** 检查是否有 x2t WASM 文件 */
  hasWasm(): boolean {
    const x2tPath = path.join(this.config.paths.wasm, "x2t");
    return fs.existsSync(x2tPath);
  }

  /** 复制 WASM 文件 */
  copy(): boolean {
    const { paths, rootDir } = this.config;
    const x2tSource = path.join(paths.wasm, "x2t");

    if (!this.hasWasm()) {
      logger.info("未找到 x2t WASM 文件，跳过");
      return true;
    }

    const targetDir = path.join(paths.vendor, "x2t");
    logger.info(`复制 x2t WASM 到 ${path.relative(rootDir, targetDir)}...`);

    // 清理并复制
    remove(targetDir);
    copyDir(x2tSource, targetDir);

    logger.success("WASM 复制完成");
    return true;
  }
}
