# termserver — Fleet Execution Plan

> **Usage:** Copy everything below the `---` line and paste as a `/fleet` prompt.
> The orchestrator will decompose these into parallel subagents with the specified models.

---

## Objective

Build **termserver** — a cross-platform Node.js CLI daemon that exposes local PTY sessions over WebSocket, plus a **Flutter mobile app** that connects to it as a remote terminal client. Two separate codebases: `termserver/` (Node.js CLI) and `termserver_app/` (Flutter).

## Shared Protocol Reference (all agents must follow this)

### WebSocket Message Protocol
Server → Client:
```json
{ "type": "output", "data": "<terminal bytes as base64>" }
{ "type": "session_closed", "exitCode": 0 }
{ "type": "sessions_list", "sessions": [{ "id": "tb-a3f2", "cmd": "copilot .", "startedAt": "...", "status": "active" }] }
```
Client → Server:
```json
{ "type": "input", "data": "ls -la\n" }
{ "type": "resize", "cols": 120, "rows": 40 }
{ "type": "request_control" }
{ "type": "release_control" }
```

### REST API
- `GET  /sessions` — list active sessions (auth required)
- `GET  /sessions/:id` — single session info (auth required)
- `POST /pair/initiate` — `{ deviceName }` → `{ sessionToken }` (no auth)
- `POST /pair/complete` — `{ code, sessionToken }` → `{ deviceToken, deviceId }` (no auth)

### Auth
All endpoints except `/pair/*` require `Authorization: Bearer <deviceToken>` header.

### WS Endpoints
- `WS /ws/sessions/:id` — stream PTY I/O for a session (auth required)
- `WS /ws/events` — real-time session list updates (auth required)

---

## Task 1 — Project Scaffolding & Core Utilities
**Model: Claude Sonnet 4.6**
**No dependencies — start immediately**

Create the `termserver/` Node.js project with ESM modules:

1. `termserver/package.json` — name: `termserver`, type: `module`, bin: `./bin/termserver.js`
   Dependencies: `node-pty@^1.0.0`, `ws@^8.0.0`, `express@^4.18.0`, `commander@^12.0.0`, `nanoid@^5.0.0`, `conf@^12.0.0`, `chalk@^5.0.0`, `qrcode-terminal@^0.12.0`, `detect-port@^1.5.0`
2. `termserver/src/store.js` — Config persistence using `conf`. Cross-platform config dir (`~/.termserver/` on Linux, `%APPDATA%/termserver/` on Windows). Schema: `{ port: 8787, devices: [{ id, name, token, pairedAt }] }`. Export functions: `getConfig()`, `addDevice(device)`, `removeDevice(id)`, `getDevices()`, `getPort()`, `setPort(port)`.
3. `termserver/src/network.js` — LAN IP detection using `os.networkInterfaces()`. Export `getLanIp()` that returns the first non-internal IPv4 address. Works on Linux + Windows.
4. Run `cd termserver && npm install` to verify the setup works.

---

## Task 2 — PTY Session Manager
**Model: Claude Opus 4.6**
**No dependencies — start immediately**

Create `termserver/src/session.js` — PTY session lifecycle manager:

1. Use `node-pty` to spawn PTY processes. API reference:
   ```js
   import * as pty from 'node-pty';
   const proc = pty.spawn(shell, args, { name: 'xterm-color', cols: 80, rows: 30, cwd, env: process.env });
   proc.onData(callback);  // terminal output
   proc.write(data);       // terminal input
   proc.resize(cols, rows);
   proc.kill();
   ```
2. `Session` class with: `id` (nanoid, 8 chars, prefix `tb-`), `command`, `ptyProcess`, `status` (active/closed), `startedAt`, `cols`, `rows`, `outputHistory` (circular buffer, last 1000 lines for reconnect scrollback).
3. `SessionRegistry` class (EventEmitter): `create(command, args, opts)`, `get(id)`, `list()`, `remove(id)`. Emits `session:created`, `session:closed`, `session:output` events.
4. Cross-platform shell detection: `$SHELL` or `bash` on Linux, `powershell.exe` on Windows.
5. Session output should be buffered in a circular array (`outputHistory`) so new WS clients can receive recent history on connect.

---

## Task 3 — Pairing System
**Model: Claude Opus 4.6**
**No dependencies — start immediately**

Create `termserver/src/pairing.js` — Pairing code generation and auth:

