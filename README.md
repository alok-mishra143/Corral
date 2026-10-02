# corral (Rust)

Detect and monitor **OpenCode** agents running on the local machine and
collect their activity into one normalized event format, with an in-agent
firewall that can deny file / command / web access.

The CLI + daemon are written in **Rust**; the OpenCode plugin stays TypeScript
(OpenCode loads JS/TS plugins). Only OpenCode is supported.

## 1. Build

Requires a Rust toolchain (rustc/cargo).

```bash
make build           # -> target/release/corral
# or
cargo build --release

make check           # cargo check
make fmt             # cargo fmt
```

Dependencies: `serde`, `serde_json`, `libc` (all build offline from the local
cargo cache). Release profile uses `opt-level = "z"`, `lto = true`,
`codegen-units = 1`, `strip = true` — the binary is ~575 KB.

## 2. Run the CLI

```bash
./target/release/corral daemon            # event server on 127.0.0.1:4317
./target/release/corral daemon --port N
./target/release/corral admin             # open the dashboard
./target/release/corral doctor            # diagnose setup
./target/release/corral rules list
./target/release/corral version
```

Development shortcut:

```bash
cargo run -- daemon
```

## 3. Install

```bash
./install.sh
```

The installer builds the release binary, copies it to
`~/.local/bin/corral`, installs the OpenCode plugin, and restarts the daemon. The daemon is **not** a
login/boot item: it autostarts (detached via `setsid`) when OpenCode loads the
plugin.

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

Then **restart OpenCode** so it loads the plugin. The plugin subscribes to the
real OpenCode plugin API (`tool.execute.before/after`, `file.edited`,
`command.executed`, `permission.asked`, session lifecycle) and delivers events
fire-and-forget with a 1.5 s timeout.

## 5. Events

`session.started|stopped|idle`, `tool.started|completed`,
`file.read|edited|created|deleted`, `command.executed`,
`http.request|response`, `permission.requested`, `error`.

## 6. Firewall

Rules are persisted by the daemon and enforced **inside OpenCode** before the
tool runs. The plugin pulls the daemon's current rules before every tool call,
so a rule added while a chat is open applies to the next tool call in that
same session. Match kinds: `file` glob, `command` substring or `/regex/`,
`http` hostname or URL prefix. Fail-open on an empty/stale cache.

The dashboard, agents, events and firewall views are served at
`http://127.0.0.1:4317/`. Sensitive headers/fields and URL query params are
redacted; the server binds loopback only.

## 7. Project layout (Rust)

```
Cargo.toml                   crate + release profile (size-optimized)
src/main.rs                  CLI entry + help
src/events.rs                AgentEvent schema, validation + redaction
src/store.rs                 append-only JSONL store (tail-based reads)
src/policy.rs                firewall rule + settings load/save
src/scanner.rs               finds running `opencode` processes
src/server.rs                127.0.0.1:4317 event server + rules CRUD
src/dashboard.html           single-file UI (embedded via include_str!)
src/logger.rs, timeutil.rs, random.rs
src/cli/                     one file per command
integrations/opencode/plugin.ts  plugin (embedded into the binary)
```

## 8. Benchmark (this project, macOS arm64)

Measured on the same machine, same `/health` and `/api/events` handlers:

| Metric | TS/Bun | Go | Rust |
| --- | --- | --- | --- |
| Binary / deploy size | 73,589 B app **+ 61.5 MB runtime** | 10.26 MiB (6.98 stripped) | **575 KB** |
| Idle RSS | ~44 MB | ~13 MB | **~3.3 MB** |
| `GET /health` | 42,652 req/s | 43,471 req/s | 42,373 req/s |
| `GET /api/events?limit=200` (JSON+tail) | 1,390 req/s | 1,691 req/s | **3,458 req/s** |
| RSS after JSON load | 191 MB | 49 MB | **18 MB** |

`/health` is loopback/client-bound so all three tie; the JSON/tail path — the
daemon's real work — is where Rust (serde_json) pulls ahead (~2.5× Bun, ~2×
Go). Rust also wins decisively on deploy size and memory.

## 9. Known limitations

- HTTP monitoring covers only agent-instrumentation events, not packets.
- macOS `cwd` needs `lsof`; Windows listing needs PowerShell/CIM.
- The daemon uses a thread-per-connection model (fine for loopback, low
  traffic); an async runtime is not used.
- The JSONL store has no rotation; reads are tail-based, so file size does not
  affect daemon memory or `/api/events` latency.
