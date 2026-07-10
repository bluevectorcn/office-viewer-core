package controller

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"office-viewer-backend/config"
	"office-viewer-backend/service"
	"office-viewer-backend/utils"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rakyll/magicmime"
)

type DocumentController struct {
	convertSvc *service.ConvertService
	exportSvc  *service.ExportService
	appConfig  *config.AppConfig
}

func NewDocumentController(convertSvc *service.ConvertService, exportSvc *service.ExportService, appConfig *config.AppConfig) *DocumentController {
	return &DocumentController{
		convertSvc: convertSvc,
		exportSvc:  exportSvc,
		appConfig:  appConfig,
	}
}

func (ctrl *DocumentController) HandleConvert(c *gin.Context) {
	file, err := c.FormFile("file")
	var fileUrl string
	var title string

	if err != nil {
		fileUrl = c.PostForm("url")
		if fileUrl == "" {
			RespondError(c, http.StatusBadRequest, "Missing file or url in form-data", "")
			return
		}
		title = c.PostForm("title")
		if title == "" {
			parts := strings.Split(fileUrl, "/")
			if len(parts) > 0 {
				title = strings.Split(parts[len(parts)-1], "?")[0]
			}
			if title == "" {
				title = "document.docx"
			}
		}
	} else {
		title = c.PostForm("title")
		if title == "" {
			title = file.Filename
		}
	}

	taskId := uuid.New().String()
	workDir := filepath.Join(ctrl.appConfig.TempDir, taskId)

	err = os.MkdirAll(filepath.Join(workDir, "media"), 0755)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "Failed to create task workspace", err.Error())
		return
	}

	var ext string
	var inputFilePath string
	tmpUploadPath := filepath.Join(workDir, "upload_tmp")

	if fileUrl != "" {
		log.Printf("[Task %s] Downloading remote file: %s\n", taskId, fileUrl)
		downloadErr := utils.DownloadFile(fileUrl, tmpUploadPath, ctrl.appConfig.MaxDownloadSize)
		if downloadErr != nil {
			log.Printf("[Task %s] Failed to download file from url: %v\n", taskId, downloadErr)
			RespondError(c, http.StatusInternalServerError, fmt.Sprintf("Failed to download file from remote URL: %v", downloadErr), "")
			return
		}
	} else {
		if err := c.SaveUploadedFile(file, tmpUploadPath); err != nil {
			RespondError(c, http.StatusInternalServerError, "Failed to save uploaded file", err.Error())
			return
		}
	}

	titleExt := filepath.Ext(title)
	if titleExt != "" && utils.IsSupportedExtension(titleExt) {
		ext = titleExt
		log.Printf("[Task %s] Using supported extension from title: %s\n", taskId, ext)
	} else {
		if mimeType, err := magicmime.TypeByFile(tmpUploadPath); err == nil {
			ext = utils.MimeToExt(mimeType)
			log.Printf("[Task %s] Detected MIME type: %s, mapped extension: %s\n", taskId, mimeType, ext)
		}
		if ext == "" && titleExt != "" {
			ext = titleExt
		}
		if ext == "" {
			ext = ".docx"
		}
	}

	inputFileName := "document" + ext
	inputFilePath = filepath.Join(workDir, inputFileName)

	if err := os.Rename(tmpUploadPath, inputFilePath); err != nil {
		RespondError(c, http.StatusInternalServerError, "Failed to rename uploaded file to target extension", err.Error())
		return
	}

	csvDelimiter, _ := strconv.Atoi(c.PostForm("csvDelimiter"))
	csvEncoding, _ := strconv.Atoi(c.PostForm("csvEncoding"))
	
	params := service.ConvertParams{
		TaskId:           taskId,
		WorkDir:          workDir,
		InputFilePath:    inputFilePath,
		Ext:              ext,
		CsvDelimiter:     csvDelimiter,
		CsvDelimiterChar: c.PostForm("csvDelimiterChar"),
		CsvEncoding:      csvEncoding,
	}

	result, err := ctrl.convertSvc.RunConversion(params)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "Conversion failed", err.Error())
		return
	}

	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := c.Request.Host

	images := make(map[string]string)
	for _, fileName := range result.MediaFiles {
		key := "media/" + fileName
		images[key] = fmt.Sprintf("%s://%s%s/static/%s/media/%s", scheme, host, ctrl.appConfig.ContextPath, taskId, fileName)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"taskId":       taskId,
		"documentType": utils.InferDocumentType(inputFileName),
		"fileType":     strings.TrimPrefix(ext, "."),
		"editorBinUrl": fmt.Sprintf("%s://%s%s/static/%s/Editor.bin", scheme, host, ctrl.appConfig.ContextPath, taskId),
		"images":       images,
	})
}

func (ctrl *DocumentController) HandleExportPdf(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		RespondError(c, http.StatusBadRequest, "Missing file in form-data", "")
		return
	}

	documentType := strings.ToLower(c.PostForm("documentType"))
	fileName := c.PostForm("fileName")
	if fileName == "" {
		fileName = file.Filename
	}

	taskId := uuid.New().String()
	workDir := filepath.Join(ctrl.appConfig.TempDir, taskId)
	err = os.MkdirAll(workDir, 0755)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "Failed to create task workspace", err.Error())
		return
	}

	uploadPath := filepath.Join(workDir, "input.bin")
	if err := c.SaveUploadedFile(file, uploadPath); err != nil {
		RespondError(c, http.StatusInternalServerError, "Failed to save uploaded file", err.Error())
		return
	}

	mediaPathsStr := c.PostForm("mediaPaths")
	if mediaPathsStr != "" {
		var mediaPaths map[string]string
		if err := json.Unmarshal([]byte(mediaPathsStr), &mediaPaths); err == nil {
			form, err := c.MultipartForm()
			if err == nil && form != nil {
				for fieldName, relPath := range mediaPaths {
					files := form.File[fieldName]
					if len(files) == 0 {
						continue
					}
					fileHeader := files[0]

					cleanRelPath := filepath.Clean(relPath)
					if strings.HasPrefix(cleanRelPath, "..") || filepath.IsAbs(cleanRelPath) {
						log.Printf("[Task %s] Warning: Ignored media file with invalid path: %s\n", taskId, relPath)
						continue
					}

					targetPath := filepath.Join(workDir, cleanRelPath)
					parentDir := filepath.Dir(targetPath)
					mkdirErr := os.MkdirAll(parentDir, 0755)
					if mkdirErr != nil {
						continue
					}

					if err := c.SaveUploadedFile(fileHeader, targetPath); err == nil {
						log.Printf("[Task %s] Saved media file to: %s\n", taskId, cleanRelPath)
					}
				}
			}
		}
	}

	uploadExt := strings.ToLower(filepath.Ext(fileName))
	
	params := service.ExportParams{
		TaskId:        taskId,
		WorkDir:       workDir,
		InputFilePath: uploadPath,
		Ext:           uploadExt,
		DocumentType:  documentType,
	}

	result, err := ctrl.exportSvc.RunExport(params)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "Export failed", err.Error())
		return
	}

	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.pdf\"", strings.TrimSuffix(fileName, filepath.Ext(fileName))))
	c.Data(http.StatusOK, "application/pdf", result.PdfBytes)
}
