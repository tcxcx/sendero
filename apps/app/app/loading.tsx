/**
 * Root-level fallback loader for anything above the dashboard layout —
 * auth gates, onboarding, public routes during a locale flip.
 *
 * Same overlay the dashboard uses; Next.js picks whichever `loading.tsx`
 * is closest to the suspending segment, so the dashboard copy still
 * wins inside `/dashboard/*`.
 */

import { AppLoadingOverlay } from '@/components/app-shell/app-loading-overlay';

export default function RootLoading() {
  return <AppLoadingOverlay />;
}
