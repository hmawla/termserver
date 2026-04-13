# termserver

Cross-platform terminal sharing daemon. Share your terminal sessions with mobile devices over your local network.

## Installation

```bash
npm install -g termserver
```

Or run locally:
```bash
git clone <repo>
cd termserver
npm install
npm link
```

## Usage

### Pair a mobile device
```bash
termserver pair
```
Displays your LAN IP, port, and a 4-digit pairing code. Enter the code in the mobile app to pair.

### Run a shared terminal session
```bash
termserver -c "your-command-here"
```
Examples:
```bash
termserver -c "htop"
termserver -c "copilot ."
termserver -c "npm run dev"
termserver -c "bash"
```
The command runs in your terminal normally. Paired mobile devices can view and optionally control the session.

### Start daemon explicitly
```bash
termserver daemon
```

### List paired devices
```bash
termserver devices
```

## How It Works

1. **Daemon**: A background HTTP/WebSocket server (default port 8787) manages PTY sessions
2. **Pairing**: One-time 4-digit code exchange establishes a persistent device token
3. **Sessions**: Commands run in PTY with output streamed over WebSocket to connected clients
4. **Control**: Remote clients can request control; local terminal always has priority

## Protocol

### REST API
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/pair/initiate` | No | Start pairing flow |
| POST | `/pair/complete` | No | Complete pairing with code |
| GET | `/sessions` | Bearer | List active sessions |
| GET | `/sessions/:id` | Bearer | Get session details |

### WebSocket
| Path | Auth | Description |
|------|------|-------------|
| `/ws/sessions/:id` | Bearer | Stream terminal I/O |
| `/ws/events` | Bearer | Real-time session list updates |

## Cross-Platform Support

| Feature | Linux/macOS | Windows |
|---------|-------------|---------|
| PTY | node-pty (forkpty) | node-pty (ConPTY) |
| Shell | $SHELL / bash | powershell.exe |
| Config | ~/.termserver/ | %APPDATA%/termserver/ |

## License

MIT
