import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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
  
  // 获取最新代码和标签
  spawnSync("git", ["fetch", "--all", "--tags", "--force"], { cwd: dir });
  
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

function processFonts() {
  const fontsSource = path.join(rootDir, "fonts");
  if (!fs.existsSync(fontsSource) || fs.readdirSync(fontsSource).length === 0) {
    console.log("No custom fonts found in 'fonts' directory. Skipping font generation.");
    return;
  }

  console.log("Processing custom fonts...");
  const tempOut = path.join(rootDir, "temp_fonts_out");
  fs.rmSync(tempOut, { recursive: true, force: true });
  fs.mkdirSync(tempOut);

  try {
    const uid = process.getuid ? process.getuid() : 0;
    const gid = process.getgid ? process.getgid() : 0;

    console.log("Running Docker container for font generation...");
    // 假设 docker 在 PATH 中
    const dockerResult = spawnSync("docker", [
      "run", "--rm",
      "--user", `${uid}:${gid}`,
      "-v", `${fontsSource}:/fonts`,
      "-v", `${tempOut}:/out`,
      "jacktea/allfontsgen:latest",
      "/fonts", "/out"
    ], { stdio: "inherit" });

    if (dockerResult.status !== 0) {
      console.error("Docker font generation failed.");
      // 不中断构建，只是打印错误？或者应该抛出异常？
      // 根据用户需求，这里应该是一个重要步骤，但如果没有docker可能应该警告。
      // 为了安全起见，我们打印错误但不 crash 整个 build，除非 strict mode。
      // 这里选择打印错误。
    } else {
      console.log("Fonts generated successfully. Copying artifacts...");

      const sdkjsCommonDir = path.join(rootDir, "vendor", "onlyoffice", "sdkjs", "common");
      const sdkjsImagesDir = path.join(sdkjsCommonDir, "Images");
      const onlyofficeDir = path.join(rootDir, "vendor", "onlyoffice");

      // 1. AllFonts.js, font_selection.bin -> vendor/onlyoffice/sdkjs/common
      ["AllFonts.js", "font_selection.bin"].forEach(file => {
        const src = path.join(tempOut, file);
        if (fs.existsSync(src)) {
           fs.cpSync(src, path.join(sdkjsCommonDir, file), { force: true });
        }
      });
      
      // 2. font_thumbs/* -> vendor/onlyoffice/sdkjs/common/Images
      const thumbsSrc = path.join(tempOut, "font_thumbs");
      if (fs.existsSync(thumbsSrc)) {
         fs.cpSync(thumbsSrc, sdkjsImagesDir, { recursive: true, force: true });
      }

      // 3. fonts/* -> vendor/onlyoffice
      // 注意：输出目录里的 fonts 是一个目录，要在 vendor/onlyoffice 下也叫 fonts
      const fontsDstSrc = path.join(tempOut, "fonts");
      if (fs.existsSync(fontsDstSrc)) {
        // 如果目标存在，先清理还是合并？cpSync 默认是 overwrite file，但不会删除多余文件。
        // 这里假设是合并或覆盖。
        const fontsTarget = path.join(onlyofficeDir, "fonts");
        fs.mkdirSync(fontsTarget, { recursive: true });
        fs.cpSync(fontsDstSrc, fontsTarget, { recursive: true, force: true });
      }
    }
  } finally {
    fs.rmSync(tempOut, { recursive: true, force: true });
  }
}

function copyWasm() {
  const wasmX2tSource = path.join(rootDir, "wasm", "x2t");
  if (!fs.existsSync(wasmX2tSource)) return;

  console.log("Copying x2t WASM files...");
  const targetDir = path.join(rootDir, "vendor", "onlyoffice", "x2t"); // 假设放在 vendor/onlyoffice/x2t
  fs.rmSync(targetDir, { recursive: true, force: true });
  
  // 按照用户指令：把目录wasm下的x2t,拷贝到 vendor/onlyoffice 目录下。
  // 这意味着 vendor/onlyoffice 下会有一个 x2t 目录。
  fs.cpSync(wasmX2tSource, targetDir, { recursive: true });
}

function compressAssets(dir: string) {
  if (!fs.existsSync(dir)) return;
  
  console.log(`Compressing assets in ${path.relative(rootDir, dir)}...`);
  const files = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      compressAssets(fullPath);
    } else if (file.isFile()) {
       if (/\.(js|css|wasm)$/.test(file.name)) {
         try {
           const content = fs.readFileSync(fullPath);
           const compressed = zlib.brotliCompressSync(content, {
             params: {
               [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
               [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
             }
           });
           fs.writeFileSync(fullPath + ".br", compressed);
         } catch (e) {
           console.error(`Failed to compress ${file.name}:`, e);
         }
       }
    }
  }
}

const packageManager = process.env.ONLYOFFICE_PM ?? "pnpm";
let buildExitCode = 0;

try {
  // 0. 清理 vendor/onlyoffice
  console.log("Cleaning up vendor/onlyoffice...");
  const onlyofficeVendorPath = path.join(rootDir, "vendor", "onlyoffice");
  fs.rmSync(onlyofficeVendorPath, { recursive: true, force: true });

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

  // 4. 处理字体、WASM 和 压缩
  processFonts();
  copyWasm();
  
  // 5. 复制 Service Worker
  const swSource = path.join(rootDir, "vendor", "onlyoffice", "sdkjs", "common", "serviceworker", "document_editor_service_worker.js");
  const swTarget = path.join(rootDir, "vendor", "onlyoffice", "document_editor_service_worker.js");
  if (fs.existsSync(swSource)) {
    console.log("Copying Service Worker...");
    fs.cpSync(swSource, swTarget, { force: true });
  } else {
    console.warn(`Warning: Service Worker not found at ${swSource}`);
  }
  
  const onlyofficeVendorRoot = path.join(rootDir, "vendor", "onlyoffice");
  if (fs.existsSync(onlyofficeVendorRoot)) {
    compressAssets(onlyofficeVendorRoot);
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
