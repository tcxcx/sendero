'use client';

/**
 * TokenIcon — branded USDC / EURC glyph via @web3icons/react.
 * Lazy-loaded so the icon sprite doesn't block the main bundle.
 * Fallback is a matching-size coloured circle while the chunk loads.
 */

import { lazy, Suspense } from 'react';

type TVariant = 'branded' | 'mono' | 'background';

const Web3TokenIcon = lazy(() =>
  import('@web3icons/react/dynamic').then(mod => ({ default: mod.TokenIcon }))
);

type Token = 'USDC' | 'EURC';

interface Props {
  token: Token;
  size?: number;
  variant?: TVariant;
  className?: string;
}

const FALLBACK_COLOR: Record<Token, string> = {
  USDC: '#2775ca',
  EURC: '#0ea5e9',
};

export function TokenIcon({ token, size = 20, variant = 'branded', className }: Props) {
  const fallbackColor = FALLBACK_COLOR[token];
  const fallback = (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill={fallbackColor} />
    </svg>
  );

  return (
    <Suspense fallback={fallback}>
      <Web3TokenIcon
        symbol={token.toLowerCase()}
        size={size}
        variant={variant}
        className={className}
      />
    </Suspense>
  );
}
