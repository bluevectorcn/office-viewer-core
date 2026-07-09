package csvdetector

import (
	"bytes"
	"io"
	"math"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// DecodeUTF16LE 辅助解码 UTF-16LE 字节到 UTF-8 字符串
func DecodeUTF16LE(data []byte) string {
	decoder := unicode.UTF16(unicode.LittleEndian, unicode.UseBOM).NewDecoder()
	reader := transform.NewReader(bytes.NewReader(data), decoder)
	decoded, err := io.ReadAll(reader)
	if err != nil {
		return string(data)
	}
	return string(decoded)
}

// DecodeUTF16BE 辅助解码 UTF-16BE 字节到 UTF-8 字符串
func DecodeUTF16BE(data []byte) string {
	decoder := unicode.UTF16(unicode.BigEndian, unicode.UseBOM).NewDecoder()
	reader := transform.NewReader(bytes.NewReader(data), decoder)
	decoded, err := io.ReadAll(reader)
	if err != nil {
		return string(data)
	}
	return string(decoded)
}

// DecodeGBK 辅助解码 GBK 字节到 UTF-8 字符串
func DecodeGBK(data []byte) string {
	decoder := simplifiedchinese.GBK.NewDecoder()
	reader := transform.NewReader(bytes.NewReader(data), decoder)
	decoded, err := io.ReadAll(reader)
	if err != nil {
		return string(data)
	}
	return string(decoded)
}

// DetectCsvEncoding 探测 CSV 文件字符编码
func DetectCsvEncoding(data []byte) int {
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return 65001 // UTF-8 BOM
	}
	if len(data) >= 2 {
		if data[0] == 0xFF && data[1] == 0xFE {
			return 1200 // UTF-16LE
		}
		if data[0] == 0xFE && data[1] == 0xFF {
			return 1201 // UTF-16BE
		}
	}
	if utf8.Valid(data) {
		return 65001 // UTF-8
	}
	// 尝试检验是否能被 GBK 正确解码
	decoder := simplifiedchinese.GBK.NewDecoder()
	checkLen := len(data)
	if checkLen > 4096 {
		checkLen = 4096
	}
	_, err := decoder.Bytes(data[:checkLen])
	if err == nil {
		return 936 // GBK
	}
	return 65001 // 默认回退
}

// DetectCsvDelimiter 探测 CSV 文件分割符
func DetectCsvDelimiter(data []byte, encoding int) (int, string) {
	var content string
	switch encoding {
	case 1200:
		content = DecodeUTF16LE(data)
	case 1201:
		content = DecodeUTF16BE(data)
	case 936:
		content = DecodeGBK(data)
	default:
		content = string(data)
	}

	candidates := []struct {
		char string
		code int
	}{
		{",", 4},
		{";", 2},
		{"\t", 1},
		{" ", 0},
		{":", 3},
	}

	lines := strings.Split(content, "\n")
	var activeLines []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			activeLines = append(activeLines, line)
		}
		if len(activeLines) >= 20 {
			break
		}
	}

	if len(activeLines) == 0 {
		return 4, ","
	}

	bestCode := 4
	bestChar := ","
	maxScore := -1.0

	for _, cand := range candidates {
		counts := make([]int, len(activeLines))
		totalCount := 0
		for i, line := range activeLines {
			cnt := strings.Count(line, cand.char)
			counts[i] = cnt
			totalCount += cnt
		}

		if totalCount == 0 {
			continue
		}

		// 检查是否在每行都出现相同的次数
		allSame := true
		firstCount := counts[0]
		for _, cnt := range counts {
			if cnt != firstCount {
				allSame = false
				break
			}
		}

		if allSame && firstCount > 0 {
			score := float64(firstCount) * 10.0
			if cand.char == " " {
				score = float64(firstCount) * 0.1 // 降权空格
			}
			if score > maxScore {
				maxScore = score
				bestCode = cand.code
				bestChar = cand.char
			}
		} else {
			mean := float64(totalCount) / float64(len(activeLines))
			var variance float64
			for _, cnt := range counts {
				diff := float64(cnt) - mean
				variance += diff * diff
			}
			variance = variance / float64(len(activeLines))
			stdDev := math.Sqrt(variance)

			cv := 0.0
			if mean > 0 {
				cv = stdDev / mean
			} else {
				continue
			}

			score := mean / (1.0 + cv)
			if cand.char == " " {
				score = score * 0.01 // 空格降权
			}
			if score > maxScore {
				maxScore = score
				bestCode = cand.code
				bestChar = cand.char
			}
		}
	}

	return bestCode, bestChar
}