1. Generate 4-digit numeric pairing codes (random, zero-padded).
2. Codes are single-use with 2-minute TTL. Store pending pairings in-memory Map.
3. `PairingManager` class:
   - `createPairing(deviceName)` → `{ code, sessionToken }` where sessionToken is a nanoid(32) temporary token
   - `completePairing(code, sessionToken)` → `{ deviceToken, deviceId }` or throws on invalid/expired
   - `validateToken(bearerToken)` → device object or null
   - Internal cleanup timer that purges expired pending pairings every 30s
4. `deviceToken` is a nanoid(64) long-lived secret stored via `store.js` `addDevice()`.
5. `sessionToken` (short-lived) is stored only in-memory in the pending pairings Map.
6. Export an Express middleware `authMiddleware(pairingManager)` that:
   - Extracts `Authorization: Bearer <token>` from request headers or WS upgrade `sec-websocket-protocol` or URL query `?token=`
   - Calls `validateToken()` and attaches `req.device` or rejects with 401

---

## Task 4 — WebSocket & HTTP Daemon Server
**Model: Claude Opus 4.6**
**Depends on: Task 1, Task 2, Task 3** (needs store, network, session, pairing modules)

Create `termserver/src/daemon.js` — the main daemon server:

1. Express HTTP server + `ws` WebSocket server sharing the same HTTP server. Use `noServer: true` mode with manual upgrade handling for path-based routing:
   ```js
   import { WebSocketServer } from 'ws';
   const wss = new WebSocketServer({ noServer: true });
   server.on('upgrade', (request, socket, head) => { /* route by pathname */ });
   ```

2. REST endpoints:
   - `GET /sessions` → returns `sessionRegistry.list()` (auth required)
   - `GET /sessions/:id` → returns single session info (auth required)
   - `POST /pair/initiate` → body `{ deviceName }` → calls `pairingManager.createPairing()` → returns `{ sessionToken }`
   - `POST /pair/complete` → body `{ code, sessionToken }` → calls `pairingManager.completePairing()` → returns `{ deviceToken, deviceId }`

3. WebSocket endpoints:
   - `WS /ws/sessions/:id` — auth required. On connect: send `outputHistory` as initial burst, then pipe `session:output` events. Accept `input`, `resize`, `request_control`, `release_control` messages. Send `session_closed` on PTY exit.
   - `WS /ws/events` — auth required. Sends `sessions_list` on connect and on every `session:created` / `session:closed` event.

4. Control model: one controlling remote client at a time per session. Local terminal always has priority. Track `controllingClientId` per session.

5. Port selection: use `detect-port` to find available port starting from configured port (default 8787).

6. Single-instance enforcement: create a lock file at `~/.termserver/daemon.pid` with the PID. On startup, check if lock exists and process is alive → connect to existing daemon instead.

7. Export `startDaemon(options)` and `connectToExistingDaemon()`.

---

## Task 5 — PTY Bridge & Local Terminal
**Model: Claude Opus 4.6**
**Depends on: Task 2** (needs session module)

Create `termserver/src/ptyBridge.js` — bridges local terminal ↔ PTY ↔ WS:

1. When `termserver -c "command"` is called:
   - Set `process.stdin.setRawMode(true)` for full raw terminal passthrough
   - Pipe `process.stdin` → PTY stdin (write to `ptyProcess`)
   - Pipe PTY stdout → `process.stdout` (via `ptyProcess.onData`)
   - Handle `SIGWINCH` to resize PTY to match local terminal dimensions
   - On PTY exit: restore terminal, print exit status, clean up

2. Local terminal always has write priority. When a remote WS client has control, remote input is also piped to PTY stdin. Local keypress reclaims control.

3. Handle graceful shutdown: `SIGINT`, `SIGTERM` → kill PTY process, restore terminal raw mode, exit cleanly.

4. Export `bridgeLocalTerminal(session)` function.

---

## Task 6 — CLI Entry Point
**Model: Claude Sonnet 4.6**
**Depends on: Task 1, Task 4, Task 5** (needs daemon, ptyBridge)

Create `termserver/bin/termserver.js` — CLI entry using Commander.js:

1. `#!/usr/bin/env node` shebang.
2. Commands using Commander:
   ```js
   import { Command } from 'commander';
   const program = new Command();
   program.name('termserver').description('Terminal sharing daemon').version('1.0.0');
   ```

3. `termserver pair` command:
   - Ensure daemon is running (auto-start if not)
   - Call `pairingManager.createPairing()` to get code
   - Print formatted output with chalk: IP address, port, pairing code
   - Optionally print QR code of `http://<ip>:<port>` using `qrcode-terminal`
   - Wait for pairing completion, then print success message with device name

