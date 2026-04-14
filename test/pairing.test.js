import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PairingManager, extractTokenFromRequest, authMiddleware } from '../src/pairing.js';

function createMockStore(initialDevices = []) {
  const devices = [...initialDevices];
  return {
    addDevice: (d) => devices.push(d),
    getDevices: () => [...devices],
  };
}

// ---------------------------------------------------------------------------
// extractTokenFromRequest
// ---------------------------------------------------------------------------

describe('extractTokenFromRequest', () => {
  test('extracts token from Authorization header', () => {
    const req = { headers: { authorization: 'Bearer mytoken123' }, url: '/' };
    assert.equal(extractTokenFromRequest(req), 'mytoken123');
  });

  test('extracts token from Authorization header via .get() (Headers API)', () => {
    const req = {
      headers: { get: (k) => (k === 'authorization' ? 'Bearer viaGetToken' : null) },
      url: '/',
    };
    assert.equal(extractTokenFromRequest(req), 'viaGetToken');
  });

  test('extracts token from query param when no header present', () => {
    const req = { headers: {}, url: '/ws/sessions/abc?token=querytok' };
    assert.equal(extractTokenFromRequest(req), 'querytok');
  });

  test('prefers Authorization header over query param', () => {
    const req = {
      headers: { authorization: 'Bearer headertoken' },
      url: '/ws/sessions/abc?token=querytok',
    };
    assert.equal(extractTokenFromRequest(req), 'headertoken');
  });

  test('returns null when no token present anywhere', () => {
    const req = { headers: {}, url: '/path?foo=bar' };
    assert.equal(extractTokenFromRequest(req), null);
  });

  test('returns null when headers is undefined', () => {
    const req = { url: '/' };
    assert.equal(extractTokenFromRequest(req), null);
  });
});

// ---------------------------------------------------------------------------
// PairingManager — createPairing
// ---------------------------------------------------------------------------

describe('PairingManager.createPairing', () => {
  test('returns a zero-padded 4-digit code and a non-empty sessionToken', () => {
    const pm = new PairingManager(createMockStore());
    const { code, sessionToken } = pm.createPairing('TestDevice');
    assert.match(code, /^\d{4}$/);
    assert.ok(typeof sessionToken === 'string' && sessionToken.length > 0);
    pm.destroy();
  });

  test('successive calls return different sessionTokens', () => {
    const pm = new PairingManager(createMockStore());
    const a = pm.createPairing('A');
    const b = pm.createPairing('B');
    assert.notEqual(a.sessionToken, b.sessionToken);
    pm.destroy();
  });

  test('fires onPairingInitiated callbacks with deviceName', () => {
    const pm = new PairingManager(createMockStore());
    const calls = [];
    pm.onPairingInitiated((info) => calls.push(info));
    pm.createPairing('MyPhone');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].deviceName, 'MyPhone');
    pm.destroy();
  });
});

// ---------------------------------------------------------------------------
// PairingManager — completePairing
// ---------------------------------------------------------------------------

describe('PairingManager.completePairing', () => {
  test('happy path: returns deviceToken and deviceId, persists device', () => {
    const store = createMockStore();
    const pm = new PairingManager(store);
    const { code, sessionToken } = pm.createPairing('MyPhone');
    const result = pm.completePairing(code, sessionToken);

    assert.ok(typeof result.deviceToken === 'string' && result.deviceToken.length > 0);
    assert.ok(typeof result.deviceId === 'string' && result.deviceId.length > 0);
    assert.equal(store.getDevices().length, 1);
    assert.equal(store.getDevices()[0].name, 'MyPhone');
    pm.destroy();
  });

  test('throws on unknown code', () => {
    const pm = new PairingManager(createMockStore());
    assert.throws(() => pm.completePairing('0000', 'faketoken'), /Invalid or expired/);
    pm.destroy();
  });

  test('throws on sessionToken mismatch', () => {
    const pm = new PairingManager(createMockStore());
    const { code } = pm.createPairing('Phone');
    assert.throws(() => pm.completePairing(code, 'wrong-session-token'), /Session token mismatch/);
    pm.destroy();
  });

  test('throws when pairing code has expired (short ttlMs)', async () => {
    const pm = new PairingManager(createMockStore(), { ttlMs: 1 });
    const { code, sessionToken } = pm.createPairing('Phone');
    await new Promise((r) => setTimeout(r, 10));
    assert.throws(() => pm.completePairing(code, sessionToken), /expired/);
    pm.destroy();
  });

  test('fires onPairingComplete callbacks with deviceId and deviceName', () => {
    const pm = new PairingManager(createMockStore());
    const calls = [];
    pm.onPairingComplete((info) => calls.push(info));
    const { code, sessionToken } = pm.createPairing('Phone');
    pm.completePairing(code, sessionToken);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].deviceName, 'Phone');
    assert.ok(typeof calls[0].deviceId === 'string');
    pm.destroy();
  });

  test('code cannot be reused after a successful pairing', () => {
    const pm = new PairingManager(createMockStore());
    const { code, sessionToken } = pm.createPairing('Phone');
    pm.completePairing(code, sessionToken);
    assert.throws(() => pm.completePairing(code, sessionToken), /Invalid or expired/);
    pm.destroy();
  });
});

