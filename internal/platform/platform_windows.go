//go:build windows

package platform

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	createNewProcessGroup = 0x00000200
	detachedProcess       = 0x00000008
	processQueryInfo      = 0x0400
	stillActive           = 259
)

// Alive reports whether a process with pid exists.
func Alive(pid int) bool {
	h, err := syscall.OpenProcess(processQueryInfo, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(h)
	var code uint32
	if err := syscall.GetExitCodeProcess(h, &code); err != nil {
		return false
	}
	return code == stillActive
}

// Terminate ends a process (Windows has no SIGTERM equivalent).
func Terminate(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}

// Kill ends a process forcibly.
func Kill(pid int) error {
	return Terminate(pid)
}

// DetachSysProcAttr detaches a spawned daemon from the console.
func DetachSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: createNewProcessGroup | detachedProcess}
}

// NotifySignals registers the signals that stop the daemon.
func NotifySignals(ch chan os.Signal) {
	signal.Notify(ch, os.Interrupt)
}

// IsAddrInUse reports whether err means the port is already taken.
func IsAddrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}

// ListeningPid returns the pid listening on the TCP port, or 0.
func ListeningPid(port int) int {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "netstat", "-ano", "-p", "tcp").Output()
	if err != nil {
		return 0
	}
	suffix := ":" + strconv.Itoa(port)
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || !strings.EqualFold(fields[0], "TCP") {
			continue
		}
		if !strings.EqualFold(fields[3], "LISTENING") || !strings.HasSuffix(fields[1], suffix) {
			continue
		}
		pid, err := strconv.Atoi(fields[4])
		if err == nil && pid > 0 {
			return pid
		}
	}
	return 0
}

// PortOwner describes what is listening on the port, or "".
func PortOwner(port int) string {
	pid := ListeningPid(port)
	if pid == 0 {
		return ""
	}
	return "pid " + strconv.Itoa(pid)
}

// ScanProcesses lists running processes via PowerShell/CIM.
func ScanProcesses() ([]Proc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	script := "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"
	out, err := exec.CommandContext(ctx, "powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return nil, err
	}
	type row struct {
		ProcessID       int    `json:"ProcessId"`
		ParentProcessID int    `json:"ParentProcessId"`
		CommandLine     string `json:"CommandLine"`
	}
	trimmed := strings.TrimSpace(string(out))
	var rows []row
	switch {
	case strings.HasPrefix(trimmed, "["):
		if err := json.Unmarshal([]byte(trimmed), &rows); err != nil {
			return nil, err
		}
	case strings.HasPrefix(trimmed, "{"):
		var one row
		if err := json.Unmarshal([]byte(trimmed), &one); err != nil {
			return nil, err
		}
		rows = []row{one}
	default:
		return nil, nil
	}
	procs := make([]Proc, 0, len(rows))
	for _, r := range rows {
		if r.ProcessID > 0 {
			procs = append(procs, Proc{PID: r.ProcessID, PPID: r.ParentProcessID, Args: r.CommandLine})
		}
	}
	return procs, nil
}
