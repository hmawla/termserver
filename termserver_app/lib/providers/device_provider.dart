import 'package:flutter/foundation.dart';
import '../models/paired_device.dart';
import '../services/storage_service.dart';

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

  Future<void> removeDevice(String id) async {
    await _storageService.removeDevice(id);
    _devices = _storageService.getDevices();
    notifyListeners();
  }
}
