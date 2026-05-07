import { redirect } from 'next/navigation';

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
import { ArcProvisionForm } from './_components/arc-provision-form';
import { SolanaProvisionForm } from './_components/solana-provision-form';

/**
 * Treasury landing — superadmin-only by per-page guard. Two cards,
 * one per chain. Phase 7.4 wired Solana (live, Squads V4); Phase 7.5
 * wires Arc in **intent mode** (form + persistence; on-chain deploy
 * lands in 7.5.x).
 */
export default async function TreasuryPage() {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) redirect('/unauthorized');

  const [sol, arc] = await Promise.all([getSolanaTreasury(), getArcTreasury()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Treasury</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
          Sendero&apos;s dual-chain multisig treasury. Provision, sign, execute.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sol ? <SolanaTreasuryCard treasury={sol} /> : <SolanaProvisionCard />}
        {arc ? <ArcTreasuryCard treasury={arc} /> : <ArcProvisionCard />}
      </div>

      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        Phase 7.4 ships live Solana provisioning (Squads V4 on devnet). Phase 7.5
        ships Arc in <strong>intent mode</strong> via{' '}
        <code>@sendero/multisig</code>; on-chain Circle MSCA deploy lands in 7.5.x
        (counterfactual address + Gas Station paymaster + bundler glue). See{' '}
        <code>docs/specs/sendero-admin-app.md</code>.
      </p>
    </div>
  );
}

// ──────────────────── Solana — provisioned ────────────────────

function SolanaTreasuryCard({
  treasury,
}: {
  treasury: NonNullable<Awaited<ReturnType<typeof getSolanaTreasury>>>;
}) {
  const members = Array.isArray(treasury.members) ? (treasury.members as string[]) : [];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle>Solana</CardTitle>
          <span className="rounded-full bg-[color:var(--color-secondary)] px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
            {treasury.network}
          </span>
        </div>
        <CardDescription>
          Squads V4 multisig vault. Owns Anchor program upgrade authority + Sendero Solana treasury
          USDC.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-[color:var(--color-muted-foreground)]">Status</dt>
          <dd className="font-medium uppercase tracking-wide">{treasury.status}</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Multisig</dt>
          <dd className="break-all font-mono text-xs">{treasury.multisigAddress}</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Vault</dt>
          <dd className="break-all font-mono text-xs">{treasury.vaultAddress}</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Threshold</dt>
          <dd className="font-medium">
            {treasury.threshold} of {members.length} signers
          </dd>
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
      </CardContent>
      <CardFooter>
        <Button variant="outline" disabled className="w-full" title="Phase 7.6">
          Sign / Execute proposals (Phase 7.6)
        </Button>
      </CardFooter>
    </Card>
  );
}

// ──────────────────── Solana — not yet provisioned ────────────────────

function SolanaProvisionCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle>Solana</CardTitle>
          <span className="text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            SOL-DEV
          </span>
        </div>
        <CardDescription>
          Provision a Squads V4 multisig vault. Will own Anchor program upgrade authority + Sendero
          Solana treasury USDC + agent NFT custody.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SolanaProvisionForm />
      </CardContent>
    </Card>
  );
}

// ──────────────────── Arc — provisioned (intent or live) ────────────────────

function ArcTreasuryCard({
  treasury,
}: {
  treasury: NonNullable<Awaited<ReturnType<typeof getArcTreasury>>>;
}) {
  const members = Array.isArray(treasury.members) ? (treasury.members as string[]) : [];
  const isIntent = treasury.status === 'intent';
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle>Arc</CardTitle>
          <span className="rounded-full bg-[color:var(--color-secondary)] px-2 py-0.5 text-xs font-medium uppercase tracking-wider">
            {treasury.network}
          </span>
        </div>
        <CardDescription>
          Circle MSCA weighted multisig. Will own SenderoGuestEscrow +
          AgenticCommerce upgrade roles + Arc treasury USDC + Sendero canonical
          agent NFT.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-[color:var(--color-muted-foreground)]">Status</dt>
          <dd className="font-medium uppercase tracking-wide">{treasury.status}</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">
            {isIntent ? 'Placeholder' : 'MSCA'}
          </dt>
          <dd className="break-all font-mono text-xs">{treasury.multisigAddress}</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Threshold</dt>
          <dd className="font-medium">
            {treasury.threshold} of {members.length} signers
          </dd>
        </dl>
        {isIntent ? (
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            Intent reserved. On-chain MSCA deploy + Circle Gas Station paymaster
            wiring lands in Phase 7.5.x.
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          disabled
          className="w-full"
          title={isIntent ? 'Phase 7.5.x' : 'Phase 7.6'}
        >
          {isIntent
            ? 'Deploy on-chain (Phase 7.5.x)'
            : 'Sign / Execute proposals (Phase 7.6)'}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ──────────────────── Arc — not yet provisioned ────────────────────

function ArcProvisionCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle>Arc</CardTitle>
          <span className="text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            ARC-TESTNET
          </span>
        </div>
        <CardDescription>
          Reserve a Circle MSCA weighted multisig intent. Will own
          SenderoGuestEscrow + AgenticCommerce upgrade roles + Arc treasury USDC
          + Sendero canonical agent NFT once deployed (Phase 7.5.x).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ArcProvisionForm />
      </CardContent>
    </Card>
  );
}
