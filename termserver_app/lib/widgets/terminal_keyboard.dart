import 'package:flutter/material.dart';

class _KeyDef {
  final String label;
  final String sequence;
  const _KeyDef(this.label, this.sequence);
}

class TerminalKeyboardBar extends StatelessWidget {
  final void Function(String sequence) onKey;

  const TerminalKeyboardBar({super.key, required this.onKey});

  static const _navKeys = [
    _KeyDef('Esc', '\x1b'),
    _KeyDef('Tab', '\t'),
    _KeyDef('←', '\x1b[D'),
    _KeyDef('↑', '\x1b[A'),
    _KeyDef('↓', '\x1b[B'),
    _KeyDef('→', '\x1b[C'),
    _KeyDef('Home', '\x1b[H'),
    _KeyDef('End', '\x1b[F'),
    _KeyDef('PgUp', '\x1b[5~'),
    _KeyDef('PgDn', '\x1b[6~'),
  ];

  static const _ctrlKeys = [
    _KeyDef('^C', '\x03'),
    _KeyDef('^D', '\x04'),
    _KeyDef('^Z', '\x1a'),
    _KeyDef('^A', '\x01'),
    _KeyDef('^E', '\x05'),
    _KeyDef('^K', '\x0b'),
    _KeyDef('^L', '\x0c'),
    _KeyDef('^U', '\x15'),
    _KeyDef('^W', '\x17'),
    _KeyDef('^R', '\x12'),
  ];

  static const _altKeys = [
    _KeyDef('M-f', '\x1bf'),
    _KeyDef('M-b', '\x1bb'),
    _KeyDef('M-d', '\x1bd'),
    _KeyDef('M-.', '\x1b.'),
  ];

  Widget _key(BuildContext context, _KeyDef def) {
    return InkWell(
      onTap: () => onKey(def.sequence),
      borderRadius: BorderRadius.circular(4),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Text(
          def.label,
          style: const TextStyle(fontSize: 13, fontFamily: 'monospace'),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      height: 44,
      color: colorScheme.surfaceContainerHighest,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: Row(
          children: [
            ..._navKeys.map((k) => _key(context, k)),
            const VerticalDivider(width: 16, indent: 6, endIndent: 6),
            ..._ctrlKeys.map((k) => _key(context, k)),
            const VerticalDivider(width: 16, indent: 6, endIndent: 6),
            ..._altKeys.map((k) => _key(context, k)),
          ],
        ),
      ),
    );
  }
}
