import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/session_info.dart';

class ApiService {
  Future<String> initiatePairing(String ip, int port, String deviceName) async {
    final uri = Uri.parse('http://$ip:$port/pair/initiate');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'deviceName': deviceName}),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to initiate pairing: ${response.statusCode} ${response.body}');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return data['sessionToken'] as String;
  }

  Future<Map<String, String>> completePairing(
    String ip,
    int port,
    String code,
    String sessionToken,
  ) async {
    final uri = Uri.parse('http://$ip:$port/pair/complete');
    final response = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'code': code, 'sessionToken': sessionToken}),
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to complete pairing: ${response.statusCode} ${response.body}');
    }
    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return {
      'deviceToken': data['deviceToken'] as String,
      'deviceId': data['deviceId'] as String,
    };
  }

  Future<void> unpairDevice(
    String ip,
    int port,
    String token,
    String deviceId,
  ) async {
    final uri = Uri.parse('http://$ip:$port/devices/$deviceId');
    final response = await http
        .delete(uri, headers: {'Authorization': 'Bearer $token'})
        .timeout(const Duration(seconds: 3));
    if (response.statusCode != 200) {
      throw Exception('Failed to unpair: ${response.statusCode}');
    }
  }

  Future<List<SessionInfo>> getSessions(String ip, int port, String token) async {
    final uri = Uri.parse('http://$ip:$port/sessions');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to get sessions: ${response.statusCode} ${response.body}');
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list.map((e) => SessionInfo.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<SessionInfo> getSession(String ip, int port, String token, String sessionId) async {
    final uri = Uri.parse('http://$ip:$port/sessions/$sessionId');
    final response = await http.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to get session: ${response.statusCode} ${response.body}');
    }
    return SessionInfo.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }
}
