export interface LineItemInput {
  quantity: number;
  unitPriceMicro: bigint;
}

export interface CalculatedTotals {
  subtotalMicro: bigint;
  discountMicro: bigint;
  taxAmountMicro: bigint;
  vatAmountMicro: bigint;
  totalMicro: bigint;
}

/**
 * Amounts are BigInt micro-USD. Rate inputs are floats (0.08 = 8%).
 * Rounding: truncate to nearest micro (floor). For presentation rounding,
 * apply at the display layer.
 */
export function calculateTotals(args: {
  lineItems: LineItemInput[];
  taxRate?: number;
  vatRate?: number;
  discountMicro?: bigint;
}): CalculatedTotals {
  const taxRate = args.taxRate ?? 0;
  const vatRate = args.vatRate ?? 0;
  const discountMicro = args.discountMicro ?? 0n;

  const subtotalMicro = args.lineItems.reduce((acc, li) => {
    const q = (BigInt(Math.round(li.quantity * 10_000)) * li.unitPriceMicro) / 10_000n;
    return acc + q;
  }, 0n);

  const taxableBase = subtotalMicro - discountMicro;

  const taxBps = BigInt(Math.round(taxRate * 10_000));
  const vatBps = BigInt(Math.round(vatRate * 10_000));

  const taxAmountMicro = (taxableBase * taxBps) / 10_000n;
  const vatAmountMicro = (taxableBase * vatBps) / 10_000n;

  const totalMicro = taxableBase + taxAmountMicro + vatAmountMicro;

  return { subtotalMicro, discountMicro, taxAmountMicro, vatAmountMicro, totalMicro };
}
