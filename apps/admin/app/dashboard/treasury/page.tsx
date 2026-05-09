import { redirect } from 'next/navigation';

import { CheckCircle2, CircleDashed, Landmark } from 'lucide-react';

import { Button } from '@/components/ui/button';
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

import { ArcDeployButton } from './_components/arc-deploy-button';
import { ArcDeriveButton } from './_components/arc-derive-button';
import { ArcInstallMultisigButton } from './_components/arc-install-multisig-button';
import { ArcProvisionForm } from './_components/arc-provision-form';
import { ArcRemovePlatformButton } from './_components/arc-remove-platform-button';
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
  const arcReady = Boolean(arc?.status === 'live' && arc.platformOwnerRemovedAt);
  const solReady = Boolean(sol?.status === 'live');

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
        {sol ? <SolanaTreasuryCard treasury={sol} /> : <SolanaProvisionCard />}
        {arc ? <ArcTreasuryCard treasury={arc} /> : <ArcProvisionCard />}
      </div>
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
}: {
  treasury: NonNullable<Awaited<ReturnType<typeof getSolanaTreasury>>>;
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
}: {
  treasury: NonNullable<Awaited<ReturnType<typeof getArcTreasury>>>;
}) {
  const members = Array.isArray(treasury.members) ? (treasury.members as string[]) : [];
  const isIntent = treasury.status === 'intent';
  const isPending = treasury.status === 'pending';
  const isLive = treasury.status === 'live';
  const multisigInstalled = Boolean(treasury.multisigInstalledAt);
  const platformOwnerRemoved = Boolean(treasury.platformOwnerRemovedAt);
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
                isLive && platformOwnerRemoved
                  ? 'success'
                  : isLive || isPending
                    ? 'warning'
                    : 'muted'
              }
            >
              {isIntent
                ? 'Reserved'
                : isPending
                  ? 'Address ready'
                  : isLive && platformOwnerRemoved
                    ? 'Ready for settlement'
                    : isLive && multisigInstalled
                      ? 'Recovery signer active'
                      : 'Deploy complete'}
            </StatusPill>
          </DetailRow>
          <DetailRow label={isIntent ? 'Reserved address' : 'Treasury address'}>
            <span className="break-all font-mono text-xs">{treasury.multisigAddress}</span>
          </DetailRow>
          <DetailRow label="Approvals">
            {treasury.threshold} of {members.length} approvers
          </DetailRow>
        </dl>
        <div className="grid gap-2 rounded-md border bg-[color:var(--color-muted)] p-3 sm:grid-cols-2">
          <SetupStep done={!isIntent} title="Address" />
          <SetupStep done={isLive} title="Activated" />
          <SetupStep done={multisigInstalled} title="Policy" />
          <SetupStep done={platformOwnerRemoved} title="Self-custody" />
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
                : platformOwnerRemoved
                  ? `Arc treasury is in full self-custody with ${members.length} approver(s) at threshold ${treasury.threshold}.`
                  : `Approval policy is installed for ${members.length} approver(s) at threshold ${treasury.threshold}. Remove the recovery signer when the team is ready for full self-custody.`}
            </p>
            <TxRow label="Deploy" value={treasury.provisioningTxRef} />
            <TxRow label="Install policy" value={treasury.multisigInstallTxRef} />
            <TxRow label="Self-custody" value={treasury.platformOwnerRemovalTxRef} />
          </>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 p-5 pt-0">
        {isIntent ? (
          <ArcDeriveButton treasuryId={treasury.id} status={treasury.status} />
        ) : isPending ? (
          <ArcDeployButton treasuryId={treasury.id} status={treasury.status} />
        ) : isLive && !multisigInstalled ? (
          <ArcInstallMultisigButton treasuryId={treasury.id} alreadyInstalled={multisigInstalled} />
        ) : isLive && multisigInstalled && !platformOwnerRemoved ? (
          <div className="flex flex-col gap-2 w-full">
            <ArcRemovePlatformButton
              treasuryId={treasury.id}
              alreadyRemoved={platformOwnerRemoved}
            />
            <Button variant="outline" disabled className="w-full" title="Coming next">
              Sign and execute proposals
            </Button>
          </div>
        ) : (
          <Button variant="outline" disabled className="w-full" title="Coming next">
            Sign and execute proposals
          </Button>
        )}
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
