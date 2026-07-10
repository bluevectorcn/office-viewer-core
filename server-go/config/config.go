// server-go/config/config.go
package config

import (
	"fmt"
	"os"
	"time"
)

type AppConfig struct {
	Port               string
	MaxConcurrentTasks int
	X2tPath            string
	TempDir            string
	CleanupThreshold   time.Duration
	ContextPath        string
	MaxDownloadSize    int64
}

func LoadConfig() *AppConfig {
	cfg := &AppConfig{
		Port:               "3000",
		MaxConcurrentTasks: 4,
		X2tPath:            "./bin/x2t",
		TempDir:            "./temp",
		CleanupThreshold:   30 * time.Minute,
		ContextPath:        "",
		MaxDownloadSize:    500 * 1024 * 1024, // 500MB
	}

	if port := os.Getenv("PORT"); port != "" {
		cfg.Port = port
	}
	if envMax := os.Getenv("MAX_CONCURRENT_TASKS"); envMax != "" {
		var val int
		if _, err := fmt.Sscanf(envMax, "%d", &val); err == nil && val > 0 {
			cfg.MaxConcurrentTasks = val
		}
	}
	if envX2T := os.Getenv("X2T_PATH"); envX2T != "" {
		cfg.X2tPath = envX2T
	}
	if envTemp := os.Getenv("TEMP_DIR"); envTemp != "" {
		cfg.TempDir = envTemp
	}
	if envContext := os.Getenv("CONTEXT_PATH"); envContext != "" {
		cfg.ContextPath = envContext
	}

	return cfg
}
