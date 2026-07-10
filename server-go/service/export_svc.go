package service

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"office-viewer-backend/utils"
)

type ExportService struct {
	X2tPath string
	Queue   *QueueManager
}

func NewExportService(x2tPath string, queue *QueueManager) *ExportService {
	return &ExportService{
		X2tPath: x2tPath,
		Queue:   queue,
	}
}

type ExportParams struct {
	TaskId        string
	WorkDir       string
	InputFilePath string
	Ext           string
	DocumentType  string
}

type ExportResult struct {
	PdfBytes []byte
}

func (s *ExportService) RunExport(p ExportParams) (*ExportResult, error) {
	outputFilePath := filepath.Join(p.WorkDir, "output.pdf")
	paramsPath := filepath.Join(p.WorkDir, "params.xml")

	fontDir := filepath.Join(".", "assets", "fonts") + string(filepath.Separator)
	absFontDir, err := filepath.Abs(fontDir)
	if err == nil {
		absFontDir = absFontDir + string(filepath.Separator)
	} else {
		absFontDir = fontDir
	}

	themeDir := filepath.Join(".", "sdkjs", "slide", "themes")
	absThemeDir, err := filepath.Abs(themeDir)
	if err != nil {
		absThemeDir = themeDir
	}

	var formatFromVal int
	isEditorBin := p.Ext == ".bin" || p.Ext == ""
	if isEditorBin {
		if p.DocumentType == "" {
			p.DocumentType = "word"
		}
		formatFromVal = utils.GetAvsCanvasFormat(p.DocumentType)
	} else {
		formatFromVal = utils.GetAvsFormatFrom(p.Ext)
	}
	formatFrom := strconv.Itoa(formatFromVal)
	formatTo := "513" // PDF

	paramsContent := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <m_sFontDir>%s</m_sFontDir>
  <m_sThemeDir>%s</m_sThemeDir>
  <m_sFileFrom>%s</m_sFileFrom>
  <m_sFileTo>%s</m_sFileTo>
  <m_nFormatFrom>%s</m_nFormatFrom>
  <m_nFormatTo>%s</m_nFormatTo>
  <m_bIsNoBase64>true</m_bIsNoBase64>
</TaskQueueDataConvert>`, absFontDir, absThemeDir, p.InputFilePath, outputFilePath, formatFrom, formatTo)

	if err := os.WriteFile(paramsPath, []byte(paramsContent), 0644); err != nil {
		return nil, fmt.Errorf("failed to generate parameters file: %w", err)
	}

	select {
	case s.Queue.Sem <- struct{}{}:
		defer func() { <-s.Queue.Sem }()
	case <-time.After(60 * time.Second):
		return nil, fmt.Errorf("server is busy, queue wait timed out")
	}

	log.Printf("[Task %s] Exporting PDF (documentType=%s, formatFrom=%s)\n", p.TaskId, p.DocumentType, formatFrom)
	cmd := exec.Command(s.X2tPath, paramsPath)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("x2t conversion failed: %w, details: %s", err, string(outputBytes))
	}

	pdfBytes, err := os.ReadFile(outputFilePath)
	if err != nil {
		return nil, fmt.Errorf("x2t produced no PDF output, details: %s", string(outputBytes))
	}

	if len(pdfBytes) < 5 || pdfBytes[0] != 0x25 || pdfBytes[1] != 0x50 {
		return nil, fmt.Errorf("x2t output is not a valid PDF")
	}

	return &ExportResult{PdfBytes: pdfBytes}, nil
}
