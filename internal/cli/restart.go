package cli

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"

	"corral/internal/logger"
	"corral/internal/platform"
)

func RunRestart(argv []string) int {
	port := ParsePort(argv)
	pid := ListeningPid(port)
	if pid != 0 {
		if pid == os.Getpid() {
			logger.Error("Refusing to kill our own process.")
			return 1
		}
		logger.Info(fmt.Sprintf("Stopping old daemon on :%d (pid %d)…", port, pid))
		if err := platform.Terminate(pid); err != nil {
			logger.Error(fmt.Sprintf("Could not signal pid %d: %s", pid, err.Error()))
			return 1
		}
		if !WaitGone(pid, 5000) {
			logger.Info(fmt.Sprintf("pid %d did not exit, killing it…", pid))
			_ = platform.Kill(pid)
			if !WaitGone(pid, 5000) {
				logger.Error(fmt.Sprintf("pid %d is still alive — kill it manually and retry.", pid))
				return 1
			}
		}
		logger.Success(fmt.Sprintf("Old daemon (pid %d) stopped.", pid))
	} else {
		logger.Info(fmt.Sprintf("Nothing listening on :%d — starting fresh.", port))
	}

	exe, err := os.Executable()
	if err != nil {
		logger.Error("Could not locate executable:", err.Error())
		return 1
	}
	cmd := exec.Command(exe, "daemon", "--port", strconv.Itoa(port))
	cmd.SysProcAttr = platform.DetachSysProcAttr()
	if err := cmd.Start(); err != nil {
		logger.Error("Could not spawn daemon:", err.Error())
		return 1
	}
	newPid := cmd.Process.Pid
	_ = cmd.Process.Release()

	for i := 0; i < 25; i++ {
		time.Sleep(200 * time.Millisecond)
		if DaemonHealthy(port) {
			logger.Success(fmt.Sprintf("Daemon restarted on 127.0.0.1:%d (pid %d).", port, newPid))
			fmt.Printf("Dashboard: http://127.0.0.1:%d/\n", port)
			return 0
		}
	}
	logger.Error("Daemon was spawned but /health is not answering — check logs.")
	return 1
}
