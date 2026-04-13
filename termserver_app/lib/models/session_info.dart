class SessionInfo {
  final String id;
  final String cmd;
  final String startedAt;
  final String status;

  SessionInfo({
    required this.id,
    required this.cmd,
    required this.startedAt,
    required this.status,
  });

  factory SessionInfo.fromJson(Map<String, dynamic> json) => SessionInfo(
    id: json['id'] as String,
    cmd: json['cmd'] as String,
    startedAt: json['startedAt'] as String,
    status: json['status'] as String,
  );
}
