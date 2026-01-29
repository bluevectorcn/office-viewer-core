import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import dts from "vite-plugin-dts";

import fs from "node:fs";

const pkgPath = path.join(__dirname, "package.json");
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
  plugins: [
    react(),
    vue(),
    dts({
      include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        react: path.resolve(__dirname, "src/react.ts"),
        vue: path.resolve(__dirname, "src/vue.ts"),
        'web-component': path.resolve(__dirname, "src/web-component.ts"),
      },
      name: "OnlyOfficeCore",
      fileName: (format, entryName) => `${entryName}.${format}.js`,
    },
    rollupOptions: {
      external: ["react", "react-dom", "vue"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          vue: "Vue",
        },
      },
    },
    emptyOutDir: false,
    outDir: "dist-lib",
  },
});
