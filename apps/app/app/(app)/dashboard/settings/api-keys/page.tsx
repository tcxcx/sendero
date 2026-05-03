'use client';

import { APIKeys } from '@clerk/nextjs';
import { ArrowUpRightIcon } from 'lucide-react';

import { senderoClerkAppearance } from '@sendero/ui/clerk-appearance';

export default function ApiKeysPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">API keys</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Authenticate external agents, MCP clients, and x402 runners against your workspace.
          </p>
        </div>
        <a
          href="https://docs.sendero.travel/api-keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)] opacity-70 transition-opacity hover:opacity-100"
        >
          Integration guide
          <ArrowUpRightIcon className="h-3 w-3" />
        </a>
      </div>

      <APIKeys appearance={senderoClerkAppearance} />
    </div>
  );
}
