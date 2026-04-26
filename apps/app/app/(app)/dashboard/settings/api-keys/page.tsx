'use client';

import { useClerk } from '@clerk/nextjs';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@sendero/ui/button';
import { toast } from '@sendero/ui/sonner';

type PlanContext = {
  tier: string;
  productionApiKeyLimit: number | null;
  isBeta: boolean;
};

function CopyableSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!navigator?.clipboard?.writeText) {
      toast.error('Clipboard unavailable');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed');
    }
  };
  const Icon = copied ? CheckIcon : CopyIcon;
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-[var(--radius-sm)] bg-[color:var(--surface-base)] p-3 pr-10 font-mono text-xs">
        {code}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--ink)] opacity-60 transition hover:bg-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] hover:opacity-100"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function ApiKeysPage() {
  const { openOrganizationProfile } = useClerk();
  const [plan, setPlan] = useState<PlanContext | null>(null);

  // Loaded from server endpoint so the limit stays authoritative even
  // if the client's Clerk token is stale.
  useEffect(() => {
    fetch('/api/billing/plan-context', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => json && setPlan(json));
  }, []);

  const limitLine =
    plan?.productionApiKeyLimit === null
      ? 'Unlimited production API keys on this plan.'
      : plan?.productionApiKeyLimit === 0
        ? 'Your plan is sandbox-only. Upgrade to Basic or Pro for production keys.'
        : plan
          ? `Your plan includes up to ${plan.productionApiKeyLimit} production API keys. Sandbox keys don’t count.`
          : 'Loading plan…';

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-normal text-foreground">API keys</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create keys to authenticate external agents against Sendero endpoints — paste them as{' '}
              <code className="font-mono text-xs">Authorization: Bearer ak_…</code> into your MCP
              client, x402 runner, or direct API calls. Each key is scoped to this workspace.
            </p>
            {plan ? (
              <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
                Current plan: {plan.tier} · {limitLine}
              </div>
            ) : null}
          </div>
          <Button
            onClick={() => openOrganizationProfile()}
            className="!rounded-md bg-[color:var(--ink)] text-white hover:bg-[color:color-mix(in_oklab,var(--ink)_92%,black)]"
          >
            Manage keys
          </Button>
        </div>
        {plan?.isBeta ? (
          <div className="rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--ink)_30%,transparent)] bg-[color:color-mix(in_oklab,var(--ink)_4%,white)] p-3 text-sm text-muted-foreground">
            <strong className="text-[color:var(--ink)]">Testnet beta.</strong> Production keys are
            stored but settle against Arc testnet USDC until Circle promotes Arc mainnet. No real
            USDC moves during this window.
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[color:var(--surface-raised)] p-6 shadow-[var(--shadow-md)]">
        <h3 className="text-[15px] font-semibold tracking-normal text-foreground">
          How to use your key
        </h3>
        <div className="flex flex-col gap-4 text-sm text-muted-foreground">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
              1 · Claude Desktop (MCP)
            </div>
            <p className="mt-1">
              Add Sendero as an MCP server in your Claude Desktop config (typically{' '}
              <code className="font-mono text-xs">
                ~/Library/Application Support/Claude/claude_desktop_config.json
              </code>
              ):
            </p>
            <CopyableSnippet
              code={`{
  "mcpServers": {
    "sendero": {
      "type": "http",
      "url": "https://sendero.travel/api/mcp",
      "headers": { "Authorization": "Bearer ak_…" }
    }
  }
}`}
            />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
              2 · curl (agent dispatch)
            </div>
            <CopyableSnippet
              code={`curl -X POST https://sendero.travel/api/agent/dispatch \\
  -H "Authorization: Bearer ak_…" \\
  -H "Content-Type: application/json" \\
  -d '{"channel":"mcp","text":"search SFO→LHR May 8"}'`}
            />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
              3 · x402 / programmatic
            </div>
            <p className="mt-1">
              Use the key as a static bearer token on any x402-enabled tool call. The key identifies
              your workspace; metered charges settle against your workspace’s Arc wallet at your
              plan’s nanopayment discount rate.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
