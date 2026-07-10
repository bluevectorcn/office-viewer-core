package utils

import (
	"path/filepath"
	"strings"
)

// MimeToExt 将 MIME 类型映射为已知的文件后缀名
func MimeToExt(mimeType string) string {
	parts := strings.Split(mimeType, ";")
	mime := strings.TrimSpace(strings.ToLower(parts[0]))

	switch mime {
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return ".docx"
	case "application/msword":
		return ".doc"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return ".xlsx"
	case "application/vnd.ms-excel":
		return ".xls"
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return ".pptx"
	case "application/vnd.ms-powerpoint":
		return ".ppt"
	case "application/pdf":
		return ".pdf"
	case "application/vnd.oasis.opendocument.text":
		return ".odt"
	case "application/vnd.oasis.opendocument.spreadsheet":
		return ".ods"
	case "application/vnd.oasis.opendocument.presentation":
		return ".odp"
	case "text/csv":
		return ".csv"
	case "text/plain":
		return ".txt"
	case "text/rtf", "application/rtf":
		return ".rtf"
	case "application/epub+zip":
		return ".epub"
	default:
		return ""
	}
}

// InferDocumentType 推断文档大类
func InferDocumentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".docx", ".doc", ".odt", ".txt", ".rtf":
		return "word"
	case ".xlsx", ".xls", ".ods", ".csv":
		return "cell"
	case ".pptx", ".ppt", ".odp":
		return "slide"
	case ".pdf":
		return "pdf"
	default:
		return "word"
	}
}

// IsSupportedExtension 检查后缀是否为 OnlyOffice 支持 of 已知格式
func IsSupportedExtension(ext string) bool {
	normalized := strings.ToLower(strings.TrimPrefix(ext, "."))
	supported := map[string]bool{
		"docx": true, "doc": true, "odt": true, "txt": true, "rtf": true,
		"xlsx": true, "xls": true, "ods": true, "csv": true,
		"pptx": true, "ppt": true, "odp": true, "pdf": true,
	}
	return supported[normalized]
}

// MapCodePageToIndex 映射 Windows CodePage 到 OnlyOffice 内部的编码 Index 标识
func MapCodePageToIndex(codepage int) int {
	switch codepage {
	case 65001:
		return 46 // UTF-8
	case 936:
		return 18 // GBK
	case 1200:
		return 48 // UTF-16LE
	case 1201:
		return 49 // UTF-16BE
	default:
		return 0 // Default
	}
}
