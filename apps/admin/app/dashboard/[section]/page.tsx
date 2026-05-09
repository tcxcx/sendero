import { notFound } from 'next/navigation';

import { ComingSoon } from '@/components/coming-soon';

const SECTIONS: Record<string, { title: string; description: string; items: string[] }> = {
  contracts: {
    title: 'Contracts',
    description:
      'Internal contract review, signed rail configuration, and policy approvals will live here.',
    items: ['Treasury proposal review', 'Policy guard diffs', 'Contract artifact audit trail'],
  },
  payouts: {
    title: 'Payouts',
    description:
      'Finance operations for tenant payouts, settlement exceptions, and payee reconciliation.',
    items: ['Settlement queue', 'Tenant payout status', 'Supplier payee exceptions'],
  },
  billing: {
    title: 'Billing',
    description:
      'SaaS MRR, included usage, usage blocks, overages, and tool ledger rollups by tenant.',
    items: ['MRR by vertical', 'Tool usage by tenant', 'Overage invoice preparation'],
  },
  pipeline: {
    title: 'Pipeline',
    description:
      'Sales and onboarding workflow for new vertical agents, businesses, and launch tenants.',
    items: ['Vertical agent pipeline', 'Implementation stages', 'Launch readiness checks'],
  },
  tenants: {
    title: 'Tenant Command Center',
    description:
      'Support and operations hub for tenant channel health, active trips, and customer handoffs.',
    items: ['Slack + WhatsApp routing', 'Active support handoffs', 'Tenant health timeline'],
  },
  agents: {
    title: 'Agents',
    description:
      'Manage vertical AI agent capabilities, tool bundles, channel behavior, and release status.',
    items: ['Tool registry by vertical', 'Model and plan gates', 'Release health by agent'],
  },
  health: {
    title: 'Health',
    description:
      'Platform health, channel delivery, webhook integrity, and payment rail observability.',
    items: ['Notification dispatch checks', 'WhatsApp audit trail', 'Gateway settlement health'],
  },
};

export default async function AdminSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const config = SECTIONS[section];
  if (!config) notFound();
  return <ComingSoon {...config} />;
}
