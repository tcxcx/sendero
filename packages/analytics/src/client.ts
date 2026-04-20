'use client';

/**
 * Client-side PostHog wrapper.
 *
 * Init is called from apps/app/app/providers.tsx once we know the user's
 * `distinctId`. We deliberately do NOT auto-capture (pageviews go via
 * Vercel Web Analytics) so PostHog events are all intentional product
 * analytics, not SPA noise.
 */

import posthog from 'posthog-js';
import type { CapturedEvent, SenderoEventName } from './events';

let initialized = false;

export function initPosthog(args: { distinctId?: string | null }): void {
  if (initialized) return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!key || typeof window === 'undefined') return;
  posthog.init(key, {
    api_host: host,
    capture_pageview: false,
    autocapture: false,
    disable_session_recording: true,
    persistence: 'localStorage+cookie',
    loaded: ph => {
      if (args.distinctId) ph.identify(args.distinctId);
    },
  });
  initialized = true;
}

export function identify(distinctId: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.identify(distinctId, properties);
}

export function capture<K extends SenderoEventName>(event: CapturedEvent<K>): void {
  if (!initialized) return;
  posthog.capture(event.event, event.properties as Record<string, unknown>);
}

export function reset(): void {
  if (!initialized) return;
  posthog.reset();
}
