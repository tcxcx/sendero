/**
 * End-to-end test of the generated OpenAPI 3.1 spec as an external
 * API consumer would validate it.
 *
 * What this proves:
 *   - Every PUBLIC tool in toolList appears in the generated doc.
 *     `internal: true` tools are stripped — they're operator-only and
 *     never part of the public contract for external integrators.
 *   - No hand-maintained spec drift: if a tool is added without a
 *     scope / tag / jsonSchema, this test fails.
 *   - OpenAPI 3.1 required top-level fields are present.
 *   - Security schemes, server URLs, component schemas are wired.
 *   - Tags are sensible (no orphans, no "misc" bucket).
 *
 * Run: `bun test packages/tools/src/openapi.test.ts`
 */

import { describe, expect, test } from 'bun:test';

import { buildOpenApiDoc } from './openapi';
import { toolList } from './index';
import { filterPublicTools, toolToScope } from './scopes';

const DOC = buildOpenApiDoc({
  title: 'Sendero Agent Tools',
  version: '1.0.0',
  serverUrl: 'https://www.sendero.travel',
  tools: toolList,
}) as Record<string, any>;

/** The tools the spec is expected to advertise — internal stripped. */
const PUBLIC = filterPublicTools(toolList);

describe('OpenAPI 3.1 envelope', () => {
  test('declares openapi 3.1.0', () => {
    expect(DOC.openapi).toBe('3.1.0');
  });

  test('info.title + version + description present', () => {
    expect(DOC.info.title).toBe('Sendero Agent Tools');
    expect(DOC.info.version).toBe('1.0.0');
    expect(typeof DOC.info.description).toBe('string');
    expect(DOC.info.description.length).toBeGreaterThan(100);
  });

  test('info.contact points to our docs', () => {
    expect(DOC.info.contact?.url).toBe('https://docs.sendero.travel');
  });

  test('has production + preview servers', () => {
    expect(DOC.servers.length).toBe(2);
    expect(DOC.servers[0].url).toBe('https://www.sendero.travel');
  });

  test('ClerkApiKey security scheme present', () => {
    const scheme = DOC.components?.securitySchemes?.ClerkApiKey;
    expect(scheme).toBeDefined();
    expect(scheme.type).toBe('http');
    expect(scheme.scheme).toBe('bearer');
  });
});

describe('OpenAPI tool coverage', () => {
  test('every tool in toolList has a path entry', () => {
    const pathKeys = Object.keys(DOC.paths ?? {});
    const missing: string[] = [];
    for (const tool of PUBLIC) {
      const expectedPath = `/api/agent/dispatch#${tool.name}`;
      if (!pathKeys.includes(expectedPath)) missing.push(tool.name);
    }
    expect(missing).toEqual([]);
  });

  test('every path carries a POST with correct operationId + tags + security', () => {
    for (const tool of PUBLIC) {
      const path = DOC.paths[`/api/agent/dispatch#${tool.name}`];
      expect(path).toBeDefined();
      expect(path.post).toBeDefined();
      expect(path.post.operationId).toBe(tool.name);
      expect(Array.isArray(path.post.tags)).toBe(true);
      expect(path.post.tags.length).toBe(1);
      expect(path.post.security).toEqual([{ ClerkApiKey: [] }]);
    }
  });

  test('every tool has its Zod-derived jsonSchema registered under components.schemas', () => {
    const schemas = DOC.components?.schemas ?? {};
    for (const tool of PUBLIC) {
      const schemaName =
        tool.name
          .split('_')
          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
          .join('') + 'Input';
      expect(schemas[schemaName]).toBeDefined();
      // The schema IS the tool's jsonSchema by reference — not a clone
      expect(schemas[schemaName]).toBe(tool.jsonSchema);
    }
  });

  test('request body references the correct schema ref', () => {
    for (const tool of PUBLIC) {
      const path = DOC.paths[`/api/agent/dispatch#${tool.name}`];
      const argsProp = path.post.requestBody.content['application/json'].schema.properties.args;
      const schemaName =
        tool.name
          .split('_')
          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
          .join('') + 'Input';
      expect(argsProp.$ref).toBe(`#/components/schemas/${schemaName}`);
    }
  });

  test('every path has 200/401/402/404/500 response entries', () => {
    for (const tool of PUBLIC) {
      const responses = DOC.paths[`/api/agent/dispatch#${tool.name}`].post.responses;
      expect(responses['200']).toBeDefined();
      expect(responses['401']).toBeDefined();
      expect(responses['402']).toBeDefined();
      expect(responses['404']).toBeDefined();
      expect(responses['500']).toBeDefined();
    }
  });
});

