/**
 * Format resolution tests. The TTY-aware default is the user-facing
 * contract: a piped/CI invocation should always get JSON, an interactive
 * shell should get tables.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { isAgentMode, resolveFormat } from './formatter';

const originalIsTTY = process.stdout.isTTY;

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', {
    value: originalIsTTY,
    configurable: true,
    writable: true,
  });
});

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('resolveFormat', () => {
  test('--agent forces json', () => {
    setTTY(true);
    expect(resolveFormat({ agent: true })).toBe('json');
  });

  test('--json forces json', () => {
    setTTY(true);
    expect(resolveFormat({ json: true })).toBe('json');
  });

  test('--table forces table', () => {
    setTTY(false); // even when piped
    expect(resolveFormat({ table: true })).toBe('table');
  });

  test('TTY default is table', () => {
    setTTY(true);
    expect(resolveFormat({})).toBe('table');
  });

  test('non-TTY default is json (CI / piped)', () => {
    setTTY(false);
    expect(resolveFormat({})).toBe('json');
  });
});

describe('isAgentMode', () => {
  test('returns true only with --agent', () => {
    expect(isAgentMode({ agent: true })).toBe(true);
    expect(isAgentMode({ json: true })).toBe(false);
    expect(isAgentMode({})).toBe(false);
  });
});
