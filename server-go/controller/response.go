package controller

import "github.com/gin-gonic/gin"

func RespondError(c *gin.Context, status int, errMessage string, details string) {
	c.JSON(status, gin.H{
		"success": false,
		"error":   errMessage,
		"details": details,
	})
}
