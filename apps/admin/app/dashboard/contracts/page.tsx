import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Activity, ExternalLink, ScanLine } from 'lucide-react';

import { BlockchainIcon } from '@sendero/icons';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { auditArcContract } from '@/lib/contracts/audit-arc';
import { auditSolanaProgram } from '@/lib/contracts/audit-solana';
import {
  CONTRACTS_REGISTRY,
  explorerUrlFor,
  type ArcContractEntry,
  type SolanaContractEntry,
} from '@/lib/contracts/registry';
import { requirePlatformRole } from '@/lib/access';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Superadmin contract management surface.
 *
 * Tabbed by chain. Solana is the DEFAULT tab — Sendero is going
 * Solana-first, so that's what superadmin sees on landing.
 * URL-driven (`?chain=sol|arc`).
 *
 * Solana tab splits programs into:
 *   - Sendero-owned (sendero_guest_escrow, agentic_commerce) — full
 *     authority-drift check.
 *   - External (Metaplex Core, Metaplex Agent Registry) — Solana
 *     equivalents of ERC-8004's Identity / Reputation / Validation
 *     registries (consolidated on Solana into one Agent Registry
 *     program + an MPL Core asset).
 *
 * Live reads on every load — Next caching disabled per route.
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams?: Promise<{ chain?: string }>;
}) {
  const access = await requirePlatformRole(['superadmin', 'eng']);
  if (!access.ok) redirect('/unauthorized');

  const params = (await searchParams) ?? {};
  const activeChain: 'arc' | 'sol' = params.chain === 'arc' ? 'arc' : 'sol';

  const arcEntries = CONTRACTS_REGISTRY.filter((e): e is ArcContractEntry => e.chain === 'arc');
  const solSenderoEntries = CONTRACTS_REGISTRY.filter(
    (e): e is SolanaContractEntry => e.chain === 'sol' && e.ownership === 'sendero'
  );
  const solExternalEntries = CONTRACTS_REGISTRY.filter(
    (e): e is SolanaContractEntry => e.chain === 'sol' && e.ownership === 'external'
  );

  const [arcRows, solSenderoRows, solExternalRows] = await Promise.all([
    Promise.all(arcEntries.map(auditArcContract)),
    Promise.all(solSenderoEntries.map(auditSolanaProgram)),
    Promise.all(solExternalEntries.map(auditSolanaProgram)),
  ]);

  const arc = arcEntries.map((entry, i) => ({ entry, audit: arcRows[i] }));
  const solSendero = solSenderoEntries.map((entry, i) => ({ entry, audit: solSenderoRows[i] }));
  const solExternal = solExternalEntries.map((entry, i) => ({
    entry,
    audit: solExternalRows[i],
  }));

  const arcStats = audit(arc);
  const solStats = audit([...solSendero, ...solExternal]);
  const total = arc.length + solSendero.length + solExternal.length;
  const passing = arcStats.pass + solStats.pass;
  const failing = arcStats.fail + solStats.fail;
  const unknown = arcStats.unknown + solStats.unknown;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--color-muted-foreground)]">
            <ScanLine className="h-4 w-4" />
            Contracts
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Deployments</h1>
          <p className="max-w-2xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            Every Sendero contract + Anchor program a superadmin manages, plus the external Metaplex
            programs Solana-primary tenants depend on. Verification is live-polled on every page
            load.
          </p>
        </div>
        <Card className="shadow-none">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Verification</span>
              <StatusPill tone={failing === 0 && unknown === 0 ? 'success' : 'warning'}>
                {passing} / {total} live
              </StatusPill>
            </div>
            <div className="space-y-1 text-xs text-[color:var(--color-muted-foreground)]">
              <SummaryLine label="Pass" value={passing} tone="success" />
              {failing > 0 ? <SummaryLine label="Fail" value={failing} tone="fail" /> : null}
              {unknown > 0 ? <SummaryLine label="Unknown" value={unknown} tone="muted" /> : null}
            </div>
            <Separator />
            <form action="/dashboard/contracts">
              <Button variant="outline" size="sm" type="submit" className="w-full gap-2">
                <Activity className="h-3.5 w-3.5" />
                Refresh audit
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <ChainTabs
        active={activeChain}
        solCount={solSendero.length + solExternal.length}
        arcCount={arc.length}
        solPassing={solStats.pass}
        arcPassing={arcStats.pass}
      />

      {activeChain === 'sol' ? (
        <>
          <SectionCard
            icon={<BlockchainIcon chain="Sol" size={20} variant="branded" />}
            title="Sendero programs"
            count={solSendero.length}
            description="Anchor programs Sendero owns. Audit confirms BPF Loader Upgradeable ownership and authority drift — the #1 unauthorized re-deploy signal."
          >
            {solSendero.map(row => (
              <SolanaRow key={row.entry.address} row={row} />
            ))}
          </SectionCard>

          <SectionCard
            icon={<BlockchainIcon chain="Sol" size={20} variant="branded" />}
            title="Metaplex programs"
            count={solExternal.length}
            description="External Metaplex programs Sendero integrates against. NFT minting (Core), and the Solana equivalent of ERC-8004's Identity / Reputation / Validation registries (Agent Registry consolidates the three on Solana)."
          >
            {solExternal.map(row => (
              <SolanaRow key={row.entry.address} row={row} />
            ))}
          </SectionCard>
        </>
      ) : (
        <SectionCard
          icon={<BlockchainIcon chain="Arc_Testnet" size={20} variant="branded" />}
          title="Arc — testnet"
          count={arc.length}
          description="EVM contracts on Arc Testnet. Verification audited via Arcscan API; full source for Sendero contracts, EIP-1167 auto-detect for Circle SCP minimal proxies."
        >
          {arc.map(row => (
            <ArcRow key={row.entry.address} row={row} />
          ))}
        </SectionCard>
      )}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  count,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/40">
            {icon}
          </span>
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {title}
              <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-secondary)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--color-muted-foreground)]">
                {count}
              </span>
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function audit(rows: Array<{ audit: { status: string } }>) {
  return {
    pass: rows.filter(r => r.audit.status === 'pass').length,
    fail: rows.filter(r => r.audit.status === 'fail').length,
    unknown: rows.filter(r => r.audit.status === 'unknown').length,
  };
}

