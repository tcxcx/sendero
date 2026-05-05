/**
 * Pure tests for the channel-agnostic share-card → ChannelMessage
 * conversion. Layer 1 of the dispatcher; covers CTA narrowing,
 * deterministic id generation, and field passthrough. Per-channel
 * adapters (`dispatchAgentShareCardsWhatsApp` / `dispatchAgentShareCardsSlack`)
 * use this same conversion, so a green test here means every channel
 * gets the same canonical card.
 */

import { describe, expect, test } from 'bun:test';

import { type AgentShareCard, shareCardsToChannelMessages } from '../agent-share-cards';

describe('shareCardsToChannelMessages', () => {
  const baseCard: AgentShareCard = {
    toolName: 'search_flights',
    share: {
      title: 'Flights EZE → LIM',
      body: '3 options EZE→LIM on 2026-05-05, from USD 142.37',
      bullets: [
        'Duffel Airways · 03:05–05:52 · nonstop · USD 142.37',
        'LATAM Airlines · 07:35–10:25 · nonstop · USD 253.55',
      ],
      primaryCta: { label: 'Hold cheapest', kind: 'select_offer' },
    },
  };

  test('emits one ChannelMessage per share card with kind=tool_result', () => {
    const out = shareCardsToChannelMessages([baseCard], { idPrefix: 'turn_42' });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('tool_result');
  });

  test('id is deterministic and includes prefix + index + toolName', () => {
    const out = shareCardsToChannelMessages([baseCard, baseCard], { idPrefix: 'turn_42' });
    expect(out[0]!.id).toBe('turn_42_0_search_flights');
    expect(out[1]!.id).toBe('turn_42_1_search_flights');
  });

  test('passthrough preserves title / body / bullets / imageUrl', () => {
    const card: AgentShareCard = {
      ...baseCard,
      share: { ...baseCard.share, imageUrl: 'https://example.com/og.png' },
    };
    const out = shareCardsToChannelMessages([card], { idPrefix: 'x' });
    if (out[0]!.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(out[0]!.share?.title).toBe(card.share.title);
    expect(out[0]!.share?.body).toBe(card.share.body);
    expect(out[0]!.share?.bullets).toEqual(card.share.bullets ?? []);
    expect(out[0]!.share?.imageUrl).toBe('https://example.com/og.png');
  });

  test('known CTA kinds pass through unchanged', () => {
    const known: Array<AgentShareCard['share']['primaryCta']> = [
      { label: 'A', kind: 'reply' },
      { label: 'B', kind: 'approve' },
      { label: 'C', kind: 'select_offer' },
      { label: 'D', kind: 'confirm_cancel' },
      { label: 'E', kind: 'open_link' },
      { label: 'F', kind: 'tool_invoke' },
    ];
    for (const cta of known) {
      const out = shareCardsToChannelMessages(
        [{ toolName: 't', share: { title: 'x', body: 'y', primaryCta: cta } }],
        { idPrefix: 'p' }
      );
      if (out[0]!.kind !== 'tool_result') throw new Error('expected tool_result');
      expect(out[0]!.share?.primaryCta?.kind).toBe(cta!.kind);
    }
  });

  test('unknown CTA kinds degrade to open_link instead of dropping the card', () => {
    const out = shareCardsToChannelMessages(
      [
        {
          toolName: 'something_new',
          share: {
            title: 't',
            body: 'b',
            primaryCta: { label: 'Whatever', kind: 'wat_is_this' },
            secondaryCtas: [{ label: 'Also', kind: 'mystery_kind' }],
          },
        },
      ],
      { idPrefix: 'p' }
    );
    if (out[0]!.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(out[0]!.share?.primaryCta).toEqual({ label: 'Whatever', kind: 'open_link' });
    expect(out[0]!.share?.secondaryCtas).toEqual([{ label: 'Also', kind: 'open_link' }]);
  });

  test('omits optional CTA fields when not provided', () => {
    const minimal: AgentShareCard = {
      toolName: 'check_treasury',
      share: { title: 'Treasury', body: 'USDC 12,304.56' },
    };
    const out = shareCardsToChannelMessages([minimal], { idPrefix: 'p' });
    if (out[0]!.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(out[0]!.share?.primaryCta).toBeUndefined();
    expect(out[0]!.share?.secondaryCtas).toBeUndefined();
    expect(out[0]!.share?.imageUrl).toBeUndefined();
    expect(out[0]!.share?.bullets).toBeUndefined();
  });

  test('author defaults to Sendero (agent role) and respects override', () => {
    const out1 = shareCardsToChannelMessages([baseCard], { idPrefix: 'p' });
    if (out1[0]!.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(out1[0]!.author.role).toBe('agent');
    expect(out1[0]!.author.name).toBe('Sendero');

    const out2 = shareCardsToChannelMessages([baseCard], {
      idPrefix: 'p',
      authorName: 'Sendero · Lima',
    });
    if (out2[0]!.kind !== 'tool_result') throw new Error('expected tool_result');
    expect(out2[0]!.author.name).toBe('Sendero · Lima');
  });

  test('empty input returns empty array', () => {
    expect(shareCardsToChannelMessages([], { idPrefix: 'p' })).toEqual([]);
  });

  test('activation payload promotes the card to esim_activation kind', () => {
    const cardWithActivation: AgentShareCard = {
      toolName: 'book_esim',
      share: {
        title: 'Trip eSIM ready',
        body: '5 GB · 7 days · JP',
        bullets: ['5.0 GB · 7 days', 'JP'],
      },
      activation: {
        esimId: 'esim_test_123',
        planLabel: '5 GB · 7 days · JP',
        countries: ['JP'],
        dataMb: 5120,
        validityDays: 7,
        qrUrl: 'https://app.sendero.travel/api/esim/qr/abc.png',
        lpaCode: 'LPA:1$smdp.example.com$AC123',
        installUrl: 'https://app.sendero.travel/install/esim/abc',
        priceLine: '$3.00 · charged to your wallet',
      },
    };
    const out = shareCardsToChannelMessages([cardWithActivation], { idPrefix: 'turn_42' });
    expect(out).toHaveLength(1);
    const m = out[0]!;
    if (m.kind !== 'esim_activation') {
      throw new Error(`expected esim_activation, got ${m.kind}`);
    }
    expect(m.esimId).toBe('esim_test_123');
    expect(m.qrUrl).toBe('https://app.sendero.travel/api/esim/qr/abc.png');
    expect(m.installUrl).toBe('https://app.sendero.travel/install/esim/abc');
    expect(m.lpaCode).toBe('LPA:1$smdp.example.com$AC123');
    expect(m.priceLine).toBe('$3.00 · charged to your wallet');
    expect(m.id).toBe('turn_42_0_book_esim');
  });

  test('share-only cards keep emitting tool_result (backward compat)', () => {
    const out = shareCardsToChannelMessages([baseCard], { idPrefix: 'p' });
    expect(out[0]!.kind).toBe('tool_result');
  });
});
