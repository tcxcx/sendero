export interface GatewayBalanceDomainInput {
  domain: number;
  balance: string;
}

export interface GatewayPendingCreditInput {
  domain: number;
  amount: string;
}

export interface GatewayOpsStagingInput {
  chain: string;
  usdc: string;
}

export interface GatewayBalanceTotals {
  availableMicro: bigint;
  spendableAvailableMicro: bigint;
  unsupportedSourceMicro: bigint;
  pendingCreditMicro: bigint;
  spendablePendingCreditMicro: bigint;
  opsStagingMicro: bigint;
  spendableOpsStagingMicro: bigint;
  grandTotalMicro: bigint;
  spendableTotalMicro: bigint;
}

// Solana domain constants kept for callers that explicitly need them
// (e.g. picking a depositor address per chain). The "spendable" carve-
// out that historically excluded Solana is gone — Circle App Kit
// handles Sol for send/swap/bridge through the unified-balance
// abstraction the same way it does EVM, so every Gateway-supported
// chain is spendable.
const SOLANA_GATEWAY_DOMAIN = 5;
const SOLANA_CHAINS = new Set(['SOL-DEVNET', 'SOL']);
void SOLANA_GATEWAY_DOMAIN;
void SOLANA_CHAINS;

export function decimalUsdcToMicro(value: string): bigint {
  const [whole = '0', frac = ''] = value.split('.');
  const normalizedWhole = whole.trim() || '0';
  const padded = `${frac.trim()}000000`.slice(0, 6);
  return BigInt(normalizedWhole) * 1_000_000n + BigInt(padded || '0');
}

export function microUsdcToDecimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0');
  return `${sign}${whole}.${frac}`;
}

export function isGatewaySpendableDomain(_domain: number): boolean {
  // Every Gateway-enabled domain is spendable through App Kit's unified
  // balance abstraction — including Solana via `circle-wallets` /
  // `viem` adapters. Kept as a function to preserve the existing
  // call-site shape; the EVM-only carve-out was a phase-1 hold-over.
  return true;
}

export function isGatewaySpendableOpsChain(_chain: string): boolean {
  return true;
}

export function calculateGatewayBalanceTotals(args: {
  perDomain: GatewayBalanceDomainInput[];
  pendingCredits: GatewayPendingCreditInput[];
  opsStaging: GatewayOpsStagingInput[];
}): GatewayBalanceTotals {
  let availableMicro = 0n;
  let spendableAvailableMicro = 0n;
  let pendingCreditMicro = 0n;
  let spendablePendingCreditMicro = 0n;
  let opsStagingMicro = 0n;
  let spendableOpsStagingMicro = 0n;

  for (const domain of args.perDomain) {
    const amount = decimalUsdcToMicro(domain.balance || '0');
    availableMicro += amount;
    if (isGatewaySpendableDomain(domain.domain)) {
      spendableAvailableMicro += amount;
    }
  }

  for (const credit of args.pendingCredits) {
    const amount = BigInt(credit.amount || '0');
    pendingCreditMicro += amount;
    if (isGatewaySpendableDomain(credit.domain)) {
      spendablePendingCreditMicro += amount;
    }
  }

  for (const staging of args.opsStaging) {
    const amount = BigInt(staging.usdc || '0');
    opsStagingMicro += amount;
    if (isGatewaySpendableOpsChain(staging.chain)) {
      spendableOpsStagingMicro += amount;
    }
  }

  // grandTotal = available + opsStaging. pendingCredits is EXCLUDED.
  //
  // Why exclude pendingCredits: a `GatewayDepositLog` row is marked
  // `confirmed` once the deposit tx finalises on-chain. But Circle's
  // Gateway API balance attestation also picks up the same deposit
  // (usually within a few seconds on fast chains). The static
  // `FINALIZATION_ETA_MS` window (30s-15min) is far longer than the
  // actual attestation lag on Sol / Arc, so the same money was being
  // counted twice — once in `available` (Gateway API) and once again
  // in `pendingCredits` (deposit log within ETA).
  //
  // The user complaint that surfaced this: bridge $X → sweep credits
  // Gateway pool ($X reflected in `available`) → deposit log row
  // ($X reflected in `pendingCredits`) → grandTotal shows +$2X. After
  // the ETA window expires, grandTotal drops back to the correct +$X
  // — but during the window the UI shows phantom money.
  //
  // opsStaging stays in: it represents USDC sitting at the ops DCW
  // BEFORE the sweep runs. That money is genuinely yours, not yet in
  // Gateway pool, no overlap with `available`. Once sweep fires, the
  // ops DCW balance drops to 0 and `available` grows by the same
  // amount.
  //
  // pendingCredits is still exposed as a separate field on the API
  // response so the UI can render "processing $X" informationally,
  // but it does not influence the headline number.
  return {
    availableMicro,
    spendableAvailableMicro,
    unsupportedSourceMicro: availableMicro - spendableAvailableMicro,
    pendingCreditMicro,
    spendablePendingCreditMicro,
    opsStagingMicro,
    spendableOpsStagingMicro,
    grandTotalMicro: availableMicro + opsStagingMicro,
    spendableTotalMicro: spendableAvailableMicro + spendableOpsStagingMicro,
  };
}
