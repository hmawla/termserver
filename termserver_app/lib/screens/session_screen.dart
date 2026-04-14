import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:xterm/xterm.dart';
import '../models/paired_device.dart';
import '../providers/terminal_provider.dart';
import '../widgets/terminal_keyboard.dart';

class SessionScreen extends StatefulWidget {
  final PairedDevice device;
  final String sessionId;

  const SessionScreen({
    super.key,
    required this.device,
    required this.sessionId,
  });

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  late final TerminalProvider _terminalProvider;
  final _inputController = TextEditingController();
  int? _lastCols;
  int? _lastRows;
  bool _sessionClosedHandled = false;
  bool _showKeyboard = false;

  @override
  void initState() {
    super.initState();
    _terminalProvider = TerminalProvider();
    _terminalProvider.addListener(_onProviderChanged);
    _terminalProvider.connect(widget.device, widget.sessionId);
  }

  void _onProviderChanged() {
    // Only pop when the SERVER explicitly closes the session.
    // Don't react to transient WS disconnects (which trigger reconnect).
    if (_terminalProvider.sessionClosed && !_sessionClosedHandled && mounted) {
      _sessionClosedHandled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Session closed')),
          );
          Navigator.of(context).pop();
        }
      });
    }
  }

  @override
  void dispose() {
    _terminalProvider.removeListener(_onProviderChanged);
    _terminalProvider.dispose();
    _inputController.dispose();
    super.dispose();
  }

  void _onControlToggle() {
    switch (_terminalProvider.controlState) {
      case ControlState.none:
        _terminalProvider.requestControl();
        break;
      case ControlState.active:
        _terminalProvider.releaseControl();
        break;
      case ControlState.requested:
        break;
    }
  }

  Widget _buildControlButton(TerminalProvider provider) {
    final state = provider.controlState;
    IconData icon;
    String? tooltip;
    VoidCallback? onPressed;

    switch (state) {
      case ControlState.none:
        icon = Icons.pan_tool_outlined;
        tooltip = 'Request Control';
        onPressed = _onControlToggle;
        break;
      case ControlState.requested:
        icon = Icons.hourglass_top;
        tooltip = 'Waiting...';
        onPressed = null;
        break;
      case ControlState.active:
        icon = Icons.pan_tool;
        tooltip = 'Release Control';
        onPressed = _onControlToggle;
        break;
    }

    return IconButton(
      icon: Icon(icon),
      tooltip: tooltip,
      onPressed: onPressed,
    );
  }

  void _handleResize(double width, double height) {
    const charWidth = 9.0;
    const charHeight = 18.0;
    final cols = (width / charWidth).floor();
    final rows = (height / charHeight).floor();

    if (cols > 0 && rows > 0 && (cols != _lastCols || rows != _lastRows)) {
      _lastCols = cols;
      _lastRows = rows;
      _terminalProvider.sendResize(cols, rows);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _terminalProvider,
      child: Consumer<TerminalProvider>(
        builder: (context, provider, _) {
          return Scaffold(
            appBar: AppBar(
              title: Text('Session ${widget.sessionId}'),
              actions: [
                IconButton(
                  icon: Icon(
                    _showKeyboard ? Icons.keyboard_hide : Icons.keyboard,
                  ),
                  tooltip: _showKeyboard ? 'Hide keyboard' : 'Special keys',
                  onPressed: () => setState(() => _showKeyboard = !_showKeyboard),
                ),
                _buildControlButton(provider),
              ],
            ),
            body: Column(
              children: [
                Expanded(
                  child: provider.terminal == null
                      ? const Center(child: CircularProgressIndicator())
                      : LayoutBuilder(
                          builder: (context, constraints) {
                            _handleResize(
                              constraints.maxWidth,
                              constraints.maxHeight,
                            );
                            return TerminalView(provider.terminal!);
                          },
                        ),
                ),
                if (_showKeyboard)
                  TerminalKeyboardBar(
                    onKey: (seq) => provider.sendInput(seq),
                  ),
                _buildInputBar(provider),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildInputBar(TerminalProvider provider) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _inputController,
                decoration: const InputDecoration(
                  hintText: 'Type command...',
                  border: InputBorder.none,
                  isDense: true,
                ),
                onSubmitted: (text) {
                  provider.sendInput('$text\n');
                  _inputController.clear();
                },
              ),
            ),
            IconButton(
              icon: const Icon(Icons.send),
              onPressed: () {
                final text = _inputController.text;
                if (text.isNotEmpty) {
                  provider.sendInput('$text\n');
                  _inputController.clear();
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
