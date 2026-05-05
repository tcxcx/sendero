// Snapshot pre-conditions — pin the env so test runs are independent
// of which `.env.local` bun resolves at test-discovery time.
process.env.OG_SHARE_SIGNING_SECRET = '';
process.env.NEXT_PUBLIC_APP_URL = '';

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

  test('esim_activation uses cta_url interactive with QR header + install URL', async () => {
    const out = await renderForWhatsApp(fixtures.esimActivation());
    expect(out?.payload.type).toBe('interactive');
    expect(out?.payload.interactive?.type).toBe('cta_url');
    // Image header carries the QR PNG.
    expect(out?.payload.interactive?.header).toEqual({
      type: 'image',
      image: { link: 'https://app.sendero.travel/api/esim/qr/abc.def.png' },
    });
    // CTA button URL is the universal install page (HTTPS — Cloud API
    // rejects LPA: directly).
    const action = (out?.payload.interactive?.action ?? {}) as {
      parameters?: { url?: string; display_text?: string };
    };
    expect(action.parameters?.url).toBe('https://app.sendero.travel/install/esim/abc.def');
    expect(action.parameters?.display_text).toContain('Install');
    // Body carries plan label + payer attribution + per-device hint.
    expect(out?.payload.interactive?.body.text).toContain('5 GB · 30 days · Japan + Korea');
    expect(out?.payload.interactive?.body.text).toContain('charged to your wallet');
    expect(out).toMatchSnapshot();
  });

  test('esim_activation cta button title caps at 20 chars', async () => {
    const out = await renderForWhatsApp(fixtures.esimActivation());
    const action = (out?.payload.interactive?.action ?? {}) as {
      parameters?: { display_text?: string };
    };
    expect((action.parameters?.display_text ?? '').length).toBeLessThanOrEqual(20);
  });

  test('seat_picker uses an interactive list with select_seat row ids', async () => {
    const out = await renderForWhatsApp(fixtures.seatPicker());
    expect(out?.payload.interactive?.type).toBe('list');
    const action = (out?.payload.interactive?.action ?? {}) as {
      sections?: Array<{ rows?: Array<{ id: string; title: string }> }>;
    };
    const rows = action.sections?.[0]?.rows ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id.startsWith('select_seat:')).toBe(true);
    expect(rows[0]?.id).toContain('sea_001');
    expect(out).toMatchSnapshot();
  });

  test('ancillary_picker collapses bags + cfar into one interactive list', async () => {
    const out = await renderForWhatsApp(fixtures.ancillaryPicker());
    expect(out?.payload.interactive?.type).toBe('list');
    const action = (out?.payload.interactive?.action ?? {}) as {
      sections?: Array<{ rows?: Array<{ id: string }> }>;
    };
    const ids = action.sections?.[0]?.rows?.map(r => r.id) ?? [];
    expect(ids.some(i => i.startsWith('add_bag:'))).toBe(true);
    expect(ids.some(i => i.startsWith('cfar:'))).toBe(true);
    expect(out).toMatchSnapshot();
  });

  test('trip_brief uses cta_url when shareUrl present (single-tap to public page)', async () => {
    const out = await renderForWhatsApp(fixtures.tripBrief());
    expect(out?.payload.interactive?.type).toBe('cta_url');
    const action = (out?.payload.interactive?.action ?? {}) as {
      parameters?: { url?: string; display_text?: string };
    };
    expect(action.parameters?.url).toBe('https://app.sendero.travel/trip/abc.def');
    // Body must summarize the bookings — the public page is the deep
    // surface, the WA bubble is the elevator pitch.
    expect(out?.payload.interactive?.body.text).toContain('NYC week');
    expect(out?.payload.interactive?.body.text).toContain('JFK');
    expect(out?.payload.interactive?.body.text).toContain('Mercer');
    expect(out).toMatchSnapshot();
  });

  test('trip_brief without shareUrl falls back to plain text', async () => {
    const out = await renderForWhatsApp(fixtures.tripBrief({ shareUrl: null }));
    expect(out?.payload.type).toBe('text');
    // Recap content still present
    expect(out?.payload.text?.body).toContain('JFK');
  });

  test('trip_brief with no bookings + no important alerts says so explicitly', async () => {
    const out = await renderForWhatsApp(
      fixtures.tripBrief({ flights: [], stays: [], esims: [], alerts: [] })
    );
    const body = out?.payload.interactive?.body.text ?? out?.payload.text?.body ?? '';
    expect(body).toContain('No bookings yet');
  });

  test('stay_rate_picker emits an interactive list with a row per rate keyed by rateId', async () => {
    const out = await renderForWhatsApp(fixtures.stayRatePicker());
    expect(out?.payload.type).toBe('interactive');
    expect(out?.payload.interactive?.type).toBe('list');
    const rows = out?.payload.interactive?.action.sections?.[0]?.rows ?? [];
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toContain('rat_0000B5zdBpSS9xnoU7J48B');
    expect(out).toMatchSnapshot();
  });

  test('stay_quote_review interactive button surfaces every Duffel-mandated field', async () => {
    const out = await renderForWhatsApp(fixtures.stayQuoteReview());
    expect(out?.payload.type).toBe('interactive');
    expect(out?.payload.interactive?.type).toBe('button');
    const body = out?.payload.interactive?.body.text ?? '';
    expect(body).toContain('Room');
    expect(body).toContain('Taxes');
    expect(body).toContain('Fees');
    expect(body).toContain('Total');
    expect(body).toContain('Due at property');
    expect(body).toContain('Full refund');
    expect(body).toContain('No smoking allowed');
    expect(body).toContain('Key collection');
    expect(body).toContain('Sold by Sendero Travel');
    const buttons = out?.payload.interactive?.action?.buttons ?? [];
    expect(buttons[0]?.reply.id).toContain('confirm_stay_booking');
    expect(buttons[1]?.reply.id).toContain('cancel_stay_booking');
    expect(out).toMatchSnapshot();
  });

  test('stay_booking_confirmation with tripUrl renders cta_url; without falls back to text', async () => {
    const withUrl = await renderForWhatsApp(fixtures.stayBookingConfirmation());
    expect(withUrl?.payload.interactive?.type).toBe('cta_url');
    expect(withUrl?.payload.interactive?.body.text).toContain('AFE33SE2');

    const withoutUrl = await renderForWhatsApp(fixtures.stayBookingConfirmation({ tripUrl: null }));
    expect(withoutUrl?.payload.type).toBe('text');
    expect(withoutUrl?.payload.text?.body).toContain('AFE33SE2');
  });
});
