package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"corral/integrations"
	"corral/internal/logger"
)

func RunSetup() int {
	content := integrations.OpencodePlugin
	if !strings.Contains(content, "CorralPlugin") {
		logger.Error("Embedded plugin template is missing CorralPlugin.")
		return 1
	}
	destDir := GlobalOpencodePluginDir()
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		logger.Error("Setup failed:", err.Error())
		return 1
	}
	dest := filepath.Join(destDir, "corral.ts")
	if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
		logger.Error("Setup failed:", err.Error())
		return 1
	}
	logger.Success("OpenCode plugin installed → " + dest)
	fmt.Println("")
	fmt.Println("Next steps:")
	fmt.Println("  1. corral daemon               # must be running to enforce rules")
	fmt.Println("  2. restart OpenCode                # so it loads the plugin")
	fmt.Println("  3. corral rules deny --file '**/notes.md'")
	fmt.Println("  4. corral doctor               # verify everything")
	return 0
}
