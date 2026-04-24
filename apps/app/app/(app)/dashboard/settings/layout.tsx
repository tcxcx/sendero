import { requireRole } from '@/lib/require-role';

/**
 * Settings layout — chrome deliberately stripped (DESIGN.md §26).
 *
 * Each settings sub-route now renders standalone inside the dashboard's
 * main panel. Per the DX journey the API keys content moved to
 * `/dashboard/integrations/mcp`; the remaining sub-pages (billing,
 * branding, org, profile, channels) keep their own routes but no
 * longer share a SettingsNav sidebar — the global app sidebar is the
 * single navigation surface.
 *
 * The org-admin role check is preserved here so every settings route
 * still gates on `org:admin`.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireRole('org:admin');
  return <>{children}</>;
}
