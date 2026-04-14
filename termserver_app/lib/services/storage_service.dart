import 'package:hive_flutter/hive_flutter.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/paired_device.dart';

class StorageService {
  static const String _devicesBoxName = 'paired_devices';
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage();
  late Box<PairedDevice> _devicesBox;

  Future<void> init() async {
    await Hive.initFlutter();
    Hive.registerAdapter(PairedDeviceAdapter());
    _devicesBox = await Hive.openBox<PairedDevice>(_devicesBoxName);
  }

  List<PairedDevice> getDevices() => _devicesBox.values.toList();

  Future<void> addDevice(PairedDevice device) async {
    await _devicesBox.put(device.id, device);
    await _secureStorage.write(key: 'token_${device.id}', value: device.deviceToken);
  }

  Future<void> renameDevice(String id, String newName) async {
    final device = _devicesBox.get(id);
    if (device == null) return;
    final updated = PairedDevice(
      id: device.id,
      name: newName,
      ip: device.ip,
      port: device.port,
      deviceToken: device.deviceToken,
      pairedAt: device.pairedAt,
    );
    await _devicesBox.put(id, updated);
  }

  Future<void> removeDevice(String id) async {
    await _devicesBox.delete(id);
    await _secureStorage.delete(key: 'token_$id');
  }

  Future<String?> getDeviceToken(String deviceId) async {
    return await _secureStorage.read(key: 'token_$deviceId');
  }

  Future<void> dispose() async {
    await _devicesBox.close();
  }
}
