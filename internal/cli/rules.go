package cli

import (
	"fmt"
	"strings"
	"time"

	"corral/internal/logger"
	"corral/internal/policy"
)

func isoNow() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func flagValue(argv []string, names ...string) (string, bool) {
	for _, n := range names {
		for i, a := range argv {
			if a == n && i+1 < len(argv) {
				return argv[i+1], true
			}
			if strings.HasPrefix(a, n+"=") {
				return strings.TrimPrefix(a, n+"="), true
			}
		}
	}
	return "", false
}

func RunRules(argv []string) int {
	if len(argv) == 0 {
		return listRules()
	}
	sub := argv[0]
	rest := argv[1:]
	switch sub {
	case "list":
		return listRules()
	case "deny":
		return denyRule(rest)
	case "rm":
		return removeRule(rest)
	default:
		logger.Error("Usage: corral rules [list|deny (--file GLOB|--command STR|--http HOST)|rm ID]")
		return 1
	}
}

func listRules() int {
	rules := policy.LoadRules("")
	if len(rules) == 0 {
		logger.Info("No rules. Example: corral rules deny --file '**/notes.md'")
		return 0
	}
	for _, r := range rules {
		mark := "[off]"
		if r.Enabled {
			mark = "[on] "
		}
		fmt.Printf("%s%s  %s\n", mark, r.ID, policy.DescribeRule(r))
	}
	return 0
}

func denyRule(rest []string) int {
	file, hasFile := flagValue(rest, "--file")
	command, hasCmd := flagValue(rest, "--command")
	httpVal, hasHTTP := flagValue(rest, "--http", "--url")

	kind := ""
	value := ""
	switch {
	case hasFile:
		kind, value = "file", file
	case hasCmd:
		kind, value = "command", command
	case hasHTTP:
		kind, value = "http", httpVal
	}
	if kind == "" || value == "" {
		logger.Error("Usage: corral rules deny (--file GLOB | --command SUBSTRING | --http HOST)")
		return 1
	}
	scope := policy.RuleScope{}
	if cwd, ok := flagValue(rest, "--cwd"); ok {
		scope.CwdPrefix = cwd
	}
	if session, ok := flagValue(rest, "--session"); ok {
		scope.SessionID = session
	}
	rule := &policy.FirewallRule{
		ID:        policy.NewRuleID(),
		Enabled:   true,
		Action:    "deny",
		Scope:     scope,
		Match:     policy.RuleMatch{Kind: kind, Value: value},
		CreatedAt: isoNow(),
	}
	rules := policy.LoadRules("")
	for _, existing := range rules {
		if policy.RuleKey(existing) == policy.RuleKey(rule) {
			logger.Info("Already denied: " + policy.DescribeRule(existing))
			return 0
		}
	}
	rules = append(rules, rule)
	if err := policy.SaveRules(rules, ""); err != nil {
		logger.Error("Could not save rule:", err.Error())
		return 1
	}
	logger.Success("Denied: " + policy.DescribeRule(rule))
	return 0
}

func removeRule(rest []string) int {
	if len(rest) == 0 {
		logger.Error("Usage: corral rules rm ID")
		return 1
	}
	id := rest[0]
	rules := policy.LoadRules("")
	next := make([]*policy.FirewallRule, 0, len(rules))
	for _, r := range rules {
		if r.ID != id {
			next = append(next, r)
		}
	}
	if len(next) == len(rules) {
		logger.Error("Rule not found: " + id)
		return 1
	}
	if err := policy.SaveRules(next, ""); err != nil {
		logger.Error("Could not save rules:", err.Error())
		return 1
	}
	logger.Success("Removed " + id)
	return 0
}
