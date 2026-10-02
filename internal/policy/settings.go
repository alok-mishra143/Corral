package policy

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type CorralSettings struct {
	AllowDashboardAccess bool `json:"allowDashboardAccess"`
}

var DefaultSettings = CorralSettings{AllowDashboardAccess: false}

func DefaultSettingsPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".corral", "settings.json")
}

func NormalizeSettings(value any) CorralSettings {
	m, ok := value.(map[string]any)
	if !ok {
		return DefaultSettings
	}
	out := DefaultSettings
	if b, ok := m["allowDashboardAccess"].(bool); ok {
		out.AllowDashboardAccess = b
	}
	return out
}

func LoadSettings(path string) CorralSettings {
	if path == "" {
		path = DefaultSettingsPath()
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return DefaultSettings
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return DefaultSettings
	}
	return NormalizeSettings(parsed)
}

func SaveSettings(settings CorralSettings, path string) (CorralSettings, error) {
	if path == "" {
		path = DefaultSettingsPath()
	}
	normalized := NormalizeSettings(map[string]any{"allowDashboardAccess": settings.AllowDashboardAccess})
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return normalized, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return normalized, err
	}
	return normalized, os.WriteFile(path, append(data, '\n'), 0o644)
}
