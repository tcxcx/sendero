/**
 * WhatsApp channel renderer snapshot coverage.
 *
 * Snapshots pin the native Cloud API payload shape per ChannelMessage
 * kind. WhatsApp has the strictest channel constraints (1024-char body,
 * 20-char button titles, 3 buttons / 10 list rows), so the inline
 * checks verify each cap before the snapshot freezes the whole shape.
 *
 * Run: bun test apps/app/lib/channel-render/__tests__/whatsapp.test.ts
 */

import { describe, expect, test } from 'bun:test';

import { renderForWhatsApp } from '../channels/whatsapp';
import { fixtures } from './__fixtures__/messages';

describe('renderForWhatsApp', () => {
  test('text uses type:text and rewrites markdown to WhatsApp mrkdwn', async () => {
    const out = await renderForWhatsApp(fixtures.text({ content: 'Booked **AA 100** to LHR' }));
    expect(out?.payload.type).toBe('text');
    // GFM bold collapses to a single asterisk per the simplifier, then
    // the lone-asterisk pass rewrites to underscores so WA renders it
    // as italic instead of leaving a stray bold marker.
    expect(out?.payload.text?.body).not.toContain('**AA 100**');
    expect(out?.payload.text?.body).toMatch(/[_*]AA 100[_*]/);
    expect(out).toMatchSnapshot();
  });

  test('text caps body at 1024 chars with sentence-boundary truncation', async () => {
    const sentence = 'The agent rebooked the traveler on the next available departure. ';
    const huge = sentence.repeat(50);
    const out = await renderForWhatsApp(fixtures.text({ content: huge }));
    const body = out?.payload.text?.body ?? '';
    expect(body.length).toBeLessThanOrEqual(1024);
    expect(body.endsWith('...')).toBe(true);
  });

  test('card with <=3 ctas renders interactive button payload', async () => {
    const out = await renderForWhatsApp(fixtures.card());
    expect(out?.payload.type).toBe('interactive');
    expect(out?.payload.interactive?.type).toBe('button');
    const action = out?.payload.interactive?.action as { buttons: unknown[] };
    expect(action.buttons.length).toBe(2);
    expect(out).toMatchSnapshot();
  });

  test('card with >3 ctas falls back to list payload', async () => {
    const ctas = Array.from({ length: 5 }, (_, i) => ({
      kind: 'select_offer' as const,
      label: `Offer ${i + 1}`,
      value: `off-${i + 1}`,
    }));
    const out = await renderForWhatsApp(fixtures.card({ ctas }));
    expect(out?.payload.interactive?.type).toBe('list');
    const action = out?.payload.interactive?.action as { sections: Array<{ rows: unknown[] }> };
    expect(action.sections[0].rows.length).toBe(5);
    expect(out).toMatchSnapshot();
  });

  test('card with no ctas + no image collapses to plain text', async () => {
    const out = await renderForWhatsApp(fixtures.card({ ctas: undefined, imageUrl: undefined }));
    expect(out?.payload.type).toBe('text');
  });

  test('button titles cap at 20 chars', async () => {
    const longLabel = 'Confirm this very long action title';
    const out = await renderForWhatsApp(
      fixtures.card({
        ctas: [{ kind: 'approve', label: longLabel, value: 'x' }],
      })
    );
    const buttons = (
      out?.payload.interactive?.action as { buttons: Array<{ reply: { title: string } }> }
    ).buttons;
    expect(buttons[0].reply.title.length).toBeLessThanOrEqual(20);
  });

  test('tool_result with share', async () => {
    const out = await renderForWhatsApp(fixtures.toolResult());
    expect(out?.payload.type).toBe('interactive');
    expect(out).toMatchSnapshot();
  });

  test('tool_result without share returns null', async () => {
    const out = await renderForWhatsApp(fixtures.toolResult({ share: undefined }));
    expect(out).toBeNull();
  });

  test('tool_invocation returns null (operator-only)', async () => {
    const out = await renderForWhatsApp(fixtures.toolInvocation());
    expect(out).toBeNull();
  });

  test('approval_request returns null (operator-only)', async () => {
    const out = await renderForWhatsApp(fixtures.approvalRequest());
    expect(out).toBeNull();
  });

  test('reasoning returns null (operator-only)', async () => {
    const out = await renderForWhatsApp(fixtures.reasoning());
    expect(out).toBeNull();
  });

  test('sources renders text with numbered links', async () => {
    const out = await renderForWhatsApp(fixtures.sources());
    expect(out?.payload.type).toBe('text');
    expect(out?.payload.text?.body).toContain('Sources:');
    expect(out?.payload.text?.body).toContain('1. AA flight status');
    expect(out).toMatchSnapshot();
  });

  test('sources with empty items returns null', async () => {
    const out = await renderForWhatsApp(fixtures.sources({ items: [] }));
    expect(out).toBeNull();
  });
});
