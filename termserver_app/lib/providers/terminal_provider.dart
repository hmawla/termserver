import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:xterm/xterm.dart';
import '../models/paired_device.dart';
import '../services/websocket_service.dart';

class TerminalProvider extends ChangeNotifier {
  Terminal? _terminal;
  WebSocketService? _wsService;
  bool _isConnected = false;
  bool _sessionClosed = false;
  String? _sessionId;
  int? _originalCols;
  int? _originalRows;
  StreamSubscription? _messageSubscription;
  StreamSubscription? _statusSubscription;

  Terminal? get terminal => _terminal;
  bool get isConnected => _isConnected;
  bool get sessionClosed => _sessionClosed;
  String? get sessionId => _sessionId;
  int? get originalCols => _originalCols;
  int? get originalRows => _originalRows;

  Future<void> connect(PairedDevice device, String sessionId) async {
    _sessionId = sessionId;
    _sessionClosed = false;
    _terminal = Terminal(maxLines: 10000);
    _wsService = WebSocketService();

    _statusSubscription = _wsService!.status.listen((status) {
      final connected = status == ConnectionStatus.connected;
      if (_isConnected != connected) {
        _isConnected = connected;
        notifyListeners();
      }
    });

    _messageSubscription = _wsService!.messages.listen((msg) {
      final type = msg['type'] as String?;
      switch (type) {
        case 'output':
          final data = msg['data'] as String? ?? '';
          _terminal?.write(data);
          break;
        case 'session_closed':
          _wsService?.disconnect();
          _sessionClosed = true;
          notifyListeners();
          break;
        case 'session_info':
          _originalCols = msg['cols'] as int?;
          _originalRows = msg['rows'] as int?;
          break;
      }
    });

    _terminal!.onOutput = (data) {
      // xterm 4.x on iOS sends \n (LF) for the Enter key via the software
      // keyboard (TextInputAction.newline inserts text instead of calling
      // performAction). PTY line discipline expects \r (CR) for Enter, so
      // we remap bare \n → \r here for all input (correct for both
      // individual keypresses and pasted multi-line content).
      final fixed = data.replaceAll('\n', '\r');
      sendInput(fixed);
    };

    _wsService!.connectToSession(
      device.ip,
      device.port,
      device.deviceToken,
      sessionId,
    );
  }

  void sendInput(String data) {
    _wsService?.sendInput(data);
  }

  void sendResize(int cols, int rows) {
    _wsService?.sendResize(cols, rows);
  }

  void disconnect() {
    _messageSubscription?.cancel();
    _statusSubscription?.cancel();
    _wsService?.disconnect();
    _wsService?.dispose();
    _wsService = null;
    _terminal = null;
    _isConnected = false;
    _sessionId = null;
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
