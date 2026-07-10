package utils

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

func DownloadFile(url string, destPath string, maxSize int64) error {
	client := &http.Client{Timeout: 45 * time.Second}
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

	limitReader := io.LimitReader(resp.Body, maxSize+1)
	written, err := io.Copy(out, limitReader)
	if err != nil {
		return err
	}
	if written > maxSize {
		return errors.New("file exceeds maximum allowed size")
	}
	return nil
}
