import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const mainPkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf-8"));
const fullVersion = mainPkg.onlyoffice?.version || "9.3.0.1"; // 例如 "9.3.0.67"
const submoduleDir = path.join(rootDir, mainPkg.onlyoffice?.submodule ?? "submodules/onlyoffice/web-apps");
const sdkjsDir = path.join(rootDir, "submodules/onlyoffice/sdkjs");
const vendorDir = path.join(rootDir, "vendor", "onlyoffice", "web-apps");

// 解析版本号逻辑：9.3.0.67 -> version: 9.3.0, build: 67
const versionParts = fullVersion.split(".");
const buildNo = versionParts.pop() || "1";
const productVersion = versionParts.join(".");

function run(command: string, args: string[], cwd: string, extraEnv = {}): number {
  const polyfill = `
    const util = require('util');
    if (!util.isRegExp) util.isRegExp = (obj) => Object.prototype.toString.call(obj) === '[object RegExp]';
    if (!util.isArray) util.isArray = Array.isArray;
  `;
  const polyfillPath = path.join(rootDir, ".polyfill.cjs");
  fs.writeFileSync(polyfillPath, polyfill);

  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...extraEnv,
      npm_config_legacy_peer_deps: "true",
      PRODUCT_VERSION: productVersion,
      BUILD_NUMBER: buildNo,
      NODE_OPTIONS: `--require ${polyfillPath} --openssl-legacy-provider ` + (process.env.NODE_OPTIONS ?? "")
    }
  });

  return result.status ?? 1;
}

function syncSubmodule(dir: string, version: string) {
  if (!version || !fs.existsSync(dir)) return;
  console.log(`Syncing submodule at ${path.relative(rootDir, dir)} to v${version}...`);
  
  // 重置任何可能的修改
  spawnSync("git", ["checkout", "."], { cwd: dir });
  spawnSync("git", ["clean", "-fd"], { cwd: dir });
  
  const tags = [`v${version}`, version];
  let success = false;
  for (const tag of tags) {
    if (spawnSync("git", ["checkout", tag], { cwd: dir }).status === 0) {
      console.log(`Successfully checked out ${tag} in ${path.relative(rootDir, dir)}`);
      success = true;
      break;
    }
  }

  if (!success) {
    console.warn(`Warning: Could not checkout version ${version} in ${path.relative(rootDir, dir)}.`);
  }
}