function ChainTabs(props: {
  active: 'arc' | 'sol';
  solCount: number;
  arcCount: number;
  solPassing: number;
  arcPassing: number;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-[color:var(--color-border)]">
      <ChainTab
        href="/dashboard/contracts?chain=sol"
        active={props.active === 'sol'}
        label="Solana"
        sublabel={`${props.solPassing}/${props.solCount} live`}
        icon={<BlockchainIcon chain="Sol" size={18} variant="branded" />}
      />
      <ChainTab
        href="/dashboard/contracts?chain=arc"
        active={props.active === 'arc'}
        label="Arc"
        sublabel={`${props.arcPassing}/${props.arcCount} live`}
        icon={<BlockchainIcon chain="Arc_Testnet" size={18} variant="branded" />}
      />
    </div>
  );
}

function ChainTab({
  href,
  active,
  label,
  sublabel,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group relative inline-flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
        active
          ? 'text-[color:var(--color-foreground)]'
          : 'text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]'
      }`}
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-md border transition ${
          active
            ? 'border-[color:var(--color-primary)]/30 bg-[color:var(--color-primary)]/10'
            : 'border-[color:var(--color-border)] bg-transparent group-hover:border-[color:var(--color-primary)]/20'
        }`}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-0.5 leading-tight">
        <span className="font-semibold">{label}</span>
        <span className="text-[10px] uppercase tracking-wide">{sublabel}</span>
      </span>
      {active ? (
        <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-[color:var(--color-primary)]" />
      ) : null}
    </Link>
  );
}

function ArcRow({
  row,
}: {
  row: { entry: ArcContractEntry; audit: Awaited<ReturnType<typeof auditArcContract>> };
}) {
  const { entry, audit } = row;
  const tone = audit.status === 'pass' ? 'success' : audit.status === 'fail' ? 'fail' : 'muted';
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{entry.label}</span>
            <StatusPill tone={tone}>{audit.status}</StatusPill>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
              {entry.expect}
            </span>
          </div>
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {entry.role}
          </p>
        </div>
        <Link
          href={explorerUrlFor(entry)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
        >
          Arcscan
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        <DetailLine label="Address" value={entry.address} mono />
        {entry.implAddress ? <DetailLine label="Impl" value={entry.implAddress} mono /> : null}
        {audit.name ? <DetailLine label="Name" value={audit.name} /> : null}
        {audit.compiler ? <DetailLine label="Compiler" value={audit.compiler} /> : null}
        {audit.proxyType ? <DetailLine label="Proxy" value={audit.proxyType} /> : null}
        <DetailLine label="Network" value={entry.network} />
      </div>
      <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
        {audit.reason}
      </p>
    </div>
  );
}

function SolanaRow({
  row,
}: {
  row: { entry: SolanaContractEntry; audit: Awaited<ReturnType<typeof auditSolanaProgram>> };
}) {
  const { entry, audit } = row;
  const tone = audit.status === 'pass' ? 'success' : audit.status === 'fail' ? 'fail' : 'muted';
  return (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{entry.label}</span>
            <StatusPill tone={tone}>{audit.status}</StatusPill>
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
              {entry.ownership}
            </span>
          </div>
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            {entry.role}
          </p>
        </div>
        <Link
          href={explorerUrlFor(entry)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
        >
          Solana Explorer
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        <DetailLine label="Program ID" value={entry.address} mono />
        {audit.programData ? (
          <DetailLine label="ProgramData" value={audit.programData} mono />
        ) : null}
        {audit.authority ? <DetailLine label="Authority" value={audit.authority} mono /> : null}
        {audit.lastSlot != null ? (
          <DetailLine label="Last slot" value={String(audit.lastSlot)} />
        ) : null}
        {audit.dataLength != null ? (
          <DetailLine label="Bytecode" value={`${audit.dataLength.toLocaleString()} B`} />
        ) : null}
        <DetailLine label="Network" value={entry.network} />
      </div>
      <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
        {audit.reason}
      </p>
    </div>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <span className="text-[color:var(--color-muted-foreground)]">{label}</span>
      <span className={mono ? 'break-all font-mono' : ''}>{value}</span>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'fail' | 'muted';
}) {
  const dot =
    tone === 'success'
      ? 'bg-emerald-500'
      : tone === 'fail'
        ? 'bg-rose-500'
        : 'bg-[color:var(--color-muted-foreground)]';
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      <span>
        {value} {label}
      </span>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'success' | 'warning' | 'fail' | 'muted';
}) {
  const className =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : tone === 'fail'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : tone === 'warning'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-[color:var(--color-border)] bg-[color:var(--color-secondary)] text-[color:var(--color-secondary-foreground)]';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}
