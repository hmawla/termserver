import * as pty from 'node-pty';
import { nanoid } from 'nanoid';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';

/**
 * Returns the default shell for the current platform.
 * Validates that the shell binary exists before returning it, falling back
 * through known locations so a stale $SHELL (e.g. a Homebrew shell that was
 * removed) does not cause posix_spawnp to fail at PTY creation time.
 */
export function getDefaultShell() {
  if (os.platform() === 'win32') {
    return 'powershell.exe';
  }
  const candidates = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ];
  for (const shell of candidates) {
    if (shell && fs.existsSync(shell)) return shell;
  }
  return 'sh';
}

/**
 * Fixed-size circular buffer that overwrites oldest entries when full.
 */
export class CircularBuffer {
  #buffer;
  #maxSize;
  #head;   // next write position
  #count;  // number of items currently stored

  constructor(maxSize = 1000) {
    this.#maxSize = maxSize;
    this.#buffer = new Array(maxSize);
    this.#head = 0;
    this.#count = 0;
  }

  push(item) {
    this.#buffer[this.#head] = item;
    this.#head = (this.#head + 1) % this.#maxSize;
    if (this.#count < this.#maxSize) {
      this.#count++;
    }
  }

  /** Returns all stored items in insertion order (oldest first). */
  toArray() {
    if (this.#count === 0) return [];
    if (this.#count < this.#maxSize) {
      return this.#buffer.slice(0, this.#count);
    }
    // Buffer is full — head points to the oldest entry
    return [
      ...this.#buffer.slice(this.#head),
      ...this.#buffer.slice(0, this.#head),
    ];
  }

  get length() {
    return this.#count;
  }

  clear() {
    this.#buffer = new Array(this.#maxSize);
    this.#head = 0;
    this.#count = 0;
  }
}

/**
 * A single PTY session wrapping a node-pty process.
 */
export class Session {
  constructor(command, args = [], opts = {}) {
    this.id = `tb-${nanoid(8)}`;
    this.command = command;
    this.args = args;
    this.cols = opts.cols ?? 80;
    this.rows = opts.rows ?? 30;
    this.status = 'active';
    this.startedAt = new Date().toISOString();
    this.outputHistory = new CircularBuffer(1000);
    this.controllingClientId = null;

    // Callbacks that SessionRegistry wires up
    this._onOutput = null;
    this._onExit = null;

    // Resolve and validate the working directory so a missing path never
    // causes an opaque posix_spawnp failure.
    let cwd = opts.cwd ?? os.homedir();
    if (!cwd || !fs.existsSync(cwd)) {
      cwd = os.tmpdir();
    }

    try {
      this.ptyProcess = pty.spawn(command, args, {
        name: 'xterm-color',
        cols: this.cols,
        rows: this.rows,
        cwd,
        env: process.env,
      });
    } catch (err) {
      const cmdExists = fs.existsSync(command);
      const cwdExists = fs.existsSync(cwd);
      throw new Error(
        `Failed to spawn PTY` +
        ` (shell: ${command} [exists: ${cmdExists}],` +
        ` cwd: ${cwd} [exists: ${cwdExists}]): ${err.message}`
      );
    }

    this.ptyProcess.onData((data) => {
      this.outputHistory.push(data);
      if (this._onOutput) this._onOutput(data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.status = 'closed';
      this.exitCode = exitCode;
      this.signal = signal;
      if (this._onExit) this._onExit({ exitCode, signal });
    });
  }

  write(data) {
    if (this.status !== 'active') return;
    try {
      this.ptyProcess.write(data);
    } catch {
      // PTY already dead — ignore
    }
  }

  resize(cols, rows) {
    if (this.status !== 'active') return;
    this.cols = cols;
    this.rows = rows;
    try {
      this.ptyProcess.resize(cols, rows);
    } catch {
      // PTY already dead — ignore
    }
  }

  kill() {
    if (this.status !== 'active') return;
    this.status = 'closed';
    try {
      this.ptyProcess.kill();
    } catch {
      // Already dead — ignore
    }
  }

  /** Display-friendly command string shown in the mobile app. */
  get displayCmd() {
    if (Array.isArray(this.args) && this.args[0] === '-c' && this.args[1]) {
      return this.args[1];
    }
    return [this.command, ...this.args].join(' ').trim();
  }

  toJSON() {
    return {
      id: this.id,
      cmd: this.displayCmd,
      command: this.command,
      args: this.args,
      status: this.status,
      startedAt: this.startedAt,
      cols: this.cols,
      rows: this.rows,
      controllingClientId: this.controllingClientId,
      exitCode: this.exitCode,
      signal: this.signal,
    };
  }
}

/**
 * Registry that manages all active PTY sessions.
 * Emits: 'session:created', 'session:closed', 'session:output'
 */
export class SessionRegistry extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  create(command, args = [], opts = {}) {
    const shell = command ?? getDefaultShell();
    const session = new Session(shell, args, opts);

    session._onOutput = (data) => {
      this.emit('session:output', { sessionId: session.id, data });
    };

    session._onExit = () => {
      this.emit('session:closed', session);
    };

    this.sessions.set(session.id, session);
    this.emit('session:created', session);
    return session;
  }

  get(id) {
    return this.sessions.get(id);
  }

  list() {
    return Array.from(this.sessions.values()).map((s) => s.toJSON());
  }

  remove(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill();
    this.sessions.delete(id);
    return true;
  }
}
