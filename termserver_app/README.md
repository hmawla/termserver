# Termserver App

Flutter mobile client for termserver. View and control terminal sessions on your computer from your phone.

## Features

- Pair with termserver instances on your LAN
- View active terminal sessions in real-time
- Full ANSI terminal emulation (colors, cursor, etc.)
- Request/release remote control of sessions
- Auto-reconnect on connection drop

## Getting Started

### Prerequisites
- Flutter SDK >= 3.0.0
- A running termserver instance on your LAN

### Build & Run

```bash
cd termserver_app
flutter pub get
flutter run
```

### iOS
```bash
flutter build ios
```

### Android
```bash
flutter build apk
```

## Usage

1. Start `termserver pair` on your computer
2. Open the app and tap "+" to add a device
3. Enter the IP address shown in the terminal
4. Enter the 4-digit pairing code
5. Tap a paired device to see active sessions
6. Tap a session to view the terminal

## Architecture

- **State Management**: Provider
- **Terminal Emulation**: xterm.dart
- **Storage**: Hive (device list) + flutter_secure_storage (tokens)
- **Networking**: http (REST) + web_socket_channel (WebSocket)

## Screens

| Screen | Description |
|--------|-------------|
| Home | List of paired devices |
| Add Device | Enter IP address to initiate pairing |
| Pairing Code | Enter 4-digit code from terminal |
| Device | View active sessions for a device |
| Session | Full terminal view with control toggle |
