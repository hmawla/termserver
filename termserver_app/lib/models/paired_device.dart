import 'package:hive/hive.dart';

part 'paired_device.g.dart';

@HiveType(typeId: 0)
class PairedDevice extends HiveObject {
  @HiveField(0)
  final String id;

  @HiveField(1)
  final String name;

  @HiveField(2)
  final String ip;

  @HiveField(3)
  final int port;

  @HiveField(4)
  final String deviceToken;

  @HiveField(5)
  final DateTime pairedAt;

  PairedDevice({
    required this.id,
    required this.name,
    required this.ip,
    required this.port,
    required this.deviceToken,
    required this.pairedAt,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'ip': ip,
    'port': port,
    'deviceToken': deviceToken,
    'pairedAt': pairedAt.toIso8601String(),
  };

  factory PairedDevice.fromJson(Map<String, dynamic> json) => PairedDevice(
    id: json['id'] as String,
    name: json['name'] as String,
    ip: json['ip'] as String,
    port: json['port'] as int,
    deviceToken: json['deviceToken'] as String,
    pairedAt: DateTime.parse(json['pairedAt'] as String),
  );
}