4. `termserver -c <command>` (option on root command, not a subcommand):
   - Ensure daemon is running
   - Create a session via `sessionRegistry.create(command)`
   - Call `bridgeLocalTerminal(session)` to take over the terminal
   - Print session header: ID, command, "Visible to paired devices"

5. `termserver daemon` command:
   - Explicitly start daemon in foreground
   - Print listening address and port

6. `termserver devices` command:
   - List all paired devices from config

---

## Task 7 — Flutter Project Scaffolding & Data Layer
**Model: Claude Sonnet 4.6**
**No dependencies — start immediately**

Create the `termserver_app/` Flutter project:

1. Run `flutter create termserver_app` with org `com.termserver`.
2. Add to `pubspec.yaml`:
   ```yaml
   dependencies:
     xterm: ^4.0.0
     web_socket_channel: ^2.4.0
     flutter_secure_storage: ^9.0.0
     hive_flutter: ^1.1.0
     provider: ^6.0.0
     http: ^1.2.0
   ```
3. Create data model `lib/models/paired_device.dart`:
   ```dart
   class PairedDevice {
     final String id;
     final String name;
     final String ip;
     final int port;
     final String deviceToken;
     final DateTime pairedAt;
   }
   ```
   Include `toJson()`, `fromJson()`, Hive TypeAdapter.

4. Create `lib/services/storage_service.dart`:
   - Initialize Hive with `hive_flutter`
   - Register `PairedDeviceAdapter`
   - CRUD operations for paired devices in a Hive box
   - Store/retrieve `deviceToken` via `flutter_secure_storage`

5. Create `lib/services/api_service.dart`:
   - `initiatePairing(ip, port, deviceName)` → POST `/pair/initiate`
   - `completePairing(ip, port, code, sessionToken)` → POST `/pair/complete`
   - `getSessions(ip, port, token)` → GET `/sessions`
   - `getSession(ip, port, token, sessionId)` → GET `/sessions/:id`

6. Create `lib/services/websocket_service.dart`:
   - `connectToSession(ip, port, token, sessionId)` → WebSocket connection to `/ws/sessions/:id`
   - `connectToEvents(ip, port, token)` → WebSocket connection to `/ws/events`
   - Auto-reconnect on disconnect with exponential backoff
   - Message parsing for the shared WS protocol

7. Run `cd termserver_app && flutter pub get` to verify.

---

## Task 8 — Flutter Screens: Home, Add Device, Pairing
**Model: Claude Opus 4.6**
**Depends on: Task 7** (needs data layer and services)

Create the first three screens using Provider for state management:

1. `lib/providers/device_provider.dart`:
   - Extends `ChangeNotifier`
   - Holds `List<PairedDevice>`, loads from Hive on init
   - Methods: `addDevice()`, `removeDevice()`, `refreshDevices()`

2. `lib/screens/home_screen.dart`:
   - ListView of paired devices (from `DeviceProvider`)
   - Each tile shows device name, IP, last-seen status
   - Swipe-to-delete for removing paired devices
   - FAB "+" button → navigates to AddDeviceScreen
   - Tap device → navigates to DeviceScreen

3. `lib/screens/add_device_screen.dart`:
   - Text field for IP address (with validation for IPv4 format)
   - Optional port field (defaults to 8787)
   - "Connect" button → calls `apiService.initiatePairing()`
   - On success → navigates to PairingCodeScreen with `sessionToken` in memory

4. `lib/screens/pairing_code_screen.dart`:
   - 4-digit PIN entry (4 individual text fields, auto-advance focus)
   - On complete → calls `apiService.completePairing()`
   - On success → saves device to Hive + token to secure storage → navigates to DeviceScreen
   - On error → shows error, allows retry

5. Wire up `MaterialApp` in `lib/main.dart` with `MultiProvider`, routes, and theme.

---

## Task 9 — Flutter Screens: Device & Session Terminal
**Model: Claude Opus 4.6**
**Depends on: Task 7, Task 8** (needs services + navigation)

Create the device screen and terminal session screen:

1. `lib/providers/session_provider.dart`:
   - Manages WebSocket connection to `/ws/events` for a specific device
   - Holds `List<SessionInfo>` with live updates
   - Emits changes via `ChangeNotifier`

2. `lib/screens/device_screen.dart`:
   - Header showing device name and connection status
   - ListView of active sessions (from `SessionProvider`)
   - Each tile: session ID, command, uptime, status badge
   - Tap session → navigates to SessionScreen
   - Pull-to-refresh

