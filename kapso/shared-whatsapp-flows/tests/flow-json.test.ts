import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

describe('shared WhatsApp Flow JSON', () => {
  test('uses the Kapso-compatible dynamic Flow contract', async () => {
    const files = (await readdir(resolve(root, 'flows'))).filter(file =>
      file.endsWith('.flow.json')
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const flow = JSON.parse(await readFile(resolve(root, 'flows', file), 'utf8'));
      expect(flow.version).toBe('7.3');
      expect(flow.data_api_version).toBe('3.0');
      expect(flow.routing_model).toBeTruthy();
      expect(flow.screens.length).toBeGreaterThan(0);
    }
  });
});
