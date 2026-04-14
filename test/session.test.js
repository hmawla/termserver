import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CircularBuffer, getDefaultShell } from '../src/session.js';

// ---------------------------------------------------------------------------
// CircularBuffer
// ---------------------------------------------------------------------------

describe('CircularBuffer', () => {
  test('starts empty', () => {
    const buf = new CircularBuffer(5);
    assert.equal(buf.length, 0);
    assert.deepEqual(buf.toArray(), []);
  });

  test('push and retrieve a single item', () => {
    const buf = new CircularBuffer(5);
    buf.push('hello');
    assert.equal(buf.length, 1);
    assert.deepEqual(buf.toArray(), ['hello']);
  });

  test('preserves insertion order for multiple items', () => {
    const buf = new CircularBuffer(5);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    assert.deepEqual(buf.toArray(), ['a', 'b', 'c']);
  });

  test('overwrites oldest item when full', () => {
    const buf = new CircularBuffer(3);
    buf.push('a');
    buf.push('b');
    buf.push('c');
    buf.push('d'); // evicts 'a'
    assert.equal(buf.length, 3);
    assert.deepEqual(buf.toArray(), ['b', 'c', 'd']);
  });

  test('toArray returns correct order after multiple overwrites', () => {
    const buf = new CircularBuffer(3);
    for (let i = 1; i <= 7; i++) buf.push(String(i));
    // Latest 3: '5', '6', '7'
    assert.deepEqual(buf.toArray(), ['5', '6', '7']);
  });

  test('length caps at maxSize', () => {
    const buf = new CircularBuffer(3);
    buf.push(1); buf.push(2); buf.push(3); buf.push(4);
    assert.equal(buf.length, 3);
  });

  test('toArray on exactly-full buffer returns all items in order', () => {
    const buf = new CircularBuffer(4);
    buf.push('w'); buf.push('x'); buf.push('y'); buf.push('z');
    assert.deepEqual(buf.toArray(), ['w', 'x', 'y', 'z']);
  });

  test('clear resets length and array', () => {
    const buf = new CircularBuffer(5);
    buf.push('x');
    buf.push('y');
    buf.clear();
    assert.equal(buf.length, 0);
    assert.deepEqual(buf.toArray(), []);
  });

  test('can push again after clear', () => {
    const buf = new CircularBuffer(3);
    buf.push('old');
    buf.clear();
    buf.push('new');
    assert.deepEqual(buf.toArray(), ['new']);
  });

  test('size-1 buffer always holds only the latest item', () => {
    const buf = new CircularBuffer(1);
    buf.push('first');
    buf.push('second');
    assert.deepEqual(buf.toArray(), ['second']);
    assert.equal(buf.length, 1);
  });
});

// ---------------------------------------------------------------------------
// getDefaultShell
// ---------------------------------------------------------------------------

describe('getDefaultShell', () => {
  test('returns a non-empty string', () => {
    const shell = getDefaultShell();
    assert.ok(typeof shell === 'string' && shell.length > 0);
  });

  test('returns powershell.exe on win32', () => {
    if (process.platform === 'win32') {
      assert.equal(getDefaultShell(), 'powershell.exe');
    }
  });

  test('returns SHELL env var value on non-Windows when SHELL is set', () => {
    if (process.platform !== 'win32' && process.env.SHELL) {
      assert.equal(getDefaultShell(), process.env.SHELL);
    }
  });

  test('falls back to bash on non-Windows when SHELL is unset', () => {
    if (process.platform !== 'win32') {
      const saved = process.env.SHELL;
      delete process.env.SHELL;
      assert.equal(getDefaultShell(), 'bash');
      if (saved !== undefined) process.env.SHELL = saved;
    }
  });
});
