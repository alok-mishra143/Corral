package cli

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"corral/internal/logger"
	"corral/internal/policy"
)

func itoa(n int) string { return strconv.Itoa(n) }

func RunDoctor(argv []string) int {
	port := ParsePort(argv)
	ok := true

	if DaemonHealthy(port) {
		logger.Success(fmt.Sprintf("daemon reachable at 127.0.0.1:%d", port))
	} else {
		logger.Error(fmt.Sprintf("daemon NOT reachable at 127.0.0.1:%d — run `corral daemon`", port))
		ok = false
	}

	pluginPath := filepath.Join(GlobalOpencodePluginDir(), "corral.ts")
	if data, err := os.ReadFile(pluginPath); err == nil && strings.Contains(string(data), "CorralPlugin") {
		logger.Success(fmt.Sprintf("OpenCode plugin installed (%s)", pluginPath))
	} else {
		logger.Error("OpenCode plugin missing — run `corral setup`")
		ok = false
	}

	if _, err := os.ReadFile(policy.DefaultRulesPath()); err != nil && !errors.Is(err, os.ErrNotExist) {
		logger.Error("rules unreadable:", err.Error())
		ok = false
	} else {
		rules := policy.LoadRules("")
		enabled := 0
		for _, r := range rules {
			if r.Enabled {
				enabled++
			}
		}
		logger.Success(fmt.Sprintf("rules readable (%d total, %d enabled)", len(rules), enabled))
	}

	if !ok {
		fmt.Println("\nFix: run `corral setup`, then `corral daemon`, then restart OpenCode.")
		return 1
	}
	return 0
}