function patchOnlyOfficeConfigs() {
  // 1. 修复所有 build/*.json 中的版本号
  const buildDir = path.join(submoduleDir, "build");
  if (fs.existsSync(buildDir)) {
    const jsonFiles = fs.readdirSync(buildDir).filter(f => f.endsWith(".json") && f !== "package.json");
    jsonFiles.forEach(file => {
      const filePath = path.join(buildDir, file);
      const config = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (config.version) {
        config.version = productVersion;
        config.build = parseInt(buildNo, 10) || 1;
        fs.writeFileSync(filePath, JSON.stringify(config, null, 4));
      }
    });
  }

  // 2. Webpack 5 ESM 补丁
  const framework7ConfigPath = path.join(submoduleDir, "vendor/framework7-react/build/webpack.config.js");
  if (fs.existsSync(framework7ConfigPath)) {
    let content = fs.readFileSync(framework7ConfigPath, "utf-8");
    if (!content.includes("fullySpecified: false")) {
      // 注入 Webpack 补丁以处理 ESM 路径
      content = content.replace(/(rules:\s*\[)/, "$1 { test: /\\.js$/, resolve: { fullySpecified: false } },");
      content = content.replace(/(test:\s*\/\\\.\(mjs\|js\|jsx\)\\\$\/,)/, "$1 resolve: { fullySpecified: false },");
      fs.writeFileSync(framework7ConfigPath, content);
    }
  }
}

function ensureSubmodule(dir: string) {
  if (!fs.existsSync(dir)) {
    console.error(`Submodule missing at ${dir}. Run git submodule update --init --recursive.`);
    process.exit(1);
  }
}

function findBuildOutput(baseDir: string) {
  const candidates = ["deploy", "build", "dist", "out"];
  for (const candidate of candidates) {
    const resolved = path.join(baseDir, candidate);
    if (!fs.existsSync(resolved)) continue;

    // Web Apps 特征
    if (fs.existsSync(path.join(resolved, "apps/documenteditor/main/index.html"))) return resolved;
    if (fs.existsSync(path.join(resolved, "web-apps/apps/documenteditor/main/index.html"))) return path.join(resolved, "web-apps");

    // SDKJS 特征
    if (fs.existsSync(path.join(resolved, "sdkjs/word/sdk-all.js"))) return path.join(resolved, "sdkjs");
    if (fs.existsSync(path.join(resolved, "sdkjs/cell/sdk-all.js"))) return path.join(resolved, "sdkjs");
    if (fs.existsSync(path.join(resolved, "sdkjs/common/Native/native.js"))) return path.join(resolved, "sdkjs");
  }
  return null;
}

function moveOutput(source: string, target: string) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch (e) {
    // 跨设备移动可能失败，回退到拷贝+删除
    fs.cpSync(source, target, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
}

// --- Main Flow ---

ensureSubmodule(submoduleDir);
ensureSubmodule(sdkjsDir);

syncSubmodule(submoduleDir, fullVersion);
syncSubmodule(sdkjsDir, fullVersion);

patchOnlyOfficeConfigs();

const packageManager = process.env.ONLYOFFICE_PM ?? "pnpm";
let buildExitCode = 0;

try {
  // 1. 显式构建 sdkjs
  const sdkjsBuildDir = path.join(sdkjsDir, "build");
  if (fs.existsSync(sdkjsBuildDir)) {
    console.log(`Installing dependencies for SDKJS in ${sdkjsBuildDir}...`);
    run("npm", ["install"], sdkjsBuildDir);
    console.log("Building OnlyOffice SDKJS...");
    run("npx", ["grunt"], sdkjsBuildDir);
  }

  // 2. 构建 web-apps
  const submoduleBuildDir = path.join(submoduleDir, "build");
  const cwd = fs.existsSync(path.join(submoduleBuildDir, "package.json")) ? submoduleBuildDir : submoduleDir;
  console.log(`Installing dependencies for Web Apps in ${cwd}...`);
  run(packageManager, ["install"], cwd);
  console.log(`Starting Web Apps build. Version: ${productVersion}, Build: ${buildNo}`);
  
  const pkg = JSON.parse(fs.readFileSync(path.join(submoduleBuildDir, "package.json"), "utf8"));
  if (pkg.scripts && pkg.scripts.build) {
    buildExitCode = run(packageManager, ["run", "build"], cwd) || 0;
  } else {
    buildExitCode = run("npx", ["grunt"], cwd);
  }

  // 3. 同步产物到 vendor (要在清理之前！)
  const webAppsBuildOutput = findBuildOutput(submoduleDir);
  if (webAppsBuildOutput) {
      moveOutput(webAppsBuildOutput, vendorDir);
      console.log(`Successfully moved OnlyOffice Web Apps to ${path.relative(rootDir, vendorDir)}`);
  }

  const sdkjsVendorDir = path.join(rootDir, "vendor", "onlyoffice", "sdkjs");
  const sdkjsBuildOutput = findBuildOutput(sdkjsDir);
  if (sdkjsBuildOutput) {
      moveOutput(sdkjsBuildOutput, sdkjsVendorDir);
      console.log(`Successfully moved OnlyOffice SDKJS to ${path.relative(rootDir, sdkjsVendorDir)}`);
  }
} finally {
  console.log("Cleaning up submodules...");
  [submoduleDir, sdkjsDir].forEach(dir => {
    spawnSync("git", ["checkout", "."], { cwd: dir });
    spawnSync("git", ["clean", "-fd"], { cwd: dir });
  });
  const polyfillPath = path.join(rootDir, ".polyfill.cjs");
  if (fs.existsSync(polyfillPath)) fs.unlinkSync(polyfillPath);
}

process.exit(buildExitCode);
