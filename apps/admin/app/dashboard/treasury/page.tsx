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
import { getSolanaTreasury } from '@/lib/treasury/provision-solana';
import { SolanaProvisionForm } from './_components/solana-provision-form';

/**
 * Treasury landing — superadmin-only by per-page guard. Two cards,
 * one per chain. Solana card is wired in Phase 7.4 (this turn).
 * Arc card stays disabled until Phase 7.5 wires Circle MSCA via the
 * existing `@sendero/multisig` package.
 */
export default async function TreasuryPage() {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) redirect('/unauthorized');

  // Read live Solana treasury (or null if not yet provisioned).
  const sol = await getSolanaTreasury();

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
        <ArcTreasuryCard />
      </div>

      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        Phase 7.4 ships Solana provisioning (Squads V4 on devnet). Arc lands in
        7.5 via <code>@sendero/multisig</code> + Circle MSCA. See{' '}
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
          Squads V4 multisig vault. Owns Anchor program upgrade authority +
          Sendero Solana treasury USDC.
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
          Provision a Squads V4 multisig vault. Will own Anchor program upgrade
          authority + Sendero Solana treasury USDC + agent NFT custody.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SolanaProvisionForm />
      </CardContent>
    </Card>
  );
}

// ──────────────────── Arc — Phase 7.5 placeholder ────────────────────

function ArcTreasuryCard() {
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
          Circle Modular Wallets MSCA (weighted multisig). Will own
          SenderoGuestEscrow + AgenticCommerce upgrade roles + Arc treasury USDC
          + Sendero canonical agent NFT.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-[color:var(--color-muted-foreground)]">Standard</dt>
          <dd className="font-medium">Circle MSCA</dd>
          <Separator className="col-span-2" />
          <dt className="text-[color:var(--color-muted-foreground)]">Status</dt>
          <dd className="font-medium">Not provisioned</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Vault</dt>
          <dd className="text-[color:var(--color-muted-foreground)]">—</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Threshold</dt>
          <dd className="text-[color:var(--color-muted-foreground)]">—</dd>
        </dl>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          disabled
          className="w-full"
          title="Provision flow lands in Phase 7.5"
        >
          Provision (Phase 7.5)
        </Button>
      </CardFooter>
    </Card>
  );
}
