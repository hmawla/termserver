import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { nanoid } from 'nanoid';
import detectPort from 'detect-port';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import * as store from './store.js';
import { getLanIp } from './network.js';
import { SessionRegistry } from './session.js';
import { PairingManager, authMiddleware, extractTokenFromRequest } from './pairing.js';

const LOCK_DIR = path.join(os.homedir(), '.termserver');
const LOCK_FILE = path.join(LOCK_DIR, 'daemon.pid');

// ---------------------------------------------------------------------------
// Lock file helpers
// ---------------------------------------------------------------------------

function readLockFile() {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLockFile(pid, port, adminToken) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid, port, adminToken }));
}

function removeLockFile() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // already gone
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isDaemonRunning() {
  const lock = readLockFile();
  if (!lock) return { running: false };

  if (isPidAlive(lock.pid)) {
    return { running: true, port: lock.port, pid: lock.pid, adminToken: lock.adminToken };
  }

  // Stale lock file — clean up
  removeLockFile();
  return { running: false };
}

export async function startDaemon(options = {}) {
  // Single-instance check
  const status = isDaemonRunning();
  if (status.running) {
    return { alreadyRunning: true, port: status.port, pid: status.pid };
  }

  const sessionRegistry = new SessionRegistry();
  const pairingManager = new PairingManager(store);

  // Generate a per-run admin token so the local CLI can attach sessions
  // to an already-running daemon without going through the mobile pairing flow.
  const adminToken = nanoid(64);
  pairingManager.setAdminToken(adminToken);

  const app = express();
  app.use(express.json());

  const server = createServer(app);
  const sessionWss = new WebSocketServer({ noServer: true });
  const eventsWss = new WebSocketServer({ noServer: true });

  // -----------------------------------------------------------------------
  // REST endpoints
  // -----------------------------------------------------------------------

  const auth = authMiddleware(pairingManager);

  // Pair endpoints (no auth)
  app.post('/pair/initiate', (req, res) => {
    try {
      const { deviceName } = req.body || {};
      if (!deviceName) {
        return res.status(400).json({ error: 'deviceName is required' });
      }
      const { sessionToken } = pairingManager.createPairing(deviceName);
      res.json({ sessionToken });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/pair/complete', (req, res) => {
    try {
      const { code, sessionToken } = req.body || {};
      if (!code || !sessionToken) {
        return res.status(400).json({ error: 'code and sessionToken are required' });
      }
      const result = pairingManager.completePairing(code, sessionToken);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Device management (auth required)
  app.get('/devices', auth, (req, res) => {
    if (!req.device.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(store.getDevices());
  });

  app.delete('/devices/:id', auth, (req, res) => {
    const { id } = req.params;
    // A device may only revoke itself; admin may revoke any device.
    if (req.device.id !== id && !req.device.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const devices = store.getDevices();
    if (!devices.find((d) => d.id === id)) {
      return res.status(404).json({ error: 'Device not found' });
    }
    store.removeDevice(id);
    res.json({ success: true });
  });

  // Session endpoints (auth required)
  app.get('/sessions', auth, (_req, res) => {
    res.json(sessionRegistry.list());
  });

  app.get('/sessions/:id', auth, (req, res) => {
    const session = sessionRegistry.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session.toJSON());
  });

  // Create a new PTY session (admin-only — used by local CLI when attaching to a running daemon)
  app.post('/sessions', auth, (req, res) => {
    if (!req.device.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    try {
      const { command, args = [], cols = 80, rows = 24 } = req.body || {};
      if (!command) {
        return res.status(400).json({ error: 'command is required' });
      }
      const session = sessionRegistry.create(command, args, { cols, rows });
      res.json({ sessionId: session.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // WebSocket upgrade routing
  // -----------------------------------------------------------------------

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);

    // Auth check for all WS endpoints
    const token = extractTokenFromRequest(request);
    const device = pairingManager.validateToken(token);
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (pathname.startsWith('/ws/sessions/')) {
      sessionWss.handleUpgrade(request, socket, head, (ws) => {
        const sessionId = pathname.replace('/ws/sessions/', '');
        sessionWss.emit('connection', ws, request, sessionId);
      });
    } else if (pathname === '/ws/events') {
      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        eventsWss.emit('connection', ws, request);
      });
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  });

  // -----------------------------------------------------------------------
  // /ws/sessions/:id  — terminal I/O
  // -----------------------------------------------------------------------

  sessionWss.on('connection', (ws, _request, sessionId) => {
    const clientId = nanoid();
    const session = sessionRegistry.get(sessionId);

    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      ws.close(4004, 'Session not found');
      return;
    }

    // Tell the client the current PTY dimensions so it can restore them on disconnect
    ws.send(JSON.stringify({ type: 'session_info', cols: session.cols, rows: session.rows }));

    // Remember dimensions before this client potentially resizes the PTY,
    // so we can restore them when the client disconnects.
    const preConnectCols = session.cols;
    const preConnectRows = session.rows;

    // Send output history as initial burst
    for (const data of session.outputHistory.toArray()) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }

    // Forward live output
    const onOutput = ({ sessionId: sid, data }) => {
      if (sid !== sessionId) return;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    };

    // Forward session close
    const onClosed = (closedSession) => {
      if (closedSession.id !== sessionId) return;
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'session_closed',
          exitCode: closedSession.exitCode,
        }));
        ws.close();
      }
    };

    sessionRegistry.on('session:output', onOutput);
    sessionRegistry.on('session:closed', onClosed);

    // Handle incoming messages
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // ignore malformed JSON
      }

      switch (msg.type) {
        case 'input': {
          // Allow if no one has control or this client has control
          if (!session.controllingClientId || session.controllingClientId === clientId) {
            session.write(msg.data);
          }
          break;
        }
        case 'resize': {
          const cols = Number(msg.cols);
          const rows = Number(msg.rows);
          if (cols > 0 && rows > 0) {
            session.resize(cols, rows);
          }
          break;
        }
        case 'request_control': {
          session.controllingClientId = clientId;
          break;
        }
        case 'release_control': {
          if (session.controllingClientId === clientId) {
            session.controllingClientId = null;
          }
          break;
        }
        default:
          break;
      }
    });

    // Cleanup on disconnect
    ws.on('close', () => {
      if (session.controllingClientId === clientId) {
        session.controllingClientId = null;
      }
      // Restore the PTY to its pre-connection dimensions now that the mobile
      // client has disconnected (avoids leaving the host terminal at phone size).
      if (session.status === 'active') {
        session.resize(preConnectCols, preConnectRows);
      }
      sessionRegistry.off('session:output', onOutput);
      sessionRegistry.off('session:closed', onClosed);
    });
  });

  // -----------------------------------------------------------------------
  // /ws/events  — session lifecycle notifications
  // -----------------------------------------------------------------------

  const eventClients = new Set();

  function broadcastSessionsList() {
    const payload = JSON.stringify({
      type: 'sessions_list',
      sessions: sessionRegistry.list(),
    });
    for (const client of eventClients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  sessionRegistry.on('session:created', broadcastSessionsList);
  sessionRegistry.on('session:closed', broadcastSessionsList);

  eventsWss.on('connection', (ws) => {
    eventClients.add(ws);

    ws.send(JSON.stringify({
      type: 'sessions_list',
      sessions: sessionRegistry.list(),
    }));

    ws.on('close', () => {
      eventClients.delete(ws);
    });
  });

  // -----------------------------------------------------------------------
  // Start listening
  // -----------------------------------------------------------------------

  const configuredPort = options.port ?? getPortSafe();
  const port = await detectPort(configuredPort);

  await new Promise((resolve, reject) => {
    server.listen(port, () => resolve());
    server.once('error', reject);
  });

  const address = getLanIp();
  writeLockFile(process.pid, port, adminToken);

  process.stderr.write(`termserver daemon listening on ${address}:${port}\n`);

  // Clean up lock file on exit
  const cleanup = () => removeLockFile();
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('exit', cleanup);

  return { server, app, sessionRegistry, pairingManager, sessionWss, eventsWss, port, address };
}

export async function stopDaemon(components) {
  const { server, pairingManager, sessionRegistry, sessionWss, eventsWss } = components;

  // Kill all active PTY sessions
  if (sessionRegistry) {
    for (const s of sessionRegistry.sessions.values()) {
      s.kill();
    }
  }

  if (pairingManager) {
    pairingManager.destroy();
  }

  if (server) {
    // Terminate all open WebSocket connections — otherwise server.close() waits
    // for them to finish on their own (keep-alive / open sessions = long hang).
    for (const wss of [sessionWss, eventsWss]) {
      if (wss) {
        for (const ws of wss.clients) {
          ws.terminate();
        }
      }
    }

    // Destroy lingering keep-alive HTTP connections (Node 18.2+).
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    await new Promise((resolve) => server.close(resolve));
  }

  removeLockFile();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPortSafe() {
  try {
    return store.getPort();
  } catch {
    return 8787;
  }
}
