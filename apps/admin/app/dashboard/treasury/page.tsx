import { redirect } from 'next/navigation';

import { requirePlatformRole } from '@/lib/access';

/**
 * Treasury landing — Phase 7.0 stub. **Superadmin only** at the
 * page-level guard; the layout already filtered the sidebar entry,
 * but middleware bypass via header (CVE-2025-29927) means we
 * re-check here. Defense-in-depth.
 *
 * Two cards, one per chain. Each card surfaces the multisig
 * provisioning state. Phase 7.4 wires Squads V4 (Solana). Phase 7.5
 * wires Circle Modular Wallets MSCA (Arc/EVM).
 */

export default async function TreasuryPage() {
  const guard = await requirePlatformRole(['superadmin']);
  if (!guard.ok) redirect('/unauthorized');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Treasury</h1>
        <p className="mt-1 text-sm text-[color:var(--color-muted-fg)]">
          Sendero's dual-chain multisig treasury. Provision, sign, execute.
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

      <p className="text-xs text-[color:var(--color-muted-fg)]">
        Phase 7.0 is auth + scaffold only. Multisig SDKs land in 7.4 (Solana) and
        7.5 (Arc). See <code>docs/specs/sendero-admin-app.md</code> for the
        rollout.
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
    <section className="rounded-lg border bg-[color:var(--color-bg)] p-5">
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-medium">{props.chain}</h2>
        <span className="text-xs uppercase tracking-wider text-[color:var(--color-muted-fg)]">
          {props.chainHint}
        </span>
      </header>
      <p className="text-sm text-[color:var(--color-muted-fg)]">
        {props.description}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-[color:var(--color-muted-fg)]">Standard</dt>
        <dd className="font-medium">{props.multisigStandard}</dd>
        <dt className="text-[color:var(--color-muted-fg)]">Status</dt>
        <dd className="font-medium">Not provisioned</dd>
        <dt className="text-[color:var(--color-muted-fg)]">Vault</dt>
        <dd className="text-[color:var(--color-muted-fg)]">—</dd>
        <dt className="text-[color:var(--color-muted-fg)]">Threshold</dt>
        <dd className="text-[color:var(--color-muted-fg)]">—</dd>
        <dt className="text-[color:var(--color-muted-fg)]">USDC balance</dt>
        <dd className="text-[color:var(--color-muted-fg)]">—</dd>
      </dl>

      <button
        type="button"
        disabled
        className="mt-5 w-full cursor-not-allowed rounded-md border bg-[color:var(--color-muted)] px-4 py-2 text-sm font-medium text-[color:var(--color-muted-fg)]"
        title={`Provision flow lands in Phase ${props.phase}`}
      >
        Provision (Phase {props.phase})
      </button>
    </section>
  );
}
