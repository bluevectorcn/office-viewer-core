import { describe, it, expect } from "vitest";
import { sniffFormatFromBytes } from "@/shared/utils/FileFormatSniffer";
import { getAvsCanvasFormat, AvsFileType } from "@/shared/types/EditorTypes";

describe("FileFormatSniffer", () => {
  it("detects PDF magic number", () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(sniffFormatFromBytes(pdfBytes, "docx")).toBe("pdf");
  });

  it("detects docx from zip with word/ directory", () => {
    const zipWord = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...new TextEncoder().encode("some/path/word/document.xml")
    ]);
    expect(sniffFormatFromBytes(zipWord, "unknown")).toBe("docx");
  });

  it("detects xlsx from zip with xl/ directory", () => {
    const zipXl = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...new TextEncoder().encode("some/path/xl/workbook.xml")
    ]);
    expect(sniffFormatFromBytes(zipXl, "docx")).toBe("xlsx");
  });

  it("detects pptx from zip with ppt/ directory", () => {
    const zipPpt = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...new TextEncoder().encode("some/path/ppt/presentation.xml")
    ]);
    expect(sniffFormatFromBytes(zipPpt, "docx")).toBe("pptx");
  });

  it("detects OLE composite document header (.doc / .xls / .ppt)", () => {
    const oleBytes = new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00
    ]);
    expect(sniffFormatFromBytes(oleBytes, "docx")).toBe("doc");
    expect(sniffFormatFromBytes(oleBytes, "xls")).toBe("xls");
  });

  it("detects RTF header", () => {
    const rtfBytes = new Uint8Array([0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31]);
    expect(sniffFormatFromBytes(rtfBytes, "docx")).toBe("rtf");
  });

  it("falls back to provided extension when not matching specific magics", () => {
    const csvBytes = new TextEncoder().encode("a,b,c\n1,2,3");
    expect(sniffFormatFromBytes(csvBytes, "csv")).toBe("csv");
  });
});

describe("getAvsCanvasFormat", () => {
  it("maps word formats to canvas word", () => {
    expect(getAvsCanvasFormat("docx")).toBe(AvsFileType.AVS_FILE_CANVAS_WORD);
    expect(getAvsCanvasFormat("doc")).toBe(AvsFileType.AVS_FILE_CANVAS_WORD);
    expect(getAvsCanvasFormat("txt")).toBe(AvsFileType.AVS_FILE_CANVAS_WORD);
  });

  it("maps spreadsheet formats to canvas spreadsheet", () => {
    expect(getAvsCanvasFormat("xlsx")).toBe(AvsFileType.AVS_FILE_CANVAS_SPREADSHEET);
    expect(getAvsCanvasFormat("xls")).toBe(AvsFileType.AVS_FILE_CANVAS_SPREADSHEET);
    expect(getAvsCanvasFormat("csv")).toBe(AvsFileType.AVS_FILE_CANVAS_SPREADSHEET);
  });

  it("maps presentation formats to canvas presentation", () => {
    expect(getAvsCanvasFormat("pptx")).toBe(AvsFileType.AVS_FILE_CANVAS_PRESENTATION);
    expect(getAvsCanvasFormat("ppt")).toBe(AvsFileType.AVS_FILE_CANVAS_PRESENTATION);
  });

  it("maps pdf format to canvas pdf", () => {
    expect(getAvsCanvasFormat("pdf")).toBe(AvsFileType.AVS_FILE_CANVAS_PDF);
  });
});
