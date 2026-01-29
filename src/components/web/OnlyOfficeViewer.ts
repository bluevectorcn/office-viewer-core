import { createEditor } from "../../application/EditorFactory";
import type { DocEditorConfig, IEditor, EditorInput, ExportFormat } from "../../shared/types/EditorTypes";

export class OnlyOfficeViewer extends HTMLElement implements IEditor {
  private editor: IEditor | null = null;
  private _config: DocEditorConfig | null = null;
  private container: HTMLElement;

  constructor() {
    super();
    // Do not use Shadow DOM as DocsAPI requires access to the element by ID
    // this.attachShadow({ mode: "open" });
    this.container = document.createElement("div");
    this.container.style.width = "100%";
    this.container.style.height = "100%";
    this.appendChild(this.container);
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
    // Or we can initialize if we have minimal config
  }

  disconnectedCallback() {
    this.destroy();
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

  public async save(): Promise<Blob> {
    if (!this.editor) {
      throw new Error("Editor not initialized. Call init(config) first.");
    }
    return this.editor.save();
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
