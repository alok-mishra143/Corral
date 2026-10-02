# corral (Go)

Detect and monitor **OpenCode** agents running on the local machine and
collect their activity into one normalized event format, with an in-agent
firewall that can deny file / command / web access.

The CLI + daemon are written in **Go**; the OpenCode plugin stays TypeScript
(OpenCode loads JS/TS plugins). Only OpenCode is supported. Other agents
(Claude Code, Codex, Gemini, Aider) can be re-added later behind the same
adapter idea.

## 1. Build

Requires Go (1.21+; developed against 1.27).

```bash
make build           # -> dist/corral
# or
go build -o dist/corral ./cmd/corral

make vet             # go vet ./...
make fmt             # gofmt -w .
```

## 2. Run the CLI

```bash
./dist/corral daemon            # event server on 127.0.0.1:4317
./dist/corral daemon --port N
./dist/corral admin             # open the dashboard
./dist/corral doctor            # diagnose setup
./dist/corral rules list
./dist/corral version
```

Development shortcut:

```bash
go run ./cmd/corral daemon
```

## 3. Install

```bash
./install.sh
```

The installer builds the Go binary, copies it to `~/.local/bin/corral`,
installs the OpenCode plugin, and restarts the daemon. The daemon is **not** a login/boot item: it autostarts
(detached) when OpenCode loads the plugin.

## CLI reference

| Command              | What it does                                                     |
| -------------------- | ---------------------------------------------------------------- |
| `corral daemon`  | Start event server (127.0.0.1:4317) + process monitor            |
| `corral admin`   | Open the dashboard (ensures the daemon is up)                    |
| `corral setup`   | Install the OpenCode plugin (template is embedded in the binary) |
| `corral doctor`  | Diagnose setup (daemon, plugin, rules)                           |
| `corral rules`   | `list` / `deny --file GLOB` / `rm ID`                            |
| `corral restart` | Restart the firewall daemon                                      |
| `corral uninstall` | Remove daemon, plugin and the `corral` command                  |
| `corral version` | Print version                                                    |

### Common commands

| Command          | What it does                                          |
| ---------------- | ----------------------------------------------------- |
| `corral d`       | Open the dashboard (`--port N`, `--no-open` optional) |
| `corral help`    | List all commands                                     |
| `corral restart` | Restart the firewall daemon                           |
| `corral uninstall` | Uninstall corral from your computer                 |

Events are stored append-only in `~/.corral/events.jsonl` (one validated
event per line).

## 4. OpenCode integration

```bash
corral setup      # installs the plugin into the global OpenCode plugin dir
corral daemon     # must be running to receive events
corral doctor     # verify: daemon, plugin, store, processes
```

Then **restart OpenCode** so it loads the plugin.

The plugin subscribes to the real OpenCode plugin API:
`tool.execute.before/after`, `file.edited`, `command.executed`,
`permission.asked`, and session lifecycle via the generic `event` hook.
Delivery is fire-and-forget with a 1.5 s timeout, so it can never block or
crash OpenCode.

## 5. Events

| Event                  | Source                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `session.started`      | plugin `session.created` + daemon process-start synthesis     |
| `session.stopped`      | plugin `session.deleted` + daemon process-stop synthesis      |
| `session.idle`         | plugin `session.idle`                                         |
| `tool.started`         | plugin `tool.execute.before`                                  |
| `tool.completed`       | plugin `tool.execute.after`                                   |
| `file.read`            | read-family tool args (`filePath`/`path`)                     |
| `file.edited`          | plugin `file.edited` + write/edit-family tool args            |
| `file.created`         | write tool creating a new path                                |
| `file.deleted`         | delete-family tool                                            |
| `command.executed`     | plugin `command.executed` + bash/shell-family tool args       |
| `http.request`         | fetch-family tool args (URL the agent asked for, no sniffing) |
| `http.response`        | provider/HTTP telemetry if the plugin API exposes it          |
| `permission.requested` | plugin `permission.asked`                                     |
| `error`                | plugin `session.error`                                        |

## 6. Firewall (deny file / command / web / tool)

Rules live in the corral data directory (`~/.corral/`) and are enforced
**inside OpenCode**, before the tool runs:

```
dashboard (or API) → daemon stores rules → plugin pulls GET /api/rules
→ tool.execute.before matches → throw = blocked + logged
```

The plugin keeps no baked-in copy: it pulls the daemon's current rules before
**every tool call**, so a rule you add while a chat is open applies to the very
next tool call in that same session. The pull is capped at 500 ms.

- **Scopes:** global (all agents) · one session (`sessionId`) · one project
  folder (`cwdPrefix`).
- **Match kinds:** `file` glob, `command` substring or `/regex/`, `http`
  hostname or URL prefix, `tool` name.
- Blocking throws in `tool.execute.before`, so the tool never runs, and logs a
  `permission.requested` event with `blocked: true`.
- **Fail open:** empty or stale rule cache = allow.

### Self-protection & dashboard access

Agents are blocked from reaching the corral dashboard/API itself
(`127.0.0.1:4317`) by default, so an agent cannot read your rule set. The
Firewall view has a **Self-protection** card to flip this.

Rules API (all JSON, loopback only):

```bash
curl http://127.0.0.1:4317/api/rules                          # list
curl -X POST http://127.0.0.1:4317/api/rules \
  -H 'content-type: application/json' \
  -d '{"match":{"kind":"file","value":"**/notes.md"},"name":"no notes"}'
curl -X PUT http://127.0.0.1:4317/api/rules/<id> -H 'content-type: application/json' -d '{...}'
curl -X DELETE http://127.0.0.1:4317/api/rules/<id>
```

Dashboard views: **Overview**, **Agents**, **Events**, **Firewall**.

## 7. Security

- Server binds **only** to `127.0.0.1` (non-loopback hosts are refused).
- Sensitive headers/fields redacted; sensitive URL query params redacted.
- HTTP bodies are truncated and env vars are never collected.
- All external input is validated; malformed JSON → `400`; oversized bodies
  (>1 MB) → `413`. Nothing received is ever executed.

## 8. Project layout (Go)

```
cmd/corral/main.go       CLI entry + help (daemon/admin/setup/doctor/rules/...)
internal/events/event.go     AgentEvent schema, validation + redaction
internal/events/store.go     append-only JSONL store (tail-based reads)
internal/policy/rules.go     firewall rule schema + load/save
internal/policy/settings.go  owner settings (~/.corral/settings.json)
internal/scanner/scanner.go  finds running `opencode` processes
internal/server/server.go    127.0.0.1:4317 event server + rules CRUD
internal/server/dashboard.go serves the embedded dashboard with a UI token
internal/server/dashboard.html  single-file UI (embedded at build time)
internal/cli/                one file per command
integrations/opencode/plugin.ts  plugin (observes + enforces firewall, fails open)
integrations/embed.go        go:embed of the plugin template
```

## 9. Memory

The Go daemon runs at roughly **13 MB resident** (vs ~44 MB for the previous
Bun/JS daemon), and stays flat with history: `ReadTail` is O(limit), the dedup
id set is capped at 5000, and the tainted list at 200.

## 10. Known limitations

- HTTP monitoring covers only agent-instrumentation events, not packets.
- macOS `cwd` needs `lsof`; Windows listing needs PowerShell/CIM.
- `session.started/stopped` from the daemon are process-lifecycle observations.
- PID reuse is handled by `pid + command` fingerprinting.
- The JSONL store has no rotation; reads are tail-based, so file size does not
  affect daemon memory or `/api/events` latency.
