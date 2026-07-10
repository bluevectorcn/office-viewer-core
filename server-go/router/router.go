package router

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"office-viewer-backend/config"
	"office-viewer-backend/controller"

	"github.com/gin-gonic/gin"
)

func SetupRouter(cfg *config.AppConfig, docCtrl *controller.DocumentController) *gin.Engine {
	r := gin.Default()

	r.Use(CorsMiddleware())
	r.Use(CoopCoepMiddleware())

	// API 路由
	var baseGroup gin.IRoutes
	if cfg.ContextPath != "" {
		baseGroup = r.Group(cfg.ContextPath)
	} else {
		baseGroup = r
	}

	baseGroup.POST("/api/convert", docCtrl.HandleConvert)
	baseGroup.POST("/api/export-pdf", docCtrl.HandleExportPdf)

	// 静态文件与 SPA 路由
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		log.Printf("[NoRoute] Received request path: %s (Raw query: %s)\n", path, c.Request.URL.RawQuery)

		// 如果配置了 contextPath，需要剥离前缀以定位到正确的 dist 静态资源
		if cfg.ContextPath != "" && strings.HasPrefix(path, cfg.ContextPath) {
			path = strings.TrimPrefix(path, cfg.ContextPath)
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

	return r
}
