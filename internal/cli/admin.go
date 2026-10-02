package cli

import (
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"corral/internal/logger"
)

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd, args = "open", []string{url}
	case "windows":
		cmd, args = "cmd", []string{"/c", "start", "", url}
	default:
		cmd, args = "xdg-open", []string{url}
	}
	c := exec.Command(cmd, args...)
	if err := c.Start(); err == nil {
		_ = c.Process.Release()
	}
}

func RunAdmin(argv []string) int {
	port := ParsePort(argv)
	noOpen := contains(argv, "--no-open")
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	EnsureDaemon(port)

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + itoa(port) + "/health")
	if err != nil || resp.StatusCode != 200 {
		if resp != nil {
			resp.Body.Close()
		}
		logger.Warn("Daemon does not seem to be running.")
		fmt.Printf("  1. Start it:  corral daemon --port %d\n", port)
		fmt.Printf("  2. Then open: %s\n", url)
		return 1
	}
	resp.Body.Close()
	fmt.Println("Dashboard: " + url)
	if !noOpen {
		openBrowser(url)
		logger.Success("Opening dashboard in your browser…")
	}
	return 0
}
