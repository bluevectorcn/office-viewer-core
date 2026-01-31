#!/usr/bin/env npx tsx
/**
 * 测试插件和主题处理器
 * 用法: npx tsx scripts/test-plugins-themes.ts
 */

import { loadConfig } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { PluginProcessor } from "./lib/processors/plugins.js";
import { ThemeProcessor } from "./lib/processors/themes.js";
import { ensureDir } from "./lib/fs-utils.js";

const rootDir = process.cwd();
const config = loadConfig(rootDir, { debug: true });

// 确保 vendor 目录存在
ensureDir(config.paths.vendor);

logger.title("测试插件处理器");
const pluginProcessor = new PluginProcessor(config);
pluginProcessor.process();

logger.title("测试主题处理器");
const themeProcessor = new ThemeProcessor(config);
themeProcessor.process();

logger.success("测试完成！");
