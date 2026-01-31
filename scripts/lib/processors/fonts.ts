/**
 * 字体处理器模块
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig } from "../types.js";
import { logger } from "../logger.js";
import { ensureDir, remove, copyFile, copyDir } from "../fs-utils.js";

export class FontProcessor {
  private config: BuildConfig;

  constructor(config: BuildConfig) {
    this.config = config;
  }

  /** 检查是否有自定义字体 */
  hasFonts(): boolean {
    const { fonts } = this.config.paths;
    if (!fs.existsSync(fonts)) return false;

    const files = fs.readdirSync(fonts);
    return files.length > 0;
  }

  /** 检查 Docker 是否可用 */
  isDockerAvailable(): boolean {
    const result = spawnSync("docker", ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  }

  /** 处理字体 */
  process(): boolean {
    const { paths, rootDir } = this.config;

    if (!this.hasFonts()) {
      logger.info("fonts 目录为空，跳过字体处理");
      return true;
    }

    if (!this.isDockerAvailable()) {
      logger.warn("Docker 不可用，跳过字体处理");
      return false;
    }

    const tempOut = path.join(rootDir, "temp_fonts_out");
    remove(tempOut);
    ensureDir(tempOut);

    try {
      // 获取当前用户 UID/GID
      const uid = process.getuid ? process.getuid() : 0;
      const gid = process.getgid ? process.getgid() : 0;

      logger.info("使用 Docker 生成字体...");

      const dockerResult = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "--user",
          `${uid}:${gid}`,
          "-v",
          `${paths.fonts}:/fonts`,
          "-v",
          `${tempOut}:/out`,
          "jacktea/allfontsgen:latest",
          "/fonts",
          "/out",
        ],
        { stdio: "inherit" }
      );

      if (dockerResult.status !== 0) {
        logger.error("Docker 字体生成失败");
        return false;
      }

      // 复制生成的文件
      this.copyArtifacts(tempOut);
      logger.success("字体处理完成");
      return true;
    } finally {
      remove(tempOut);
    }
  }

  /** 复制字体生成产物 */
  private copyArtifacts(sourceDir: string): void {
    const { paths } = this.config;
    const sdkjsCommonDir = path.join(paths.vendor, "sdkjs", "common");
    const sdkjsImagesDir = path.join(sdkjsCommonDir, "Images");

    // 1. AllFonts.js, font_selection.bin -> vendor/onlyoffice/sdkjs/common
    for (const file of ["AllFonts.js", "font_selection.bin"]) {
      const src = path.join(sourceDir, file);
      if (fs.existsSync(src)) {
        copyFile(src, path.join(sdkjsCommonDir, file));
        logger.debug(`已复制: ${file}`);
      }
    }

    // 2. font_thumbs/* -> vendor/onlyoffice/sdkjs/common/Images
    const thumbsSrc = path.join(sourceDir, "font_thumbs");
    if (fs.existsSync(thumbsSrc)) {
      ensureDir(sdkjsImagesDir);
      copyDir(thumbsSrc, sdkjsImagesDir);
      logger.debug("已复制: font_thumbs");
    }

    // 3. fonts/* -> vendor/onlyoffice/fonts
    const fontsSrc = path.join(sourceDir, "fonts");
    if (fs.existsSync(fontsSrc)) {
      const fontsTarget = path.join(paths.vendor, "fonts");
      ensureDir(fontsTarget);
      copyDir(fontsSrc, fontsTarget);
      logger.debug("已复制: fonts");
    }
  }
}
