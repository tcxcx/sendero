/**
 * Drift guard — fires if `TOOL_PRICING` (here) and `WORKFLOW_TOOL_PRICING`
 * (in @sendero/workflows/external-tools) get out of sync.
 *
 * Workflow pricing is duplicated by design: tools is below workflows in
 * the dep graph (workflows peer-deps tools/types), so we inline the
 * sendero_* entries in TOOL_PRICING rather than importing them. This
 * test catches the drift if anyone updates one side without the other.
 */

import { describe, expect, it } from 'bun:test';

import { WORKFLOW_TOOL_PRICING } from '@sendero/workflows/external-tools';

import { TOOL_PRICING } from '../pricing';

describe('workflow tool pricing sync', () => {
  it('every WORKFLOW_TOOL_PRICING entry exists in TOOL_PRICING with the same price', () => {
    for (const [toolName, expectedPrice] of Object.entries(WORKFLOW_TOOL_PRICING)) {
      const got = TOOL_PRICING[toolName];
      expect(got).toBe(expectedPrice);
    }
  });

  it('TOOL_PRICING has no orphan sendero_* entries missing from WORKFLOW_TOOL_PRICING', () => {
    const orphans = Object.keys(TOOL_PRICING)
      .filter(name => name.startsWith('sendero_'))
      .filter(name => !(name in WORKFLOW_TOOL_PRICING));
    expect(orphans).toEqual([]);
  });
});
