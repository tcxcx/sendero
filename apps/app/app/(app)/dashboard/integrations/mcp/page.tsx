/**
 * /dashboard/integrations/mcp — combined "API keys / MCP" surface.
 *
 * Per the operator-onboarding journey: keys + MCP wiring belong on one
 * page so the user mints a key and immediately sees how to wire it
 * into Claude Desktop / curl / x402.
 */

import ApiKeysPanel from '@/app/(app)/dashboard/settings/api-keys/page';

export default function McpIntegrationsPage() {
  return (
    <div className="flex flex-col gap-4">
      <ApiKeysPanel />
    </div>
  );
}
