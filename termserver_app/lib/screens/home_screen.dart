import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/paired_device.dart';
import '../providers/device_provider.dart';
import 'add_device_screen.dart';
import 'device_screen.dart';

String _relativeTime(DateTime dateTime) {
  final diff = DateTime.now().difference(dateTime);
  if (diff.inDays > 365) return '${diff.inDays ~/ 365}y ago';
  if (diff.inDays > 30) return '${diff.inDays ~/ 30}mo ago';
  if (diff.inDays > 0) return '${diff.inDays}d ago';
  if (diff.inHours > 0) return '${diff.inHours}h ago';
  if (diff.inMinutes > 0) return '${diff.inMinutes}m ago';
  return 'just now';
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  Future<bool?> _confirmDelete(BuildContext context, PairedDevice device) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove Device'),
        content: Text('Remove "${device.name}" from paired devices?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Termserver')),
      body: Consumer<DeviceProvider>(
        builder: (context, provider, _) {
          if (provider.isEmpty) {
            return const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'No paired devices',
                    style: TextStyle(fontSize: 18),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Tap + to add a device',
                    style: TextStyle(color: Colors.grey),
                  ),
                ],
              ),
            );
          }

          return ListView.builder(
            itemCount: provider.devices.length,
            itemBuilder: (context, index) {
              final device = provider.devices[index];
              return Dismissible(
                key: ValueKey(device.id),
                direction: DismissDirection.endToStart,
                background: Container(
                  alignment: Alignment.centerRight,
                  padding: const EdgeInsets.only(right: 16),
                  color: Colors.red,
                  child: const Icon(Icons.delete, color: Colors.white),
                ),
                confirmDismiss: (_) => _confirmDelete(context, device),
                onDismissed: (_) => provider.removeDevice(device.id),
                child: ListTile(
                  leading: const Icon(Icons.computer),
                  title: Text(device.name),
                  subtitle: Text('${device.ip}:${device.port}'),
                  trailing: Text(
                    _relativeTime(device.pairedAt),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => DeviceScreen(device: device),
                    ),
                  ),
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const AddDeviceScreen()),
        ),
        child: const Icon(Icons.add),
      ),
    );
  }
}
