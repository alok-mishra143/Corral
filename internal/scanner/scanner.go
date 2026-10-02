package scanner

import (
	"regexp"
	"strings"

	"corral/internal/platform"
)

type RunningAgent struct {
	Name    string `json:"name"`
	PID     int    `json:"pid"`
	Command string `json:"command"`
	Cwd     string `json:"cwd,omitempty"`
	IDE     string `json:"ide,omitempty"`
}

var patterns = []struct {
	name string
	re   *regexp.Regexp
}{
	{"OpenCode", regexp.MustCompile(`(?i)opencode`)},
}

var ideMarkers = []struct {
	name string
	re   *regexp.Regexp
}{
	{"VS Code", regexp.MustCompile(`(?i)visual studio code\.app|/code( -oss)?( |$|/)|\bcode\b.*helper|vscodium`)},
	{"Zed", regexp.MustCompile(`(?i)zed\.app|\bzed\b`)},
	{"Cursor", regexp.MustCompile(`(?i)cursor\.app|\bcursor\b`)},
	{"Windsurf", regexp.MustCompile(`(?i)windsurf\.app|\bwindsurf\b`)},
	{"JetBrains", regexp.MustCompile(`(?i)intellij|webstorm|pycharm|goland|phpstorm|clion|rider|android studio`)},
	{"Xcode", regexp.MustCompile(`(?i)xcode\.app|\bxcodebuild\b`)},
	{"Sublime", regexp.MustCompile(`(?i)sublime text\.app|\bsubl\b`)},
	{"Vim", regexp.MustCompile(`(?i)/vim?\s|^\s*vim?\s`)},
	{"Neovim", regexp.MustCompile(`(?i)nvim`)},
	{"Terminal", regexp.MustCompile(`(?i)terminal\.app|iterm|ghostty|alacritty|kitty|wezterm|tmux`)},
}

var noise = regexp.MustCompile(`(?i)corral|grep|ps -axo|crash-handler|crashpad|mcp-server|/extensions/|helper|renderer|gpu-process|utility-network|wakatime|codebook|package-version|node($|\s)|/node `)

func detectIDE(args string) string {
	for _, m := range ideMarkers {
		if m.re.MatchString(args) {
			return m.name
		}
	}
	return ""
}

func baseOf(args string) string {
	first := strings.Fields(strings.TrimSpace(args))
	if len(first) == 0 {
		return ""
	}
	seg := strings.Split(strings.ReplaceAll(first[0], `\`, "/"), "/")
	return seg[len(seg)-1]
}

func ScanAgents() []RunningAgent {
	rows, err := platform.ScanProcesses()
	if err != nil {
		return nil
	}
	byPid := make(map[int]platform.Proc, len(rows))
	for _, r := range rows {
		byPid[r.PID] = r
	}

	parentIDE := func(pid int) string {
		cur := byPid[pid].PPID
		for i := 0; i < 6 && cur != 0; i++ {
			p, ok := byPid[cur]
			if !ok {
				break
			}
			if hit := detectIDE(p.Args); hit != "" {
				return hit
			}
			cur = p.PPID
		}
		return ""
	}

	agents := make([]RunningAgent, 0)
	for _, r := range rows {
		if noise.MatchString(r.Args) {
			continue
		}
		base := strings.TrimSuffix(baseOf(r.Args), ".exe")
		for _, p := range patterns {
			if p.re.MatchString(base) || (p.re.MatchString(r.Args) && !regexp.MustCompile(`(?i)\b(Zed|Cursor|Code|Windsurf)\.app\b`).MatchString(r.Args)) {
				command := r.Args
				if len(command) > 300 {
					command = command[:300]
				}
				agents = append(agents, RunningAgent{
					Name:    p.name,
					PID:     r.PID,
					Command: command,
					IDE:     parentIDE(r.PID),
				})
				break
			}
		}
		if len(agents) >= 100 {
			break
		}
	}
	return agents
}
