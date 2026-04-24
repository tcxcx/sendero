import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';

export default function McpIntegrationsPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader
        title="MCP & LLM tools"
        description="Expose the same journey engine, policy, and booking tools to other models via the machine-readable manifest."
      />
      <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
        <li>
          <Link
            className="font-medium text-foreground underline underline-offset-2"
            href="/llms.txt"
            target="_blank"
          >
            llms.txt
          </Link>{' '}
          — capability manifest for clients and tools.
        </li>
        <li>
          Use the agent console to verify end-to-end behavior before giving an LLM production keys.
        </li>
      </ul>
      <Link
        className="text-sm font-medium text-primary underline underline-offset-2"
        href="/dashboard/console"
      >
        Open agent console
      </Link>
    </div>
  );
}
