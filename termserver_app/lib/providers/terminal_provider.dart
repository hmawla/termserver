import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:xterm/xterm.dart';
import '../models/paired_device.dart';
import '../services/websocket_service.dart';

enum ControlState { none, requested, active }

class TerminalProvider extends ChangeNotifier {
  Terminal? _terminal;
  WebSocketService? _wsService;
  ControlState _controlState = ControlState.none;
  bool _isConnected = false;
  String? _sessionId;
  StreamSubscription? _messageSubscription;
  StreamSubscription? _statusSubscription;

  Terminal? get terminal => _terminal;
  ControlState get controlState => _controlState;
  bool get isConnected => _isConnected;
  String? get sessionId => _sessionId;

  Future<void> connect(PairedDevice device, String sessionId) async {
    _sessionId = sessionId;
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
          _isConnected = false;
          notifyListeners();
          break;
        case 'control_granted':
          _controlState = ControlState.active;
          notifyListeners();
          break;
        case 'control_denied':
          _controlState = ControlState.none;
          notifyListeners();
          break;
      }
    });

    _terminal!.onOutput = (data) {
      sendInput(data);
    };

    _wsService!.connectToSession(
      device.ip,
      device.port,
      device.deviceToken,
      sessionId,
    );

    _isConnected = true;
    notifyListeners();
  }

  void sendInput(String data) {
    _wsService?.sendInput(data);
  }

  void sendResize(int cols, int rows) {
    _wsService?.sendResize(cols, rows);
  }

  void requestControl() {
    _wsService?.requestControl();
    _controlState = ControlState.requested;
    notifyListeners();
  }

  void releaseControl() {
    _wsService?.releaseControl();
    _controlState = ControlState.none;
    notifyListeners();
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
