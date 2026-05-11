import { redirect } from 'next/navigation';
import Link from 'next/link';

import { CheckCircle2, CircleDashed, ExternalLink, Landmark, ScanLine } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { requirePlatformRole } from '@/lib/access';
import { getArcTreasury } from '@/lib/treasury/provision-arc';
import { getSolanaTreasury } from '@/lib/treasury/provision-solana';
import { getTreasuryUsdcBalance, type TreasuryBalance } from '@/lib/treasury/treasury-balance';

import { ArcProposeForm } from './_components/arc-propose-form';
import { ArcProvisionForm } from './_components/arc-provision-form';
import { ProposalList } from './_components/proposal-list';
import { SolanaProposeForm } from './_components/solana-propose-form';
import { SolanaProvisionForm } from './_components/solana-provision-form';

/**
 * Treasury landing — superadmin-only by per-page guard. This page is
 * the operational onboarding surface for Sendero's platform treasury:
 * create the treasury, finish chain setup, then use the live
 * addresses as settlement destinations.
 */
export default async function TreasuryPage() {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) redirect('/unauthorized');

  const [sol, arc] = await Promise.all([getSolanaTreasury(), getArcTreasury()]);
  const arcReady = Boolean(arc?.status === 'live' && arc.multisigInstalledAt);
  const solReady = Boolean(sol?.status === 'live');

  // Fetch live USDC balances for any provisioned treasury so the
  // cards can render the "how much is held from sales" figure.
  // Fail-soft per helper — bad RPCs render "—" instead of a 500.
  const [arcBalance, solBalance] = await Promise.all([
    arc ? getTreasuryUsdcBalance(arc) : Promise.resolve(null),
    sol ? getTreasuryUsdcBalance(sol) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--color-muted-foreground)]">
            <Landmark className="h-4 w-4" />
            Treasury
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Settlement destinations</h1>
          <p className="max-w-2xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">
            Configure the governed addresses that receive Sendero platform funds.
          </p>
        </div>
        <Card className="shadow-none">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Routing</span>
              <StatusPill tone={arcReady || solReady ? 'success' : 'muted'}>
                {arcReady || solReady ? 'Live' : 'Setup'}
              </StatusPill>
            </div>
            <div className="space-y-2 text-xs text-[color:var(--color-muted-foreground)]">
              <RoutingLine
                label="Arc"
                value={arc?.status === 'live' ? arc.vaultAddress : 'Finish Arc setup'}
                ready={arc?.status === 'live'}
              />
              <RoutingLine
                label="Solana"
                value={sol?.status === 'live' ? sol.vaultAddress : 'Provision Solana vault'}
                ready={solReady}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sol ? <SolanaTreasuryCard treasury={sol} balance={solBalance} /> : <SolanaProvisionCard />}
        {arc ? <ArcTreasuryCard treasury={arc} balance={arcBalance} /> : <ArcProvisionCard />}
      </div>

      <Link
        href="/dashboard/contracts"
        className="inline-flex items-center gap-2 self-start rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-secondary)]/40 px-3 py-2 text-sm font-medium hover:bg-[color:var(--color-secondary)]"
      >
        <ScanLine className="h-4 w-4" />
        Audit deployed contracts
        <ExternalLink className="h-3.5 w-3.5 opacity-60" />
      </Link>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'success' | 'warning' | 'muted';
}) {
  const className =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
        : 'border-[color:var(--color-border)] bg-[color:var(--color-secondary)] text-[color:var(--color-secondary-foreground)]';
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function RoutingLine({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="grid grid-cols-[4rem_1fr] gap-2">
      <span className="font-medium text-[color:var(--color-foreground)]">{label}</span>
      <span className={ready ? 'break-all font-mono' : ''}>{value}</span>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[color:var(--color-muted-foreground)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function UsdcBalanceValue({ balance }: { balance: TreasuryBalance | null }) {
  if (!balance) {
    return <span className="text-[color:var(--color-muted-foreground)]">—</span>;
  }
  if (balance.status === 'error') {
    return (
      <span
        className="text-[color:var(--color-muted-foreground)]"
        title={balance.error ?? 'RPC read failed'}
      >
        — <span className="text-[10px]">read failed</span>
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {balance.formatted}{' '}
      <span className="text-xs text-[color:var(--color-muted-foreground)]">USDC</span>
      {balance.status === 'uninitialized' ? (
        <span className="ml-1 text-[10px] text-[color:var(--color-muted-foreground)]">
          · token account not yet initialized
        </span>
      ) : null}
    </span>
  );
}

function TxRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-md border bg-[color:var(--color-muted)] px-3 py-2 text-[11px]">
      <span className="font-medium text-[color:var(--color-muted-foreground)]">{label}: </span>
      <span className="break-all font-mono">{value}</span>
    </div>
  );
}

function SetupStep({ done, title }: { done: boolean; title: string }) {
  const Icon = done ? CheckCircle2 : CircleDashed;
  return (
    <div className="flex items-center gap-2">
      <Icon
        className={`h-3.5 w-3.5 ${done ? 'text-emerald-600' : 'text-[color:var(--color-muted-foreground)]'}`}
      />
      <span className="text-xs text-[color:var(--color-muted-foreground)]">{title}</span>
    </div>
  );
}

// Solana — provisioned

function SolanaTreasuryCard({
  treasury,
  balance,
}: {
  treasury: NonNullable<Awaited<ReturnType<typeof getSolanaTreasury>>>;
  balance: TreasuryBalance | null;
}) {
  const members = Array.isArray(treasury.members) ? (treasury.members as string[]) : [];
  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Solana</CardTitle>
          <span className="rounded-full bg-[color:var(--color-secondary)] px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
            {treasury.network}
          </span>
        </div>
        <CardDescription>Solana-side settlement vault.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <DetailRow label="Status">
            <StatusPill tone={treasury.status === 'live' ? 'success' : 'warning'}>
              {treasury.status === 'live' ? 'Ready for settlement' : treasury.status}
            </StatusPill>
          </DetailRow>
          <DetailRow label="USDC balance">
            <UsdcBalanceValue balance={balance} />
          </DetailRow>
          <DetailRow label="Treasury vault">
            <span className="break-all font-mono text-xs">{treasury.vaultAddress}</span>
          </DetailRow>
          <DetailRow label="Governance">
            <span className="break-all font-mono text-xs">{treasury.multisigAddress}</span>
          </DetailRow>
          <DetailRow label="Approvals">
            {treasury.threshold} of {members.length} approvers
          </DetailRow>
        </dl>
        {treasury.provisioningTxRef ? (
          <div className="text-xs">
            <a
              href={`https://explorer.solana.com/tx/${treasury.provisioningTxRef}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View provisioning tx →
            </a>
          </div>
        ) : null}

        <Separator />
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Proposals</h3>
          <ProposalList
            treasuryId={treasury.id}
            multisigAddress={treasury.multisigAddress}
            threshold={treasury.threshold}
            members={members}
            chain="sol"
          />
        </div>

        <SolanaProposeForm treasuryId={treasury.id} />
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 p-5 pt-0">
        <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
          Connected-wallet approval and execution are available for Solana treasury proposals.
        </p>
      </CardFooter>
    </Card>
  );
}

// Solana — not yet provisioned

function SolanaProvisionCard() {
  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Solana</CardTitle>
          <span className="text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            SOL-DEV
          </span>
        </div>
        <CardDescription>Create the settlement vault.</CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <SolanaProvisionForm />
      </CardContent>
    </Card>
  );
}

// Arc — provisioned

function ArcTreasuryCard({
  treasury,
  balance,
}: {
  treasury: NonNullable<Awaited<ReturnType<typeof getArcTreasury>>>;
  balance: TreasuryBalance | null;
}) {
  const members = Array.isArray(treasury.members) ? (treasury.members as string[]) : [];
  const isIntent = treasury.status === 'intent';
  const isPending = treasury.status === 'pending';
  const isLive = treasury.status === 'live';
  const multisigInstalled = Boolean(treasury.multisigInstalledAt);
  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Arc</CardTitle>
          <span className="rounded-full bg-[color:var(--color-secondary)] px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
            {treasury.network}
          </span>
        </div>
        <CardDescription>Arc platform settlement account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-5 pt-0">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <DetailRow label="Status">
            <StatusPill
              tone={
                isLive && multisigInstalled ? 'success' : isLive || isPending ? 'warning' : 'muted'
              }
            >
              {isIntent
                ? 'Reserved'
                : isPending
                  ? 'Address ready'
                  : isLive && multisigInstalled
                    ? 'Ready for settlement'
                    : 'Deploy complete'}
            </StatusPill>
          </DetailRow>
          <DetailRow label={isIntent ? 'Reserved address' : 'Treasury address'}>
            <span className="break-all font-mono text-xs">{treasury.multisigAddress}</span>
          </DetailRow>
          {isLive ? (
            <DetailRow label="USDC balance">
              <UsdcBalanceValue balance={balance} />
            </DetailRow>
          ) : null}
          <DetailRow label="Approvals">
            {treasury.threshold} of {members.length} approvers
          </DetailRow>
        </dl>
        <div className="grid gap-2 rounded-md border bg-[color:var(--color-muted)] p-3 sm:grid-cols-3">
          <SetupStep done={!isIntent} title="Address" />
          <SetupStep done={isLive} title="Activated" />
          <SetupStep done={multisigInstalled} title="Policy" />
        </div>
        {isIntent ? (
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            The treasury is reserved. Continue to generate the real Arc address that will receive
            platform settlement.
          </p>
        ) : null}
        {isPending ? (
          <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
            The Arc treasury address is ready. Deploy it next so settlement can route funds to this
            address.
          </p>
        ) : null}
        {isLive ? (
          <>
            <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
              {!multisigInstalled
                ? 'The Arc treasury is deployed. Install the approval policy so approvers control treasury operations.'
                : `Approval policy is installed for ${members.length} approver(s) at threshold ${treasury.threshold}. Circle recovery signer kept as a backup.`}
            </p>
            <TxRow label="Deploy" value={treasury.provisioningTxRef} />
            <TxRow label="Install policy" value={treasury.multisigInstallTxRef} />
          </>
        ) : null}
        {isLive && multisigInstalled ? (
          <>
            <Separator />
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Proposals</h3>
              <ProposalList
                treasuryId={treasury.id}
                multisigAddress={treasury.multisigAddress}
                threshold={treasury.threshold}
                members={members}
                chain="arc"
              />
            </div>
            <ArcProposeForm treasuryId={treasury.id} />
          </>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 p-5 pt-0">
        {/*
         * Lifecycle runs end-to-end from `ArcProvisionForm` — operator
         * clicks one "Create Arc treasury" button and the form chains:
         *   provision → derive → deploy → install. The Circle bootstrap
         * EOA stays as a weight=1 recovery owner; that's a Circle
         * modular-wallet contract behavior, not a finishing step.
         *
         * Approve/Reject/Execute UI for Arc proposals ships next —
         * needs MetaMask signing + bundler userOp submit. Until then
         * the propose form persists callData for the eventual signer.
         */}
        <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
          Connected-wallet approval and execution land next for Arc proposals.
        </p>
      </CardFooter>
    </Card>
  );
}

// Arc — not yet provisioned

function ArcProvisionCard() {
  return (
    <Card>
      <CardHeader className="p-5 pb-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Arc</CardTitle>
          <span className="text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            ARC-TESTNET
          </span>
        </div>
        <CardDescription>Create the platform settlement account.</CardDescription>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <ArcProvisionForm />
      </CardContent>
    </Card>
  );
}
