/**
 * Store tests.
 *
 * TERMSERVER_CONFIG_DIR is set before the dynamic import of store.js so that
 * Conf uses a throw-away temp directory instead of the user's real config.
 * This works because node --test runs each test file in its own subprocess,
 * giving it a fresh module registry.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termserver-store-test-'));
process.env.TERMSERVER_CONFIG_DIR = tmpDir;

// Dynamic import so the env var is set before Conf initialises.
const { addDevice, removeDevice, getDevices, getPort, setPort } =
  await import('../src/store.js');

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('store', () => {
  test('getDevices returns an empty array on a fresh config', () => {
    assert.deepEqual(getDevices(), []);
  });

  test('addDevice persists a device', () => {
    addDevice({ id: 'dev1', name: 'Test Phone', token: 'tok1', pairedAt: new Date().toISOString() });
    const devices = getDevices();
    assert.equal(devices.length, 1);
    assert.equal(devices[0].id, 'dev1');
    assert.equal(devices[0].name, 'Test Phone');
  });

  test('addDevice can store multiple devices', () => {
    addDevice({ id: 'dev2', name: 'Tablet', token: 'tok2', pairedAt: new Date().toISOString() });
    assert.equal(getDevices().length, 2);
  });

  test('removeDevice deletes by id, leaves others intact', () => {
    removeDevice('dev1');
    const devices = getDevices();
    assert.equal(devices.length, 1);
    assert.equal(devices[0].id, 'dev2');
  });

  test('removeDevice on unknown id is a no-op', () => {
    const before = getDevices().length;
    removeDevice('nonexistent');
    assert.equal(getDevices().length, before);
  });

  test('getPort returns the default port 8787', () => {
    assert.equal(getPort(), 8787);
  });

  test('setPort persists a new port value', () => {
    setPort(9000);
    assert.equal(getPort(), 9000);
  });
});
