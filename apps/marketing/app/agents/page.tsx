import type { Metadata } from 'next';

import { Agents } from '@/components/agents/agents';

export const metadata: Metadata = {
  title: 'Agents — let agents run your travel ops · Sendero',
  description:
    'Sendero CLI and MCP server let AI agents search inventory, place holds, ticket bookings, settle on-chain in USDC, and audit every step. One npx, ~49 tools, any MCP client.',
  keywords: [
    'agent native cli',
    'travel ops automation for agents',
    'MCP travel agent',
    'Sendero CLI',
    'on-chain settlement',
    'usdc travel booking',
    'duffel agent',
  ],
  alternates: {
    canonical: 'https://sendero.travel/agents',
  },
  openGraph: {
    title: 'Agents · Sendero',
    description: 'Let AI agents run your travel ops.',
    type: 'website',
    url: 'https://sendero.travel/agents',
  },
};

export default function AgentsPage() {
  return <Agents />;
}
