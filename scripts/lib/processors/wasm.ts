/**
 * WASM 处理器模块
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
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
    return fs.existsSync(path.join(x2tPath, "x2t.wasm")) && fs.existsSync(path.join(x2tPath, "x2t.js"));
  }

  /** 下载并解压 x2t WASM */
  private ensureWasm(): void {
    if (this.hasWasm()) {
      return;
    }

    const x2tPath = path.join(this.config.paths.wasm, "x2t");
    const jsPath = path.join(x2tPath, "x2t.js");

    logger.info("x2t.wasm 或 x2t.js 不存在，开始下载...");

    // 确保目录存在
    if (!fs.existsSync(x2tPath)) {
      fs.mkdirSync(x2tPath, { recursive: true });
    }

    const zipPath = path.join(x2tPath, "x2t.zip");
    const url = "https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/download/v7.3%2B1/x2t.zip";

    try {
      // 下载
      execSync(`curl -L -o "${zipPath}" "${url}"`, { stdio: "inherit" });
      logger.info("下载完成，开始解压...");

      // 解压
      execSync(`unzip -o "${zipPath}" -d "${x2tPath}"`, { stdio: "inherit" });

      // 删除压缩包
      fs.rmSync(zipPath, { force: true });

      // 修改 x2t.js
      if (fs.existsSync(jsPath)) {
        let jsContent = fs.readFileSync(jsPath, "utf-8");
        jsContent = jsContent.replace(
          "suffix = new URL(mySrc).search;",
          "suffix = new URL(mySrc, document.baseURI).search;"
        );
        fs.writeFileSync(jsPath, jsContent, "utf-8");
        logger.success("修改 x2t.js 成功");
      }

      logger.success("x2t WASM 下载并处理完成");
    } catch (error) {
      logger.error(`下载或处理 x2t WASM 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** 复制 WASM 文件 */
  copy(): boolean {
    this.ensureWasm();
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
