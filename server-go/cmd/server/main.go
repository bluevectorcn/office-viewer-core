package main

import (
	"log"
	"os"
	"time"

	"office-viewer-backend/config"
	"office-viewer-backend/controller"
	"office-viewer-backend/router"
	"office-viewer-backend/service"

	"github.com/rakyll/magicmime"
)

func main() {
	if err := magicmime.Open(magicmime.MAGIC_MIME_TYPE); err != nil {
		log.Fatalf("Failed to open magicmime: %v", err)
	}
	defer magicmime.Close()

	cfg := config.LoadConfig()

	if err := os.MkdirAll(cfg.TempDir, 0755); err != nil {
		log.Fatalf("Failed to create temp directory: %v", err)
	}

	queueMgr := service.NewQueueManager(cfg.MaxConcurrentTasks, cfg.CleanupThreshold, cfg.TempDir)
	go queueMgr.StartCleanupTimer(10 * time.Minute)

	convSvc := service.NewConvertService(cfg.X2tPath, queueMgr)
	expSvc := service.NewExportService(cfg.X2tPath, queueMgr)
	docCtrl := controller.NewDocumentController(convSvc, expSvc, cfg)

	r := router.SetupRouter(cfg, docCtrl)

	log.Printf("Office Viewer Transcode Server is running on :%s\n", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}