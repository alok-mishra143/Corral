package events

import (
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type AgentName string

const AgentOpenCode AgentName = "opencode"

type AgentEvent struct {
	ID        string         `json:"id"`
	Timestamp string         `json:"timestamp"`
	Agent     Agent          `json:"agent"`
	Type      string         `json:"type"`
	Cwd       string         `json:"cwd,omitempty"`
	Data      map[string]any `json:"data"`
}

type Agent struct {
	Name      AgentName `json:"name"`
	PID       *int      `json:"pid,omitempty"`
	SessionID string    `json:"sessionId,omitempty"`
}

var eventTypes = map[string]struct{}{
	"session.started": {}, "session.stopped": {}, "session.idle": {},
	"tool.started": {}, "tool.completed": {},
	"file.read": {}, "file.edited": {}, "file.created": {}, "file.deleted": {},
	"command.executed": {}, "http.request": {}, "http.response": {},
	"permission.requested": {}, "error": {},
}

var (
	sensitiveKey       = regexp.MustCompile(`(?i)api[_-]?key|apikey|auth(orization)?|bearer|token|secret|cookie|set-cookie|password|passwd|private[_-]?key|client[_-]?secret|session[_-]?key`)
	sensitiveQueryParm = regexp.MustCompile(`(?i)key|token|secret|auth|session|code|password`)
)

func isRecord(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func ParseEvent(input any) *AgentEvent {
	m, ok := isRecord(input)
	if !ok {
		return nil
	}
	id, _ := m["id"].(string)
	if id == "" || len(id) > 128 {
		return nil
	}
	ts, _ := m["timestamp"].(string)
	if ts == "" {
		return nil
	}
	if _, err := time.Parse(time.RFC3339Nano, ts); err != nil {
		return nil
	}
	agent, ok := isRecord(m["agent"])
	if !ok || agent["name"] != "opencode" {
		return nil
	}
	var pid *int
	if raw, present := agent["pid"]; present && raw != nil {
		f, ok := raw.(float64)
		if !ok || f <= 0 || math.Trunc(f) != f {
			return nil
		}
		p := int(f)
		pid = &p
	}
	sessionID := ""
	if raw, present := agent["sessionId"]; present && raw != nil {
		s, ok := raw.(string)
		if !ok {
			return nil
		}
		sessionID = s
	}
	evType, _ := m["type"].(string)
	if _, ok := eventTypes[evType]; !ok {
		return nil
	}
	cwd := ""
	if raw, present := m["cwd"]; present && raw != nil {
		s, ok := raw.(string)
		if !ok {
			return nil
		}
		cwd = s
	}
	data, ok := isRecord(m["data"])
	if !ok {
		return nil
	}
	ev := &AgentEvent{
		ID:        id,
		Timestamp: ts,
		Agent:     Agent{Name: AgentOpenCode, PID: pid, SessionID: sessionID},
		Type:      evType,
		Cwd:       cwd,
		Data:      data,
	}
	return RedactEvent(ev)
}

func RedactHeaders(headers map[string]any) map[string]any {
	out := make(map[string]any, len(headers))
	for k, v := range headers {
		if sensitiveKey.MatchString(k) {
			out[k] = "[REDACTED]"
		} else {
			out[k] = v
		}
	}
	return out
}

func RedactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := u.Query()
	changed := false
	for key := range q {
		if sensitiveQueryParm.MatchString(key) {
			q.Set(key, "[REDACTED]")
			changed = true
		}
	}
	if !changed {
		return raw
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func RedactEvent(event *AgentEvent) *AgentEvent {
	if event == nil {
		return nil
	}
	event.Data = redactUnknown(event.Data).(map[string]any)
	return event
}

func redactUnknown(value any) any {
	switch v := value.(type) {
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = redactUnknown(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			lower := strings.ToLower(k)
			if lower == "headers" {
				if hm, ok := item.(map[string]any); ok {
					out[k] = RedactHeaders(hm)
					continue
				}
			}
			if lower == "url" {
				if s, ok := item.(string); ok {
					out[k] = RedactURL(s)
					continue
				}
			}
			if sensitiveKey.MatchString(k) {
				out[k] = "[REDACTED]"
			} else {
				out[k] = redactUnknown(item)
			}
		}
		return out
	default:
		return value
	}
}