// ---------------------------------------------------------------------------
// PairingManager — validateToken
// ---------------------------------------------------------------------------

describe('PairingManager.validateToken', () => {
  test('returns null for null', () => {
    const pm = new PairingManager(createMockStore());
    assert.equal(pm.validateToken(null), null);
    pm.destroy();
  });

  test('returns null for an unknown token', () => {
    const pm = new PairingManager(createMockStore());
    assert.equal(pm.validateToken('notadevicetoken'), null);
    pm.destroy();
  });

  test('validates a device token issued during pairing', () => {
    const store = createMockStore();
    const pm = new PairingManager(store);
    const { code, sessionToken } = pm.createPairing('MyPhone');
    const { deviceToken } = pm.completePairing(code, sessionToken);
    const device = pm.validateToken(deviceToken);
    assert.ok(device !== null);
    assert.equal(device.name, 'MyPhone');
    pm.destroy();
  });

  test('validates the admin token with isAdmin flag', () => {
    const pm = new PairingManager(createMockStore());
    pm.setAdminToken('supersecretadmintoken');
    const result = pm.validateToken('supersecretadmintoken');
    assert.ok(result !== null);
    assert.equal(result.isAdmin, true);
    pm.destroy();
  });

  test('admin token takes priority over device token with same value', () => {
    const store = createMockStore([{ id: 'dev1', name: 'Phone', token: 'shared', pairedAt: '' }]);
    const pm = new PairingManager(store);
    pm.setAdminToken('shared');
    const result = pm.validateToken('shared');
    assert.equal(result.isAdmin, true);
    pm.destroy();
  });
});

// ---------------------------------------------------------------------------
// authMiddleware
// ---------------------------------------------------------------------------

describe('authMiddleware', () => {
  test('calls next() and sets req.device for a valid token', () => {
    const store = createMockStore();
    const pm = new PairingManager(store);
    const { code, sessionToken } = pm.createPairing('Phone');
    const { deviceToken } = pm.completePairing(code, sessionToken);

    const middleware = authMiddleware(pm);
    const req = { headers: { authorization: `Bearer ${deviceToken}` }, url: '/' };
    const res = { status: () => ({ json: () => {} }) };
    let called = false;
    middleware(req, res, () => { called = true; });

    assert.ok(called, 'next() should be called');
    assert.ok(req.device !== undefined, 'req.device should be set');
    assert.equal(req.device.name, 'Phone');
    pm.destroy();
  });

  test('returns 401 JSON for an invalid token', () => {
    const pm = new PairingManager(createMockStore());
    const middleware = authMiddleware(pm);
    const req = { headers: { authorization: 'Bearer badtoken' }, url: '/' };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status: (code) => {
        statusCode = code;
        return { json: (body) => { jsonBody = body; } };
      },
    };
    let called = false;
    middleware(req, res, () => { called = true; });

    assert.equal(called, false, 'next() should NOT be called');
    assert.equal(statusCode, 401);
    assert.ok(jsonBody?.error, 'response should have an error field');
    pm.destroy();
  });

  test('returns 401 when no token is provided', () => {
    const pm = new PairingManager(createMockStore());
    const middleware = authMiddleware(pm);
    const req = { headers: {}, url: '/' };
    let statusCode = null;
    const res = { status: (code) => { statusCode = code; return { json: () => {} }; } };
    let called = false;
    middleware(req, res, () => { called = true; });

    assert.equal(called, false);
    assert.equal(statusCode, 401);
    pm.destroy();
  });
});
