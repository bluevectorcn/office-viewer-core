import { createEditor } from "../../application/EditorFactory";
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat } from "../../shared/types/EditorTypes";

export class OnlyOfficeViewer extends HTMLElement implements IEditor {
  private editor: IEditor | null = null;
  private _config: DocEditorConfig | null = null;
  private container: HTMLElement;
  private mask: HTMLElement;

  constructor() {
    super();
    this.style.display = "block";
    this.style.position = "relative";
    
    this.container = document.createElement("div");
    this.container.style.width = "100%";
    this.container.style.height = "100%";
    this.container.style.position = "relative";
    this.appendChild(this.container);

    // Default Mask
    this.mask = document.createElement("div");
    this.mask.style.cssText = `
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
    this.mask.innerHTML = `
      <div class="oo-loading-spinner" style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: oo-spin 1s linear infinite;"></div>
      <div class="oo-loading-status" style="margin-top: 15px; color: #333; font-weight: 500;">Loading...</div>
      <div class="oo-loading-progress" style="margin-top: 10px; width: 200px; height: 4px; background: #eee; border-radius: 2px; display: none;">
        <div class="oo-loading-bar" style="width: 0%; height: 100%; background: #3498db; border-radius: 2px; transition: width 0.3s;"></div>
      </div>
      <style>
        @keyframes oo-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    `;
    this.appendChild(this.mask);
  }

  static get observedAttributes() {
    return ["assets-prefix"];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === "assets-prefix" && this._config) {
      this._config.assetsPrefix = newValue;
    }
  }

  connectedCallback() {
    // We wait for init() or config setter to initialize the editor
  }

  disconnectedCallback() {
    this.destroy();
  }

  private updateStatus(status: { type: string; message: string; progress?: number }) {
    // Support custom loading element if provided via slot="loading"
    const customLoading = this.querySelector('[slot="loading"]') as HTMLElement;
    
    if (customLoading) {
      if (status.type === 'ready') {
        this.mask.style.display = 'none';
        return;
      }

      this.mask.style.display = 'flex';
      this.mask.style.background = 'transparent';
      
      // Only move the custom loading element into the mask if it's not already there
      if (customLoading.parentElement !== this.mask) {
        // Safe way to clear other children without destroying customLoading if it were already there
        while (this.mask.firstChild) {
          this.mask.removeChild(this.mask.firstChild);
        }
        this.mask.appendChild(customLoading);
      }
      
      // Dispatch event for custom element to handle
      customLoading.dispatchEvent(new CustomEvent('loading-status', { 
        detail: status,
        bubbles: true,
        composed: true
      }));
      return;
    }

    if (status.type === 'ready') {
      this.mask.style.display = 'none';
      return;
    }

    this.mask.style.display = 'flex';
    const statusEl = this.mask.querySelector('.oo-loading-status') as HTMLElement;
    const barContainer = this.mask.querySelector('.oo-loading-progress') as HTMLElement;
    const bar = this.mask.querySelector('.oo-loading-bar') as HTMLElement;

    if (statusEl) statusEl.textContent = status.message;
    
    if (status.progress !== undefined && barContainer && bar) {
      barContainer.style.display = 'block';
      bar.style.width = `${status.progress}%`;
    } else if (barContainer) {
      barContainer.style.display = 'none';
    }

    if (status.type === 'error') {
      const spinner = this.mask.querySelector('.oo-loading-spinner') as HTMLElement;
      if (spinner) spinner.style.display = 'none';
      if (statusEl) statusEl.style.color = '#e74c3c';
    }
  }

  /**
   * Initialize the editor with configuration
   */
  public async init(config: DocEditorConfig): Promise<void> {
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

    this.editor = createEditor(this.container, this._config);
  }

  // IEditor implementation proxies
  
  public async open(input: EditorInput): Promise<void> {
    if (!this.editor) {
      throw new Error("Editor not initialized. Call init(config) first.");
    }
    return this.editor.open(input);
  }

  public async newFile(format: "docx" | "xlsx" | "pptx"): Promise<void> {
    if (!this.editor) {
      throw new Error("Editor not initialized. Call init(config) first.");
    }
    return this.editor.newFile(format);
  }

  public async save(filename?: string): Promise<{ blob: Blob; filename: string }> {
    if (!this.editor) {
      throw new Error("Editor not initialized. Call init(config) first.");
    }
    return this.editor.save(filename);
  }

  public async export(format: ExportFormat): Promise<Blob> {
    if (!this.editor) {
      throw new Error("Editor not initialized. Call init(config) first.");
    }
    return this.editor.export(format);
  }

  public destroy(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  public get editorInstance(): IEditor | null {
    return this.editor;
  }
}

if (!customElements.get("onlyoffice-viewer")) {
  customElements.define("onlyoffice-viewer", OnlyOfficeViewer);
}
