/**
 * Default loading UI for every `/dashboard/*` route segment.
 *
 * Next.js App Router mounts this automatically whenever a nested
 * segment suspends — initial app boot, route transitions inside the
 * dashboard, and full-navigation locale changes via `?locale=xx-XX`.
 *
 * The overlay masks the segment; it unmounts when Next.js finishes
 * resolving the target page.
 */

import { AppLoadingOverlay } from '@/components/app-shell/app-loading-overlay';

export default function DashboardLoading() {
  return <AppLoadingOverlay />;
}
