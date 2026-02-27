import { createEditor } from "../../application/EditorFactory";
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat } from "../../shared/types/EditorTypes";

export class OnlyOfficeViewer extends HTMLElement implements IEditor {
  private static readonly NOT_INITIALIZED_ERROR = "Editor not initialized. Call init(config) first.";

  private editor: IEditor | null = null;
  private _config: DocEditorConfig | null = null;
  private container: HTMLElement | null = null;
  private mask: HTMLElement | null = null;

  constructor() {
    super();
  }

  static get observedAttributes() {
    return ["assets-prefix"];
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
    if (name === "assets-prefix" && this._config) {
      this._config.assetsPrefix = newValue ?? undefined;
    }
  }

  connectedCallback() {
    this.ensureDom();
  }

  disconnectedCallback() {
    this.destroy();
  }

  private ensureDom(): void {
    this.style.display = "block";
    this.style.position = "relative";

    if (!this.container) {
      this.container = document.createElement("div");
      this.container.className = "oo-viewer-container";
      this.container.style.width = "100%";
      this.container.style.height = "100%";
      this.container.style.position = "relative";
    }
    if (!this.contains(this.container)) {
      this.appendChild(this.container);
    }

    if (!this.mask) {
      this.mask = this.createMaskElement();
    }
    if (!this.contains(this.mask)) {
      this.appendChild(this.mask);
    }
  }

  private createMaskElement(): HTMLElement {
    const mask = document.createElement("div");
    mask.className = "oo-loading-mask";
    mask.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 100;
      font-family: sans-serif;
    `;
    this.ensureDefaultMaskContent(mask);
    return mask;
  }

  private ensureDefaultMaskContent(mask: HTMLElement): void {
    if (mask.querySelector(".oo-loading-status")) {
      return;
    }
    mask.innerHTML = `
      <div class="oo-loading-spinner" style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: oo-spin 1s linear infinite;"></div>
      <div class="oo-loading-status" style="margin-top: 15px; color: #333; font-weight: 500;">Loading...</div>
      <div class="oo-loading-progress" style="margin-top: 10px; width: 200px; height: 4px; background: #eee; border-radius: 2px; display: none;">
        <div class="oo-loading-bar" style="width: 0%; height: 100%; background: #3498db; border-radius: 2px; transition: width 0.3s;"></div>
      </div>
      <style>
        @keyframes oo-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    `;
  }

  private updateStatus(status: { type: string; message: string; progress?: number }) {
    this.ensureDom();
    const mask = this.mask;
    if (!mask) {
      return;
    }

    // Support custom loading element if provided via slot="loading"
    const customLoading = this.querySelector('[slot="loading"]') as HTMLElement | null;
    
    if (customLoading) {
      if (status.type === 'ready') {
        mask.style.display = 'none';
        return;
      }

      mask.style.display = 'flex';
      mask.style.background = 'transparent';
      
      // Only move the custom loading element into the mask if it's not already there
      if (customLoading.parentElement !== mask) {
        // Safe way to clear other children without destroying customLoading if it were already there
        while (mask.firstChild) {
          mask.removeChild(mask.firstChild);
        }
        mask.appendChild(customLoading);
      }
      
      // Dispatch event for custom element to handle
      customLoading.dispatchEvent(new CustomEvent('loading-status', { 
        detail: status,
        bubbles: true,
        composed: true
      }));
      return;
    }

    this.ensureDefaultMaskContent(mask);

    if (status.type === 'ready') {
      mask.style.display = 'none';
      return;
    }

    mask.style.display = 'flex';
    mask.style.background = 'rgba(255, 255, 255, 0.9)';
    const statusEl = mask.querySelector('.oo-loading-status') as HTMLElement | null;
    const barContainer = mask.querySelector('.oo-loading-progress') as HTMLElement | null;
    const bar = mask.querySelector('.oo-loading-bar') as HTMLElement | null;
    const spinner = mask.querySelector('.oo-loading-spinner') as HTMLElement | null;

    if (statusEl) statusEl.textContent = status.message;
    if (statusEl) statusEl.style.color = '#333';
    if (spinner) spinner.style.display = 'block';
    
    if (status.progress !== undefined && barContainer && bar) {
      barContainer.style.display = 'block';
      bar.style.width = `${status.progress}%`;
    } else if (barContainer) {
      barContainer.style.display = 'none';
    }

    if (status.type === 'error') {
      if (spinner) spinner.style.display = 'none';
      if (statusEl) statusEl.style.color = '#e74c3c';
    }
  }

  /**
   * Initialize the editor with configuration
   */
  public async init(config: DocEditorConfig): Promise<void> {
    this.ensureDom();
    this.destroy(); // Cleanup existing if any
    this._config = config;
    
    // Apply attributes if not in config
    const attrPrefix = this.getAttribute("assets-prefix");
    if (attrPrefix && !this._config.assetsPrefix) {
      this._config.assetsPrefix = attrPrefix;
    }

    const originalOnLoadingStatus = this._config.events?.onLoadingStatus;
    
    if (!this._config.events) this._config.events = {};
    
    this._config.events.onLoadingStatus = (status) => {
      this.updateStatus(status);
      originalOnLoadingStatus?.(status);
    };

    if (!this.container) {
      throw new Error("Viewer container is unavailable.");
    }
    this.editor = createEditor(this.container, this._config);
  }

  // IEditor implementation proxies
  private getEditorOrThrow(): IEditor {
    if (!this.editor) {
      throw new Error(OnlyOfficeViewer.NOT_INITIALIZED_ERROR);
    }
    return this.editor;
  }
  
  public async open(input: EditorInput): Promise<void> {
    return this.getEditorOrThrow().open(input);
  }

  public async newFile(format: "docx" | "xlsx" | "pptx"): Promise<void> {
    return this.getEditorOrThrow().newFile(format);
  }

  public async save(filename?: string): Promise<{ blob: Blob; filename: string }> {
    return this.getEditorOrThrow().save(filename);
  }

  public async export(format: ExportFormat): Promise<Blob> {
    return this.getEditorOrThrow().export(format);
  }

  public destroy(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    this._config = null;

    if (this.mask) {
      this.mask.style.display = "none";
      this.mask.style.background = "rgba(255, 255, 255, 0.9)";
    }
  }

  public get editorInstance(): IEditor | null {
    return this.editor;
  }
}

if (!customElements.get("onlyoffice-viewer")) {
  customElements.define("onlyoffice-viewer", OnlyOfficeViewer);
}
