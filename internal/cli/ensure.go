package cli

import (
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"

	"corral/internal/platform"
	"corral/internal/server"
)

func DaemonHealthy(port int) bool {
	if port == 0 {
		port = server.DefaultPort
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/health")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == 200
}

func EnsureDaemon(port int) bool {
	if port == 0 {
		port = server.DefaultPort
	}
	if DaemonHealthy(port) {
		return true
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	cmd := exec.Command(exe, "daemon", "--port", strconv.Itoa(port))
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	cmd.SysProcAttr = platform.DetachSysProcAttr()
	if err := cmd.Start(); err != nil {
		var pathErr *exec.Error
		if errors.As(err, &pathErr) {
			return false
		}
		return false
	}
	_ = cmd.Process.Release()
	for i := 0; i < 20; i++ {
		time.Sleep(250 * time.Millisecond)
		if DaemonHealthy(port) {
			return true
		}
	}
	return false
}
