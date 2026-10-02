# Platform support

corral supports macOS, Linux and Windows. The Go and Rust builds are standalone
binaries on all three; the TypeScript/Bun build runs wherever Bun runs, with one
caveat on Windows (see below). Every push builds all of these in CI and in the
release workflow.

## Matrix

| Platform | TypeScript / Bun | Go | Rust |
| -------- | :--------------: | :-: | :--: |
| **macOS (Apple Silicon / Intel)** | ✅ supported | ✅ supported | ✅ supported |
| **Linux (x64 / arm64)** | ✅ supported¹ | ✅ supported | ✅ supported |
| **Windows (x64; Go also arm64)** | ⚠️ runs; detection/control limited² | ✅ supported | ✅ supported |

¹ TypeScript needs `bun`. Full CLI (restart / stop / kill) needs `lsof`.
² Node/Bun runs on Windows, but the TypeScript scanner shells out to
`ps -axo` / `lsof`, so agent detection and daemon control are limited. Use the
Go or Rust build on Windows.

## What the workflows build

`.github/workflows/ci.yml` builds on `ubuntu-latest`, `macos-latest` and
`windows-latest` for all three builds (and runs the daemon on macOS/Linux).

`.github/workflows/release.yml` publishes:

| Build | macOS | Linux | Windows |
| ----- | ----- | ----- | ------- |
| Rust | `arm64`, `x86_64` | `x86_64`, `aarch64` | `x86_64` |
| Go | `arm64`, `x86_64` | `x86_64`, `aarch64` | `x86_64`, `arm64` |
| TypeScript / Bun | universal bundle (`corral-ts.tar.gz` / `.zip`) | | |

## How each platform is handled

Go and Rust isolate the OS differences behind a small platform layer.

### Go — `internal/platform`

- **Unix** (`platform_unix.go`): `syscall.Kill` signals, `Setsid` to detach the
  daemon, `lsof` for port ownership, `ps -axo` for the process scanner.
- **Windows** (`platform_windows.go`): `OpenProcess` / `GetExitCodeProcess` for
  liveness, `os.Process.Kill` to terminate, `CREATE_NEW_PROCESS_GROUP |
  DETACHED_PROCESS` to detach, `netstat -ano` for port ownership, and
  PowerShell `Get-CimInstance Win32_Process` for the scanner.

### Rust — `src/platform`

- **Unix** (`platform/unix.rs`): `libc` (`kill`, `setsid`) and `ps` / `lsof`.
- **Windows** (`platform/windows.rs`): `tasklist` / `taskkill` for process
  control, `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` to detach,
  `netstat -ano` for port ownership, and PowerShell `Get-CimInstance
  Win32_Process` for the scanner.
- Random IDs and tokens use the `getrandom` crate on every platform, so there is
  no `/dev/urandom` dependency.

### TypeScript

- Still shells out to `lsof` / `ps` with Unix flags. Windows support would need
  a `netstat` / `tasklist` process layer.

## Verify on your machine

After installing, run:

```sh
corral doctor
```

It checks the daemon, the plugin and the rules. On Linux, install `lsof` first
(`sudo apt install lsof` or `sudo dnf install lsof`) for `restart`/`stop`/`kill`.
