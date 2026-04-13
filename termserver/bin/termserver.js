#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';

import { startDaemon, stopDaemon, isDaemonRunning } from '../src/daemon.js';
import { getDefaultShell } from '../src/session.js';
import { bridgeLocalTerminal } from '../src/ptyBridge.js';
import { getDevices } from '../src/store.js';
import { getLanIp } from '../src/network.js';

const program = new Command();

program
  .name('termserver')
  .description('Cross-platform terminal sharing daemon')
  .version('1.0.0');

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
  .description('Generate a pairing code for a mobile device')
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
    const { code } = pairingManager.createPairing('Terminal');
    const ip = getLanIp();
    const url = `http://${ip}:${port}`;

    console.log('');
    console.log('  ' + chalk.bold('termserver Pairing'));
    console.log('  ' + '─'.repeat(18));
    console.log('  IP Address  : ' + chalk.cyan(ip));
    console.log('  Port        : ' + chalk.cyan(port));
    console.log('  Pairing Code: ' + chalk.yellow.bold(code));
    console.log('');
    console.log('  ' + chalk.dim('Waiting for mobile app to connect and pair...'));
    console.log('  ' + chalk.dim('(Ctrl+C to cancel)'));
    console.log('');

    qrcode.generate(url, { small: true }, (qr) => console.log(qr));

    pairingManager.onPairingComplete(async ({ deviceName }) => {
      console.log('  ' + chalk.green('✓') + ` Paired with device "${deviceName}"`);
      await stopDaemon(components);
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('\n  ' + chalk.yellow('Pairing cancelled.'));
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
    const header =
      chalk.bold('Name'.padEnd(nameWidth)) + '  ' + chalk.bold('Paired At');
    console.log('');
    console.log('  ' + header);
    console.log('  ' + '─'.repeat(header.replace(/\x1b\[[0-9;]*m/g, '').length));

    for (const device of devices) {
      const pairedAt = device.pairedAt
        ? new Date(device.pairedAt).toLocaleString()
        : 'unknown';
      console.log('  ' + device.name.padEnd(nameWidth) + '  ' + pairedAt);
    }
    console.log('');
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

  const { components, alreadyRunning, port } = await ensureDaemon();

  if (alreadyRunning) {
    console.error(
      chalk.red('✗') +
        ' Daemon is already running in another process.\n' +
        '  Stop it first, then try again.'
    );
    process.exit(1);
  }

  const shell = getDefaultShell();
  const commandStr = opts.command;
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  const session = components.sessionRegistry.create(shell, ['-c', commandStr], { cols, rows });

  const exitCode = await bridgeLocalTerminal(session);

  await stopDaemon(components);
  process.exit(exitCode);
});

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
