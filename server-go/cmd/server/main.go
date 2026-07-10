package main

import (
	"encoding/json"
	"fmt"
	"html"
	"log"
	"net/http"
	"office-viewer-backend/service"
	"office-viewer-backend/utils"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rakyll/magicmime"

	"office-viewer-backend/csvdetector"
)

// 并发队列配置
var (
		maxConcurrentTasks = 4                // 最大并发转码任务数，保护 CPU
	x2tPath            = "./bin/x2t"      // x2t 可执行文件路径
	tempDir            = "./temp"         // 转换临时文件目录
	cleanupThreshold   = 30 * time.Minute // 转换文件保留时间，到期自动清理
	contextPath        = ""               // 统一的前端与 API 根路径前缀
)


func main() {
	// 初始化 magicmime
	if err := magicmime.Open(magicmime.MAGIC_MIME_TYPE); err != nil {
		log.Fatalf("Failed to open magicmime: %v", err)
	}
	defer magicmime.Close()

	// 允许通过环境变量修改配置
	if envMax := os.Getenv("MAX_CONCURRENT_TASKS"); envMax != "" {
		var val int
		if _, err := fmt.Sscanf(envMax, "%d", &val); err == nil && val > 0 {
			maxConcurrentTasks = val
					}
	}
	if envX2T := os.Getenv("X2T_PATH"); envX2T != "" {
		x2tPath = envX2T
	}
	if envTemp := os.Getenv("TEMP_DIR"); envTemp != "" {
		tempDir = envTemp
	}

	// 确保临时目录存在
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		log.Fatalf("Failed to create temp directory: %v", err)
	}

	queueManager := service.NewQueueManager(maxConcurrentTasks, cleanupThreshold, tempDir)
	convertService := service.NewConvertService(x2tPath, queueManager)
	exportService := service.NewExportService(x2tPath, queueManager)

	// 解析 CONTEXT_PATH 环境变量
	contextPath = os.Getenv("CONTEXT_PATH")
	if contextPath != "" {
		if !strings.HasPrefix(contextPath, "/") {
			contextPath = "/" + contextPath
		}
		contextPath = strings.TrimSuffix(contextPath, "/")
	}

	r := gin.Default()

	// 启用跨域中间件和跨域隔离头中间件（用于加载 WASM SharedArrayBuffer）
	r.Use(corsMiddleware())
	r.Use(coopCoepMiddleware())

	var baseGroup gin.IRoutes
	if contextPath != "" {
		baseGroup = r.Group(contextPath)
	} else {
		baseGroup = r
	}

	// 静态文件服务，托管转换产物（Editor.bin 以及 media 目录下的图片）
	baseGroup.Static("/static", tempDir)

	// API 接口：文件转码
	baseGroup.POST("/api/convert", func(c *gin.Context) {
		handleConvert(c, convertService)
	})

	// API 接口：导出 PDF（原生 x2t + doctrenderer，支持 Editor.bin/原始文档 → PDF）
	baseGroup.POST("/api/export-pdf", func(c *gin.Context) {
		handleExportPdf(c, exportService)
	})

	// 兜底路由 (NoRoute)：托管静态前端资源的托管和 SPA 集成路由 fallback 处理器，规避 Gin 通配符与已有路由段的冲突崩溃问题
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		log.Printf("[NoRoute] Received request path: %s (Raw query: %s)\n", path, c.Request.URL.RawQuery)

		// 如果配置了 contextPath，需要剥离前缀以定位到正确的 dist 静态资源
		if contextPath != "" && strings.HasPrefix(path, contextPath) {
			path = strings.TrimPrefix(path, contextPath)
		}

		// 规范化路径
		path = filepath.Clean(path)

		// 如果是根目录请求，直接返回 index.html
		if path == "/" || path == "." || path == "" {
			c.File(filepath.Join("dist", "index.html"))
			return
		}

		// 如果是集成的跳转路由，直接返回专用的 app.html 承载页面，实现控制栏剥离和纯净全屏渲染
		if path == "/preview" || path == "/edit" || path == "/open" {
			c.File(filepath.Join("dist", "app.html"))
			return
		}

		// 拼接 dist 下的物理静态文件路径并确认存在
		filePath := filepath.Join("dist", path)
		fileInfo, err := os.Stat(filePath)
		if err == nil {
			if fileInfo.IsDir() {
				// 如果是目录，自动检索并服务其目录下的 index.html (类似 Nginx 的 index 机制)
				indexFilePath := filepath.Join(filePath, "index.html")
				if indexInfo, indexErr := os.Stat(indexFilePath); indexErr == nil && !indexInfo.IsDir() {
					c.File(indexFilePath)
					return
				}
			} else {
				// 如果是普通静态文件，直接服务
				c.File(filePath)
				return
			}
		}

		// 打印未找到的静态文件路径
		log.Printf("[NoRoute] Asset not found in dist, fallback to index.html. Path: %s -> Resolved: %s (Err: %v)\n", c.Request.URL.Path, filePath, err)

		// 默认兜底返回 index.html
		c.File(filepath.Join("dist", "index.html"))
	})

	// 启动定期清理定时器
	go queueManager.StartCleanupTimer(10 * time.Minute)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("Office Viewer Transcode Server is running on :%s (Max concurrent: %d, ContextPath: '%s')\n", port, maxConcurrentTasks, contextPath)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

