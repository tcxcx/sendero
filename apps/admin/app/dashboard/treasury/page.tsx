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

/**
 * Treasury landing — superadmin-only by per-page guard. Two cards,
 * one per chain. Each surfaces the multisig provisioning state.
 * Phase 7.4 wires Squads V4 (Solana). Phase 7.5 wires Circle Modular
 * Wallets MSCA (Arc/EVM).
 */
export default async function TreasuryPage() {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) redirect('/unauthorized');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Treasury</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted-foreground)]">
          Sendero&apos;s dual-chain multisig treasury. Provision, sign, execute.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TreasuryCard
          chain="Solana"
          chainHint="SOL-DEV"
          multisigStandard="Squads V4"
          phase="7.4"
          description="Owns Anchor program upgrade authority + Sendero Solana treasury USDC + agent NFT custody."
        />
        <TreasuryCard
          chain="Arc"
          chainHint="ARC-TESTNET"
          multisigStandard="Circle Modular Wallets MSCA"
          phase="7.5"
          description="Owns SenderoGuestEscrow + AgenticCommerce upgrade roles + Arc treasury USDC + Sendero canonical agent NFT."
        />
      </div>

      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        Phase 7.0 is auth + scaffold only. Multisig SDKs land in 7.4 (Solana) and
        7.5 (Arc). See <code>docs/specs/sendero-admin-app.md</code> for the rollout.
      </p>
    </div>
  );
}

function TreasuryCard(props: {
  chain: string;
  chainHint: string;
  multisigStandard: string;
  phase: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between">
          <CardTitle>{props.chain}</CardTitle>
          <span className="text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            {props.chainHint}
          </span>
        </div>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-[color:var(--color-muted-foreground)]">Standard</dt>
          <dd className="font-medium">{props.multisigStandard}</dd>
          <Separator className="col-span-2" />
          <dt className="text-[color:var(--color-muted-foreground)]">Status</dt>
          <dd className="font-medium">Not provisioned</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Vault</dt>
          <dd className="text-[color:var(--color-muted-foreground)]">—</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">Threshold</dt>
          <dd className="text-[color:var(--color-muted-foreground)]">—</dd>
          <dt className="text-[color:var(--color-muted-foreground)]">USDC balance</dt>
          <dd className="text-[color:var(--color-muted-foreground)]">—</dd>
        </dl>
      </CardContent>
      <CardFooter>
        <Button
          variant="outline"
          disabled
          className="w-full"
          title={`Provision flow lands in Phase ${props.phase}`}
        >
          Provision (Phase {props.phase})
        </Button>
      </CardFooter>
    </Card>
  );
}
