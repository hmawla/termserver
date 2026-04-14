# termserver

Share your terminal sessions with mobile devices over your local network.

Run `htop`, `npm run dev`, `copilot .`, or any command on your machine — then view and optionally control it from your phone, hands-free.

## Requirements

- **Node.js ≥ 18**
- Linux or macOS (Windows: ConPTY via node-pty — experimental)
- The companion **Flutter mobile app** (Android/iOS) — see [`termserver_app/`](./termserver_app/)

## Installation

```bash
npm install -g termserver
```

> `node-pty` requires native compilation. Make sure you have a C++ build toolchain:
> - **Linux/macOS:** `build-essential` / Xcode Command Line Tools
> - **Windows:** Visual Studio Build Tools

## Quick Start

```bash
# 1 — Pair your phone (first time only)
termserver pair

# 2 — Run a command in a shared session
termserver -c "htop"
```

## Commands

### `termserver pair`

Generates a QR code and starts the daemon. Scan the QR with the mobile app to pair your device. The daemon keeps running after pairing — press **Ctrl+C** to stop it.

```
termserver pair
```

If the phone uses manual entry (IP + port) instead of scanning the QR, the matching code is printed when the phone initiates the request.

> **Note:** If the daemon is already running you must stop it first (`Ctrl+C`), then re-run `termserver pair`.

---

### `termserver -c <command>`

Runs a command in a shared PTY session. If a daemon is already running the session attaches to it; otherwise a temporary daemon is started and torn down when the command exits.

```bash
termserver -c "htop"
termserver -c "bash"
termserver -c "npm run dev"
termserver -c "copilot ."
```

Paired mobile devices see a live list of active sessions and can connect to any of them.

---

### `termserver daemon`

Starts the daemon in the foreground without creating a pairing or running a command. Useful if you want the daemon running permanently and will pair separately.

```bash
termserver daemon
```

---

### `termserver devices`

Lists all paired devices with their IDs and pairing timestamps.

```bash
termserver devices
```

---

### `termserver unpair <id>`

Revokes a paired device by ID (get the ID from `termserver devices`).

```bash
termserver unpair abc123
```

## How It Works

```
Your machine                          Phone
──────────────────                    ──────────────────
termserver pair                       Scan QR  ──────────────────────┐
  └─ starts daemon                    OR enter IP + port             │
  └─ creates pairing ◄────────────────────────────────── POST /pair/complete
                                      saves device token             │
termserver -c "htop"                                                 │
  └─ creates PTY session              connects to session ────────────┘
  └─ streams output ──────────────────────────────────── WS /ws/sessions/:id
  └─ optional resize ◄──────────────────────────────────
```

1. **Daemon** — Express + WebSocket server (default port `8787`), started on demand.
2. **Pairing** — One-time QR/code exchange issues a persistent per-device bearer token.
3. **Sessions** — Commands run in a PTY; output is buffered and streamed over WebSocket. Multiple clients can observe simultaneously; one at a time can hold control.
4. **Resize** — When a phone connects it resizes the PTY to its screen size; when it disconnects the PTY is restored to its pre-connection dimensions.
5. **Config** — Paired devices and port preference are stored in `~/.config/termserver/` (via [`conf`](https://github.com/sindresorhus/conf)).

## REST API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/pair/initiate` | — | Start manual pairing (returns `sessionToken`) |
| `POST` | `/pair/complete` | — | Complete pairing with code + token |
| `GET` | `/devices` | Admin | List all paired devices |
| `DELETE` | `/devices/:id` | Bearer | Revoke a device (self or admin) |
| `GET` | `/sessions` | Bearer | List active sessions |
| `GET` | `/sessions/:id` | Bearer | Get session details |
| `POST` | `/sessions` | Admin | Create a new session |

## WebSocket API

| Path | Auth | Description |
|------|------|-------------|
| `/ws/sessions/:id?token=…` | Bearer | Terminal I/O stream |
| `/ws/events?token=…` | Bearer | Session lifecycle events |

### Messages — Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `input` | `{ data: string }` | Send keystrokes |
| `resize` | `{ cols, rows }` | Resize the PTY |
| `request_control` | — | Request exclusive write access |
| `release_control` | — | Release exclusive write access |

### Messages — Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `output` | `{ data: string }` | Terminal output |
| `session_info` | `{ cols, rows }` | Current PTY dimensions on connect |
| `session_closed` | `{ exitCode }` | Process exited |
| `sessions_list` | `{ sessions: [] }` | Full session list (on connect + changes) |

## Mobile App

The companion Flutter app lives in [`termserver_app/`](./termserver_app/). It handles:

- **Pairing** via QR scan or manual IP + port entry
- **Session browser** — live list of sessions on the connected device
- **Terminal emulator** — full xterm-compatible view with resize
- **Special-keys bar** — Esc, Tab, arrows, Home/End, PgUp/PgDn, Ctrl/Alt combos
- **Multi-device** — save and switch between multiple paired machines
- **Rename / unpair** from the app

Build & run:
```bash
cd termserver_app
flutter pub get
flutter run
```

## License

[MIT](./LICENSE)
