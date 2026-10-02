//go:build !windows

package platform

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Alive reports whether a process with pid exists.
func Alive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

// Terminate asks a process to exit (SIGTERM).
func Terminate(pid int) error {
	return syscall.Kill(pid, syscall.SIGTERM)
}

// Kill forces a process to exit (SIGKILL).
func Kill(pid int) error {
	return syscall.Kill(pid, syscall.SIGKILL)
}

// DetachSysProcAttr puts a spawned daemon in its own session.
func DetachSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}

// NotifySignals registers the signals that stop the daemon.
func NotifySignals(ch chan os.Signal) {
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
}

// IsAddrInUse reports whether err means the port is already taken.
func IsAddrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}

// ListeningPid returns the pid listening on the TCP port, or 0.
func ListeningPid(port int) int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "lsof", "-ti", "TCP:"+strconv.Itoa(port), "-sTCP:LISTEN")
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	first := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	pid, err := strconv.Atoi(first)
	if err != nil || pid <= 0 {
		return 0
	}
	return pid
}

// PortOwner describes what is listening on the port, or "".
func PortOwner(port int) string {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "lsof", "-i", ":"+strconv.Itoa(port), "-sTCP:LISTEN", "-F", "cp")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	var pid, name string
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "p") {
			pid = line[1:]
		}
		if strings.HasPrefix(line, "c") {
			name = strings.TrimSpace(line[1:])
		}
	}
	switch {
	case pid != "" && name != "":
		return name + " (pid " + pid + ")"
	case pid != "":
		return "pid " + pid
	default:
		return name
	}
}

var rowRe = regexp.MustCompile(`^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$`)

// ScanProcesses lists running processes via ps.
func ScanProcesses() ([]Proc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ps", "-axo", "pid=,ppid=,comm=,args=").Output()
	if err != nil {
		return nil, err
	}
	var procs []Proc
	for _, line := range strings.Split(string(out), "\n") {
		m := rowRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		pid, _ := strconv.Atoi(m[1])
		ppid, _ := strconv.Atoi(m[2])
		procs = append(procs, Proc{PID: pid, PPID: ppid, Args: m[4]})
	}
	return procs, nil
}
