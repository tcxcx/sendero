'use client';

import * as React from 'react';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { deployArcMscaUserOp } from '@/lib/treasury/deploy-arc-msca-userop';
import { deriveArcMscaCounterfactual } from '@/lib/treasury/deploy-arc-msca';
import { installArcMultisig } from '@/lib/treasury/install-arc-multisig';
import { provisionArcMultisigIntent } from '@/lib/treasury/provision-arc';

import { ApproverAddressFields } from './approver-address-fields';

// The Circle bootstrap EOA (platform recovery signer) stays as a
// weight=1 owner. Circle's modular-wallet stack keeps it there for
// recovery + plugin-config flows — removing it would forfeit those
// affordances and the on-chain `updateMultisigWeights` call reverts
// without surfacing a reason. Trust the default.
type Stage = 'idle' | 'reserving' | 'deriving' | 'deploying' | 'installing' | 'done';

const STAGE_LABEL: Record<Stage, string> = {
  idle: 'Create Arc treasury',
  reserving: 'Reserving address…',
  deriving: 'Deriving counterfactual…',
  deploying: 'Deploying on-chain…',
  installing: 'Installing approval policy…',
  done: 'Live',
};

/**
 * Arc treasury onboarding form.
 *
 * Single-button flow: submit chains all 5 server actions
 *   provision intent → derive counterfactual → deploy MSCA →
 *   install approval policy → remove platform owner
 * so the operator clicks once and gets a fully self-custodied treasury.
 * Each stage label flashes in the submit button while it runs.
 *
 * Mid-flight failures stop the chain at the failing stage and surface
 * the error. Re-submitting picks up from wherever the row's status sits
 * (each server action is idempotent for already-completed states).
 */
export function ArcProvisionForm() {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>('idle');
  const [addressesValid, setAddressesValid] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pending = stage !== 'idle' && stage !== 'done';

  async function handleSubmit(formData: FormData) {
    if (!addressesValid) return;
    setError(null);
    setStage('reserving');
    const memberAddresses = formData
      .getAll('memberAddresses')
      .map(value => String(value).trim())
      .filter(Boolean);
    const threshold = Number(formData.get('threshold') ?? 1);

    const reserved = await provisionArcMultisigIntent({ memberAddresses, threshold });
    if (!reserved.ok) {
      setError(`Reserve failed: ${reserved.error}`);
      setStage('idle');
      return;
    }
    const treasuryId = reserved.treasuryId;

    setStage('deriving');
    const derived = await deriveArcMscaCounterfactual({ treasuryId });
    if (!derived.ok) {
      setError(`Derive failed: ${derived.error}`);
      setStage('idle');
      return;
    }

    setStage('deploying');
    const deployed = await deployArcMscaUserOp({ treasuryId });
    if (!deployed.ok) {
      setError(`Deploy failed: ${deployed.error}`);
      setStage('idle');
      return;
    }

    setStage('installing');
    const installed = await installArcMultisig({ treasuryId });
    if (!installed.ok) {
      setError(`Install failed: ${installed.error}`);
      setStage('idle');
      return;
    }

    setStage('done');
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      <ApproverAddressFields
        kind="evm"
        name="memberAddresses"
        disabled={pending}
        onValidityChange={setAddressesValid}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="threshold-arc" className="text-sm font-medium">
          Threshold
        </label>
        <input
          id="threshold-arc"
          name="threshold"
          type="number"
          min={1}
          defaultValue={1}
          required
          className="h-9 w-20 rounded-md border bg-[color:var(--color-background)] px-2 text-sm"
        />
        <span className="text-xs text-[color:var(--color-muted-foreground)]">
          approvals required
        </span>
      </div>
      <Button type="submit" disabled={pending || !addressesValid} className="w-full">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {STAGE_LABEL[stage]}
          </>
        ) : (
          STAGE_LABEL[stage]
        )}
      </Button>
      {error ? (
        <div className="rounded-md border border-[color:var(--color-destructive)] bg-[color:var(--color-destructive)]/10 p-3 text-xs text-[color:var(--color-destructive)]">
          {error}
        </div>
      ) : null}
    </form>
  );
}
