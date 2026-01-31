/**
 * 主题处理器模块
 * 生成 themes.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildConfig } from "../types.js";
import { logger } from "../logger.js";

export class ThemeProcessor {
  private config: BuildConfig;

  constructor(config: BuildConfig) {
    this.config = config;
  }

  /** 生成 themes.json */
  process(): boolean {
    const content = {
      themes: [
        {
          themes: [],
        },
      ],
    };

    const targetPath = path.join(this.config.paths.vendor, "themes.json");
    fs.writeFileSync(targetPath, JSON.stringify(content, null, 2));

    logger.success("themes.json 已创建");
    return true;
  }
}
