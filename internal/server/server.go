package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"corral/internal/events"
	"corral/internal/platform"
	"corral/internal/policy"
	"corral/internal/scanner"
)

const (
	DefaultPort    = 4317
	DefaultHost    = "127.0.0.1"
	MaxBodyBytes   = 1024 * 1024
	UITokenHeader  = "x-corral-ui"
	agentsCacheTTL = 10 * time.Second
)

var uiToken = newUIToken()

func newUIToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type Server struct {
	Port  int
	Host  string
	store *events.EventStore

	http *http.Server

	mu       sync.Mutex
	cacheAt  time.Time
	cached   []scanner.RunningAgent
	hasCache bool
}

func CreateServer(port int, host string, store *events.EventStore) (*Server, error) {
	if host == "" {
		host = DefaultHost
	}
	if host != "127.0.0.1" && host != "::1" && host != "localhost" {
		return nil, &net.OpError{Op: "listen", Err: errNonLoopback(host)}
	}
	if store == nil {
		store = events.NewEventStore("")
	}
	s := &Server{Port: port, Host: host, store: store}
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return nil, err
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tw := &trackingWriter{ResponseWriter: w}
		defer func() {
			if rec := recover(); rec != nil && !tw.wrote {
				sendJSON(tw, 500, map[string]any{"ok": false, "error": "internal error"})
			}
		}()
		s.handle(tw, r)
	})}
	s.http = srv
	go func() { _ = srv.Serve(ln) }()
	return s, nil
}

func (s *Server) Close() error {
	if s.http == nil {
		return nil
	}
	return s.http.Close()
}

func errNonLoopback(host string) error {
	return &nonLoopbackError{host}
}

type nonLoopbackError struct{ host string }

func (e *nonLoopbackError) Error() string {
	return "refusing to bind event server to non-loopback host: " + e.host
}

func (s *Server) CachedAgents() []scanner.RunningAgent {
	s.mu.Lock()
	if s.hasCache && time.Since(s.cacheAt) < agentsCacheTTL {
		v := s.cached
		s.mu.Unlock()
		return v
	}
	s.mu.Unlock()
	value := scanner.ScanAgents()
	if value == nil {
		value = []scanner.RunningAgent{}
	}
	s.mu.Lock()
	s.cacheAt = time.Now()
	s.cached = value
	s.hasCache = true
	s.mu.Unlock()
	return value
}

func tokenMatches(r *http.Request) bool {
	value := r.Header.Get(UITokenHeader)
	if len(value) != len(uiToken) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value), []byte(uiToken)) == 1
}

func sendJSON(w http.ResponseWriter, status int, body any) {
	text, err := json.Marshal(body)
	if err != nil {
		text = []byte(`{"ok":false,"error":"internal error"}`)
		status = 500
	}
	w.Header().Set("content-type", "application/json")
	w.Header().Set("content-length", strconv.Itoa(len(text)))
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(text)
}

func sendHTML(w http.ResponseWriter, status int, html string) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("content-length", strconv.Itoa(len(html)))
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, html)
}

var errTooLarge = &tooLargeError{}

type tooLargeError struct{}

func (e *tooLargeError) Error() string { return "payload too large" }

func readBody(r *http.Request) (string, error) {
	buf, err := io.ReadAll(io.LimitReader(r.Body, MaxBodyBytes+1))
	if err != nil {
		return "", errTooLarge
	}
	if len(buf) > MaxBodyBytes {
		return "", errTooLarge
	}
	return string(buf), nil
}

func readJSONBody(r *http.Request) (value any, status int, errMsg string) {
	text, err := readBody(r)
	if err != nil {
		return nil, 413, "payload too large"
	}
	if err := json.Unmarshal([]byte(text), &value); err != nil {
		return nil, 400, "malformed JSON"
	}
	return value, 0, ""
}

