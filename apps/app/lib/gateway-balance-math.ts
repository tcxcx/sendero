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

const SOLANA_GATEWAY_DOMAIN = 5;
const SOLANA_CHAINS = new Set(['SOL-DEVNET', 'SOL']);

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

export function isGatewaySpendableDomain(domain: number): boolean {
  return domain !== SOLANA_GATEWAY_DOMAIN;
}

export function isGatewaySpendableOpsChain(chain: string): boolean {
  return !SOLANA_CHAINS.has(chain);
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

  return {
    availableMicro,
    spendableAvailableMicro,
    unsupportedSourceMicro: availableMicro - spendableAvailableMicro,
    pendingCreditMicro,
    spendablePendingCreditMicro,
    opsStagingMicro,
    spendableOpsStagingMicro,
    grandTotalMicro: availableMicro + pendingCreditMicro + opsStagingMicro,
    spendableTotalMicro:
      spendableAvailableMicro + spendablePendingCreditMicro + spendableOpsStagingMicro,
  };
}
