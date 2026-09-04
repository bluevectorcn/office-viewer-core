/**
 * 文件格式嗅探工具
 * 通过分析文件头部魔数（Magic Number）精确判定文件真实格式，
 * 避免因扩展名被错误重命名、无扩展名或 MIME 为 application/octet-stream 导致转码核心解析失败 (code 88)。
 */

export function sniffFormatFromBytes(bytes: Uint8Array, fallbackExt = "docx"): string {
  if (!bytes || bytes.length === 0) return fallbackExt;

  // 1. PDF 文件: %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46    // F
  ) {
    return "pdf";
  }

  // 2. ZIP 格式 (PK\x03\x04): docx, xlsx, pptx, odt, ods, odp
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 && // P
    bytes[1] === 0x4b && // K
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    // 检查是否包含特定子目录标识
    const headerSlice = bytes.subarray(0, Math.min(bytes.length, 4096));
    const headerStr = new TextDecoder("latin1").decode(headerSlice);

    if (headerStr.includes("word/")) return "docx";
    if (headerStr.includes("xl/")) return "xlsx";
    if (headerStr.includes("ppt/")) return "pptx";

    const lowerFallback = fallbackExt.toLowerCase().replace(/^\./, "");
    if (["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(lowerFallback)) {
      return lowerFallback;
    }
    return "docx";
  }

  // 3. OLE 复合文档: \xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1 (.doc, .xls, .ppt)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    const lowerFallback = fallbackExt.toLowerCase().replace(/^\./, "");
    if (["doc", "xls", "ppt"].includes(lowerFallback)) {
      return lowerFallback;
    }
    return "doc";
  }

  // 4. RTF 格式: {\rtf
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x7b &&
    bytes[1] === 0x5c &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x74 &&
    bytes[4] === 0x66
  ) {
    return "rtf";
  }

  return fallbackExt.toLowerCase().replace(/^\./, "");
}
