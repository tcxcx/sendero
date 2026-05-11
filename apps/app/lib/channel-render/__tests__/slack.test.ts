// Snapshot pre-conditions — pin the env so test runs are independent
// of which `.env.local` bun resolves at test-discovery time. The
// snapshots were authored against `OG_SHARE_SIGNING_SECRET=unset`
// (image-fallback URL omitted); production deployments override via
// real env at runtime.
process.env.OG_SHARE_SIGNING_SECRET = '';
process.env.NEXT_PUBLIC_APP_URL = '';

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

import { renderForSlack, toSlackMrkdwn } from '../channels/slack';
import { fixtures } from './__fixtures__/messages';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

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
  test('toSlackMrkdwn converts agent markdown for direct Slack replies', () => {
    const out = toSlackMrkdwn(
      'Tienes **$314.87 USDC** en tu wallet.\n- Arc Testnet\n[Recargar](https://pay.example.com)'
    );
    expect(out).toContain('*$314.87 USDC*');
    expect(out).toContain('• Arc Testnet');
    expect(out).toContain('<https://pay.example.com|Recargar>');
    expect(out).not.toContain('**');
  });

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

  test('esim_activation renders header + plan section + QR image + actions', async () => {
    const out = await renderForSlack(fixtures.esimActivation());
    const blocks = (out?.payload.blocks ?? []) as Array<{ type: string }>;
    const types = blocks.map(b => b.type);
    expect(types).toEqual(['header', 'section', 'image', 'actions', 'context']);
    const image = blocks[2] as unknown as { image_url: string };
    expect(image.image_url).toBe('https://app.sendero.travel/api/esim/qr/abc.def.png');
    const actions = blocks[3] as unknown as { elements: Array<{ url?: string; style?: string }> };
    expect(actions.elements[0].url).toBe('https://app.sendero.travel/install/esim/abc.def');
    expect(actions.elements[0].style).toBe('primary');
    expect(actions.elements[1].url).toContain('#instructions');
    expect(out).toMatchSnapshot();
  });

  test('seat_picker renders header + section with overflow accessory routing to sendero_select_seat', async () => {
    const out = await renderForSlack(fixtures.seatPicker());
    const blocks = (out?.payload.blocks ?? []) as Array<{ type: string }>;
    expect(blocks.map(b => b.type)).toEqual(['header', 'section']);
    const section = blocks[1] as unknown as {
      accessory: { type: string; action_id: string; options: Array<{ value: string }> };
    };
    expect(section.accessory.type).toBe('overflow');
    expect(section.accessory.action_id).toBe('sendero_select_seat');
    expect(section.accessory.options).toHaveLength(2);
    expect(section.accessory.options[0].value).toContain('"seatServiceId":"sea_001"');
    expect(out).toMatchSnapshot();
  });

  test('ancillary_picker renders one section per bag + cfar with sendero_add_bag buttons', async () => {
    const out = await renderForSlack(fixtures.ancillaryPicker());
    const blocks = (out?.payload.blocks ?? []) as Array<{ type: string }>;
    expect(blocks[0]?.type).toBe('header');
    // 2 bags + 1 cfar = 3 section blocks after header
    expect(blocks.slice(1).map(b => b.type)).toEqual(['section', 'section', 'section']);
    const firstBag = blocks[1] as unknown as {
      accessory: { action_id: string; value: string };
    };
    expect(firstBag.accessory.action_id).toBe('sendero_add_bag');
    expect(firstBag.accessory.value).toContain('"bagServiceId":"bag_001"');
    expect(out).toMatchSnapshot();
  });

  test('trip_brief renders header + context + per-section blocks + share button', async () => {
    const out = await renderForSlack(fixtures.tripBrief());
    const blocks = (out?.payload.blocks ?? []) as Array<{ type: string }>;
    // header + context + alerts + flights + stays + esims + actions
    const types = blocks.map(b => b.type);
    expect(types[0]).toBe('header');
    expect(types).toContain('context');
    expect(types.filter(t => t === 'section').length).toBeGreaterThanOrEqual(3); // alerts + 3 sections
    expect(types[types.length - 1]).toBe('actions');
    // Share button must be a primary URL button pointing at the
    // signed share URL — not a Sendero internal route.
    const actions = blocks[blocks.length - 1] as unknown as {
      elements: Array<{ url: string; style?: string }>;
    };
    expect(actions.elements[0].url).toBe('https://app.sendero.travel/trip/abc.def');
    expect(actions.elements[0].style).toBe('primary');
    expect(out).toMatchSnapshot();
  });

  test('trip_brief without shareUrl omits the actions block (no broken link)', async () => {
    const out = await renderForSlack(fixtures.tripBrief({ shareUrl: null }));
    const blocks = (out?.payload.blocks ?? []) as Array<{ type: string }>;
    expect(blocks.some(b => b.type === 'actions')).toBe(false);
  });

  test('trip_brief surfaces critical alerts above bookings', async () => {
    const out = await renderForSlack(
      fixtures.tripBrief({
        alerts: [{ kind: 'trip_canceled', severity: 'critical', message: 'Trip canceled.' }],
      })
    );
    const blocks = (out?.payload.blocks ?? []) as Array<{ type: string; text?: { text?: string } }>;
    // First section after header+context contains the alert
    const firstSection = blocks.find(b => b.type === 'section');
    expect(firstSection?.text?.text).toContain('🔴');
    expect(firstSection?.text?.text).toContain('canceled');
  });

  test('stay_search_results emits one section + actions per hotel with select_stay_hotel button', async () => {
    const out = await renderForSlack(fixtures.staySearchResults());
    const blocks = (out?.payload.blocks ?? []) as Array<{
      type: string;
      accessory?: { type?: string };
      elements?: Array<{ action_id?: string; value?: string; style?: string }>;
    }>;
    expect(blocks[0]?.type).toBe('header');
    const hotelButtons = blocks
      .flatMap(b => b.elements ?? [])
      .filter(e => e.action_id === 'select_stay_hotel');
    expect(hotelButtons).toHaveLength(2);
    expect(hotelButtons[0]?.value).toBe('ssr_0000B5zd9zXpgcMvBmwkgG');
    expect(hotelButtons[0]?.style).toBe('primary');
    // First hotel has a photo → image accessory present.
    const firstHotelSection = blocks.find(b => b.accessory?.type === 'image');
    expect(firstHotelSection).toBeDefined();
    expect(out).toMatchSnapshot();
  });

  test('stay_search_results without hotels falls back to a "no results" section', async () => {
    const out = await renderForSlack(fixtures.staySearchResults({ hotels: [] }));
    const blocks = (out?.payload.blocks ?? []) as Array<{ text?: { text?: string } }>;
    const allText = blocks.map(b => b.text?.text ?? '').join('\n');
    expect(allText).toContain('No matching hotels');
  });

  test('stay_rate_picker emits one button per rate with select_stay_rate action_id', async () => {
    const out = await renderForSlack(fixtures.stayRatePicker());
    const blocks = (out?.payload.blocks ?? []) as Array<{
      type: string;
      accessory?: { type?: string; action_id?: string; value?: string };
    }>;
    expect(blocks[0]?.type).toBe('header');
    const ratesWithButtons = blocks.filter(b => b.accessory?.type === 'button');
    expect(ratesWithButtons.length).toBe(1);
    expect(ratesWithButtons[0]?.accessory?.action_id).toBe('select_stay_rate');
    expect(ratesWithButtons[0]?.accessory?.value).toBe('rat_0000B5zdBpSS9xnoU7J48B');
    expect(out).toMatchSnapshot();
  });

  test('stay_quote_review without travelerContact degrades to a single Open in Sendero link', async () => {
    const out = await renderForSlack(
      fixtures.stayQuoteReview({ travelerContact: undefined, tenantId: undefined })
    );
    const blocks = (out?.payload.blocks ?? []) as Array<{
      type: string;
      elements?: Array<{ action_id?: string; value?: string }>;
    }>;
    const actions = blocks.find(b => b.type === 'actions');
    expect(actions?.elements).toHaveLength(1);
    expect(actions?.elements?.[0]?.action_id).toBe('open_link');
    // No confirm/cancel buttons → no risk of forged taps booking blind.
    expect(blocks.some(b => b.elements?.some(e => e.action_id === 'confirm_stay_booking'))).toBe(
      false
    );
  });

  test('stay_quote_review surfaces every Duffel-mandated field + confirm/cancel actions', async () => {
    const out = await renderForSlack(fixtures.stayQuoteReview());
    const blocks = (out?.payload.blocks ?? []) as Array<{
      type: string;
      text?: { text?: string };
      elements?: Array<{ action_id?: string; value?: string }>;
    }>;
    const allText = blocks.map(b => b.text?.text ?? '').join('\n');
    // Billing summary separated rows + due-at-property always rendered.
    expect(allText).toContain('Room');
    expect(allText).toContain('Taxes');
    expect(allText).toContain('Fees');
    expect(allText).toContain('Total');
    expect(allText).toContain('Due at property');
    // Cancellation policy verbatim entries.
    expect(allText).toContain('Full refund');
    // Conditions verbatim — full description text lands in a section.
    expect(allText).toContain('No smoking allowed in any room');
    // Key collection always-visible.
    expect(allText).toContain('Key collection');
    expect(allText).toContain('Collect from reception.');
    // Confirm/cancel actions present, JSON value carries the booking
    // context the interactions handler needs to actually run book_stay.
    const actions = blocks.find(b => b.type === 'actions');
    expect(actions?.elements?.[0]?.action_id).toBe('confirm_stay_booking');
    const confirmValue = JSON.parse(actions?.elements?.[0]?.value ?? '{}');
    expect(confirmValue).toEqual({
      q: 'quo_0000B5zdBvh42oRqcoI4BO',
      t: 'ten_test_123',
      tr: 'trip_abc123',
      e: 'casey@example.com',
      g: 'Casey',
      f: 'Traveler',
    });
    expect(actions?.elements?.[1]?.action_id).toBe('cancel_stay_booking');
    expect(out).toMatchSnapshot();
  });

  test('stay_booking_confirmation surfaces reference + confirmedAt + key collection always-visible', async () => {
    const out = await renderForSlack(fixtures.stayBookingConfirmation());
    const blocks = (out?.payload.blocks ?? []) as Array<{
      type: string;
      text?: { text?: string };
      fields?: Array<{ text?: string }>;
    }>;
    const allText = blocks
      .map(b => (b.text?.text ?? '') + (b.fields?.map(f => f.text).join(' ') ?? ''))
      .join('\n');
    expect(allText).toContain('Booking reference');
    expect(allText).toContain('AFE33SE2');
    expect(allText).toContain('Confirmed at');
    expect(allText).toContain('Collect from reception.');
    expect(out).toMatchSnapshot();
  });

  test('stay_booking_confirmation falls back to a generic key-collection note when null', async () => {
    const out = await renderForSlack(
      fixtures.stayBookingConfirmation({
        accommodation: {
          ...fixtures.stayBookingConfirmation().accommodation,
          keyCollection: null,
        },
      })
    );
    const blocks = (out?.payload.blocks ?? []) as Array<{ text?: { text?: string } }>;
    const allText = blocks.map(b => b.text?.text ?? '').join('\n');
    expect(allText).toContain('Ask at the property on arrival');
  });
});
