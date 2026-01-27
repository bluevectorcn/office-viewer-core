import { defineConfig } from "vite";
import path from "node:path";
import fs from "node:fs";

const rootDir = path.resolve(__dirname);
const staticDirs = [
  { route: "/vendor", dir: path.join(rootDir, "vendor") },
];

const mimeTypes: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
  ".xml": "application/xml",
  ".ico": "image/x-icon",
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext) return mimeTypes[ext] ?? "application/octet-stream";
  
  // OnlyOffice 字体文件通常没有扩展名 (例如 077)
  if (filePath.includes("/fonts/")) return "font/ttf";
  
  return "application/octet-stream";
}

function createStaticMiddleware(root: string, route: string) {
  const normalizedRoute = route.replace(/\/+$/, "");
  return (req: { url?: string }, res: any, next: () => void) => {
    if (!req.url) return next();
    const rawPath = req.url.split("?")[0];
    let urlPath = "/";
    try {
      urlPath = decodeURIComponent(rawPath);
    } catch {
      return next();
    }

    if (normalizedRoute && urlPath.startsWith(normalizedRoute)) {
      urlPath = urlPath.slice(normalizedRoute.length) || "/";
      if (urlPath.startsWith("/")) {
        urlPath = urlPath.slice(1);
      }
    }

    const resolved = path.normalize(path.join(root, urlPath));
    if (!resolved.startsWith(root)) return next();

    let target = resolved;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, "index.html");
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return next();

    // 设置必要的 Header，特别是 COOP/COEP 以支持 SharedArrayBuffer
    res.setHeader("Content-Type", getContentType(target));
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "X-Requested-With, content-type, Authorization");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cache-Control", "no-cache");

    fs.createReadStream(target).pipe(res);
  };
}

function staticCopyPlugin() {
  return {
    name: "onlyoffice-static-copy",
    configureServer(server: any) {
      for (const entry of staticDirs) {
        server.middlewares.use(entry.route, createStaticMiddleware(entry.dir, entry.route));
      }
    },
    closeBundle() {
      const outDir = path.join(rootDir, "dist");
      for (const entry of staticDirs) {
        const dest = path.join(outDir, entry.route.replace(/^\//, ""));
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(entry.dir, dest, { recursive: true });
      }
    },
  };
}

const pkgPath = path.join(rootDir, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const fullVersion = pkg.onlyoffice?.version || "9.3.0.1";
const versionParts = fullVersion.split(".");
const buildNo = versionParts.pop() || "1";
const productVersion = versionParts.join(".");

export default defineConfig({
  define: {
    __ONLYOFFICE_VERSION__: JSON.stringify(productVersion),
    __ONLYOFFICE_BUILD_NUMBER__: parseInt(buildNo, 10),
  },
  server: {
    port: 5173,
    host: true,
    fs: {
      allow: [rootDir, path.join(rootDir, "vendor")],
    },
    // 为开发服务器添加全局 Header
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Access-Control-Allow-Origin": "*",
    },
  },
  plugins: [staticCopyPlugin()],
});