// corsMiddleware 跨域处理中间件
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// coopCoepMiddleware 跨域隔离安全头中间件，启用 SharedArrayBuffer 的 WASM 必须
func coopCoepMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		c.Writer.Header().Set("Cross-Origin-Embedder-Policy", "require-corp")
		c.Next()
	}
}

func handleConvert(c *gin.Context, svc *service.ConvertService) {
	file, err := c.FormFile("file")
	var fileUrl string
	var title string

	if err != nil {
		fileUrl = c.PostForm("url")
		if fileUrl == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Missing file or url in form-data", "details": ""})
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
	workDir := filepath.Join(tempDir, taskId)

	err = os.MkdirAll(filepath.Join(workDir, "media"), 0755)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create task workspace", "details": err.Error()})
		return
	}

	var ext string
	var inputFilePath string
	tmpUploadPath := filepath.Join(workDir, "upload_tmp")

	if fileUrl != "" {
		log.Printf("[Task %s] Downloading remote file: %s\n", taskId, fileUrl)
		downloadErr := utils.DownloadFile(fileUrl, tmpUploadPath, 500*1024*1024)
		if downloadErr != nil {
			log.Printf("[Task %s] Failed to download file from url: %v\n", taskId, downloadErr)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": fmt.Sprintf("Failed to download file from remote URL: %v", downloadErr), "details": ""})
			return
		}
	} else {
		if err := c.SaveUploadedFile(file, tmpUploadPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to save uploaded file", "details": err.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to rename uploaded file to target extension", "details": err.Error()})
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

	result, err := svc.RunConversion(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Conversion failed", "details": err.Error()})
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
		images[key] = fmt.Sprintf("%s://%s%s/static/%s/media/%s", scheme, host, contextPath, taskId, fileName)
	}

	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"taskId":       taskId,
		"documentType": utils.InferDocumentType(inputFileName),
		"fileType":     strings.TrimPrefix(ext, "."),
		"editorBinUrl": fmt.Sprintf("%s://%s%s/static/%s/Editor.bin", scheme, host, contextPath, taskId),
		"images":       images,
	})
}

func handleExportPdf(c *gin.Context, svc *service.ExportService) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "Missing file in form-data", "details": ""})
		return
	}

	documentType := strings.ToLower(c.PostForm("documentType"))
	fileName := c.PostForm("fileName")
	if fileName == "" {
		fileName = file.Filename
	}

	taskId := uuid.New().String()
	workDir := filepath.Join(tempDir, taskId)
	err = os.MkdirAll(workDir, 0755)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to create task workspace", "details": err.Error()})
		return
	}

	uploadPath := filepath.Join(workDir, "input.bin")
	if err := c.SaveUploadedFile(file, uploadPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Failed to save uploaded file", "details": err.Error()})
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

	result, err := svc.RunExport(params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "Export failed", "details": err.Error()})
		return
	}

	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.pdf\"", strings.TrimSuffix(fileName, filepath.Ext(fileName))))
	c.Data(http.StatusOK, "application/pdf", result.PdfBytes)
}
