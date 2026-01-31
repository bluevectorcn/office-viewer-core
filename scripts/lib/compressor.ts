/**
 * Brotli 压缩模块
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { logger } from "./logger.js";
import { walkDir, formatSize } from "./fs-utils.js";

/** 需要压缩的文件扩展名 */
const COMPRESSIBLE_EXTENSIONS = [".js", ".css", ".wasm", ".json", ".html", ".svg"];

/** 压缩选项 */
interface CompressOptions {
  /** 最小文件大小（字节），小于此值的文件不压缩 */
  minSize?: number;
  /** Brotli 压缩质量 (0-11) */
  quality?: number;
}

/**
 * 压缩单个文件
 */
function compressFile(filePath: string, quality: number): { original: number; compressed: number } | null {
  try {
    const content = fs.readFileSync(filePath);
    const original = content.length;

    const compressed = zlib.brotliCompressSync(content, {
      params: {
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      },
    });

    fs.writeFileSync(filePath + ".br", compressed);

    return { original, compressed: compressed.length };
  } catch (e) {
    logger.debug(`压缩失败: ${path.basename(filePath)} - ${e}`);
    return null;
  }
}

/**
 * 检查文件是否需要压缩
 */
function shouldCompress(filePath: string, minSize: number): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!COMPRESSIBLE_EXTENSIONS.includes(ext)) return false;

  try {
    const stats = fs.statSync(filePath);
    return stats.size >= minSize;
  } catch {
    return false;
  }
}

/**
 * 压缩目录中的资源文件
 */
export function compressAssets(dir: string, options: CompressOptions = {}): void {
  const { minSize = 1024, quality = 11 } = options;

  if (!fs.existsSync(dir)) {
    logger.warn(`目录不存在: ${dir}`);
    return;
  }

  let totalOriginal = 0;
  let totalCompressed = 0;
  let fileCount = 0;

  for (const { path: filePath, isFile } of walkDir(dir)) {
    if (!isFile) continue;

    // 跳过已压缩的文件
    if (filePath.endsWith(".br") || filePath.endsWith(".gz")) continue;

    if (shouldCompress(filePath, minSize)) {
      const result = compressFile(filePath, quality);
      if (result) {
        totalOriginal += result.original;
        totalCompressed += result.compressed;
        fileCount++;
      }
    }
  }

  if (fileCount > 0) {
    const ratio = ((1 - totalCompressed / totalOriginal) * 100).toFixed(1);
    logger.info(
      `压缩完成: ${fileCount} 个文件, ${formatSize(totalOriginal)} → ${formatSize(totalCompressed)} (节省 ${ratio}%)`
    );
  } else {
    logger.debug("没有需要压缩的文件");
  }
}
