package utils

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestDownloadFile_SizeLimit(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(make([]byte, 2048)) // Serve 2KB
	}))
	defer ts.Close()

	dest := "test_download.bin"
	defer os.Remove(dest)

	// Set limit to 1KB, should fail
	err := DownloadFile(ts.URL, dest, 1024)
	if err == nil || err.Error() != "file exceeds maximum allowed size" {
		t.Fatalf("Expected limit error, got: %v", err)
	}

	// Set limit to 3KB, should pass
	err = DownloadFile(ts.URL, dest, 3072)
	if err != nil {
		t.Fatalf("Expected success, got: %v", err)
	}
}
