/**
 * 进度显示模块
 */

import { BuildStep, type StepInfo } from "./types.js";
import { logger } from "./logger.js";

/** 构建步骤定义 */
const STEPS: StepInfo[] = [
  { step: BuildStep.SYNC_REPOS, name: "同步仓库", description: "克隆/更新 OnlyOffice 仓库到指定版本" },
  { step: BuildStep.BUILD_SDKJS, name: "构建 SDKJS", description: "编译 OnlyOffice SDK" },
  { step: BuildStep.BUILD_WEBAPPS, name: "构建 Web Apps", description: "编译 OnlyOffice Web 应用" },
  { step: BuildStep.PROCESS_FONTS, name: "处理字体", description: "使用 Docker 生成字体文件" },
  { step: BuildStep.COPY_WASM, name: "复制 WASM", description: "复制 x2t WASM 文件" },
  { step: BuildStep.INSTALL_PLUGINS, name: "安装插件", description: "解压 .plugin 文件并生成 plugins.json" },
  { step: BuildStep.INSTALL_THEMES, name: "安装主题", description: "生成 themes.json" },
  { step: BuildStep.COMPRESS, name: "压缩资源", description: "Brotli 压缩 JS/CSS/WASM 文件" },
  { step: BuildStep.COPY_SERVICE_WORKER, name: "复制 Service Worker", description: "复制 SW 到 vendor 根目录" },
  { step: BuildStep.CLEANUP, name: "清理", description: "清理子模块和临时文件" },
];

export class ProgressTracker {
  private steps: BuildStep[];
  private currentIndex = 0;
  private startTime: number;
  private stepStartTime: number;

  constructor(steps: BuildStep[]) {
    this.steps = steps;
    this.startTime = Date.now();
    this.stepStartTime = Date.now();
  }

  /** 获取所有步骤数量 */
  get total(): number {
    return this.steps.length;
  }

  /** 获取当前步骤索引（1-based） */
  get current(): number {
    return this.currentIndex + 1;
  }

  /** 开始下一步骤 */
  startStep(step: BuildStep): void {
    const stepInfo = STEPS.find((s) => s.step === step);
    if (!stepInfo) {
      logger.warn(`Unknown step: ${step}`);
      return;
    }

    this.currentIndex = this.steps.indexOf(step);
    this.stepStartTime = Date.now();

    logger.step(this.current, this.total, stepInfo.name);
    logger.debug(stepInfo.description);
  }

  /** 完成当前步骤 */
  endStep(): void {
    const elapsed = Date.now() - this.stepStartTime;
    logger.debug(`步骤完成，耗时 ${formatDuration(elapsed)}`);
  }

  /** 跳过步骤 */
  skipStep(step: BuildStep, reason?: string): void {
    const stepInfo = STEPS.find((s) => s.step === step);
    if (!stepInfo) return;

    this.currentIndex = this.steps.indexOf(step);
    const msg = reason ? `${stepInfo.name} (跳过: ${reason})` : `${stepInfo.name} (跳过)`;
    logger.step(this.current, this.total, msg);
  }

  /** 打印总耗时 */
  finish(success: boolean): void {
    const elapsed = Date.now() - this.startTime;
    logger.separator("═", 50);

    if (success) {
      logger.success(`构建完成！总耗时: ${formatDuration(elapsed)}`);
    } else {
      logger.error(`构建失败！总耗时: ${formatDuration(elapsed)}`);
    }
  }
}

/**
 * 格式化耗时
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * 创建进度跟踪器
 * @param skipFonts 是否跳过字体
 * @param skipCompress 是否跳过压缩
 * @param skipWasm 是否跳过 WASM
 * @param syncOnly 是否只同步
 */
export function createProgressTracker(options: {
  skipFonts?: boolean;
  skipCompress?: boolean;
  skipWasm?: boolean;
  syncOnly?: boolean;
}): ProgressTracker {
  const steps: BuildStep[] = [BuildStep.SYNC_REPOS];

  if (!options.syncOnly) {
    steps.push(BuildStep.BUILD_SDKJS);
    steps.push(BuildStep.BUILD_WEBAPPS);

    if (!options.skipFonts) steps.push(BuildStep.PROCESS_FONTS);
    if (!options.skipWasm) steps.push(BuildStep.COPY_WASM);

    steps.push(BuildStep.COPY_SERVICE_WORKER);

    steps.push(BuildStep.INSTALL_PLUGINS);
    steps.push(BuildStep.INSTALL_THEMES);

    if (!options.skipCompress) steps.push(BuildStep.COMPRESS);

    steps.push(BuildStep.CLEANUP);
  }

  return new ProgressTracker(steps);
}
