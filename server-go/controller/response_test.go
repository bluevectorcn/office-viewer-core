package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestErrorResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	RespondError(c, http.StatusBadRequest, "test error", "details here")

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected 400, got %d", w.Code)
	}
	
	var res map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &res)
	if res["success"] != false || res["error"] != "test error" {
		t.Errorf("Invalid json response: %v", res)
	}
}
