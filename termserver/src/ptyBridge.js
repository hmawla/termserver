import process from 'node:process';
import { WebSocket } from 'ws';

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

/**
 * Bridges the local terminal to a PTY session running inside a remote daemon
 * process, communicating over its WebSocket API.
 *
 * @param {number} port  - Daemon HTTP/WS port
 * @param {string} sessionId - Session ID returned by POST /sessions
 * @param {string} adminToken - Admin token from the daemon lock file
 * @returns {Promise<number>} resolves with the PTY exit code
 */
export function bridgeRemoteSession(port, sessionId, adminToken) {
  cleaned = false;

  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${port}/ws/sessions/${sessionId}?token=${adminToken}`;
    const ws = new WebSocket(url);

    const isTTY = process.stdin.isTTY && process.stdout.isTTY;
    let done = false;

    function teardown(exitCode) {
      if (done) return;
      done = true;

      process.stdin.removeListener('data', onStdinData);
      if (isTTY) process.removeListener('SIGWINCH', onSigwinch);

      try { ws.close(); } catch { /* ignore */ }
      cleanup();
      resolve(exitCode ?? 0);
    }

    ws.once('open', () => {
      // Grab control of the session so our stdin goes through
      ws.send(JSON.stringify({ type: 'request_control' }));

      if (isTTY) {
        process.stdin.setRawMode(true);
        const cols = process.stdout.columns;
        const rows = process.stdout.rows;
        if (cols && rows) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      }
      process.stdin.setEncoding(null);
      process.stdin.resume();

      process.stdout.write(
        `\n  Session: ${sessionId}\n` +
        `  Visible to paired devices\n` +
        `  ──────────────────────────────\n\n`
      );
    });

    // stdin → WS input
    const onStdinData = (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        // latin1 preserves all 8-bit bytes across JSON string encoding
        ws.send(JSON.stringify({ type: 'input', data: data.toString('latin1') }));
      }
    };
    process.stdin.on('data', onStdinData);

    // SIGWINCH → resize
    const onSigwinch = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: process.stdout.columns,
          rows: process.stdout.rows,
        }));
      }
    };
    if (isTTY) process.on('SIGWINCH', onSigwinch);

    // WS messages → stdout / session close
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'output') {
          // Use latin1 to preserve all byte values from the PTY output string
          process.stdout.write(Buffer.from(msg.data, 'latin1'));
        } else if (msg.type === 'session_closed') {
          if (msg.exitCode !== undefined) {
            process.stderr.write(`\nProcess exited with code ${msg.exitCode}\n`);
          }
          teardown(msg.exitCode);
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => teardown(0));

    ws.once('error', (err) => {
      process.stderr.write(`\nFailed to connect to daemon session: ${err.message}\n`);
      teardown(1);
    });
  });
}
