/**
 * /tools/:name — every @sendero/tools tool exposed as an
 * x402-gated HTTP endpoint. A buyer posts inputs + a Payment-Signature
 * header; the middleware settles the nanopayment; the handler runs.
 *
 * /tools             — GET: returns the price list + Payment flow hint
 * /tools/:name       — POST: invoke the tool (requires payment)
 * /tools/summary     — GET: meter summary (free)
 * /tools/events      — GET: recent meter events (free)
 * /tools/stream      — GET: SSE stream of meter events (free, powers UI)
 */

import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { toolList } from '@sendero/tools';
import { TOOL_PRICING } from '@sendero/tools/pricing';
import {
  getMeterEvents,
  meterSummary,
  subscribeMeter,
} from '@sendero/tools/meter';
import { requirePayment } from '../lib/x402-middleware';

export function mountPaidTools(app: Hono): void {
  // Catalog — tools + prices. No payment needed.
  app.get('/tools', (c) => {
    return c.json({
      seller:
        process.env.SENDERO_SELLER_ADDRESS ??
        process.env.TREASURY_VIEM_ADDRESS ??
        null,
      network: 'eip155:5042002',
      asset: '0x3600000000000000000000000000000000000000',
      tools: toolList.map((t) => ({
        name: t.name,
        description: t.description,
        priceUsdc: TOOL_PRICING[t.name] ?? null,
        endpoint: `/tools/${t.name}`,
      })),
      paymentFlow: [
        'POST /tools/:name with empty Payment-Signature header → 402 with PaymentRequirements',
        'Sign EIP-3009 TransferWithAuthorization against GatewayWalletBatched domain',
        'Retry with base64(JSON) payload in Payment-Signature header → 200 + tool result',
      ],
    });
  });

  // Meter summary — free endpoint, powers the margin panel.
  app.get('/tools/summary', (c) => c.json(meterSummary()));

  // Recent meter events — free. Optional `?since=<ms>`.
  app.get('/tools/events', (c) => {
    const since = Number(c.req.query('since') ?? 0) || undefined;
    return c.json({ events: getMeterEvents(since) });
  });

  // Live SSE of meter events. Powers the terminal-style feed UI.
  app.get('/tools/stream', (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      const unsub = subscribeMeter((e) => {
        if (closed) return;
        stream.writeSSE({ data: JSON.stringify(e), event: 'meter' }).catch(() => {});
      });
      // Replay last 20 so a late-connecting UI still shows context.
      for (const e of getMeterEvents().slice(-20)) {
        await stream.writeSSE({ data: JSON.stringify(e), event: 'meter' });
      }
      // Keepalive + wait for close.
      try {
        while (!closed) {
          await stream.writeSSE({ data: 'ping', event: 'ping' });
          await stream.sleep(15_000);
        }
      } finally {
        closed = true;
        unsub();
      }
    });
  });

  // Per-tool endpoints — one paid POST per tool.
  for (const tool of toolList) {
    const path = `/tools/${tool.name}`;
    app.post(path, requirePayment(tool.name), async (c) => {
      let input: any = {};
      try {
        input = await c.req.json();
      } catch {
        /* empty body is fine for zero-arg tools */
      }
      try {
        const result = await tool.handler(input, {});
        return c.json({
          tool: tool.name,
          paid: true,
          priceUsdc: TOOL_PRICING[tool.name],
          payment: c.get('x402' as never),
          result,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json(
          {
            tool: tool.name,
            paid: true,
            error: 'tool_failed',
            message,
          },
          500,
        );
      }
    });
  }
}
