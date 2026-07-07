package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// 并发队列配置
var (
	sem                chan struct{}
	maxConcurrentTasks = 4              // 最大并发转码任务数，保护 CPU
	x2tPath            = "./bin/x2t"    // x2t 可执行文件路径
	tempDir            = "./temp"       // 转换临时文件目录
	cleanupThreshold   = 30 * time.Minute // 转换文件保留时间，到期自动清理
)

// 任务锁，防止定时清理和转换任务冲突
var mu sync.Mutex

func init() {
	// 初始化并发控制通道
	sem = make(chan struct{}, maxConcurrentTasks)
}

func main() {
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

	r := gin.Default()

	// 启用跨域中间件
	r.Use(corsMiddleware())

	// 静态文件服务，托管转换产物（Editor.bin 以及 media 目录下的图片）
	r.Static("/static", tempDir)

	// API 接口：文件转码
	r.POST("/api/convert", handleConvert)

	// 启动定期清理定时器
	go startCleanupTimer(10 * time.Minute)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	log.Printf("Office Viewer Transcode Server is running on :%s (Max concurrent: %d)\n", port, maxConcurrentTasks)
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

// handleConvert 文件转码核心控制器
func handleConvert(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing file in form-data"})
		return
	}

	title := c.PostForm("title")
	if title == "" {
		title = file.Filename
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

	// 3. 保存上传的原始文档文件
	ext := filepath.Ext(title)
	if ext == "" {
		ext = ".docx" // 默认回退
	}
	inputFileName := "document" + ext
	inputFilePath := filepath.Join(workDir, inputFileName)

	if err := c.SaveUploadedFile(file, inputFilePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save uploaded file"})
		return
	}

	// 4. 构建 params.xml 转换配置
	outputFilePath := filepath.Join(workDir, "Editor.bin")
	paramsPath := filepath.Join(workDir, "params.xml")

	// 构建字体和主题目录（若本地有部署，可按实际路径配置。在此使用空目录或宿主环境配置）
	fontDir := filepath.Join(".", "assets", "fonts") + string(filepath.Separator)
	themeDir := filepath.Join(".", "assets", "themes")

	paramsContent := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8"?>
<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <m_sFontDir>%s</m_sFontDir>
  <m_sThemeDir>%s</m_sThemeDir>
  <m_sFileFrom>%s</m_sFileFrom>
  <m_sFileTo>%s</m_sFileTo>
  <m_bIsNoBase64>false</m_bIsNoBase64>
  <m_nCsvTxtEncoding>65001</m_nCsvTxtEncoding>
  <m_nCsvDelimiter>4</m_nCsvDelimiter>
  <m_sCsvDelimiterChar>,</m_sCsvDelimiterChar>
</TaskQueueDataConvert>`, fontDir, themeDir, inputFilePath, outputFilePath)

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
	log.Printf("[Task %s] Conversion completed successfully.\n", taskId)

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
				images[key] = fmt.Sprintf("%s://%s/static/%s/media/%s", scheme, host, taskId, fileName)
			}
		}
	}

	// 8. 响应结果
	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"taskId":       taskId,
		"documentType": inferDocumentType(title),
		"fileType":     strings.TrimPrefix(ext, "."),
		"editorBinUrl": fmt.Sprintf("%s://%s/static/%s/Editor.bin", scheme, host, taskId),
		"images":       images,
	})
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
