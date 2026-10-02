package cli

import (
	"os"
	"strconv"
	"strings"
	"time"

	"corral/internal/platform"
	"corral/internal/server"
)

func ParsePort(argv []string) int {
	port := server.DefaultPort
	for i, a := range argv {
		if a == "--port" && i+1 < len(argv) {
			if n, err := strconv.Atoi(argv[i+1]); err == nil {
				return n
			}
		}
	}
	for _, a := range argv {
		if strings.HasPrefix(a, "--port=") {
			if n, err := strconv.Atoi(strings.TrimPrefix(a, "--port=")); err == nil {
				return n
			}
		}
	}
	for _, a := range argv {
		if len(a) >= 2 && len(a) <= 5 && isDigits(a) {
			if n, err := strconv.Atoi(a); err == nil {
				return n
			}
		}
	}
	return port
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func ListeningPid(port int) int {
	return platform.ListeningPid(port)
}

func WaitGone(pid int, ms int) bool {
	deadline := time.Now().Add(time.Duration(ms) * time.Millisecond)
	for time.Now().Before(deadline) {
		if !platform.Alive(pid) {
			return true
		}
		time.Sleep(200 * time.Millisecond)
	}
	return false
}

type StopStatus string

const (
	StopAbsent  StopStatus = "absent"
	StopStopped StopStatus = "stopped"
	StopKilled  StopStatus = "killed"
	StopSelf    StopStatus = "self"
	StopFailed  StopStatus = "failed"
)

type StopResult struct {
	Status StopStatus
	PID    int
}

func StopDaemon(port int) StopResult {
	pid := ListeningPid(port)
	if pid == 0 {
		return StopResult{Status: StopAbsent}
	}
	if pid == os.Getpid() {
		return StopResult{Status: StopSelf, PID: pid}
	}
	if err := platform.Terminate(pid); err != nil {
		if WaitGone(pid, 1000) {
			return StopResult{Status: StopStopped, PID: pid}
		}
		return StopResult{Status: StopFailed, PID: pid}
	}
	if WaitGone(pid, 5000) {
		return StopResult{Status: StopStopped, PID: pid}
	}
	_ = platform.Kill(pid)
	if WaitGone(pid, 5000) {
		return StopResult{Status: StopKilled, PID: pid}
	}
	return StopResult{Status: StopFailed, PID: pid}
}
