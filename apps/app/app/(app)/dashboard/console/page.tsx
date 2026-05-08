/**
 * /dashboard/console — every column on this route is a sibling
 * parallel-routes slot (@kpis, @threads, @conversation, @stage,
 * @context). The layout-level <ConsoleChatHost /> owns useChat and
 * mirrors state to Zustand for the slots to read.
 *
 * This file MUST exist and MUST NOT be deleted. Next.js requires a
 * page.tsx at the route segment for a URL to match — without it,
 * /dashboard/console 404s even though the layout + slots compile
 * fine. Phase B-γ Codex outside-voice review #3 + #4.
 *
 * Returns null on purpose: every visible column lives in a sibling
 * slot. Phase B-δ may revisit if a route-level redirect is wanted
 * (e.g., /dashboard/console with no params → ?tripId=…most-recent).
 */

export const dynamic = 'force-dynamic';

export default function ConsolePage() {
  return null;
}
