package service

import (
	"os"
	"path/filepath"
	"time"
)

type QueueManager struct {
	Sem              chan struct{}
	TempDir          string
	CleanupThreshold time.Duration
}

func NewQueueManager(maxTasks int, threshold time.Duration, tempDir string) *QueueManager {
	return &QueueManager{
		Sem:              make(chan struct{}, maxTasks),
		TempDir:          tempDir,
		CleanupThreshold: threshold,
	}
}

func (q *QueueManager) StartCleanupTimer(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		files, err := os.ReadDir(q.TempDir)
		if err != nil {
			continue
		}
		now := time.Now()
		for _, file := range files {
			if file.IsDir() {
				dirPath := filepath.Join(q.TempDir, file.Name())
				info, err := os.Stat(dirPath)
				if err != nil {
					continue
				}
				if now.Sub(info.ModTime()) > q.CleanupThreshold {
					// Lock-free safe cleanup
					os.RemoveAll(dirPath)
				}
			}
		}
	}
}
