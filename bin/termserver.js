#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startDaemon, stopDaemon, isDaemonRunning } from '../src/daemon.js';
import { getDefaultShell, runPtyDiagnostics, checkPtyHealth } from '../src/session.js';
import { bridgeLocalTerminal, bridgeRemoteSession } from '../src/ptyBridge.js';
import { getDevices, removeDevice } from '../src/store.js';
import { getLanIp } from '../src/network.js';

const { version } = createRequire(import.meta.url)('../package.json');

const program = new Command();

program
  .name('termserver')
  .description('Cross-platform terminal sharing daemon')
  .version(version)
  .option('-D, --debug', 'Show verbose debug output on errors');

// ---------------------------------------------------------------------------
// Helper: ensure daemon is running in-process
// ---------------------------------------------------------------------------

async function ensureDaemon() {
  const components = await startDaemon();
  if (components.alreadyRunning) {
    return { components: null, alreadyRunning: true, port: components.port };
  }
  return { components, alreadyRunning: false, port: components.port };
}

// ---------------------------------------------------------------------------
// termserver pair
// ---------------------------------------------------------------------------

program
  .command('pair')
  .description('Generate a pairing QR code for a mobile device')
  .action(async () => {
    const { components, alreadyRunning, port } = await ensureDaemon();

    if (alreadyRunning) {
      console.error(
        chalk.red('✗') +
          ' Daemon is already running in another process.\n' +
          '  Stop it first, then run `termserver pair` again.'
      );
      process.exit(1);
    }

    const { pairingManager } = components;
    const ip = getLanIp();

    // Proactively create a pairing so the QR code contains the full set of
    // credentials — the mobile app can complete pairing by scanning the QR
    // without having to enter anything manually.
    const { code, sessionToken } = pairingManager.createPairing('Mobile Device');
    const qrData = `termserver://pair?ip=${ip}&port=${port}&code=${code}&token=${sessionToken}`;

    console.log('');
    console.log('  ' + chalk.bold('termserver Pairing'));
    console.log('  ' + '─'.repeat(22));
    console.log('  IP Address  : ' + chalk.cyan(ip));
    console.log('  Port        : ' + chalk.cyan(port));
    console.log('');
    console.log('  Scan the QR code with the mobile app:');
    console.log('');

    await new Promise((resolve) => qrcode.generate(qrData, { small: true }, (qr) => {
      console.log(qr);
      resolve();
    }));

    console.log('  ' + chalk.dim('(Ctrl+C to cancel)'));
    console.log('');

    pairingManager.onPairingInitiated(({ code: newCode, deviceName }) => {
      // The manual-entry flow creates a separate pairing — show its code.
      if (newCode !== code) {
        console.log('  ' + chalk.dim(`"${deviceName}" connecting manually — enter this code:`));
        console.log('  Code: ' + chalk.yellow.bold(newCode));
        console.log('');
      }
    });

    pairingManager.onPairingComplete(({ deviceName }) => {
      console.log('  ' + chalk.green('✓') + ` Paired with "${deviceName}"`);
      console.log('  ' + chalk.dim('Daemon is still running. Press Ctrl+C to stop.'));
      console.log('');
    });

    process.on('SIGINT', async () => {
      console.log('\n  ' + chalk.yellow('Shutting down daemon.'));
      await stopDaemon(components);
      process.exit(0);
    });
  });

// ---------------------------------------------------------------------------
// termserver daemon
// ---------------------------------------------------------------------------

