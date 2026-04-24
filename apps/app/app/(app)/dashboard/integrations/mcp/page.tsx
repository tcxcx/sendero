/**
 * /dashboard/integrations/mcp — combined "API keys / MCP" surface.
 *
 * Per the operator-onboarding journey: keys + MCP wiring belong on one
 * page so the user mints a key and immediately sees how to wire it
 * into Claude Desktop / curl / x402.
 */

import { PageHeader } from '@/components/app-shell/page-header';

import ApiKeysPanel from '@/app/(app)/dashboard/settings/api-keys/page';

export default function McpIntegrationsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="API keys / MCP"
        description="Mint a workspace-scoped key and wire Sendero into Claude Desktop, Cursor, Zed, your x402 runner, or direct API calls."
      />
      <ApiKeysPanel />
    </div>
  );
}
