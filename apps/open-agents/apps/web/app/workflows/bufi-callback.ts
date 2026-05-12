// BUFI bridge callback workflow — durably polls a session until terminal
// state, then POSTs the result to the session's bufi_callback_url.
//
// Started from /api/bufi/dispatch alongside runAgentWorkflow only when
// the dispatch payload included a `callback` field. Skipped otherwise
// (the morning digest cron remains the fallback).
//
// "use workflow" gives us durable hibernation between polls — the function
// suspends to disk and resumes when the sleep elapses, so a 30-minute
// agent run doesn't hold a function instance open.
//
// DB ops are imported from @/lib/db/bufi-callback (not @/lib/db/client
// directly) — Vercel Workflow flags any traceable import of `postgres`
// in a workflow file.

import { getBufiCallbackSessionState, markBufiCallbackFired } from '@/lib/db/bufi-callback';

interface BufiCallbackOptions {
  sessionId: string;
  /** Soft cap on total wait time, in seconds. Workflow exits without
   *  firing if the session never terminates. Default 90 min. */
  maxWaitSeconds?: number;
  /** Poll interval, in seconds. Default 30. */
  pollIntervalSeconds?: number;
}

const DEFAULT_MAX_WAIT_SECONDS = 90 * 60;
const DEFAULT_POLL_INTERVAL_SECONDS = 30;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'archived']);

export async function bufiCallbackWorkflow(opts: BufiCallbackOptions) {
  'use workflow';

  const pollMs = (opts.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000;
  const maxMs = (opts.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS) * 1000;
  const startedAt = Date.now();

  while (true) {
    const session = await getBufiCallbackSessionState(opts.sessionId);

    if (!session) {
      console.warn('[bufi-callback] session disappeared', { sessionId: opts.sessionId });
      return { fired: false, reason: 'session_not_found' };
    }

    if (!session.bufiCallbackUrl || !session.bufiCallbackSecret) {
      // Callback was cleared since dispatch — abandon.
      return { fired: false, reason: 'no_callback_configured' };
    }

    if (session.bufiCallbackFiredAt) {
      // Some other path already fired the callback — exit.
      return { fired: false, reason: 'already_fired' };
    }

    if (TERMINAL_STATUSES.has(session.status)) {
      const sessionOrigin =
        process.env.VERCEL_PROJECT_PRODUCTION_URL ??
        process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ??
        'open-agents-bay.vercel.app';
      const streamUrl = `https://${sessionOrigin.replace(/^https?:\/\//, '')}/sessions/${session.id}`;

      // Atomically claim the fire — wins the race against any duplicate.
      const won = await markBufiCallbackFired(session.id);
      if (!won) {
        return { fired: false, reason: 'already_fired' };
      }

      try {
        const res = await fetch(session.bufiCallbackUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.bufiCallbackSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId: session.id,
            status: session.status,
            title: session.title,
            repo: {
              owner: session.repoOwner,
              name: session.repoName,
              branch: session.branch,
            },
            streamUrl,
            firedAt: new Date().toISOString(),
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.warn('[bufi-callback] receiver returned non-2xx', {
            sessionId: session.id,
            status: res.status,
            body: text.slice(0, 200),
          });
        }
      } catch (err) {
        console.error('[bufi-callback] POST failed', {
          sessionId: session.id,
          error: (err as Error).message,
        });
        // markBufiCallbackFired already ran — we don't retry, to avoid
        // N× notifications. A failed POST is logged for visibility but
        // the workflow considers itself done.
      }

      return { fired: true, status: session.status };
    }

    if (Date.now() - startedAt > maxMs) {
      console.warn('[bufi-callback] timed out waiting for terminal state', {
        sessionId: opts.sessionId,
        waitedMs: Date.now() - startedAt,
      });
      return { fired: false, reason: 'timeout' };
    }

    // Durable sleep — the workflow hibernates here and resumes after pollMs.
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}
