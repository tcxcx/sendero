/**
 * Soft-nav fallback for the @kpis slot. Returns null so unrelated
 * sub-routes (and any future scoped variant) don't drag the workspace
 * KPI strip in. The slot's `page.tsx` is what renders on direct nav
 * to /dashboard/console.
 */
export default function KpisDefault() {
  return null;
}
