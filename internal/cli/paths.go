package cli

import (
	"os"
	"path/filepath"
)

func GlobalOpencodePluginDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "opencode", "plugins")
}
