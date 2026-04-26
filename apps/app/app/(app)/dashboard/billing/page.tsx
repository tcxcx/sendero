/**
 * /dashboard/billing — redirect to /billing/invoices.
 *
 * The Money & policy sidebar links directly to /dashboard/billing/invoices
 * (and /spend, /caps, etc.). The bare /dashboard/billing path used to
 * 404 — surfaced in the baseline /qa report. This redirect collapses
 * the no-slug case onto the canonical landing.
 */

import { redirect } from 'next/navigation';

export default function BillingIndexPage(): never {
  redirect('/dashboard/billing/invoices');
}
