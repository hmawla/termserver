import process from 'node:process';

let cleaned = false;

/**
 * Restores terminal state. Idempotent — safe to call multiple times.
 */
export function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  } catch {
    // stdin may already be destroyed
  }
}

/**
 * Bridges the local terminal to a PTY session.
 * Takes over stdin/stdout for full raw passthrough until the PTY exits.
 *
 * @param {import('./session.js').Session} session
 * @returns {Promise<number>} resolves with the PTY exit code
 */
export function bridgeLocalTerminal(session) {
  // Reset for each invocation so cleanup works correctly
  cleaned = false;

  // Edge case: session already closed
  if (session.status !== 'active') {
    process.stderr.write(`Session ${session.id} is already closed.\n`);
    return Promise.resolve(session.exitCode ?? 1);
  }

  // Print session header before entering raw mode
  process.stdout.write(
    `\n  Session: ${session.id} ("${session.command}")\n` +
    `  Visible to paired devices\n` +
    `  ──────────────────────────────\n\n`
  );

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  // Set initial PTY size to match local terminal
  if (isTTY) {
    const cols = process.stdout.columns;
    const rows = process.stdout.rows;
    if (cols && rows) {
      session.resize(cols, rows);
    }
  }

  return new Promise((resolve) => {
    // --- stdin → PTY ---
    const onStdinData = (data) => {
      session.write(data);
    };

    // --- PTY → stdout ---
    const disposeOnData = session.ptyProcess.onData((data) => {
      process.stdout.write(data);
    });

    // --- SIGWINCH: terminal resize ---
    const onSigwinch = () => {
      const cols = process.stdout.columns;
      const rows = process.stdout.rows;
      if (cols && rows) {
        session.resize(cols, rows);
      }
    };

    // --- Graceful shutdown (OS-level signals) ---
    const onSignal = () => {
      teardown();
      session.kill();
    };

    function teardown() {
      process.stdin.removeListener('data', onStdinData);
      if (isTTY) {
        process.removeListener('SIGWINCH', onSigwinch);
      }
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      disposeOnData.dispose();
      cleanup();
    }

    // --- PTY exit ---
    session.ptyProcess.onExit(({ exitCode, signal }) => {
      teardown();
      if (signal) {
        process.stderr.write(`\nProcess exited with signal ${signal}\n`);
      } else {
        process.stderr.write(`\nProcess exited with code ${exitCode}\n`);
      }
      resolve(exitCode ?? 1);
    });

    // Wire up signal handlers
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    // Enter raw mode (TTY) or plain pipe mode
    if (isTTY) {
      process.stdin.setRawMode(true);
      process.on('SIGWINCH', onSigwinch);
    }
    process.stdin.setEncoding(null);
    process.stdin.resume();
    process.stdin.on('data', onStdinData);
  });
}
