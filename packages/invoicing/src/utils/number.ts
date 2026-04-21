export function microToDecimal(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, '0')}`;
}

export function decimalToMicro(dec: string): bigint {
  const [whole, frac = ''] = dec.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

export function formatMoney(micro: bigint, currency: string, locale: string): string {
  const asNumber = Number(micro) / 1_000_000;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(asNumber);
}
