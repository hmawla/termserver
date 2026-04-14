import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum ConnectionStatus { disconnected, connecting, connected }

class WebSocketService {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _reconnectTimer;

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _statusController = StreamController<ConnectionStatus>.broadcast();

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  Stream<ConnectionStatus> get status => _statusController.stream;

  String? _ip;
  int? _port;
  String? _token;
  String? _sessionId;
  bool _isEventStream = false;
  bool _disposed = false;
  int _reconnectAttempts = 0;

  void connectToSession(String ip, int port, String token, String sessionId) {
    _ip = ip;
    _port = port;
    _token = token;
    _sessionId = sessionId;
    _isEventStream = false;
    _reconnectAttempts = 0;
    _connect();
  }

  void connectToEvents(String ip, int port, String token) {
    _ip = ip;
    _port = port;
    _token = token;
    _sessionId = null;
    _isEventStream = true;
    _reconnectAttempts = 0;
    _connect();
  }

  void _connect() {
    if (_disposed) return;
    _statusController.add(ConnectionStatus.connecting);

    final path = _isEventStream
        ? 'ws://$_ip:$_port/ws/events?token=$_token'
        : 'ws://$_ip:$_port/ws/sessions/$_sessionId?token=$_token';

    try {
      _channel = IOWebSocketChannel.connect(Uri.parse(path));
      _statusController.add(ConnectionStatus.connected);
      _reconnectAttempts = 0;

      _subscription = _channel!.stream.listen(
        (data) {
          if (data is String) {
            try {
              final msg = jsonDecode(data) as Map<String, dynamic>;
              _messageController.add(msg);
            } catch (_) {
              // ignore malformed messages
            }
          }
        },
        onError: (_) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _statusController.add(ConnectionStatus.disconnected);
    _subscription?.cancel();
    _channel = null;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    final delay = Duration(seconds: min(pow(2, _reconnectAttempts).toInt(), 30));
    _reconnectAttempts++;

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, _connect);
  }

  void sendInput(String data) {
    _send({'type': 'input', 'data': data});
  }

  void sendResize(int cols, int rows) {
    _send({'type': 'resize', 'cols': cols, 'rows': rows});
  }

  void _send(Map<String, dynamic> message) {
    _channel?.sink.add(jsonEncode(message));
  }

  void disconnect() {
    _reconnectTimer?.cancel();
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
    _statusController.add(ConnectionStatus.disconnected);
  }

  void dispose() {
    _disposed = true;
    disconnect();
    _messageController.close();
    _statusController.close();
  }
}
