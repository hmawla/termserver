#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import { createRequire } from 'node:module';

import { startDaemon, stopDaemon, isDaemonRunning } from '../src/daemon.js';
import { getDefaultShell } from '../src/session.js';
import { bridgeLocalTerminal, bridgeRemoteSession } from '../src/ptyBridge.js';
import { getDevices, removeDevice } from '../src/store.js';
import { getLanIp } from '../src/network.js';

const { version } = createRequire(import.meta.url)('../package.json');

const program = new Command();

program
  .name('termserver')
  .description('Cross-platform terminal sharing daemon')
  .version(version);

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

  const shell = getDefaultShell();
  const commandStr = opts.command;
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  // If a daemon is already running in another process, attach to it via HTTP+WS
  // instead of failing.
  const daemonStatus = isDaemonRunning();
  if (daemonStatus.running) {
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
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
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

  // No daemon running — start one in-process and bridge locally
  const { components } = await ensureDaemon();
  const session = components.sessionRegistry.create(shell, ['-c', commandStr], { cols, rows });
  const exitCode = await bridgeLocalTerminal(session);
  await stopDaemon(components);
  process.exit(exitCode);
});

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
