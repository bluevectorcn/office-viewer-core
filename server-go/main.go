package main

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rakyll/magicmime"

	"office-viewer-backend/csvdetector"
)

// 并发队列配置
var (
	sem                chan struct{}
	maxConcurrentTasks = 4                // 最大并发转码任务数，保护 CPU
	x2tPath            = "./bin/x2t"      // x2t 可执行文件路径
	tempDir            = "./temp"         // 转换临时文件目录
	cleanupThreshold   = 30 * time.Minute // 转换文件保留时间，到期自动清理
	contextPath        = ""               // 统一的前端与 API 根路径前缀
)

// 任务锁，防止定时清理和转换任务冲突
var mu sync.Mutex

func init() {
	// 初始化并发控制通道
	sem = make(chan struct{}, maxConcurrentTasks)
}

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
			sem = make(chan struct{}, maxConcurrentTasks)
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
	baseGroup.POST("/api/convert", handleConvert)

	// API 接口：导出 PDF（原生 x2t + doctrenderer，支持 Editor.bin/原始文档 → PDF）
	baseGroup.POST("/api/export-pdf", handleExportPdf)

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
	go startCleanupTimer(10 * time.Minute)

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

// handleConvert 文件转码核心控制器
func handleConvert(c *gin.Context) {
	file, err := c.FormFile("file")
	var fileUrl string
	var title string

	if err != nil {
		// 没有上传文件，检测是否是 URL 参数
		fileUrl = c.PostForm("url")
		if fileUrl == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Missing file or url in form-data"})
			return
		}
		title = c.PostForm("title")
		if title == "" {
			parts := strings.Split(fileUrl, "/")
			if len(parts) > 0 {
				lastPart := parts[len(parts)-1]
				title = strings.Split(lastPart, "?")[0]
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

	// 1. 分配唯一的转码任务 ID
	taskId := uuid.New().String()
	workDir := filepath.Join(tempDir, taskId)

	// 2. 创建临时工作空间
	mu.Lock()
	err = os.MkdirAll(filepath.Join(workDir, "media"), 0755)
	mu.Unlock()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task workspace"})
		return
	}

	var ext string
	var inputFilePath string
	tmpUploadPath := filepath.Join(workDir, "upload_tmp")

	if fileUrl != "" {
		// 远程下载文件
		log.Printf("[Task %s] Downloading remote file: %s\n", taskId, fileUrl)
		downloadErr := downloadFile(fileUrl, tmpUploadPath)
		if downloadErr != nil {
			log.Printf("[Task %s] Failed to download file from url: %v\n", taskId, downloadErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to download file from remote URL: %v", downloadErr)})
			return
		}
	} else {
		// 保存上传的原始文档文件
		if err := c.SaveUploadedFile(file, tmpUploadPath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save uploaded file"})
			return
		}
	}

	// 优先根据原文件名的后缀进行判定，若原文件名后缀是支持的有效格式，则绝不使用 magicmime 覆盖它
	titleExt := filepath.Ext(title)
	if titleExt != "" && isSupportedExtension(titleExt) {
		ext = titleExt
		log.Printf("[Task %s] Using supported extension from title: %s\n", taskId, ext)
	} else {
		// 只有在原文件名无有效后缀时，才通过 magicmime 进行推导
		if mimeType, err := magicmime.TypeByFile(tmpUploadPath); err == nil {
			ext = mimeToExt(mimeType)
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

	// 重命名临时文件到正确的输入路径
	if err := os.Rename(tmpUploadPath, inputFilePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rename uploaded file to target extension"})
		return
	}

	// 4. 构建 params.xml 转换配置
	outputFilePath := filepath.Join(workDir, "Editor.bin")
	paramsPath := filepath.Join(workDir, "params.xml")

	// 构建字体和主题目录，并转化为绝对路径以供外部 x2t 使用
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

	formatFrom := strconv.Itoa(getAvsFormatFrom(ext))
	formatTo := strconv.Itoa(getAvsFormatTo(ext))

	var csvNodes string
	if ext == ".csv" {
		csvEncoding := 65001
		csvDelimiter := 4
		csvDelimiterChar := ","

		// 检查前端是否有传参
		reqDelimiter := c.PostForm("csvDelimiter")
		reqDelimiterChar := c.PostForm("csvDelimiterChar")
		reqEncoding := c.PostForm("csvEncoding")

		hasFrontOptions := reqDelimiter != ""

		if hasFrontOptions {
			if val, err := strconv.Atoi(reqDelimiter); err == nil {
				csvDelimiter = val
			}
			csvDelimiterChar = reqDelimiterChar
			if reqEncoding != "" {
				if val, err := strconv.Atoi(reqEncoding); err == nil {
					csvEncoding = val
				}
			} else {
				// 前端未指定编码，由后端探测编码
				fileBytes, err := os.ReadFile(inputFilePath)
				if err == nil {
					csvEncoding = csvdetector.DetectCsvEncoding(fileBytes)
				}
			}
		} else {
			// 前端未识别（无后缀透传场景），后端自动探测编码与分隔符
			fileBytes, err := os.ReadFile(inputFilePath)
			if err == nil {
				csvEncoding = csvdetector.DetectCsvEncoding(fileBytes)
				csvDelimiter, csvDelimiterChar = csvdetector.DetectCsvDelimiter(fileBytes, csvEncoding)
			}
		}

		log.Printf("[Task %s] CSV Parameters - Encoding CodePage: %d, Delimiter: %d, Char: %q\n", taskId, csvEncoding, csvDelimiter, csvDelimiterChar)
		mappedEncoding := mapCodePageToIndex(csvEncoding)
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
</TaskQueueDataConvert>`, absFontDir, absThemeDir, inputFilePath, outputFilePath, formatFrom, formatTo, csvNodes)

	log.Printf("[Task %s] Generated params.xml content:\n%s\n", taskId, paramsContent)
	if err := os.WriteFile(paramsPath, []byte(paramsContent), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate parameters file"})
		return
	}

	// 5. 并发控制与排队
	select {
	case sem <- struct{}{}:
		// 成功获取槽位，继续执行转码
		defer func() { <-sem }()
	case <-time.After(60 * time.Second):
		// 排队等待超时，返回 429 忙碌
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Server is busy. Queue wait timed out."})
		return
	}

	// 6. 调用原生 x2t 命令行开始转码
	log.Printf("[Task %s] Starting x2t conversion for: %s\n", taskId, title)
	cmd := exec.Command(x2tPath, paramsPath)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[Task %s] x2t error: %v, output: %s\n", taskId, err, string(outputBytes))
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   fmt.Sprintf("x2t conversion failed: %v", err),
			"details": string(outputBytes),
		})
		return
	}
	log.Printf("[Task %s] Conversion completed successfully. x2t output: %s\n", taskId, string(outputBytes))

	// 7. 扫描生成的 media 文件夹下的静态多媒体图片并返回 URL
	images := make(map[string]string)
	mediaDir := filepath.Join(workDir, "media")

	// 判断静态路由协议与域名
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := c.Request.Host

	if entries, err := os.ReadDir(mediaDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				fileName := entry.Name()
				// 将类似于 media/image1.png 映射到后端的静态文件可访问链接
				key := "media/" + fileName
				images[key] = fmt.Sprintf("%s://%s%s/static/%s/media/%s", scheme, host, contextPath, taskId, fileName)
			}
		}
	}

	// 8. 响应结果
	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"taskId":       taskId,
		"documentType": inferDocumentType(inputFileName),
		"fileType":     strings.TrimPrefix(ext, "."),
		"editorBinUrl": fmt.Sprintf("%s://%s%s/static/%s/Editor.bin", scheme, host, contextPath, taskId),
		"images":       images,
	})
}

// mimeToExt 将 MIME 类型映射为已知的文件后缀名
func mimeToExt(mimeType string) string {
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

// inferDocumentType 推断文档大类
func inferDocumentType(filename string) string {
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

// startCleanupTimer 定时清理机制，定期清理过期转换目录
func startCleanupTimer(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		log.Println("Starting scheduled cleanup for expired task files...")
		files, err := os.ReadDir(tempDir)
		if err != nil {
			log.Printf("Cleanup scanner error: %v\n", err)
			continue
		}

		now := time.Now()
		cleanedCount := 0

		for _, file := range files {
			if file.IsDir() {
				dirPath := filepath.Join(tempDir, file.Name())
				info, err := os.Stat(dirPath)
				if err != nil {
					continue
				}

				// 检查最后修改时间，超过 threshold 阈值即删除
				if now.Sub(info.ModTime()) > cleanupThreshold {
					mu.Lock()
					err = os.RemoveAll(dirPath)
					mu.Unlock()
					if err != nil {
						log.Printf("Failed to remove expired dir %s: %v\n", dirPath, err)
					} else {
						cleanedCount++
					}
				}
			}
		}
		if cleanedCount > 0 {
			log.Printf("Cleanup completed. Removed %d expired task folders.\n", cleanedCount)
		}
	}
}

// Formatting utility constants and methods are imported from formats.go.

// handleExportPdf 导出 PDF 控制器
// 接收 multipart 上传的 file（renderer binary / Editor.bin 或原始 Office 文档）+ documentType，
// 调用原生 x2t（带 doctrenderer）转换为 PDF，直接返回 PDF 字节流。
//
// 注意：PDF 导出时前端 OnlyOffice 通过 ToRendererPart() 生成 renderer binary（Canvas
// 渲染格式），其中图片字节已在编辑时注入 g_oDocumentBlobUrls，序列化时已写成 inline
// base64。因此本接口无需再单独接收 media 字节或做 ZIP 关系修补——直接把 renderer
// binary 喂给 x2t 即可。
//
// 表单字段：
//
//	file          - 上传的文件（renderer binary / Editor.bin 或 docx/xlsx/pptx 等）
//	documentType  - word/cell/slide/pdf（当 file 是 Editor.bin 时必需）
//	fileName      - 原始文件名（可选，用于推断源格式）
func handleExportPdf(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing file in form-data"})
		return
	}

	documentType := strings.ToLower(c.PostForm("documentType"))
	fileName := c.PostForm("fileName")
	if fileName == "" {
		fileName = file.Filename
	}

	// 分配任务 ID 与工作目录
	taskId := uuid.New().String()
	workDir := filepath.Join(tempDir, taskId)
	mu.Lock()
	err = os.MkdirAll(workDir, 0755)
	mu.Unlock()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task workspace"})
		return
	}

	// 保存上传文件
	uploadPath := filepath.Join(workDir, "input.bin")
	if err := c.SaveUploadedFile(file, uploadPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save uploaded file"})
		return
	}

	// 1. 接收并保存可能存在的 media 资源文件。
	// renderer binary 里图片以 media/<path> 本地引用，x2t 需从工作目录读取，
	// 因此把前端上传的 media 字节写入 <workDir>/<relPath>。
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

					// 防御路径穿越漏洞
					cleanRelPath := filepath.Clean(relPath)
					if strings.HasPrefix(cleanRelPath, "..") || filepath.IsAbs(cleanRelPath) {
						log.Printf("[Task %s] Warning: Ignored media file with invalid path: %s\n", taskId, relPath)
						continue
					}

					targetPath := filepath.Join(workDir, cleanRelPath)
					parentDir := filepath.Dir(targetPath)
					mu.Lock()
					mkdirErr := os.MkdirAll(parentDir, 0755)
					mu.Unlock()
					if mkdirErr != nil {
						log.Printf("[Task %s] Failed to create media subdirectory %s: %v\n", taskId, parentDir, mkdirErr)
						continue
					}

					if err := c.SaveUploadedFile(fileHeader, targetPath); err != nil {
						log.Printf("[Task %s] Failed to save media file %s: %v\n", taskId, relPath, err)
						continue
					}
					log.Printf("[Task %s] Saved media file to: %s\n", taskId, cleanRelPath)
				}
			}
		} else {
			log.Printf("[Task %s] Failed to parse mediaPaths: %v\n", taskId, err)
		}
	}

	// 判断源格式码：
	//   - 文件名是 *.bin（Editor.bin/renderer binary）→ 用 documentType 推导 Canvas 码
	//   - 否则按扩展名推导
	var formatFromVal int
	uploadExt := strings.ToLower(filepath.Ext(fileName))
	isEditorBin := uploadExt == ".bin" || uploadExt == ""
	if isEditorBin {
		if documentType == "" {
			documentType = "word"
		}
		formatFromVal = getAvsCanvasFormat(documentType)
	} else {
		formatFromVal = getAvsFormatFrom(uploadExt)
		if formatFromVal == AVS_FILE_UNKNOWN {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Unsupported source extension: %s", uploadExt)})
			return
		}
	}

	formatToVal := AVS_FILE_CROSSPLATFORM_PDF

	formatFrom := strconv.Itoa(formatFromVal)
	formatTo := strconv.Itoa(formatToVal)

	// 字体与主题目录
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

	outputPath := filepath.Join(workDir, "export.pdf")
	paramsPath := filepath.Join(workDir, "params.xml")
	paramsContent := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <m_sFontDir>%s</m_sFontDir>
  <m_sThemeDir>%s</m_sThemeDir>
  <m_sFileFrom>%s</m_sFileFrom>
  <m_sFileTo>%s</m_sFileTo>
  <m_nFormatFrom>%s</m_nFormatFrom>
  <m_nFormatTo>%s</m_nFormatTo>
  <m_bIsNoBase64>true</m_bIsNoBase64>
</TaskQueueDataConvert>`, absFontDir, absThemeDir, uploadPath, outputPath, formatFrom, formatTo)

	if err := os.WriteFile(paramsPath, []byte(paramsContent), 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate parameters file"})
		return
	}

	// 并发控制
	select {
	case sem <- struct{}{}:
		defer func() { <-sem }()
	case <-time.After(60 * time.Second):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "Server is busy. Queue wait timed out."})
		return
	}

	// 调用原生 x2t
	log.Printf("[Task %s] Exporting PDF: %s (documentType=%s, formatFrom=%s)\n", taskId, fileName, documentType, formatFrom)
	cmd := exec.Command(x2tPath, paramsPath)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[Task %s] x2t error: %v, output: %s\n", taskId, err, string(outputBytes))
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   fmt.Sprintf("x2t conversion failed: %v", err),
			"details": string(outputBytes),
		})
		return
	}

	// 读取生成的 PDF
	pdfBytes, err := os.ReadFile(outputPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "x2t produced no PDF output", "details": string(outputBytes)})
		return
	}

	// 校验是否是合法 PDF
	if len(pdfBytes) < 5 || pdfBytes[0] != 0x25 || pdfBytes[1] != 0x50 {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "x2t output is not a valid PDF",
			"details": fmt.Sprintf("header=% x, size=%d", pdfBytes[:min(8, len(pdfBytes))], len(pdfBytes)),
		})
		return
	}

	log.Printf("[Task %s] PDF export completed (size=%d).\n", taskId, len(pdfBytes))

	// 返回 PDF 文件
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.pdf\"", strings.TrimSuffix(fileName, filepath.Ext(fileName))))
	c.Data(http.StatusOK, "application/pdf", pdfBytes)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// downloadFile 从指定的 URL 下载远程文件，后端拉取可规避浏览器跨域 CORS 拦截限制
func downloadFile(url string, destPath string) error {
	client := &http.Client{
		Timeout: 45 * time.Second,
	}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("bad remote server status code: %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

// isSupportedExtension 检查后缀是否为 OnlyOffice 支持 of 已知格式
func isSupportedExtension(ext string) bool {
	normalized := strings.ToLower(strings.TrimPrefix(ext, "."))
	supported := map[string]bool{
		"docx": true, "doc": true, "odt": true, "txt": true, "rtf": true,
		"xlsx": true, "xls": true, "ods": true, "csv": true,
		"pptx": true, "ppt": true, "odp": true, "pdf": true,
	}
	return supported[normalized]
}

// mapCodePageToIndex 映射 Windows CodePage 到 OnlyOffice 内部的编码 Index 标识
func mapCodePageToIndex(codepage int) int {
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
		return 46 // Default to UTF-8
	}
}