func isoNow() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func loadRulesOrEmpty() []*policy.FirewallRule {
	rules := policy.LoadRules("")
	if rules == nil {
		return []*policy.FirewallRule{}
	}
	return rules
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	method := r.Method

	switch {
	case path == "/health" && method == http.MethodGet:
		sendJSON(w, 200, map[string]any{"ok": true})

	case method == http.MethodGet && (path == "/" || path == "/admin"):
		sendHTML(w, 200, getDashboardHTML(uiToken))

	case path == "/api/settings" && (method == http.MethodGet || method == http.MethodPut):
		if method == http.MethodPut && !tokenMatches(r) {
			sendJSON(w, 403, map[string]any{"ok": false, "error": "dashboard UI token required"})
			return
		}
		if method == http.MethodGet {
			sendJSON(w, 200, map[string]any{"settings": policy.LoadSettings("")})
			return
		}
		body, status, errMsg := readJSONBody(r)
		if errMsg != "" {
			sendJSON(w, status, map[string]any{"ok": false, "error": errMsg})
			return
		}
		m, _ := body.(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		saved, err := policy.SaveSettings(policy.NormalizeSettings(m), "")
		if err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": "internal error"})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true, "settings": saved})

	case path == "/api/agents" && method == http.MethodGet:
		sendJSON(w, 200, map[string]any{"agents": s.CachedAgents()})

	case strings.HasPrefix(path, "/api/agents/") && strings.HasSuffix(path, "/kill") && method == http.MethodPost:
		if !tokenMatches(r) {
			sendJSON(w, 403, map[string]any{"ok": false, "error": "dashboard UI token required"})
			return
		}
		pidRaw := strings.TrimSuffix(strings.TrimPrefix(path, "/api/agents/"), "/kill")
		pid, err := strconv.Atoi(pidRaw)
		if err != nil || pid <= 1 || pid == os.Getpid() {
			sendJSON(w, 400, map[string]any{"ok": false, "error": "invalid pid"})
			return
		}
		found := false
		for _, a := range scanner.ScanAgents() {
			if a.PID == pid {
				found = true
				break
			}
		}
		if !found {
			sendJSON(w, 404, map[string]any{"ok": false, "error": "pid is not a detected agent"})
			return
		}
		if err := platform.Terminate(pid); err != nil {
			sendJSON(w, 404, map[string]any{"ok": false, "error": "process already gone or permission denied"})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true, "pid": pid, "signal": "SIGTERM"})

	case path == "/api/rules" && method == http.MethodGet:
		sendJSON(w, 200, map[string]any{"rules": loadRulesOrEmpty()})

	case path == "/api/rules" && method == http.MethodPost:
		if !tokenMatches(r) {
			sendJSON(w, 403, map[string]any{"ok": false, "error": "dashboard UI token required"})
			return
		}
		body, status, errMsg := readJSONBody(r)
		if errMsg != "" {
			sendJSON(w, status, map[string]any{"ok": false, "error": errMsg})
			return
		}
		m, _ := body.(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		if v, ok := m["id"]; !ok || v == nil {
			m["id"] = policy.NewRuleID()
		}
		m["createdAt"] = isoNow()
		parsed := policy.ParseRule(m)
		if parsed == nil {
			sendJSON(w, 400, map[string]any{"ok": false, "error": "invalid rule"})
			return
		}
		rules := loadRulesOrEmpty()
		key := policy.RuleKey(parsed)
		for _, existing := range rules {
			if policy.RuleKey(existing) == key {
				sendJSON(w, 200, map[string]any{"ok": true, "rule": existing, "duplicate": true})
				return
			}
		}
		rules = append(rules, parsed)
		if err := policy.SaveRules(rules, ""); err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": "internal error"})
			return
		}
		sendJSON(w, 201, map[string]any{"ok": true, "rule": parsed})

	case strings.HasPrefix(path, "/api/rules/") && (method == http.MethodPut || method == http.MethodDelete):
		if !tokenMatches(r) {
			sendJSON(w, 403, map[string]any{"ok": false, "error": "dashboard UI token required"})
			return
		}
		id, _ := url.PathUnescape(strings.TrimPrefix(path, "/api/rules/"))
		rules := loadRulesOrEmpty()
		idx := -1
		for i, rr := range rules {
			if rr.ID == id {
				idx = i
				break
			}
		}
		if idx == -1 {
			sendJSON(w, 404, map[string]any{"ok": false, "error": "rule not found"})
			return
		}
		if method == http.MethodDelete {
			rules = append(rules[:idx], rules[idx+1:]...)
			if err := policy.SaveRules(rules, ""); err != nil {
				sendJSON(w, 500, map[string]any{"ok": false, "error": "internal error"})
				return
			}
			sendJSON(w, 200, map[string]any{"ok": true})
			return
		}
		body, status, errMsg := readJSONBody(r)
		if errMsg != "" {
			sendJSON(w, status, map[string]any{"ok": false, "error": errMsg})
			return
		}
		m, _ := body.(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		m["id"] = id
		parsed := policy.ParseRule(m)
		if parsed == nil {
			sendJSON(w, 400, map[string]any{"ok": false, "error": "invalid rule"})
			return
		}
		rules[idx] = parsed
		if err := policy.SaveRules(rules, ""); err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": "internal error"})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true, "rule": parsed})

	case path == "/api/pick-file" && method == http.MethodPost:
		if !tokenMatches(r) {
			sendJSON(w, 403, map[string]any{"ok": false, "error": "dashboard UI token required"})
			return
		}
		picked, err := platform.PickFile("Select a file for corral to exclude")
		if err != nil {
			sendJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		if picked == "" {
			sendJSON(w, 200, map[string]any{"ok": false, "canceled": true})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true, "path": picked})

	case path == "/api/events" && method == http.MethodGet:
		q := r.URL.Query()
		limit := 50
		if n, err := strconv.Atoi(q.Get("limit")); err == nil && n != 0 {
			limit = n
		}
		if limit < 1 {
			limit = 1
		}
		if limit > 500 {
			limit = 500
		}
		pid := 0
		if n, err := strconv.Atoi(q.Get("pid")); err == nil {
			pid = n
		}
		hasPid := pid > 0
		session := q.Get("session")
		agent := strings.ToLower(q.Get("agent"))
		filter := func(e *events.AgentEvent) bool {
			if hasPid && (e.Agent.PID == nil || *e.Agent.PID != pid) {
				return false
			}
			if session != "" && e.Agent.SessionID != session {
				return false
			}
			if agent != "" && strings.ToLower(string(e.Agent.Name)) != agent {
				return false
			}
			return true
		}
		sendJSON(w, 200, map[string]any{"events": s.store.ReadTail(limit, filter)})

	case path != "/events":
		sendJSON(w, 404, map[string]any{"ok": false, "error": "not found"})

	default:
		if method != http.MethodPost {
			sendJSON(w, 405, map[string]any{"ok": false, "error": "method not allowed"})
			return
		}
		text, err := readBody(r)
		if err != nil {
			sendJSON(w, 413, map[string]any{"ok": false, "error": "payload too large"})
			return
		}
		var parsed any
		if err := json.Unmarshal([]byte(text), &parsed); err != nil {
			sendJSON(w, 400, map[string]any{"ok": false, "error": "malformed JSON"})
			return
		}
		event := s.store.Append(parsed)
		if event == nil {
			sendJSON(w, 400, map[string]any{"ok": false, "error": "invalid event payload"})
			return
		}
		sendJSON(w, 202, map[string]any{"ok": true, "id": event.ID})
	}
}

type trackingWriter struct {
	http.ResponseWriter
	wrote bool
}

func (t *trackingWriter) WriteHeader(code int) {
	if !t.wrote {
		t.wrote = true
		t.ResponseWriter.WriteHeader(code)
	}
}

func (t *trackingWriter) Write(b []byte) (int, error) {
	t.wrote = true
	return t.ResponseWriter.Write(b)
}