3. `lib/screens/session_screen.dart`:
   - Uses `xterm` package (`^4.0.0`). Integration pattern:
     ```dart
     import 'package:xterm/xterm.dart';
     final terminal = Terminal(maxLines: 10000);
     // Feed WS output → terminal.write(data)
     // Feed terminal.onOutput → WS input
     ```
   - Full-screen `TerminalView(terminal: terminal)` widget
   - AppBar with session info (command, session ID)
   - Control toggle button: "Request Control" / "Release Control"
   - Sends `request_control` / `release_control` WS messages
   - Handles `session_closed` message → shows snackbar, navigates back
   - Keyboard input bar at bottom for mobile-friendly text entry
   - Resize events: listen to `TerminalView` size changes, send `resize` WS message

4. `lib/providers/terminal_provider.dart`:
   - Manages single session WS connection
   - Holds `Terminal` instance from xterm.dart
   - Handles `controlState` (none, requested, active)

---

## Task 10 — Polish & Integration Testing
**Model: Claude Sonnet 4.6**
**Depends on: Task 4, Task 6, Task 9** (needs both codebases complete)

1. **Node.js CLI README** (`termserver/README.md`):
   - Installation instructions (`npm install -g`)
   - Usage examples for `pair`, `-c`, `daemon`, `devices` commands
   - Protocol documentation reference
   - Cross-platform notes

2. **Flutter app polish**:
   - Auto-reconnect on WebSocket drop (exponential backoff, max 30s)
   - Session history: on WS connect, server sends `outputHistory` burst → terminal renders scrollback
   - Last-seen timestamp per device in home screen
   - QR code scan option in AddDeviceScreen (using `mobile_scanner` package) to scan `termserver://<ip>:<port>` URLs
   - Session name display from command in session list

3. **Flutter app README** (`termserver_app/README.md`):
   - Build instructions for iOS and Android
   - Screenshots placeholder
   - Usage walkthrough

4. **Integration smoke test** (manual steps documented in both READMEs):
   - Start daemon → pair device → create session → connect from app → verify bidirectional I/O

---

## Dependency Graph (DAG)

```
Task 1 (Scaffold)     Task 2 (Session)     Task 3 (Pairing)     Task 7 (Flutter Scaffold)
     │                      │                     │                      │
     │                      │                     │                      │
     ▼                      ▼                     ▼                      ▼
Task 4 (Daemon) ◄──── Task 2 + Task 3       Task 5 (PTY Bridge)   Task 8 (Flutter Screens 1-3)
     │                                            │                      │
     ▼                                            ▼                      ▼
Task 6 (CLI Entry) ◄──────────────────── Task 5              Task 9 (Flutter Screens 4-5)
     │                                                              │
     ▼                                                              ▼
Task 10 (Polish) ◄──────────────────────────────────────── Task 9
```

**Parallel wave execution:**
- **Wave 1** (immediate, 4 parallel): Task 1, Task 2, Task 3, Task 7
- **Wave 2** (after wave 1): Task 4 (needs 1+2+3), Task 5 (needs 2), Task 8 (needs 7)
- **Wave 3** (after wave 2): Task 6 (needs 4+5), Task 9 (needs 7+8)
- **Wave 4** (after wave 3): Task 10 (needs 6+9)

## Model Assignments Summary

| Task | Model | Rationale |
|------|-------|-----------|
| 1 — Scaffolding & Utilities | Claude Sonnet 4.6 | Straightforward setup, file creation |
| 2 — PTY Session Manager | Claude Opus 4.6 | Complex: node-pty lifecycle, cross-platform, event system |
| 3 — Pairing System | Claude Opus 4.6 | Security-sensitive: token management, auth middleware |
| 4 — Daemon Server | Claude Opus 4.6 | Most complex: WS routing, REST, session orchestration |
| 5 — PTY Bridge | Claude Opus 4.6 | Complex: raw terminal mode, signal handling, control model |
| 6 — CLI Entry Point | Claude Sonnet 4.6 | Glue code: Commander.js wiring, formatted output |
| 7 — Flutter Scaffold & Data | Claude Sonnet 4.6 | Straightforward: project setup, models, services |
| 8 — Flutter Screens (Home/Pair) | Claude Opus 4.6 | Complex: multi-screen flow, Provider state, Hive + secure storage |
| 9 — Flutter Terminal Screen | Claude Opus 4.6 | Most complex Flutter: xterm.dart integration, WS + control state |
| 10 — Polish & Docs | Claude Sonnet 4.6 | Documentation, minor enhancements, integration notes |