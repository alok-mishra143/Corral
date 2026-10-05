<div align="center">

# corral

**Monitor and restrict OpenCode agents on your machine.**

Detect running agents, capture their activity as events, and enforce an in-agent
firewall that can deny file, command and web access — all from a local dashboard.

[![Rust](https://img.shields.io/badge/Rust-prebuilt-dea584?style=for-the-badge&logo=rust&logoColor=white)](#rust)
[![Go](https://img.shields.io/badge/Go-static-00ADD8?style=for-the-badge&logo=go&logoColor=white)](#go)
[![TypeScript](https://img.shields.io/badge/TypeScript-Bun-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#typescript--bun)
[![Downloads](https://img.shields.io/github/downloads/alok-mishra143/Corral/total?style=for-the-badge&label=downloads&color=2ea043)](https://github.com/alok-mishra143/Corral/releases)
[![License](https://img.shields.io/badge/License-MIT-2ea043?style=for-the-badge)](#license)

</div>

---

corral ships as **three builds of the same tool** — **Rust**, **Go** and
**TypeScript/Bun**. They have **identical features** and the same dashboard;
they differ only in speed, size and memory. You are on `main` (the TypeScript
build); the Go and Rust sources live on the `Golang` and `Rust` branches, but
the installer fetches the right one for you.



https://github.com/user-attachments/assets/eebef1fd-7319-42bf-8645-7e3a2a70e096



## Contents

- [Which one should I install?](#which-one-should-i-install)
- [Install](#install)
- [Commands](#commands)
- [Platform support](#platform-support)
- [Benchmark](#benchmark)
- [License](#license)

## Which one should I install?

There are three install commands only because the same tool is offered in three
languages — pick the one that matches what you care about:

| If you want… | Choose | Trade-off |
| ------------ | ------ | --------- |
| Lowest memory, smallest size, fastest | **Rust** | prebuilt binary, no toolchain, 3.3 MB idle |
| A single static binary, no runtime | **Go** | 13 MB idle, stdlib only, very simple |
| Easiest to hack on / you already use Bun | **TypeScript** | heaviest footprint (needs Bun, ~59 MB) |

> [!TIP]
> **Not sure?** Leave off the language and the installer picks the best fit for
> your machine automatically — you don't have to decide up front.

> [!NOTE]
> All three run the **same firewall and dashboard**. Choosing TypeScript does not
> give you fewer features — it just uses more memory and needs Bun installed.

## Install

Run **one** of the following.

### Rust

> Smallest & fastest · nothing to install first

```sh
curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh -s rust
```

### Go

> One static binary · nothing to install first

```sh
curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh -s go
```

### TypeScript / Bun

> Requires [`bun`](https://bun.sh)

```sh
curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh -s ts
```

### Let it choose

> No argument — the installer picks for you

```sh
curl -fsSL https://raw.githubusercontent.com/alok-mishra143/Corral/main/get.sh | sh
```

Rust and Go download the latest prebuilt binary from GitHub Releases for macOS
(Apple Silicon and Intel), Linux (x64 and arm64) and Windows (x64; Go also
arm64); platforms without a release asset build from source. TypeScript always
needs Bun. `get.sh` installs the `corral` command into `~/.local/bin`, installs
the OpenCode plugin, and starts the daemon.

On Windows, download `corral-rust-windows-x86_64.zip` or
`corral-go-windows-*.zip` from [Releases](../../releases) and put `corral.exe`
on your `PATH`.

> [!IMPORTANT]
> **Restart OpenCode afterwards.**

## Commands

```sh
corral d          # open the dashboard (http://127.0.0.1:4317/)
corral help       # list all commands
corral restart    # restart the firewall daemon
corral uninstall  # uninstall corral
```

| Command | What it does |
| ------- | ------------ |
| `corral daemon [--port N]` | Start the local firewall server |
| `corral admin [--no-open]` | Open the dashboard |
| `corral setup` | Install/refresh the OpenCode plugin |
| `corral doctor` | Diagnose daemon + plugin + rules |
| `corral rules list` | List firewall rules |
| `corral rules deny --file GLOB \| --command STR \| --http HOST` | Add a rule |
| `corral rules rm ID` | Remove a rule |
| `corral restart` | Restart the daemon |
| `corral uninstall [--yes] [--keep-data]` | Uninstall |
| `corral version` | Print version |

## Platform support

| Platform | TypeScript / Bun | Go | Rust |
| -------- | :--------------: | :-: | :--: |
| macOS (Apple Silicon / Intel) | Supported | Supported | Supported |
| Linux (x64 / arm64) | Supported | Supported | Supported |
| Windows (x64; Go also arm64) | Runs; detection limited | Supported | Supported |

CI builds on Linux, macOS and Windows runners for all three builds. See
[PLATFORMS.md](PLATFORMS.md) for details.

## Benchmark

| Metric | TypeScript / Bun | Go | Rust |
| ------ | ---------------- | -- | ---- |
| Deploy size (end-to-end) | 58.7 MiB (app + 59 MB Bun) | 6.98 MiB | **0.56 MiB** |
| Idle memory (RSS) | 44 MB | 13 MB | **3.3 MB** |
| Memory after load | 191 MB | 49 MB | **18 MB** |
| Cold start | 47 ms | 12.5 ms | **7 ms** |
| `/health` throughput | ~42,000 req/s | ~43,000 req/s | ~42,000 req/s |
| `/api/events?limit=200` throughput | 1,390 req/s | 1,691 req/s | **3,458 req/s** |
| Latency p50 / p90 / p99 (`/api/events`) | 32 / 43 / 53 ms | 23 / 48 / 76 ms | **14 / 19 / 25 ms** |

See the **[full visual benchmark](benchmark.md)** (charts + tables) — renders
directly on GitHub. A standalone interactive copy is in `benchmark.html`.

## License

MIT
