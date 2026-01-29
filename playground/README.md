# Office Viewer Core Playground

This playground demonstrates the usage of the `office-viewer-core` library via the UMD build.

## Prerequisites

1.  **Dependencies**: Ensure `react`, `react-dom`, and `vue` global scripts are loaded (already included in `index.html` via CDN).
2.  **Static Assets**: The `office-viewer-core` relies on WASM and other static files being served at a specific path (default `/vendor/onlyoffice`).

## How to Run

1.  **Build the Library**:
    Generate the `dist-lib` folder.
    ```bash
    pnpm build:lib
    ```

2.  **Build Static Assets**:
    Ensure `vendor/` is populated.
    ```bash
    pnpm build:onlyoffice
    ```

3.  **Run the Playground**:
    The project requires specific HTTP headers (COOP/COEP) for WASM support, which are handled by the Vite configuration.
    
    Run the following command from the project root:
    ```bash
    pnpm dev:playground
    ```
    
    Then open your browser to:
    - Main Menu: `http://localhost:5173/playground/index.html`
    - Web Component: `http://localhost:5173/playground/web.html`
    - React: `http://localhost:5173/playground/react.html`
    - Vue: `http://localhost:5173/playground/vue.html`

## Usage in Code

See `index.html` source code for how `window.OfficeViewerCore` is used.
