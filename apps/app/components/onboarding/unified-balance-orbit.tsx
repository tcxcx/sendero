'use client';

import { TokenUSDC } from '@web3icons/react';

import { BlockchainIcon } from '@sendero/icons';

import { OrbitingCircles } from '@/components/ui/orbiting-circles';

/**
 * Right-column visual for the chain-select onboarding step.
 *
 * Two concentric orbits ring a USDC center mark — outer ring carries
 * EVM gateways (Ethereum / Base / Optimism / Arbitrum), inner ring
 * carries Sol-Devnet, Arc-Testnet, Avalanche, Polygon. Same chain
 * set the wallet exposes via Circle Gateway's unified balance
 * (`GATEWAY_CHAINS` in `@sendero/circle/gateway`), so the onboarding
 * orbit and the wallet's chain badges read as the same product.
 */

const OUTER_RING = ['Ethereum_Sepolia', 'Base_Sepolia', 'Optimism_Sepolia', 'Arbitrum_Sepolia'] as const;
const INNER_RING = ['Sol_Devnet', 'Arc_Testnet', 'Avalanche_Fuji', 'Polygon_Amoy_Testnet'] as const;

export function UnifiedBalanceOrbit() {
  return (
    <div className="orbit-shell">
      <span className="orbit-eyebrow">Unified Balance</span>
      <p className="orbit-lede">One USDC pool, eight chains.</p>

      <div className="orbit-stage">
        {/* Center: USDC token mark */}
        <div className="orbit-center" aria-hidden="true">
          <TokenUSDC size={32} variant="branded" />
        </div>

        {/* Outer ring — EVM Gateway chains */}
        <OrbitingCircles iconSize={22} radius={86} duration={26}>
          {OUTER_RING.map(chain => (
            <span key={chain} className="orbit-icon" aria-label={chain}>
              <BlockchainIcon chain={chain} size={16} variant="branded" />
            </span>
          ))}
        </OrbitingCircles>

        {/* Inner ring — Sol + Arc + side chains, counter-rotating */}
        <OrbitingCircles iconSize={20} radius={52} duration={18} reverse>
          {INNER_RING.map(chain => (
            <span key={chain} className="orbit-icon" aria-label={chain}>
              <BlockchainIcon chain={chain} size={14} variant="branded" />
            </span>
          ))}
        </OrbitingCircles>
      </div>

      <style jsx>{`
        .orbit-shell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 8px 8px 0;
          height: 100%;
          min-height: 220px;
          position: relative;
        }

        .orbit-eyebrow {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 70%, transparent);
        }

        .orbit-lede {
          margin: 0 0 8px;
          font-size: 0.75rem;
          color: color-mix(in oklab, var(--midnight, #1f2a44) 60%, transparent);
          text-align: center;
        }

        .orbit-stage {
          position: relative;
          width: 100%;
          flex: 1;
          min-height: 200px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .orbit-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 2;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: color-mix(in oklab, #ffffff 92%, var(--surface-floating, #fdfbf7));
          border: 1px solid color-mix(in oklab, var(--ink, #fb542b) 24%, transparent);
          box-shadow:
            0 1px 0 rgba(255, 255, 255, 0.7) inset,
            0 4px 12px -6px rgba(31, 42, 68, 0.18);
        }

        .orbit-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: color-mix(in oklab, #ffffff 90%, var(--surface-floating, #fdfbf7));
          border: 1px solid var(--hairline-color-soft, rgba(31, 42, 68, 0.12));
          box-shadow: 0 4px 14px -8px rgba(31, 42, 68, 0.18);
        }

        @media (prefers-reduced-motion: reduce) {
          .orbit-stage :global(.animate-orbit) {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