describe('audience filter — internal tools are stripped from the spec', () => {
  test('every internal tool is missing from the public OpenAPI doc', () => {
    const internalTools = toolList.filter(t => t.internal === true);
    expect(internalTools.length).toBeGreaterThan(0); // sanity — some exist
    for (const tool of internalTools) {
      expect(DOC.paths[`/api/agent/dispatch#${tool.name}`]).toBeUndefined();
    }
  });

  test('every internal tool is missing from components.schemas', () => {
    const schemas = DOC.components?.schemas ?? {};
    for (const tool of toolList.filter(t => t.internal === true)) {
      const schemaName =
        tool.name
          .split('_')
          .map(s => s.charAt(0).toUpperCase() + s.slice(1))
          .join('') + 'Input';
      expect(schemas[schemaName]).toBeUndefined();
    }
  });
});

describe('OpenAPI ↔ scope consistency', () => {
  test('every tool tag matches the scope family its tool belongs to', () => {
    // Maps the openapi.ts categorizer output to scope names.
    const TAG_TO_SCOPE: Record<string, string> = {
      Search: 'search',
      Bookings: 'bookings',
      Settlement: 'settlement',
      Treasury: 'treasury',
      Documents: 'documents',
      Compliance: 'compliance',
      'Trip assistance': 'trip_assistance',
      Utilities: 'utilities',
    };

    const mismatches: Array<{ tool: string; tag: string; scope: string }> = [];
    for (const tool of PUBLIC) {
      const path = DOC.paths[`/api/agent/dispatch#${tool.name}`];
      const tag = path.post.tags[0];
      const expectedScope = TAG_TO_SCOPE[tag];
      const actualScope = toolToScope(tool.name);
      if (expectedScope !== actualScope) {
        mismatches.push({ tool: tool.name, tag, scope: actualScope });
      }
    }
    // Log for triage if this trips.
    if (mismatches.length > 0) {
      console.warn('tag ↔ scope mismatches', mismatches);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('OpenAPI consumer smoke tests', () => {
  test('doc is JSON-serializable (no circular refs, no BigInt, no functions)', () => {
    expect(() => JSON.stringify(DOC)).not.toThrow();
    const serialized = JSON.stringify(DOC);
    expect(serialized.length).toBeGreaterThan(1000);
  });

  test('at least one tool in each expected scope family', () => {
    const tags = new Set<string>();
    for (const tool of PUBLIC) {
      const path = DOC.paths[`/api/agent/dispatch#${tool.name}`];
      tags.add(path.post.tags[0]);
    }
    // Sanity: we expect at least these families populated.
    for (const required of ['Search', 'Settlement', 'Treasury', 'Documents', 'Compliance']) {
      expect(tags.has(required)).toBe(true);
    }
  });

  test('description of each operation is non-empty', () => {
    for (const tool of PUBLIC) {
      const path = DOC.paths[`/api/agent/dispatch#${tool.name}`];
      expect(path.post.description).toBeDefined();
      expect(path.post.description.length).toBeGreaterThan(10);
    }
  });

  test('summary is truncated to ≤ 140 chars', () => {
    for (const tool of PUBLIC) {
      const path = DOC.paths[`/api/agent/dispatch#${tool.name}`];
      if (path.post.summary) {
        expect(path.post.summary.length).toBeLessThanOrEqual(140);
      }
    }
  });
});
