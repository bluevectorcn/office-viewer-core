package service

import (
	"os"
	"testing"
	"time"
)

func TestCleanupTimer(t *testing.T) {
	qm := NewQueueManager(1, time.Millisecond*500, "./test_temp")
	defer os.RemoveAll("./test_temp")
	
	os.MkdirAll("./test_temp/keep", 0755)
	os.MkdirAll("./test_temp/drop", 0755)
	
	// Change mtime of drop to be old
	oldTime := time.Now().Add(-1 * time.Hour)
	os.Chtimes("./test_temp/drop", oldTime, oldTime)
	
	go qm.StartCleanupTimer(time.Millisecond * 10)
	time.Sleep(time.Millisecond * 100)
	
	if _, err := os.Stat("./test_temp/drop"); !os.IsNotExist(err) {
		t.Error("Expected drop folder to be deleted")
	}
	if _, err := os.Stat("./test_temp/keep"); os.IsNotExist(err) {
		t.Error("Expected keep folder to be retained")
	}
}
