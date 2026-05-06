/**
 * Unit test: AI SDK adapter stamps `sendero.experimental_tool: true`
 * on the active OTel span when `def.experimental === true`, and
 * leaves stable tools alone.
 *
 * Spec: docs/specs/anticipatory-concierge.md §5 — "Span attribute.
 * Every invocation stamps `sendero.experimental_tool: true` on the
 * active OTel span via the same `traceAgent` mechanism that already
 * stamps `sendero.tenant_id`."
 */

import { afterEach, describe, expect, mock, test } from 'bun:test';

import { toAiSdkTool } from './ai-sdk';
import type { ToolDef } from '../types';

const setAttribute = mock();
const fakeSpan = { setAttribute };
const getActiveSpan = mock(() => fakeSpan);

mock.module('@opentelemetry/api', () => ({
  trace: { getActiveSpan },
}));

afterEach(() => {
  setAttribute.mockClear();
  getActiveSpan.mockClear();
});

const stableDef: ToolDef = {
  name: 'stable_tool',
  description: 'a stable tool',
  inputSchema: { parse: (x: unknown) => x } as never,
  jsonSchema: { type: 'object' },
  handler: async () => ({ ok: true }),
};

const experimentalDef: ToolDef = {
  name: 'experimental_tool',
  description: 'an experimental tool',
  inputSchema: { parse: (x: unknown) => x } as never,
  jsonSchema: { type: 'object' },
  experimental: true,
  handler: async () => ({ ok: true }),
};

describe('toAiSdkTool — experimental span stamping', () => {
  test('stamps sendero.experimental_tool on active span when def.experimental=true', async () => {
    const t = toAiSdkTool(experimentalDef);
    await (t as { execute: (input: unknown) => Promise<unknown> }).execute({});

    const calls = setAttribute.mock.calls;
    const keys = calls.map(c => c[0]);
    expect(keys).toContain('sendero.experimental_tool');
    expect(keys).toContain('sendero.tool_name');
    expect(keys).toContain('sendero.tool.lifecycle');

    const exp = calls.find(c => c[0] === 'sendero.experimental_tool');
    expect(exp?.[1]).toBe(true);

    const name = calls.find(c => c[0] === 'sendero.tool_name');
    expect(name?.[1]).toBe('experimental_tool');

    const lifecycle = calls.find(c => c[0] === 'sendero.tool.lifecycle');
    expect(lifecycle?.[1]).toBe('experimental');
  });

  test('does NOT stamp when def.experimental is absent or false', async () => {
    const t = toAiSdkTool(stableDef);
    await (t as { execute: (input: unknown) => Promise<unknown> }).execute({});
    expect(setAttribute).not.toHaveBeenCalled();
  });

  test('still calls the handler even when stamping throws', async () => {
    getActiveSpan.mockImplementationOnce(() => {
      throw new Error('OTel internal error');
    });
    const t = toAiSdkTool(experimentalDef);
    const result = (await (t as { execute: (input: unknown) => Promise<unknown> }).execute(
      {}
    )) as { ok: boolean };
    expect(result.ok).toBe(true);
  });
});
