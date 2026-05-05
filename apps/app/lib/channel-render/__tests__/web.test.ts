// Snapshot pre-conditions — pin the env so test runs are independent
// of which `.env.local` bun resolves at test-discovery time.
process.env.OG_SHARE_SIGNING_SECRET = '';
process.env.NEXT_PUBLIC_APP_URL = '';

/**
 * Web traveler channel renderer snapshot coverage.
 *
 * Snapshots pin the JSON envelope the traveler-side bubble layer
 * consumes. Web is the second-cleanest channel (after operator) but
 * still drops operator-only kinds (reasoning, tool_invocation,
 * approval_request) and silently ignores traveler-authored echoes.
 *
 * Run: bun test apps/app/lib/channel-render/__tests__/web.test.ts
 */

import { describe, expect, test } from 'bun:test';

import { renderForWeb } from '../channels/web';
import { fixtures, travelerAuthor } from './__fixtures__/messages';

describe('renderForWeb', () => {
  test('text bubble keeps markdown intact for client-side rendering', async () => {
    const out = await renderForWeb(fixtures.text());
    expect(out?.payload.bubble).toBe('text');
    const content = out?.payload.content as { markdown: string };
    expect(content.markdown).toContain('**AA 100**');
    expect(out).toMatchSnapshot();
  });

  test('card bubble passes ctas straight through', async () => {
    const out = await renderForWeb(fixtures.card());
    expect(out?.payload.bubble).toBe('card');
    const content = out?.payload.content as { ctas: unknown[] };
    expect(content.ctas).toHaveLength(2);
    expect(out).toMatchSnapshot();
  });

  test('tool_result with share renders a card bubble', async () => {
    const out = await renderForWeb(fixtures.toolResult());
    expect(out?.payload.bubble).toBe('card');
    expect(out).toMatchSnapshot();
  });

  test('tool_result without share returns null', async () => {
    const out = await renderForWeb(fixtures.toolResult({ share: undefined }));
    expect(out).toBeNull();
  });

  test('tool_invocation returns null (operator-only)', async () => {
    const out = await renderForWeb(fixtures.toolInvocation());
    expect(out).toBeNull();
  });

  test('approval_request returns null (operator-only)', async () => {
    const out = await renderForWeb(fixtures.approvalRequest());
    expect(out).toBeNull();
  });

  test('reasoning returns null (operator-only)', async () => {
    const out = await renderForWeb(fixtures.reasoning());
    expect(out).toBeNull();
  });

  test('sources bubble surfaces every item', async () => {
    const out = await renderForWeb(fixtures.sources());
    expect(out?.payload.bubble).toBe('sources');
    const content = out?.payload.content as { items: unknown[] };
    expect(content.items).toHaveLength(2);
    expect(out).toMatchSnapshot();
  });

  test('sources with empty items returns null', async () => {
    const out = await renderForWeb(fixtures.sources({ items: [] }));
    expect(out).toBeNull();
  });

  test('traveler-authored messages return null (operator side echoes those)', async () => {
    const out = await renderForWeb(fixtures.text({ author: travelerAuthor }));
    expect(out).toBeNull();
  });

  test('esim_activation bubble carries QR + LPA + per-device tabs', async () => {
    const out = await renderForWeb(fixtures.esimActivation());
    expect(out?.payload.bubble).toBe('esim_activation');
    const content = out?.payload.content as {
      qrUrl: string;
      lpaCode: string;
      installUrl: string;
      instructions: Array<{ device: string; oneTap: boolean; steps: string[] }>;
    };
    expect(content.qrUrl).toBe('https://app.sendero.travel/api/esim/qr/abc.def.png');
    expect(content.installUrl).toBe('https://app.sendero.travel/install/esim/abc.def');
    expect(content.lpaCode).toBe('LPA:1$smdp.example.com$ACTIVATION_TEST');
    // Tabs include all 4 device kinds, only iOS is one-tap.
    expect(content.instructions.map(i => i.device)).toEqual([
      'ios',
      'androidPixel',
      'androidSamsung',
      'other',
    ]);
    expect(content.instructions[0].oneTap).toBe(true);
    expect(content.instructions[1].oneTap).toBe(false);
    expect(out).toMatchSnapshot();
  });

  test('seat_picker bubble carries options + tripId for client tap routing', async () => {
    const out = await renderForWeb(fixtures.seatPicker());
    expect(out?.payload.bubble).toBe('seat_picker');
    const content = out?.payload.content as {
      tripId: string;
      offerId: string;
      options: Array<{ serviceId: string; designator: string }>;
    };
    expect(content.tripId).toBe('trp_test_001');
    expect(content.offerId).toBe('off_test_abc');
    expect(content.options.map(o => o.designator)).toEqual(['12A', '14C']);
    expect(out).toMatchSnapshot();
  });

  test('ancillary_picker bubble surfaces bags + cfar arrays', async () => {
    const out = await renderForWeb(fixtures.ancillaryPicker());
    expect(out?.payload.bubble).toBe('ancillary_picker');
    const content = out?.payload.content as {
      bags: Array<{ serviceId: string }>;
      cancelForAnyReason?: Array<{ serviceId: string }>;
    };
    expect(content.bags).toHaveLength(2);
    expect(content.cancelForAnyReason).toHaveLength(1);
    expect(out).toMatchSnapshot();
  });

  test('trip_brief bubble carries all sections + alerts + share URL', async () => {
    const out = await renderForWeb(fixtures.tripBrief());
    expect(out?.payload.bubble).toBe('trip_brief');
    const content = out?.payload.content as {
      trip: { tripId: string; status: string };
      flights: unknown[];
      stays: unknown[];
      esims: unknown[];
      alerts: unknown[];
      shareUrl: string | null;
    };
    expect(content.trip.tripId).toBe('trp_test_001');
    expect(content.flights).toHaveLength(1);
    expect(content.stays).toHaveLength(1);
    expect(content.esims).toHaveLength(1);
    expect(content.alerts).toHaveLength(1);
    expect(content.shareUrl).toBe('https://app.sendero.travel/trip/abc.def');
    expect(out).toMatchSnapshot();
  });
});
