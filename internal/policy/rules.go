package policy

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

type RuleScope struct {
	SessionID string `json:"sessionId,omitempty"`
	CwdPrefix string `json:"cwdPrefix,omitempty"`
}

type RuleMatch struct {
	Kind  string `json:"kind"` // file | command | http
	Value string `json:"value"`
}

type FirewallRule struct {
	ID        string    `json:"id"`
	Name      string    `json:"name,omitempty"`
	Enabled   bool      `json:"enabled"`
	Action    string    `json:"action"`
	Scope     RuleScope `json:"scope"`
	Match     RuleMatch `json:"match"`
	CreatedAt string    `json:"createdAt,omitempty"`
}

func asRecord(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func ParseRule(item any) *FirewallRule {
	m, ok := asRecord(item)
	if !ok {
		return nil
	}
	id, _ := m["id"].(string)
	if id == "" || len(id) > 64 {
		return nil
	}
	name := ""
	if raw, present := m["name"]; present && raw != nil {
		s, ok := raw.(string)
		if !ok || len(s) > 160 {
			return nil
		}
		name = s
	}
	match, ok := asRecord(m["match"])
	if !ok {
		return nil
	}
	kind, _ := match["kind"].(string)
	if kind != "file" && kind != "command" && kind != "http" {
		return nil
	}
	value, _ := match["value"].(string)
	if value == "" || len(value) > 1024 {
		return nil
	}
	scope := RuleScope{}
	if raw, present := m["scope"]; present && raw != nil {
		sm, ok := asRecord(raw)
		if !ok {
			return nil
		}
		if v, present := sm["sessionId"]; present && v != nil {
			s, ok := v.(string)
			if !ok || s == "" || len(s) > 256 {
				return nil
			}
			scope.SessionID = s
		}
		if v, present := sm["cwdPrefix"]; present && v != nil {
			s, ok := v.(string)
			if !ok || s == "" || len(s) > 1024 {
				return nil
			}
			scope.CwdPrefix = s
		}
	}
	enabled := true
	if raw, present := m["enabled"]; present {
		if b, ok := raw.(bool); ok {
			enabled = b
		}
	}
	createdAt := ""
	if raw, present := m["createdAt"]; present && raw != nil {
		if s, ok := raw.(string); ok {
			createdAt = s
		}
	}
	return &FirewallRule{
		ID:        id,
		Name:      name,
		Enabled:   enabled,
		Action:    "deny",
		Scope:     scope,
		Match:     RuleMatch{Kind: kind, Value: value},
		CreatedAt: createdAt,
	}
}

func DefaultRulesPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".corral", "rules.json")
}

func LoadRules(path string) []*FirewallRule {
	if path == "" {
		path = DefaultRulesPath()
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil
	}
	var list []any
	if arr, ok := parsed.([]any); ok {
		list = arr
	} else if obj, ok := asRecord(parsed); ok {
		if arr, ok := obj["rules"].([]any); ok {
			list = arr
		}
	}
	if list == nil {
		return nil
	}
	out := make([]*FirewallRule, 0, len(list))
	for _, item := range list {
		if r := ParseRule(item); r != nil {
			out = append(out, r)
		}
	}
	return out
}

type rulesFile struct {
	Version int             `json:"version"`
	Rules   []*FirewallRule `json:"rules"`
}

func SaveRules(rules []*FirewallRule, path string) error {
	if path == "" {
		path = DefaultRulesPath()
	}
	if rules == nil {
		rules = []*FirewallRule{}
	}
	data, err := json.MarshalIndent(rulesFile{Version: 1, Rules: rules}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func NewRuleID() string {
	return "rule_" + strconv.FormatInt(time.Now().UnixMilli(), 36) + "_" + randSuffix(8)
}

// RuleKey uniquely identifies a rule by kind and value, for de-duplication.
func RuleKey(r *FirewallRule) string {
	return r.Match.Kind + "\x00" + r.Match.Value
}

func randSuffix(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func DescribeRule(rule *FirewallRule) string {
	var scope string
	switch {
	case rule.Scope.SessionID != "":
		id := rule.Scope.SessionID
		if len(id) > 12 {
			id = id[:12]
		}
		scope = "session " + id + "…"
	case rule.Scope.CwdPrefix != "":
		scope = "project " + rule.Scope.CwdPrefix
	default:
		scope = "all agents"
	}
	return fmt.Sprintf("%s:%s → deny (%s)", rule.Match.Kind, rule.Match.Value, scope)
}
