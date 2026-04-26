/**
 * Slack channel renderer snapshot coverage.
 *
 * One golden snapshot per ChannelMessage kind plus the special-case
 * branches (no-share tool result, empty sources, reasoning). Drift
 * between operator preview and traveler-facing Slack output surfaces
 * as a snapshot diff.
 *
 * Time is frozen because buildApprovalBlocks stamps `new Date().toISOString()`
 * into the context line; without freezing, the approval snapshot would
 * change every run.
 *
 * Run: bun test apps/app/lib/channel-render/__tests__/slack.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { renderForSlack } from '../channels/slack';
import { fixtures } from './__fixtures__/messages';

const FROZEN = new Date('2026-04-25T10:00:00.000Z');
let originalNow: typeof Date.now;
let originalDate: typeof Date;

beforeAll(() => {
  originalNow = Date.now;
  originalDate = global.Date;
  // Freeze Date so buildApprovalBlocks' new Date().toISOString() stays
  // deterministic across runs.
  Date.now = () => FROZEN.getTime();
  class FrozenDate extends originalDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length === 0) super(FROZEN.getTime());
      else super(...args);
    }
    static now() {
      return FROZEN.getTime();
    }
  }
  global.Date = FrozenDate as unknown as typeof Date;
});

afterAll(() => {
  Date.now = originalNow;
  global.Date = originalDate;
});

describe('renderForSlack', () => {
  test('text', async () => {
    const out = await renderForSlack(fixtures.text());
    expect(out).toMatchSnapshot();
  });

  test('text rewrites markdown bold + links to Slack mrkdwn', async () => {
    const out = await renderForSlack(
      fixtures.text({ content: 'Booked **AA 100** see [details](https://x.com)' })
    );
    const sectionText = (out?.payload.blocks?.[0] as { text: { text: string } }).text.text;
    expect(sectionText).toContain('*AA 100*');
    expect(sectionText).toContain('<https://x.com|details>');
    expect(out?.payload.text).not.toContain('*');
  });

  test('text caps section at 2900 chars', async () => {
    const huge = 'x'.repeat(5000);
    const out = await renderForSlack(fixtures.text({ content: huge }));
    const sectionText = (out?.payload.blocks?.[0] as { text: { text: string } }).text.text;
    expect(sectionText.length).toBeLessThanOrEqual(2900);
    expect(sectionText.endsWith('...')).toBe(true);
  });

  test('card', async () => {
    const out = await renderForSlack(fixtures.card());
    expect(out).toMatchSnapshot();
  });

  test('tool_invocation marks degraded:true with a fallback line', async () => {
    const out = await renderForSlack(fixtures.toolInvocation());
    expect(out?.degraded).toBe(true);
    expect(out).toMatchSnapshot();
  });

  test('tool_result with share', async () => {
    const out = await renderForSlack(fixtures.toolResult());
    expect(out).toMatchSnapshot();
  });

  test('tool_result without share returns null', async () => {
    const out = await renderForSlack(fixtures.toolResult({ share: undefined }));
    expect(out).toBeNull();
  });

  test('approval_request reuses buildApprovalBlocks (sendero_approval action_ids)', async () => {
    const out = await renderForSlack(fixtures.approvalRequest());
    // buildApprovalBlocks emits the @slack/web-api SDK shape which uses
    // camelCase `actionId`. The Block Kit wire form is `action_id`; the
    // SDK serializes one to the other on send. Accept either field name
    // so the test stays green if upstream Slack types switch.
    const blocks = out?.payload.blocks as Array<{
      type: string;
      elements?: Array<{ action_id?: string; actionId?: string }>;
    }>;
    const actions = blocks.find(b => b.type === 'actions');
    const actionIds = actions?.elements?.map(e => e.action_id ?? e.actionId) ?? [];
    expect(actionIds.some(id => id?.startsWith('sendero_approval.'))).toBe(true);
    expect(out).toMatchSnapshot();
  });

  test('reasoning returns null (operator-only)', async () => {
    const out = await renderForSlack(fixtures.reasoning());
    expect(out).toBeNull();
  });

  test('sources', async () => {
    const out = await renderForSlack(fixtures.sources());
    expect(out).toMatchSnapshot();
  });

  test('sources with empty items returns null', async () => {
    const out = await renderForSlack(fixtures.sources({ items: [] }));
    expect(out).toBeNull();
  });
});
