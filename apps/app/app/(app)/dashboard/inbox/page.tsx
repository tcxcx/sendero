/**
 * /dashboard/inbox (unscoped) — redirects to /dashboard/console.
 *
 * The unscoped MetaInbox view is functionally identical to the
 * /dashboard/console unscoped view (operator ↔ Sendero AI). Sidebar's
 * "Trip inboxes" entry lands here and bounces forward — keeps a single
 * canonical operator surface so the breadcrumb + UI state stay in sync.
 *
 * Trip-scoped /dashboard/inbox/[tripId] still has its own page and
 * renders the per-trip MetaInbox unchanged.
 */

import { redirect } from 'next/navigation';

export default function InboxIndexPage(): never {
  redirect('/dashboard/console');
}
