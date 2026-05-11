import { FUNCTION_SLUGS } from '../src/lib/constants.js';
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('sendero tenant travel workflow', () => {
  test('validates without a static phone trigger', async () => {
    const url = pathToFileURL(
      resolve(rootDir, 'workflows/sendero-tenant-travel-agent/workflow.js')
    );
    url.searchParams.set('test', `${Date.now()}-${Math.random()}`);
    const { default: workflow } = await import(url.href);
    const validation = workflow.validate();
    expect(validation.errors ?? []).toEqual([]);
    expect(workflow.toSourceFiles().metadata.triggers ?? []).toHaveLength(1);
  });

  test('uses plain uploaded Worker function slugs', () => {
    expect(Object.values(FUNCTION_SLUGS)).toContain('sendero-tenant-travel-create-handoff');
    expect(Object.values(FUNCTION_SLUGS)).toContain('sendero-tenant-travel-get-context');
  });
});
