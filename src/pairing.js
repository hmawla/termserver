import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const PAIRING_TTL_MS = 2 * 60 * 1000; // 2 minutes
const CLEANUP_INTERVAL_MS = 30 * 1000; // 30 seconds

function generatePairingCode() {
  return crypto.randomInt(0, 10000).toString().padStart(4, '0');
}

export class PairingManager {
  #store;
  #pending = new Map();
  #cleanupInterval;
  #onPairingCallbacks = [];
  #onInitiatedCallbacks = [];
  #adminToken = null;
  #ttlMs;

  constructor(store, { ttlMs = PAIRING_TTL_MS } = {}) {
    this.#store = store;
    this.#ttlMs = ttlMs;

    this.#cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [code, entry] of this.#pending) {
        if (now - entry.createdAt > this.#ttlMs) {
          this.#pending.delete(code);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  createPairing(deviceName) {
    let code = generatePairingCode();

    // Regenerate on collision
    while (this.#pending.has(code)) {
      code = generatePairingCode();
    }

    const sessionToken = nanoid(32);
    this.#pending.set(code, {
      deviceName,
      sessionToken,
      code,
      createdAt: Date.now(),
    });

    // Notify any listeners (e.g. the CLI `pair` command) that a new pairing
    // has been initiated so they can display the code to the user.
    for (const cb of this.#onInitiatedCallbacks) {
      try {
        cb({ code, deviceName });
      } catch {
        // Don't let callback errors break the pairing flow
      }
    }

    return { code, sessionToken };
  }

  /** Register a callback invoked whenever a new pairing is initiated. */
  onPairingInitiated(callback) {
    this.#onInitiatedCallbacks.push(callback);
  }

  /**
   * Set a privileged admin token for local CLI access.
   * This token bypasses the paired-devices list and grants full access.
   */
  setAdminToken(token) {
    this.#adminToken = token;
  }

  completePairing(code, sessionToken) {
    const entry = this.#pending.get(code);

    if (!entry) {
      throw new Error('Invalid or expired pairing code');
    }

    if (entry.sessionToken !== sessionToken) {
      throw new Error('Session token mismatch');
    }

    if (Date.now() - entry.createdAt > this.#ttlMs) {
      this.#pending.delete(code);
      throw new Error('Pairing code has expired');
    }

    const deviceId = nanoid(16);
    const deviceToken = nanoid(64);

    this.#store.addDevice({
      id: deviceId,
      name: entry.deviceName,
      token: deviceToken,
      pairedAt: new Date().toISOString(),
    });

    this.#pending.delete(code);

    for (const cb of this.#onPairingCallbacks) {
      try {
        cb({ deviceId, deviceName: entry.deviceName });
      } catch {
        // Don't let callback errors break the pairing flow
      }
    }

    return { deviceToken, deviceId };
  }

  validateToken(bearerToken) {
    if (!bearerToken) return null;
    // Admin token (local CLI) takes priority
    if (this.#adminToken && bearerToken === this.#adminToken) {
      return { id: '__admin__', name: 'local-cli', isAdmin: true };
    }
    const devices = this.#store.getDevices();
    return devices.find((d) => d.token === bearerToken) || null;
  }

  onPairingComplete(callback) {
    this.#onPairingCallbacks.push(callback);
  }

  destroy() {
    clearInterval(this.#cleanupInterval);
  }
}

export function extractTokenFromRequest(request) {
  // Check Authorization header first
  const authHeader =
    request.headers?.authorization ||
    request.headers?.get?.('authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Fallback: URL query parameter
  try {
    const url = request.url || '';
    // Handle both full URLs and path-only URLs
    const parsed = new URL(url, 'http://localhost');
    const token = parsed.searchParams.get('token');
    if (token) return token;
  } catch {
    // URL parsing failed
  }

  return null;
}

export function authMiddleware(pairingManager) {
  return (req, res, next) => {
    const token = extractTokenFromRequest(req);
    const device = pairingManager.validateToken(token);

    if (!device) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.device = device;
    next();
  };
}
