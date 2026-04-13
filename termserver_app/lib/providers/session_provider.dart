import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/paired_device.dart';
import '../models/session_info.dart';
import '../services/websocket_service.dart';

class SessionProvider extends ChangeNotifier {
  final PairedDevice device;
  final WebSocketService _wsService = WebSocketService();

  List<SessionInfo> _sessions = [];
  ConnectionStatus _connectionStatus = ConnectionStatus.disconnected;
  StreamSubscription? _messageSubscription;
  StreamSubscription? _statusSubscription;

  SessionProvider(this.device);

  List<SessionInfo> get sessions => _sessions;
  bool get isConnected => _connectionStatus == ConnectionStatus.connected;

  String get connectionStatus {
    switch (_connectionStatus) {
      case ConnectionStatus.connected:
        return 'connected';
      case ConnectionStatus.connecting:
        return 'connecting';
      case ConnectionStatus.disconnected:
        return 'disconnected';
    }
  }

  Future<void> connect() async {
    _statusSubscription?.cancel();
    _messageSubscription?.cancel();

    _statusSubscription = _wsService.status.listen((status) {
      _connectionStatus = status;
      notifyListeners();
    });

    _messageSubscription = _wsService.messages.listen((msg) {
      final type = msg['type'] as String?;
      if (type == 'sessions_list') {
        final list = msg['sessions'] as List<dynamic>? ?? [];
        _sessions = list
            .map((e) => SessionInfo.fromJson(e as Map<String, dynamic>))
            .toList();
        notifyListeners();
      }
    });

    _wsService.connectToEvents(device.ip, device.port, device.deviceToken);
  }

  void disconnect() {
    _messageSubscription?.cancel();
    _statusSubscription?.cancel();
    _wsService.disconnect();
    _connectionStatus = ConnectionStatus.disconnected;
  }

  @override
  void dispose() {
    disconnect();
    _wsService.dispose();
    super.dispose();
  }
}
