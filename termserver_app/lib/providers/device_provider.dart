import 'package:flutter/foundation.dart';
import '../models/paired_device.dart';
import '../services/storage_service.dart';
import '../services/api_service.dart';

class DeviceProvider extends ChangeNotifier {
  final StorageService _storageService;
  List<PairedDevice> _devices = [];

  DeviceProvider(this._storageService);

  List<PairedDevice> get devices => _devices;
  bool get isEmpty => _devices.isEmpty;

  Future<void> loadDevices() async {
    _devices = _storageService.getDevices();
    notifyListeners();
  }

  Future<void> addDevice(PairedDevice device) async {
    await _storageService.addDevice(device);
    _devices = _storageService.getDevices();
    notifyListeners();
  }

  Future<void> renameDevice(String id, String newName) async {
    await _storageService.renameDevice(id, newName);
    _devices = _storageService.getDevices();
    notifyListeners();
  }

  Future<void> removeDevice(String id) async {
    final device = _devices.firstWhere(
      (d) => d.id == id,
      orElse: () => throw StateError('Device not found'),
    );
    // Best-effort: tell the server to revoke the token. Ignore failures so an
    // offline or unreachable server does not prevent local removal.
    try {
      await ApiService().unpairDevice(device.ip, device.port, device.deviceToken, id);
    } catch (_) {}
    await _storageService.removeDevice(id);
    _devices = _storageService.getDevices();
    notifyListeners();
  }
}
