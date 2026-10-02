// Package platform isolates the Unix- and Windows-specific process and port
// handling used by the rest of corral.
package platform

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Proc is one process row: pid, parent pid and the full command line.
type Proc struct {
	PID  int
	PPID int
	Args string
}

// runPicker runs a native chooser, returning its first output line. A non-zero
// exit (the user canceling) yields "" with no error; a missing binary errors.
func runPicker(name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, name, args...).Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return "", nil
		}
		return "", err
	}
	line := strings.TrimSpace(string(out))
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = strings.TrimSpace(line[:i])
	}
	return line, nil
}

// PickFile opens the OS-native file chooser and returns the chosen absolute
// path, or "" when the user cancels.
func PickFile(prompt string) (string, error) {
	switch runtime.GOOS {
	case "darwin":
		return runPicker("osascript", "-e", `POSIX path of (choose file with prompt "`+prompt+`")`)
	case "windows":
		script := "Add-Type -AssemblyName System.Windows.Forms; " +
			"$d = New-Object System.Windows.Forms.OpenFileDialog; " +
			"$d.Title = '" + prompt + "'; " +
			"if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }"
		return runPicker("powershell.exe", "-NoProfile", "-STA", "-Command", script)
	default:
		if out, err := runPicker("zenity", "--file-selection", "--title="+prompt); err == nil {
			return out, nil
		}
		if out, err := runPicker("kdialog", "--getopenfilename", ".", "*"); err == nil {
			return out, nil
		}
		return "", errors.New("no native file picker found (install zenity or kdialog)")
	}
}
