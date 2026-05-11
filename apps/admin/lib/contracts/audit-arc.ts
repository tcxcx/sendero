/**
 * Arcscan-backed verification audit. Mirrors the rules in
 * `scripts/verify-deployments.ts` so the admin UI sees the same
 * pass/fail logic CI uses post-deploy. Single round-trip per address;
 * 10s timeout per fetch keeps the page render bounded.
 */

import type { ArcContractEntry } from './registry';

interface ArcscanContract {
  is_verified?: boolean;
  is_partially_verified?: boolean;
  name?: string;
  compiler_version?: string;
  proxy_type?: string;
  implementations?: Array<{ address_hash: string; name: string }>;
}

export type ArcAuditStatus = 'pass' | 'fail' | 'unknown';

export interface ArcAuditRow {
  status: ArcAuditStatus;
  reason: string;
  /** Arcscan-reported contract name. */
  name: string | null;
  /** Solidity compiler version on file with Arcscan. */
  compiler: string | null;
  /** Detected proxy type (eip1167, etc.). */
  proxyType: string | null;
}

const ARC_TESTNET_API = 'https://testnet.arcscan.app/api/v2/smart-contracts';
const ARC_MAINNET_API = 'https://arcscan.app/api/v2/smart-contracts';

async function fetchContract(
  address: string,
  network: ArcContractEntry['network']
): Promise<ArcscanContract | null> {
  const base = network === 'arc-mainnet' ? ARC_MAINNET_API : ARC_TESTNET_API;
  try {
    const res = await fetch(`${base}/${address.toLowerCase()}`, {
      signal: AbortSignal.timeout(10_000),
      // Disable Next.js fetch caching — operators expect a live read.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ArcscanContract;
  } catch {
    return null;
  }
}

export async function auditArcContract(entry: ArcContractEntry): Promise<ArcAuditRow> {
  const raw = await fetchContract(entry.address, entry.network);
  if (!raw) {
    return {
      status: 'unknown',
      reason: 'Arcscan API unreachable or returned non-200',
      name: null,
      compiler: null,
      proxyType: null,
    };
  }
  const verified = raw.is_verified === true;
  const partial = raw.is_partially_verified === true;
  const name = raw.name ?? null;
  const compiler = raw.compiler_version ?? null;
  const proxyType = raw.proxy_type ?? null;

  switch (entry.expect) {
    case 'full-source':
      if (verified) {
        return { status: 'pass', reason: 'Source verified on Arcscan.', name, compiler, proxyType };
      }
      if (partial) {
        return {
          status: 'fail',
          reason: 'Partially verified — full source upload required.',
          name,
          compiler,
          proxyType,
        };
      }
      return {
        status: 'fail',
        reason: 'Not verified on Arcscan. Submit Solidity source to Arcscan.',
        name,
        compiler,
        proxyType,
      };

    case 'eip1167-proxy': {
      // Arcscan returns `proxy_type: 'eip1167'` + auto-resolves the
      // impl into `implementations[0]`. Verification of the proxy
      // itself is N/A — the 45-byte minimal-proxy bytecode has no
      // source. The audit confirms the impl address matches what we
      // expect.
      if (proxyType !== 'eip1167') {
        return {
          status: 'fail',
          reason: `Expected proxy_type='eip1167', got '${proxyType ?? 'null'}'.`,
          name,
          compiler,
          proxyType,
        };
      }
      const impl = raw.implementations?.[0]?.address_hash?.toLowerCase();
      if (!entry.implAddress) {
        return {
          status: 'fail',
          reason: 'Registry entry missing `implAddress` for eip1167 proxy.',
          name,
          compiler,
          proxyType,
        };
      }
      if (impl !== entry.implAddress.toLowerCase()) {
        return {
          status: 'fail',
          reason: `Impl mismatch — Arcscan reports ${impl}, expected ${entry.implAddress}.`,
          name,
          compiler,
          proxyType,
        };
      }
      return {
        status: 'pass',
        reason: 'EIP-1167 minimal proxy auto-detected, impl address matches registry.',
        name,
        compiler,
        proxyType,
      };
    }

    case 'erc1967-proxy':
      if (verified) {
        return {
          status: 'pass',
          reason: 'Proxy verified. Check impl row separately.',
          name,
          compiler,
          proxyType,
        };
      }
      return {
        status: 'fail',
        reason: 'ERC-1967 proxy not verified — both proxy and impl must be verified.',
        name,
        compiler,
        proxyType,
      };

    default: {
      const _exhaustive: never = entry.expect;
      void _exhaustive;
      return {
        status: 'unknown',
        reason: `Unknown expectation: ${String(entry.expect)}`,
        name,
        compiler,
        proxyType,
      };
    }
  }
}
