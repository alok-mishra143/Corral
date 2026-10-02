package cli

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"corral/internal/events"
	"corral/internal/logger"
	"corral/internal/platform"
	"corral/internal/policy"
	"corral/internal/server"
)

func reportBindFailure(port int, err error) int {
	if !platform.IsAddrInUse(err) {
		logger.Error(fmt.Sprintf("Failed to start server on 127.0.0.1:%d: %s", port, err))
		return 1
	}
	client := &http.Client{Timeout: 2 * time.Second}
	healthURL := fmt.Sprintf("http://127.0.0.1:%d/health", port)
	if resp, e := client.Get(healthURL); e == nil && resp.StatusCode == 200 {
		resp.Body.Close()
		ours := false
		if r2, e2 := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/agents", port)); e2 == nil {
			var body struct {
				Agents json.RawMessage `json:"agents"`
			}
			if json.NewDecoder(r2.Body).Decode(&body) == nil && len(body.Agents) > 0 && body.Agents[0] == '[' {
				ours = true
			}
			r2.Body.Close()
		}
		if ours {
			logger.Success(fmt.Sprintf("Daemon already running on 127.0.0.1:%d — reusing it.", port))
			fmt.Printf("Dashboard: http://127.0.0.1:%d/\n", port)
			return 0
		}
		logger.Error(fmt.Sprintf("Port %d is already in use by another server (it answers /health).", port))
	} else {
		logger.Error(fmt.Sprintf("Port %d is already in use (something listens there).", port))
	}
	if owner := platform.PortOwner(port); owner != "" {
		fmt.Println("  Occupied by: " + owner)
	}
	fmt.Println("  Stop it, or run: corral daemon --port <free-port>")
	fmt.Printf("  Note: the OpenCode plugin posts to 127.0.0.1:%d, so a\n", server.DefaultPort)
	fmt.Println("  different port also needs the plugin pointed at it.")
	return 1
}

func RunDaemon(argv []string) int {
	port := ParsePort(argv)
	store := events.NewEventStore("")
	srv, err := server.CreateServer(port, "", store)
	if err != nil {
		return reportBindFailure(port, err)
	}
	logger.Success(fmt.Sprintf("Firewall server on 127.0.0.1:%d", srv.Port))
	logger.Info(fmt.Sprintf("Rules: %s | Events: %s", policy.DefaultRulesPath(), store.Path()))
	fmt.Println("")
	fmt.Printf("Dashboard: http://127.0.0.1:%d/  (or run `corral admin`)\n", srv.Port)
	fmt.Println("Setup checklist:")
	fmt.Println("  1. corral setup                  # install the OpenCode plugin")
	fmt.Println("  2. restart OpenCode                # so it loads the plugin")
	fmt.Println("  3. corral doctor                 # verify daemon + plugin + rules")
	fmt.Println("")
	logger.Info("Ctrl+C to stop.")

	sig := make(chan os.Signal, 1)
	platform.NotifySignals(sig)
	<-sig
	_ = srv.Close()
	return 0
}
