import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/paired_device.dart';
import '../providers/device_provider.dart';
import '../services/api_service.dart';

class PairingCodeScreen extends StatefulWidget {
  final String ip;
  final int port;
  final String sessionToken;
  final String name;

  const PairingCodeScreen({
    super.key,
    required this.ip,
    required this.port,
    required this.sessionToken,
    required this.name,
  });

  @override
  State<PairingCodeScreen> createState() => _PairingCodeScreenState();
}

class _PairingCodeScreenState extends State<PairingCodeScreen> {
  final List<TextEditingController> _controllers =
      List.generate(4, (_) => TextEditingController());
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
  bool _isLoading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (int i = 0; i < 4; i++) {
      _controllers[i].addListener(() => _onDigitChanged(i));
    }
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  void _onDigitChanged(int index) {
    final text = _controllers[index].text;
    if (text.length == 1) {
      if (index < 3) {
        _focusNodes[index + 1].requestFocus();
      } else {
        _trySubmit();
      }
    }
  }

  String get _code => _controllers.map((c) => c.text).join();

  bool get _allFilled => _controllers.every((c) => c.text.length == 1);

  Future<void> _trySubmit() async {
    if (!_allFilled || _isLoading) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final result = await ApiService().completePairing(
        widget.ip,
        widget.port,
        _code,
        widget.sessionToken,
      );

      final device = PairedDevice(
        id: result['deviceId']!,
        name: widget.name,
        ip: widget.ip,
        port: widget.port,
        deviceToken: result['deviceToken']!,
        pairedAt: DateTime.now(),
      );

      if (!mounted) return;

      await Provider.of<DeviceProvider>(context, listen: false)
          .addDevice(device);

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
      setState(() {
        _error = 'Pairing failed: $e';
        _isLoading = false;
      });
      _clearFields();
    }
  }

  void _clearFields() {
    for (final c in _controllers) {
      c.clear();
    }
    _focusNodes[0].requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Enter Pairing Code')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Enter the 4-digit code shown on your terminal',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16),
              ),
              const SizedBox(height: 32),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(4, (i) {
                  return Container(
                    width: 56,
                    margin: const EdgeInsets.symmetric(horizontal: 8),
                    child: TextField(
                      controller: _controllers[i],
                      focusNode: _focusNodes[i],
                      maxLength: 1,
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 32),
                      decoration: const InputDecoration(
                        counterText: '',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 24),
              if (_isLoading)
                const CircularProgressIndicator()
              else if (_error != null)
                Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ),
        ),
      ),
    );
  }
}
