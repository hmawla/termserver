import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/device_provider.dart';
import 'screens/home_screen.dart';
import 'services/storage_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final storageService = StorageService();
  await storageService.init();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => DeviceProvider(storageService)..loadDevices(),
        ),
      ],
      child: const TermserverApp(),
    ),
  );
}

class TermserverApp extends StatelessWidget {
  const TermserverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Termserver',
      theme: ThemeData(
        colorSchemeSeed: Colors.blueGrey,
        useMaterial3: true,
        brightness: Brightness.dark,
      ),
      home: const HomeScreen(),
    );
  }
}