program
  .command('daemon')
  .description('Start the daemon in the foreground')
  .action(async () => {
    const components = await startDaemon();

    if (components.alreadyRunning) {
      console.log(
        chalk.yellow('⚠') + ' Daemon already running on port ' + chalk.bold(components.port)
      );
      process.exit(0);
    }

    const { port, address } = components;
    console.log(chalk.green('✓') + ' Daemon listening on ' + chalk.bold(`${address}:${port}`));

    const shutdown = async (signal) => {
      console.log(`\n  Received ${signal}, shutting down…`);
      await stopDaemon(components);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

// ---------------------------------------------------------------------------
// termserver devices
// ---------------------------------------------------------------------------

program
  .command('devices')
  .description('List all paired devices')
  .action(() => {
    const devices = getDevices();

    if (devices.length === 0) {
      console.log(chalk.dim('No paired devices'));
      return;
    }

    const nameWidth = Math.max(4, ...devices.map((d) => d.name.length));
    const idWidth = Math.max(2, ...devices.map((d) => d.id.length));
    const header =
      chalk.bold('ID'.padEnd(idWidth)) + '  ' +
      chalk.bold('Name'.padEnd(nameWidth)) + '  ' +
      chalk.bold('Paired At');
    console.log('');
    console.log('  ' + header);
    console.log('  ' + '─'.repeat(header.replace(/\x1b\[[0-9;]*m/g, '').length));

    for (const device of devices) {
      const pairedAt = device.pairedAt
        ? new Date(device.pairedAt).toLocaleString()
        : 'unknown';
      console.log(
        '  ' + device.id.padEnd(idWidth) + '  ' +
        device.name.padEnd(nameWidth) + '  ' + pairedAt
      );
    }
    console.log('');
  });

// ---------------------------------------------------------------------------
// termserver unpair <id>
// ---------------------------------------------------------------------------

program
  .command('unpair <id>')
  .description('Remove a paired device by ID (run `termserver devices` to list IDs)')
  .action((id) => {
    const devices = getDevices();
    const device = devices.find((d) => d.id === id);

    if (!device) {
      console.error(chalk.red('✗') + ` No device with ID "${id}"`);
      console.log(chalk.dim('  Run `termserver devices` to see paired device IDs.'));
      process.exit(1);
    }

    removeDevice(id);
    console.log(chalk.green('✓') + ` Unpaired "${device.name}" (${id})`);
  });

// ---------------------------------------------------------------------------
// Root option: -c <command>
// ---------------------------------------------------------------------------

program.option('-c, --command <cmd>', 'Run a command in a shared terminal session');

program.action(async (opts) => {
  if (!opts.command) {
    program.help();
    return;
  }

  const debug = !!opts.debug;
  const shell = getDefaultShell();
  const commandStr = opts.command;
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  if (debug) {
    const shellEnv = process.env.SHELL || '(unset)';
    const shellEnvExists = process.env.SHELL ? fs.existsSync(process.env.SHELL) : false;
    const homedir = os.homedir();
    const ptyDevice = os.platform() !== 'win32' ? '/dev/ptmx' : null;
    const dline = (label, value) =>
      console.error(chalk.gray(`[debug] ${label}`.padEnd(28)) + value);

    dline('platform:', `${os.platform()}/${os.arch()}`);
    dline('node:', process.version);
    dline('pid / uid / gid:', `${process.pid} / ${process.getuid?.() ?? 'n/a'} / ${process.getgid?.() ?? 'n/a'}`);

    // macOS-specific: detect Rosetta and native module architecture
    if (os.platform() === 'darwin') {
      try {
        const translated = execSync('sysctl -n sysctl.proc_translated 2>/dev/null || echo 0', { encoding: 'utf8' }).trim();
        dline('rosetta:', translated === '1' ? chalk.yellow('YES — running under Rosetta!') : 'no');
      } catch {}
      try {
        const archOut = execSync('arch 2>&1', { encoding: 'utf8' }).trim();
        dline('arch cmd:', archOut);
      } catch {}
    }

    dline('$TERM:', process.env.TERM ?? chalk.yellow('(unset — may cause spawn failure)'));
    dline('$LANG:', process.env.LANG ?? '(unset)');
    dline('$SHELL:', `${shellEnv} (exists: ${shellEnvExists})`);
    dline('selected shell:', `${shell} (exists: ${fs.existsSync(shell)})`);
    dline('homedir:', `${homedir} (exists: ${fs.existsSync(homedir)})`);
    if (ptyDevice) dline('pty device:', `${ptyDevice} (exists: ${fs.existsSync(ptyDevice)})`);
    dline('command:', JSON.stringify([shell, '-c', commandStr]));

    // Try to open the PTY device directly — if this fails, no spawn will work
    if (ptyDevice) {
      try {
        const fd = fs.openSync(ptyDevice, 'r+');
        fs.closeSync(fd);
        dline('ptmx open test:', chalk.green('OK'));
      } catch (e) {
        dline('ptmx open test:', chalk.red(`FAILED: ${e.message}`));
      }
    }

    // Run the full diagnostics (test spawn + native module info)
    console.error(chalk.gray('[debug] running pty diagnostics…'));
    const diag = await runPtyDiagnostics();
    dline('node-pty version:', diag.ptyNodeVersion ?? '?');
    dline('node-pty root:', diag.ptyRoot ?? '?');

    if (diag.ptyNodeFiles && diag.ptyNodeFiles.length > 0) {
      for (const f of diag.ptyNodeFiles) {
        // Check architecture of each found native binary
        let archInfo = '';
        if (os.platform() === 'darwin') {
          try {
            const lipo = execSync(`lipo -archs "${f}" 2>&1`, { encoding: 'utf8' }).trim();
            archInfo = lipo.includes(os.arch())
              ? chalk.green(` [archs: ${lipo}]`)
              : chalk.red(` [archs: ${lipo} ← MISMATCH with ${os.arch()}!]`);
          } catch {}
        }
        dline('pty.node found:', f + archInfo);
      }
    } else {
      dline('pty.node found:', chalk.red('NONE — native binary is missing'));
      console.error('');
      console.error(chalk.red('  ✗ node-pty native module was not compiled during installation.'));
      console.error(chalk.yellow('  → Fix: rebuild it for your current Node.js / architecture:'));
      console.error(chalk.cyan('      npm rebuild node-pty --prefix "$(npm root -g)/../.."'));
      console.error(chalk.yellow('  → Or reinstall from source:'));
      console.error(chalk.cyan('      npm install -g @hmawla/termserver --build-from-source'));
      console.error('');
    }

    dline('test pty spawn:', diag.testSpawn === 'OK' ? chalk.green('OK') : chalk.red(diag.testSpawn));
    if (diag.ptyDeviceError) dline('pty device error:', chalk.red(diag.ptyDeviceError));
    console.error('');
  }

  // Quick PTY health check — catches broken native binaries before we try
  // to start a daemon or create a session.
  const ptyErr = await checkPtyHealth();
  if (ptyErr) {
    console.error(chalk.red('✗ PTY subsystem error\n'));
    console.error(ptyErr.message);
    process.exit(1);
  }

  // If a daemon is already running in another process, attach to it via HTTP+WS
  // instead of failing.
  const daemonStatus = isDaemonRunning();
  if (daemonStatus.running) {
    if (debug) {
      console.error(chalk.gray('[debug] daemon:       ') + `running on port ${daemonStatus.port} (pid ${daemonStatus.pid ?? '?'})`);
    }

    if (!daemonStatus.adminToken) {
      console.error(
        chalk.red('✗') +
          ' The running daemon is too old (no admin token).\n' +
          '  Restart it with `termserver pair` or `termserver daemon`, then try again.'
      );
      process.exit(1);
    }

    let sessionId;
    try {
      const resp = await fetch(`http://127.0.0.1:${daemonStatus.port}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${daemonStatus.adminToken}`,
        },
        body: JSON.stringify({ command: shell, args: ['-c', commandStr], cols, rows }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => null);
        const msg = body?.error ?? `HTTP ${resp.status}`;
        if (debug && body) {
          if (body.debug) {
            console.error(chalk.gray('[debug] daemon env:'));
            for (const [k, v] of Object.entries(body.debug)) {
              console.error(chalk.gray(`          ${k}: `) + v);
            }
          }
          if (body.stack) {
            console.error(chalk.gray('[debug] stack:\n') + body.stack);
          }
        }
        throw new Error(msg);
      }
      const data = await resp.json();
      sessionId = data.sessionId;
    } catch (err) {
      console.error(chalk.red('✗') + ` Failed to create session: ${err.message}`);
      process.exit(1);
    }

    const exitCode = await bridgeRemoteSession(daemonStatus.port, sessionId, daemonStatus.adminToken);
    process.exit(exitCode);
    return;
  }

  if (debug) {
    console.error(chalk.gray('[debug] daemon:       ') + 'not running — starting in-process');
  }

  // No daemon running — start one in-process and bridge locally
  const { components } = await ensureDaemon();
  try {
    const session = components.sessionRegistry.create(shell, ['-c', commandStr], { cols, rows });
    const exitCode = await bridgeLocalTerminal(session);
    await stopDaemon(components);
    process.exit(exitCode);
  } catch (err) {
    if (debug) console.error(chalk.gray('[debug] spawn error: ') + err.stack);
    else console.error(chalk.red('✗') + ` Failed to create session: ${err.message}`);
    await stopDaemon(components);
    process.exit(1);
  }
});

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
