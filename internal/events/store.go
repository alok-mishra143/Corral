package events

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

func DefaultStorePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".corral", "events.jsonl")
}

const (
	maxSeenIDs       = 5000
	idTailBytes      = 64 * 1024
	firstWindowBytes = 64 * 1024
)

type tailText struct {
	text      string
	truncated bool
}

func readTailText(filePath string, maxBytes int64) (tailText, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return tailText{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return tailText{}, err
	}
	size := info.Size()
	start := size - maxBytes
	if start < 0 {
		start = 0
	}
	length := size - start
	if length <= 0 {
		return tailText{text: "", truncated: false}, nil
	}
	buf := make([]byte, length)
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return tailText{}, err
	}
	n, err := io.ReadFull(f, buf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return tailText{}, err
	}
	return tailText{text: string(buf[:n]), truncated: start > 0}, nil
}

type EventStore struct {
	mu     sync.Mutex
	path   string
	seen   map[string]struct{}
	order  []string
	loaded bool
}

func NewEventStore(path string) *EventStore {
	if path == "" {
		path = DefaultStorePath()
	}
	return &EventStore{path: path, seen: make(map[string]struct{})}
}

func (s *EventStore) Path() string { return s.path }

func (s *EventStore) remember(id string) {
	if _, ok := s.seen[id]; ok {
		return
	}
	s.seen[id] = struct{}{}
	s.order = append(s.order, id)
	if len(s.order) > maxSeenIDs {
		oldest := s.order[0]
		s.order = s.order[1:]
		delete(s.seen, oldest)
	}
}

func (s *EventStore) ensureLoaded() {
	if s.loaded {
		return
	}
	s.loaded = true
	tail, err := readTailText(s.path, idTailBytes)
	if err != nil {
		return
	}
	lines := strings.Split(tail.text, "\n")
	start := 0
	if tail.truncated {
		start = 1
	}
	for i := start; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		var obj struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(line), &obj); err == nil && obj.ID != "" {
			s.remember(obj.ID)
		}
	}
}

func (s *EventStore) ensureDir() error {
	dir := filepath.Dir(s.path)
	if dir == "" || dir == "." {
		return nil
	}
	return os.MkdirAll(dir, 0o755)
}

func (s *EventStore) Append(input any) *AgentEvent {
	event := ParseEvent(input)
	if event == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureLoaded()
	if _, ok := s.seen[event.ID]; ok {
		return event // duplicate: don't write twice
	}
	if err := s.ensureDir(); err != nil {
		return nil
	}
	line, err := json.Marshal(event)
	if err != nil {
		return nil
	}
	f, err := os.OpenFile(s.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil
	}
	_, err = f.Write(append(line, '\n'))
	_ = f.Close()
	if err != nil {
		return nil
	}
	s.remember(event.ID)
	return event
}

func (s *EventStore) ReadTail(limit int, filter func(*AgentEvent) bool) []*AgentEvent {
	out := make([]*AgentEvent, 0, limit)
	window := int64(firstWindowBytes)
	for {
		tail, err := readTailText(s.path, window)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return []*AgentEvent{}
			}
			return []*AgentEvent{}
		}
		out = out[:0]
		lines := strings.Split(tail.text, "\n")
		start := 0
		if tail.truncated {
			start = 1
		}
		for i := len(lines) - 1; i >= start && len(out) < limit; i-- {
			line := strings.TrimSpace(lines[i])
			if line == "" {
				continue
			}
			var raw any
			if err := json.Unmarshal([]byte(line), &raw); err != nil {
				continue
			}
			event := ParseEvent(raw)
			if event != nil && (filter == nil || filter(event)) {
				out = append(out, event)
			}
		}
		if len(out) >= limit || !tail.truncated {
			break
		}
		window *= 4
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}
