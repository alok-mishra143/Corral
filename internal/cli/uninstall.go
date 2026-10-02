package cli

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"corral/internal/logger"
)

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func removePath(path string) (bool, error) {
	if !exists(path) {
		return false, nil
	}
	if err := os.RemoveAll(path); err != nil {
		return false, err
	}
	return true, nil
}

func isYes(answer string) bool {
	a := strings.ToLower(strings.TrimSpace(answer))
	return a == "yes" || a == "y"
}

func isTTY() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func askChoices(keepData bool, in *bufio.Scanner) (bool, bool) {
	fmt.Println("Uninstalling removes the daemon, the OpenCode plugin and the corral command.")
	fmt.Print("Are you sure you want to uninstall corral? (yes/no) ")
	if !in.Scan() || !isYes(in.Text()) {
		return false, false
	}
	if keepData {
		return true, false
	}
	fmt.Print("Do you want to remove your saved settings and rules too? (yes/no) ")
	removeData := in.Scan() && isYes(in.Text())
	return true, removeData
}

func repoRoot() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	root := filepath.Dir(filepath.Dir(exe))
	if data, err := os.ReadFile(filepath.Join(root, "go.mod")); err == nil && strings.Contains(string(data), "module corral") {
		return root
	}
	return ""
}

func RunUninstall(argv []string) int {
	yes := contains(argv, "--yes") || contains(argv, "-y")
	keepData := contains(argv, "--keep-data")
	port := ParsePort(argv)

	removeData := !keepData
	if !yes {
		if !isTTY() {
			logger.Error("Refusing to uninstall non-interactively. Re-run with --yes to confirm.")
			return 1
		}
		proceed, rd := askChoices(keepData, bufio.NewScanner(os.Stdin))
		if !proceed {
			logger.Info("Aborted — nothing was changed.")
			return 0
		}
		removeData = rd
	}

	ok := true
	home, _ := os.UserHomeDir()

	stop := StopDaemon(port)
	switch stop.Status {
	case StopAbsent:
		logger.Info(fmt.Sprintf("No daemon listening on :%d.", port))
	case StopFailed, StopSelf:
		logger.Warn(fmt.Sprintf("Could not stop the daemon on :%d (pid %d) — stop it manually.", port, stop.PID))
		ok = false
	default:
		logger.Success(fmt.Sprintf("Daemon on :%d stopped (pid %d).", port, stop.PID))
	}

	plugin := filepath.Join(GlobalOpencodePluginDir(), "corral.ts")
	if removed, err := removePath(plugin); err != nil {
		logger.Warn("Could not remove plugin:", err.Error())
		ok = false
	} else if removed {
		logger.Success("Removed plugin " + plugin)
	} else {
		logger.Info("Plugin was not installed.")
	}

	binDir := filepath.Join(home, ".local", "bin")
	for _, bin := range []string{"corral"} {
		p := filepath.Join(binDir, bin)
		if removed, err := removePath(p); err != nil {
			logger.Warn("Could not remove "+p+":", err.Error())
			ok = false
		} else if removed {
			logger.Success("Removed command " + p)
		}
	}

	dataDir := filepath.Join(home, ".corral")
	if !removeData {
		logger.Info("Kept your settings and rules in " + dataDir + " — a future install will reuse them.")
	} else if removed, err := removePath(dataDir); err != nil {
		logger.Warn("Could not remove ~/.corral:", err.Error())
		ok = false
	} else if removed {
		logger.Success("Removed ~/.corral (rules, settings, events)")
	}

	repo := repoRoot()
	fmt.Println("")
	if ok {
		logger.Success("corral uninstalled.")
	} else {
		logger.Warn("corral partially uninstalled — see warnings above.")
	}
	if repo != "" {
		fmt.Println("The repo checkout itself was kept: " + repo)
		fmt.Printf("Remove it with: rm -rf \"%s\"\n", repo)
	}
	fmt.Println("Restart OpenCode to unload the plugin if it is still running.")
	if !ok {
		return 1
	}
	return 0
}
