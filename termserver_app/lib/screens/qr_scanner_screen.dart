import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../models/paired_device.dart';
import '../providers/device_provider.dart';
import '../services/api_service.dart';

class QrScannerScreen extends StatefulWidget {
  const QrScannerScreen({super.key});

  @override
  State<QrScannerScreen> createState() => _QrScannerScreenState();
}

class _QrScannerScreenState extends State<QrScannerScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _processing = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _promptNameAndPair(
    String ip,
    int port,
    String code,
    String token,
  ) async {
    if (!mounted) return;

    final nameController = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Name this device'),
        content: TextField(
          controller: nameController,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Name (optional)',
            hintText: 'e.g. Home Server',
          ),
          textCapitalization: TextCapitalization.words,
          onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(''),
            child: const Text('Skip'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(nameController.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    // Wait for the dialog exit animation to fully complete (~300ms) before
    // touching the route stack. A single-frame delay is not sufficient.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    nameController.dispose();

    if (!mounted) return;

    final deviceName = (name == null || name.isEmpty) ? 'Device $ip' : name;

    try {
      final result = await ApiService().completePairing(ip, port, code, token);
      final device = PairedDevice(
        id: result['deviceId']!,
        name: deviceName,
        ip: ip,
        port: port,
        deviceToken: result['deviceToken']!,
        pairedAt: DateTime.now(),
      );

      if (!mounted) return;
      await Provider.of<DeviceProvider>(context, listen: false).addDevice(device);

      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).popUntil((route) => route.isFirst);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Device paired successfully')),
        );
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Pairing failed: $e')),
      );
      setState(() => _processing = false);
      await _controller.start();
    }
  }

  void _onDetect(BarcodeCapture capture) {
    if (_processing) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;

    final uri = Uri.tryParse(raw);
    if (uri == null || uri.scheme != 'termserver' || uri.host != 'pair') return;

    final ip = uri.queryParameters['ip'];
    final portStr = uri.queryParameters['port'];
    final code = uri.queryParameters['code'];
    final token = uri.queryParameters['token'];

    if (ip == null || portStr == null || code == null || token == null) return;
    final port = int.tryParse(portStr);
    if (port == null) return;

    // Lock immediately so rapid-fire detects are ignored.
    _processing = true;
    // Stop scanning without awaiting — avoids async work inside the detect
    // callback which can race with MobileScanner's own Overlay updates.
    _controller.stop();
    // Defer the dialog to the next frame so the scanner has finished its
    // current frame and the Overlay is in a stable state.
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _promptNameAndPair(ip, port, code, token),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan QR Code'),
        actions: [
          IconButton(
            icon: const Icon(Icons.flash_on),
            tooltip: 'Toggle torch',
            onPressed: _controller.toggleTorch,
          ),
          IconButton(
            icon: const Icon(Icons.flip_camera_ios),
            tooltip: 'Switch camera',
            onPressed: _controller.switchCamera,
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 3),
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.only(bottom: 48),
              child: Text(
                'Point camera at the QR code\nshown by termserver pair',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white, fontSize: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
