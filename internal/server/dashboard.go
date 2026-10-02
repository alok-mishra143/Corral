package server

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed dashboard.html
var dashboardHTML string

const tokenPlaceholder = `var AG_UI_TOKEN = "";`

func getDashboardHTML(uiToken string) string {
	if uiToken == "" {
		return dashboardHTML
	}
	quoted, err := json.Marshal(uiToken)
	if err != nil {
		return dashboardHTML
	}
	return strings.Replace(dashboardHTML, tokenPlaceholder, "var AG_UI_TOKEN = "+string(quoted)+";", 1)
}
