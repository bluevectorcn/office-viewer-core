package csvdetector

import (
	"testing"
)

func TestDetectCsvEncoding(t *testing.T) {
	// 1. UTF-8 BOM
	utf8BOM := []byte{0xEF, 0xBB, 0xBF, 'a', 'b', 'c'}
	if code := DetectCsvEncoding(utf8BOM); code != 65001 {
		t.Errorf("Expected 65001 for UTF-8 BOM, got %d", code)
	}

	// 2. UTF-16LE BOM
	utf16LE := []byte{0xFF, 0xFE, 'a', 0x00, 'b', 0x00}
	if code := DetectCsvEncoding(utf16LE); code != 1200 {
		t.Errorf("Expected 1200 for UTF-16LE, got %d", code)
	}

	// 3. UTF-16BE BOM
	utf16BE := []byte{0xFE, 0xFF, 0x00, 'a', 0x00, 'b'}
	if code := DetectCsvEncoding(utf16BE); code != 1201 {
		t.Errorf("Expected 1201 for UTF-16BE, got %d", code)
	}

	// 4. Plain UTF-8
	plainUTF8 := []byte("hello, world, 你好")
	if code := DetectCsvEncoding(plainUTF8); code != 65001 {
		t.Errorf("Expected 65001 for plain UTF-8, got %d", code)
	}

	// 5. GBK encoded bytes (e.g. "中文" in GBK)
	gbkBytes := []byte{0xd6, 0xd0, 0xce, 0xc4} // "中文" in GBK
	if code := DetectCsvEncoding(gbkBytes); code != 936 {
		t.Errorf("Expected 936 for GBK, got %d", code)
	}
}

func TestDetectCsvDelimiter(t *testing.T) {
	// 1. Comma separated
	commaCSV := []byte("name,age,city\nAlice,20,Beijing\nBob,25,Shanghai")
	code, char := DetectCsvDelimiter(commaCSV, 65001)
	if code != 4 || char != "," {
		t.Errorf("Expected comma (4, \",\"), got (%d, %q)", code, char)
	}

	// 2. Semicolon separated
	semicolonCSV := []byte("name;age;city\nAlice;20;Beijing\nBob;25;Shanghai")
	code, char = DetectCsvDelimiter(semicolonCSV, 65001)
	if code != 2 || char != ";" {
		t.Errorf("Expected semicolon (2, \";\"), got (%d, %q)", code, char)
	}

	// 3. Tab separated
	tabCSV := []byte("name\tage\tcity\nAlice\t20\tBeijing\nBob\t25\tShanghai")
	code, char = DetectCsvDelimiter(tabCSV, 65001)
	if code != 1 || char != "\t" {
		t.Errorf("Expected tab (1, \"\\t\"), got (%d, %q)", code, char)
	}

	// 4. Colon separated
	colonCSV := []byte("name:age:city\nAlice:20:Beijing\nBob:25:Shanghai")
	code, char = DetectCsvDelimiter(colonCSV, 65001)
	if code != 3 || char != ":" {
		t.Errorf("Expected colon (3, \":\"), got (%d, %q)", code, char)
	}

	// 5. Spaces but commas exist
	mixedCSV := []byte("name, age, city\nAlice, 20, Beijing\nBob, 25, Shanghai")
	code, char = DetectCsvDelimiter(mixedCSV, 65001)
	if code != 4 || char != "," {
		t.Errorf("Expected comma for mixed text with spaces (4, \",\"), got (%d, %q)", code, char)
	}
}
