# OnlyOffice WASM Core Kernel

WASM-only OnlyOffice component kernel (front-end black box) designed for React/Vue wrappers. This project loads OnlyOffice `web-apps` via an iframe from `vendor/` and injects a global `window.io` FakeSocket to avoid any backend dependency.

## Requirements

- Node.js 18+
- pnpm 9+
- git (for submodule)

## Quick Start

```bash
git submodule update --init --recursive
pnpm install
pnpm build:onlyoffice
pnpm dev
```

Open the dev server URL shown in the terminal. The demo page loads the OnlyOffice Document Editor and can open a mock `.docx` file.

## Project Structure

```
onlyoffice-core/
├─ submodules/onlyoffice/web-apps/   # OnlyOffice web-apps source (git submodule)
├─ submodules/onlyoffice/sdkjs/      # OnlyOffice sdkjs source (git submodule)
├─ vendor/onlyoffice/web-apps/       # Built runtime assets served by iframe
├─ wasm/x2t/                         # x2t.wasm + x2t.js (Emscripten glue)
├─ src/                              # Core API, bootstrap, fake socket, IO, demo
├─ scripts/build-onlyoffice.ts       # Submodule -> vendor build sync
└─ ...
```

## Core API

```ts
interface OnlyOfficeEditor {
  open(input: File | Blob | ArrayBuffer | string): Promise<void>;
  save(): Promise<Blob>;
  export(format: "pdf" | "docx"): Promise<Blob>;
  destroy(): void;
}

export function createEditor(
  container: HTMLElement,
  options?: { lang?: string }
): OnlyOfficeEditor;
```

## Build OnlyOffice (Black Box)

OnlyOffice is built from the submodule and then synced into `vendor/onlyoffice/web-apps/`.

```bash
pnpm build:onlyoffice
```

Environment overrides (optional):

- `ONLYOFFICE_PM`: `npm` or `yarn` (default: `npm`)
- `ONLYOFFICE_BUILD_OUTPUT`: relative or absolute path to build output directory

## Upgrade OnlyOffice (Official Flow)

1. Update the submodule to the desired tag/commit:

```bash
cd submodules/onlyoffice/web-apps
# Example: tag v9.3.0.67
# git fetch --tags
# git checkout v9.3.0.67
cd ../../
```

2. Rebuild and sync to vendor:

```bash
pnpm build:onlyoffice
```

3. Update the metadata in `package.json` if needed.

## Notes

- The iframe loads only `/vendor/onlyoffice/web-apps/apps/documenteditor/main/index.html`.
- `window.io` is injected before the iframe loads; no socket.io-client dependency is used.
- x2t init is wired through `import initX2T from "./x2t.js"` with `locateFile`.
