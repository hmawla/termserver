import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/paired_device.dart';
import '../providers/session_provider.dart';
import 'session_screen.dart';

class DeviceScreen extends StatefulWidget {
  final PairedDevice device;

  const DeviceScreen({super.key, required this.device});

  @override
  State<DeviceScreen> createState() => _DeviceScreenState();
}

class _DeviceScreenState extends State<DeviceScreen> {
  late final SessionProvider _sessionProvider;

  @override
  void initState() {
    super.initState();
    _sessionProvider = SessionProvider(widget.device);
    _sessionProvider.connect();
  }

  @override
  void dispose() {
    _sessionProvider.dispose();
    super.dispose();
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'connected':
        return Colors.green;
      case 'connecting':
        return Colors.orange;
      default:
        return Colors.red;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _sessionProvider,
      child: Consumer<SessionProvider>(
        builder: (context, provider, _) {
          return Scaffold(
            appBar: AppBar(
              title: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.device.name),
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _statusColor(provider.connectionStatus),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        provider.connectionStatus,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ],
              ),
            ),
            body: _buildBody(provider),
          );
        },
      ),
    );
  }

  Widget _buildBody(SessionProvider provider) {
    if (!provider.isConnected) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Connecting...'),
          ],
        ),
      );
    }

    if (provider.sessions.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => provider.connect(),
        child: ListView(
          children: const [
            SizedBox(height: 200),
            Center(
              child: Text(
                'No active sessions',
                style: TextStyle(fontSize: 16, color: Colors.grey),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => provider.connect(),
      child: ListView.builder(
        itemCount: provider.sessions.length,
        itemBuilder: (context, index) {
          final session = provider.sessions[index];
          return ListTile(
            leading: const Icon(Icons.terminal, color: Colors.green),
            title: Text(session.cmd),
            subtitle: Text('Session ${session.id} · ${session.status}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => SessionScreen(
                  device: widget.device,
                  sessionId: session.id,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
