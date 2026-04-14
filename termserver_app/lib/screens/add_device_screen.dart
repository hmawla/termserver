import 'package:flutter/material.dart';
import '../services/api_service.dart';
import 'pairing_code_screen.dart';
import 'qr_scanner_screen.dart';

class AddDeviceScreen extends StatefulWidget {
  const AddDeviceScreen({super.key});

  @override
  State<AddDeviceScreen> createState() => _AddDeviceScreenState();
}

class _AddDeviceScreenState extends State<AddDeviceScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _ipController = TextEditingController();
  final _portController = TextEditingController(text: '8787');
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _ipController.dispose();
    _portController.dispose();
    super.dispose();
  }

  String? _validateIp(String? value) {
    if (value == null || value.isEmpty) return 'IP address is required';
    final parts = value.split('.');
    if (parts.length != 4) return 'Invalid IPv4 address';
    for (final part in parts) {
      final n = int.tryParse(part);
      if (n == null || n < 0 || n > 255) return 'Invalid IPv4 address';
    }
    return null;
  }

  String? _validatePort(String? value) {
    if (value == null || value.isEmpty) return 'Port is required';
    final n = int.tryParse(value);
    if (n == null || n < 1 || n > 65535) return 'Port must be 1-65535';
    return null;
  }

  Future<void> _connect() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    final name = _nameController.text.trim();
    final ip = _ipController.text.trim();
    final port = int.parse(_portController.text.trim());

    try {
      final sessionToken = await ApiService().initiatePairing(
        ip,
        port,
        'Flutter Client',
      );

      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => PairingCodeScreen(
            ip: ip,
            port: port,
            sessionToken: sessionToken,
            name: name.isEmpty ? 'Device $ip' : name,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Connection failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add Device')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Name (optional)',
                  hintText: 'e.g. Home Server',
                ),
                textCapitalization: TextCapitalization.words,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _ipController,
                decoration: const InputDecoration(
                  labelText: 'IP Address',
                  hintText: 'e.g. 192.168.1.42',
                ),
                keyboardType: TextInputType.number,
                validator: _validateIp,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _portController,
                decoration: const InputDecoration(
                  labelText: 'Port',
                  hintText: '8787',
                ),
                keyboardType: TextInputType.number,
                validator: _validatePort,
              ),
              const SizedBox(height: 24),
              ElevatedButton(
                onPressed: _isLoading ? null : _connect,
                child: _isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Connect'),
              ),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Expanded(child: Divider()),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    child: Text('or', style: TextStyle(color: Colors.grey)),
                  ),
                  Expanded(child: Divider()),
                ],
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                icon: const Icon(Icons.qr_code_scanner),
                label: const Text('Scan QR Code'),
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const QrScannerScreen()),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
