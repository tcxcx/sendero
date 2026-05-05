/**
 * Operator-renderer exhaustive coverage.
 *
 * For each ChannelMessage kind, render via renderForOperator and walk
 * the returned React element tree to assert the expected AI Elements
 * primitive composition. We inspect the tree structurally rather than
 * mounting the components: the renderer is a pure mapper, the heavy
 * client primitives (Streamdown, Collapsible) require a DOM and would
 * pull the whole bundle into the test runtime.
 *
 * The TypeScript switch in operator.tsx is already proved exhaustive at
 * compile time. This test pins the runtime output, so a future tweak
 * (swapping MessageContent for something else, dropping a CardBlock,
 * etc.) shows up as a failing assertion instead of silent rendering
 * drift.
 *
 * Run: bun test apps/app/lib/channel-render/__tests__/operator.test.tsx
 */

import { describe, expect, test } from 'bun:test';
import type { ReactElement } from 'react';
import { isValidElement } from 'react';

import { MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning';
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';

import { renderForOperator } from '../operator';
import type { ChannelMessage } from '../types';
import { fixtures } from './__fixtures__/messages';

// ─── tree walkers ────────────────────────────────────────────────────

type AnyElement = ReactElement<{ children?: unknown }>;

function isEl(node: unknown): node is AnyElement {
  return isValidElement(node);
}

function childrenOf(node: AnyElement): unknown[] {
  const props = node.props as { children?: unknown; output?: unknown };
  const slots: unknown[] = [];
  // ToolOutput surfaces its render content via the `output` prop instead
  // of children. Walk both so structural assertions don't miss the body
  // CardBlock or fallback <pre>.
  if (props.output !== undefined && props.output !== null) slots.push(props.output);
  const c = props.children;
  if (c !== undefined && c !== null) {
    if (Array.isArray(c)) slots.push(...c);
    else slots.push(c);
  }
  return slots;
}

const PRIMITIVES: Set<unknown> = new Set([
  MessageContent,
  MessageResponse,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
]);

/**
 * Imported AI Elements primitives stay opaque so callers can match them
 * by type identity. Locally defined function components inside the
 * operator renderer (CardBlock, ApprovalCard, CtaButton) get unfolded
 * by invoking them so their inner DOM is walkable. Mounting via
 * react-dom would drag the whole 'use client' bundle (Streamdown,
 * mermaid, shiki) into the test runtime, which we want to avoid.
 */
function unfoldOnce(node: AnyElement): unknown {
  const t = node.type;
  if (typeof t === 'function' && !PRIMITIVES.has(t)) {
    const fc = t as (p: unknown) => unknown;
    try {
      return fc(node.props ?? {});
    } catch {
      return node;
    }
  }
  return node;
}

function findByType(root: unknown, type: unknown): AnyElement | null {
  if (!isEl(root)) return null;
  if (root.type === type) return root;
  const unfolded = unfoldOnce(root);
  if (unfolded !== root) {
    const hit = findByType(unfolded, type);
    if (hit) return hit;
  }
  for (const child of childrenOf(root)) {
    const hit = findByType(child, type);
    if (hit) return hit;
  }
  return null;
}

function findAllByType(root: unknown, type: unknown): AnyElement[] {
  const acc: AnyElement[] = [];
  function walk(node: unknown) {
    if (!isEl(node)) return;
    if (node.type === type) {
      acc.push(node);
      return;
    }
    const unfolded = unfoldOnce(node);
    if (unfolded !== node) {
      walk(unfolded);
      return;
    }
    for (const child of childrenOf(node)) walk(child);
  }
  walk(root);
  return acc;
}

function collectText(root: unknown): string {
  if (root === null || root === undefined || typeof root === 'boolean') return '';
  if (typeof root === 'string' || typeof root === 'number') return String(root);
  if (Array.isArray(root)) return root.map(n => collectText(n)).join('');
  if (isEl(root)) {
    const unfolded = unfoldOnce(root);
    if (unfolded !== root) return collectText(unfolded);
    const props = root.props as Record<string, unknown>;
    return [collectText(props.children), collectText(props.output)].filter(Boolean).join('');
  }
  return '';
}

// ─── tests ───────────────────────────────────────────────────────────

describe('renderForOperator', () => {
  test('text renders MessageContent wrapping a MessageResponse with the content', () => {
    const tree = renderForOperator(fixtures.text({ content: 'Hello traveler' }));
    expect(tree.type).toBe(MessageContent);

    const response = findByType(tree, MessageResponse);
    expect(response).not.toBeNull();
    expect(collectText(response)).toBe('Hello traveler');
  });

  test('card renders a CardBlock inside MessageContent with title, body, bullets, and ctas', () => {
    const msg = fixtures.card();
    const tree = renderForOperator(msg);
    expect(tree.type).toBe(MessageContent);

    const text = collectText(tree);
    expect(text).toContain(msg.title);
    expect(text).toContain(msg.body);
    for (const bullet of msg.bullets ?? []) expect(text).toContain(bullet);
    for (const cta of msg.ctas ?? []) expect(text).toContain(cta.label);
  });

  test('tool_invocation streaming renders Tool with state input-streaming', () => {
    const tree = renderForOperator(fixtures.toolInvocation({ status: 'streaming' }));
    expect(tree.type).toBe(Tool);

    const header = findByType(tree, ToolHeader);
    expect(header).not.toBeNull();
    expect(header?.props).toMatchObject({ state: 'input-streaming' });

    expect(findByType(tree, ToolContent)).not.toBeNull();
    expect(findByType(tree, ToolInput)).not.toBeNull();
  });

  test('tool_invocation error renders Tool with state output-error and an errorText', () => {
    const tree = renderForOperator(
      fixtures.toolInvocation({ status: 'error', errorMessage: 'rate limited' })
    );
    const header = findByType(tree, ToolHeader);
    expect(header?.props).toMatchObject({ state: 'output-error' });

    const output = findByType(tree, ToolOutput);
    expect(output?.props).toMatchObject({ errorText: 'rate limited' });
  });

  test('tool_result with share renders Tool > ToolOutput containing the CardBlock content', () => {
    const msg = fixtures.toolResult();
    const tree = renderForOperator(msg);
    expect(tree.type).toBe(Tool);

    const header = findByType(tree, ToolHeader);
    expect(header?.props).toMatchObject({ state: 'output-available' });

    const output = findByType(tree, ToolOutput);
    expect(output).not.toBeNull();

    const text = collectText(output);
    expect(text).toContain(msg.share?.title);
    expect(text).toContain(msg.share?.body);
    expect(text).toContain(msg.share?.primaryCta?.label);
  });

  test('tool_result without share falls back to a stringified <pre> dump', () => {
    const tree = renderForOperator(fixtures.toolResult({ share: undefined, result: { ok: 1 } }));
    const output = findByType(tree, ToolOutput);
    expect(output).not.toBeNull();

    const pres = findAllByType(output, 'pre');
    expect(pres.length).toBe(1);
    expect(collectText(pres[0])).toContain('"ok"');
  });

  test('approval_request renders an ApprovalCard with traveler, route, amount, reason', () => {
    const msg = fixtures.approvalRequest();
    const tree = renderForOperator(msg);
    expect(tree.type).toBe(MessageContent);

    const text = collectText(tree);
    expect(text).toContain(msg.subject.travelerName);
    expect(text).toContain(msg.subject.route);
    expect(text).toContain('$482.10 USD');
    expect(text).toContain('over policy cap');
  });

  test('reasoning renders Reasoning with trigger + content, defaultOpen flips on collapsedByDefault', () => {
    const msg = fixtures.reasoning({ collapsedByDefault: true });
    const tree = renderForOperator(msg);
    expect(tree.type).toBe(Reasoning);
    expect((tree.props as { defaultOpen?: boolean }).defaultOpen).toBe(false);

    expect(findByType(tree, ReasoningTrigger)).not.toBeNull();
    const content = findByType(tree, ReasoningContent);
    expect(content).not.toBeNull();
    expect(collectText(content)).toContain(msg.content);
  });

  test('sources with items renders Sources > SourcesTrigger + Source per item', () => {
    const msg = fixtures.sources();
    const tree = renderForOperator(msg);
    expect(tree.type).toBe(MessageContent);

    const sources = findByType(tree, Sources);
    expect(sources).not.toBeNull();

    const trigger = findByType(sources, SourcesTrigger);
    expect(trigger?.props).toMatchObject({ count: msg.items.length });

    const content = findByType(sources, SourcesContent);
    const sourceEls = findAllByType(content, Source);
    expect(sourceEls.length).toBe(msg.items.length);
    for (let i = 0; i < msg.items.length; i += 1) {
      expect(sourceEls[i].props).toMatchObject({
        href: msg.items[i].url,
        title: msg.items[i].title,
      });
    }
  });

  test('sources with empty items renders an empty MessageContent', () => {
    const tree = renderForOperator(fixtures.sources({ items: [] }));
    expect(tree.type).toBe(MessageContent);
    expect(findByType(tree, Sources)).toBeNull();
  });

  test('non-exhaustive ChannelMessage kind throws', () => {
    const bogus = { kind: 'mystery_kind', id: 'x' } as unknown as ChannelMessage;
    expect(() => renderForOperator(bogus)).toThrow('non-exhaustive ChannelMessage kind');
  });

  test('esim_activation renders inside MessageContent with the activation card', () => {
    const tree = renderForOperator(fixtures.esimActivation());
    expect(tree.type).toBe(MessageContent);
    // EsimActivationCard is the inner child; assert via its props rather
    // than tree-walking JSX it doesn't expand without a renderer.
    const card = (tree.props as { children?: ReactElement }).children;
    expect(card && isValidElement(card)).toBe(true);
    const props = (card as ReactElement).props as {
      planLabel?: string;
      lpaCode?: string;
      installUrl?: string;
      qrUrl?: string;
    };
    expect(props.planLabel).toBe('5 GB · 30 days · Japan + Korea');
    expect(props.lpaCode).toBe('LPA:1$smdp.example.com$ACTIVATION_TEST');
    expect(props.installUrl).toBe('https://app.sendero.travel/install/esim/abc.def');
    expect(props.qrUrl).toBe('https://app.sendero.travel/api/esim/qr/abc.def.png');
  });

  test('seat_picker renders inside MessageContent with the seat card props', () => {
    const tree = renderForOperator(fixtures.seatPicker());
    expect(tree.type).toBe(MessageContent);
    const card = (tree.props as { children?: ReactElement }).children;
    expect(card && isValidElement(card)).toBe(true);
    const props = (card as ReactElement).props as {
      tripId?: string;
      offerId?: string;
      options?: Array<{ designator: string }>;
    };
    expect(props.tripId).toBe('trp_test_001');
    expect(props.offerId).toBe('off_test_abc');
    expect(props.options?.map(o => o.designator)).toEqual(['12A', '14C']);
  });

  test('ancillary_picker renders inside MessageContent with bags + cfar props', () => {
    const tree = renderForOperator(fixtures.ancillaryPicker());
    expect(tree.type).toBe(MessageContent);
    const card = (tree.props as { children?: ReactElement }).children;
    expect(card && isValidElement(card)).toBe(true);
    const props = (card as ReactElement).props as {
      bags?: Array<{ serviceId: string }>;
      cancelForAnyReason?: Array<{ serviceId: string }>;
    };
    expect(props.bags).toHaveLength(2);
    expect(props.cancelForAnyReason).toHaveLength(1);
  });

  test('trip_brief renders inside MessageContent with all section props + share URL', () => {
    const tree = renderForOperator(fixtures.tripBrief());
    expect(tree.type).toBe(MessageContent);
    const card = (tree.props as { children?: ReactElement }).children;
    expect(card && isValidElement(card)).toBe(true);
    const props = (card as ReactElement).props as {
      trip?: { tripId: string; status: string };
      flights?: unknown[];
      stays?: unknown[];
      esims?: unknown[];
      alerts?: unknown[];
      shareUrl?: string | null;
    };
    expect(props.trip?.tripId).toBe('trp_test_001');
    expect(props.flights).toHaveLength(1);
    expect(props.stays).toHaveLength(1);
    expect(props.esims).toHaveLength(1);
    expect(props.alerts).toHaveLength(1);
    expect(props.shareUrl).toBe('https://app.sendero.travel/trip/abc.def');
  });

  test('stay_rate_picker renders inside MessageContent with the rate matrix forwarded', () => {
    const tree = renderForOperator(fixtures.stayRatePicker());
    expect(tree.type).toBe(MessageContent);
    const child = (tree.props as { children?: ReactElement }).children;
    expect(child && isValidElement(child)).toBe(true);
    const props = (child as ReactElement).props as {
      msg: { rates: unknown[]; searchResultId: string };
    };
    expect(props.msg.searchResultId).toBe('ssr_0000B5zd9zXpgcMvBmwkgG');
    expect(props.msg.rates).toHaveLength(1);
  });

  test('stay_quote_review renders inside MessageContent with the quote payload forwarded', () => {
    const tree = renderForOperator(fixtures.stayQuoteReview());
    expect(tree.type).toBe(MessageContent);
    const child = (tree.props as { children?: ReactElement }).children;
    expect(child && isValidElement(child)).toBe(true);
    const props = (child as ReactElement).props as {
      msg: {
        quoteId: string;
        billing: { totalAmount: string; taxAmount: string; feeAmount: string };
        conditions: Array<{ description: string }>;
      };
    };
    expect(props.msg.quoteId).toBe('quo_0000B5zdBvh42oRqcoI4BO');
    expect(props.msg.billing.taxAmount).toBe('95.73');
    expect(props.msg.billing.feeAmount).toBe('39.95');
    expect(props.msg.conditions[0]?.description).toContain('No smoking allowed');
  });

  test('stay_booking_confirmation renders inside MessageContent with reference + confirmedAt', () => {
    const tree = renderForOperator(fixtures.stayBookingConfirmation());
    expect(tree.type).toBe(MessageContent);
    const child = (tree.props as { children?: ReactElement }).children;
    expect(child && isValidElement(child)).toBe(true);
    const props = (child as ReactElement).props as {
      msg: { reference: string; confirmedAt: string | null };
    };
    expect(props.msg.reference).toBe('AFE33SE2');
    expect(props.msg.confirmedAt).toBe('2026-04-25T10:05:00Z');
  });
});
