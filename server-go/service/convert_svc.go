package service

import (
	"fmt"
	"html"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"office-viewer-backend/csvdetector"
	"office-viewer-backend/utils"
)

type ConvertService struct {
	X2tPath string
	Queue   *QueueManager
}

func NewConvertService(x2tPath string, queue *QueueManager) *ConvertService {
	return &ConvertService{
		X2tPath: x2tPath,
		Queue:   queue,
	}
}

type ConvertParams struct {
	TaskId           string
	WorkDir          string
	InputFilePath    string
	Ext              string
	CsvDelimiter     int
	CsvDelimiterChar string
	CsvEncoding      int
}

type ConvertResult struct {
	OutputFilePath string
	MediaFiles     []string
}

func (s *ConvertService) RunConversion(p ConvertParams) (*ConvertResult, error) {
	outputFilePath := filepath.Join(p.WorkDir, "Editor.bin")
	paramsPath := filepath.Join(p.WorkDir, "params.xml")

	fontDir := filepath.Join(".", "assets", "fonts") + string(filepath.Separator)
	themeDir := filepath.Join(".", "sdkjs", "slide", "themes")

	absFontDir, err := filepath.Abs(fontDir)
	if err == nil {
		absFontDir = absFontDir + string(filepath.Separator)
	} else {
		absFontDir = fontDir
	}

	absThemeDir, err := filepath.Abs(themeDir)
	if err != nil {
		absThemeDir = themeDir
	}

	formatFrom := strconv.Itoa(utils.GetAvsFormatFrom(p.Ext))
	formatTo := strconv.Itoa(utils.GetAvsFormatTo(p.Ext))

	var csvNodes string
	if p.Ext == ".csv" {
		csvEncoding := p.CsvEncoding
		csvDelimiter := p.CsvDelimiter
		csvDelimiterChar := p.CsvDelimiterChar

		if csvEncoding == 0 {
			fileBytes, err := os.ReadFile(p.InputFilePath)
			if err == nil {
				csvEncoding = csvdetector.DetectCsvEncoding(fileBytes)
				if csvDelimiter == 0 && csvDelimiterChar == "" {
					csvDelimiter, csvDelimiterChar = csvdetector.DetectCsvDelimiter(fileBytes, csvEncoding)
				}
			}
		}

		if csvEncoding == 0 {
			csvEncoding = 65001 // default
		}
		if csvDelimiter == 0 && csvDelimiterChar == "" {
			csvDelimiter = 4 // default
			csvDelimiterChar = ","
		}

		log.Printf("[Task %s] CSV Parameters - Encoding CodePage: %d, Delimiter: %d, Char: %q\n", p.TaskId, csvEncoding, csvDelimiter, csvDelimiterChar)
		mappedEncoding := utils.MapCodePageToIndex(csvEncoding)
		escapedChar := html.EscapeString(csvDelimiterChar)
		csvNodes = fmt.Sprintf("\n  <m_nCsvTxtEncoding>%d</m_nCsvTxtEncoding>\n  <m_nCsvDelimiter>%d</m_nCsvDelimiter>\n  <m_nCsvDelimiterChar>%s</m_nCsvDelimiterChar>", mappedEncoding, csvDelimiter, escapedChar)
	}

	paramsContent := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <m_sFontDir>%s</m_sFontDir>
  <m_sThemeDir>%s</m_sThemeDir>
  <m_sFileFrom>%s</m_sFileFrom>
  <m_sFileTo>%s</m_sFileTo>
  <m_nFormatFrom>%s</m_nFormatFrom>
  <m_nFormatTo>%s</m_nFormatTo>
  <m_bIsNoBase64>true</m_bIsNoBase64>%s
  <m_oInputLimits>
    <m_oInputLimit type="docx;dotx;docm;dotm">
      <m_oZip uncompressed="52428800" template="*.xml" />
    </m_oInputLimit>
    <m_oInputLimit type="xlsx;xltx;xlsm;xltm">
      <m_oZip uncompressed="302428800" template="*.xml" />
    </m_oInputLimit>
    <m_oInputLimit type="pptx;ppsx;potx;pptm;ppsm;potm">
      <m_oZip uncompressed="52428800" template="*.xml" />
    </m_oInputLimit>
  </m_oInputLimits>
</TaskQueueDataConvert>`, absFontDir, absThemeDir, p.InputFilePath, outputFilePath, formatFrom, formatTo, csvNodes)

	if err := os.WriteFile(paramsPath, []byte(paramsContent), 0644); err != nil {
		return nil, fmt.Errorf("failed to generate parameters file: %w", err)
	}

	select {
	case s.Queue.Sem <- struct{}{}:
		defer func() { <-s.Queue.Sem }()
	case <-time.After(60 * time.Second):
		return nil, fmt.Errorf("server is busy, queue wait timed out")
	}

	log.Printf("[Task %s] Starting x2t conversion\n", p.TaskId)
	cmd := exec.Command(s.X2tPath, paramsPath)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("x2t conversion failed: %w, details: %s", err, string(outputBytes))
	}

	mediaFiles := make([]string, 0)
	mediaDir := filepath.Join(p.WorkDir, "media")
	if entries, err := os.ReadDir(mediaDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				mediaFiles = append(mediaFiles, entry.Name())
			}
		}
	}

	return &ConvertResult{
		OutputFilePath: outputFilePath,
		MediaFiles:     mediaFiles,
	}, nil
}
