// server-go/config/config_test.go
package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	os.Setenv("PORT", "8080")
	os.Setenv("MAX_CONCURRENT_TASKS", "10")
	os.Setenv("TEMP_DIR", "./test_temp")
	
	cfg := LoadConfig()
	
	if cfg.Port != "8080" {
		t.Errorf("Expected port 8080, got %s", cfg.Port)
	}
	if cfg.MaxConcurrentTasks != 10 {
		t.Errorf("Expected 10 tasks, got %d", cfg.MaxConcurrentTasks)
	}
	if cfg.CleanupThreshold != 30*time.Minute {
		t.Errorf("Expected 30m, got %v", cfg.CleanupThreshold)
	}
}
