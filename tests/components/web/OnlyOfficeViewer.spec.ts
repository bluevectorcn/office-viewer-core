import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocEditorConfig, IEditor } from "../../../src/shared/types/EditorTypes";

vi.mock("../../../src/application/EditorFactory", () => ({
  createEditor: vi.fn(),
}));

import { createEditor } from "../../../src/application/EditorFactory";
import { OnlyOfficeViewer } from "../../../src/components/web/OnlyOfficeViewer";

const NOT_INITIALIZED_ERROR = "Editor not initialized. Call init(config) first.";

function createMockEditor(): IEditor {
  return {
    open: vi.fn().mockResolvedValue(undefined),
    newFile: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue({
      blob: new Blob(["saved"]),
      filename: "saved.docx",
    }),
    export: vi.fn().mockResolvedValue(new Blob(["exported"])),
    destroy: vi.fn(),
  };
}

describe("OnlyOfficeViewer (web component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("document.createElement('onlyoffice-viewer') should not throw", () => {
    expect(() => document.createElement("onlyoffice-viewer")).not.toThrow();
    const el = document.createElement("onlyoffice-viewer");
    expect(el).toBeInstanceOf(OnlyOfficeViewer);
  });

  it("should allow open(file) after init(config)", async () => {
    const mockEditor = createMockEditor();
    vi.mocked(createEditor).mockReturnValue(mockEditor);

    const el = document.createElement("onlyoffice-viewer") as OnlyOfficeViewer;
    await el.init({ events: {} } as DocEditorConfig);

    const file = new File(["hello"], "demo.docx");
    await expect(el.open(file)).resolves.toBeUndefined();

    expect(createEditor).toHaveBeenCalledTimes(1);
    expect(mockEditor.open).toHaveBeenCalledWith(file);
  });

  it("should not append duplicate DOM children across repeated attach/detach", () => {
    const el = document.createElement("onlyoffice-viewer") as OnlyOfficeViewer;
    const appendChildSpy = vi.spyOn(el, "appendChild");

    document.body.appendChild(el);
    expect(appendChildSpy).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll(".oo-viewer-container")).toHaveLength(1);
    expect(el.querySelectorAll(".oo-loading-mask")).toHaveLength(1);

    document.body.removeChild(el);
    document.body.appendChild(el);

    expect(appendChildSpy).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll(".oo-viewer-container")).toHaveLength(1);
    expect(el.querySelectorAll(".oo-loading-mask")).toHaveLength(1);
  });

  it("should allow re-init and open after remount", async () => {
    const editor1 = createMockEditor();
    const editor2 = createMockEditor();
    vi.mocked(createEditor).mockReturnValueOnce(editor1).mockReturnValueOnce(editor2);

    const el = document.createElement("onlyoffice-viewer") as OnlyOfficeViewer;
    document.body.appendChild(el);

    await el.init({ events: {} } as DocEditorConfig);
    await el.open(new File(["first"], "first.docx"));

    document.body.removeChild(el);
    expect(editor1.destroy).toHaveBeenCalledTimes(1);

    document.body.appendChild(el);
    await el.init({ events: {} } as DocEditorConfig);
    const secondFile = new File(["second"], "second.docx");
    await expect(el.open(secondFile)).resolves.toBeUndefined();

    expect(editor2.open).toHaveBeenCalledWith(secondFile);
  });

  it("should throw stable error messages before init", async () => {
    const el = document.createElement("onlyoffice-viewer") as OnlyOfficeViewer;

    await expect(el.open(new Blob(["x"]))).rejects.toMatchObject({ message: NOT_INITIALIZED_ERROR });
    await expect(el.newFile("docx")).rejects.toMatchObject({ message: NOT_INITIALIZED_ERROR });
    await expect(el.save()).rejects.toMatchObject({ message: NOT_INITIALIZED_ERROR });
    await expect(el.export("pdf")).rejects.toMatchObject({ message: NOT_INITIALIZED_ERROR });
  });
});
