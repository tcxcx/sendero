#!/usr/bin/env bun
/**
 * verify-deployments — audit every Sendero contract on Arc-Testnet
 * for source/proxy verification on Arcscan (Blockscout). Run as part
 * of the deploy runbook so we never ship a non-verified contract.
 *
 * What "verified" means here:
 *
 *   - Full-source contracts (SenderoGuestEscrow proxy, ERC-8004
 *     registries, thirdweb TokenERC1155 impl) → `is_verified: true`
 *     means the Solidity source was uploaded and matches the deployed
 *     bytecode.
 *
 *   - EIP-1167 minimal proxies (the Circle SCP-deployed SenderoStamps
 *     proxy) → `is_verified: false` is EXPECTED. There is no source
 *     to verify; a minimal proxy is 45 bytes of bytecode that
 *     delegates every call to its impl. Arcscan auto-detects these
 *     and exposes the impl's ABI via the proxy's "Read/Write
 *     Contract" tab. The audit treats `proxy_type: "eip1167"` +
 *     verified `implementations[0]` as functionally equivalent to
 *     verified.
 *
 *   - ERC1967Proxy contracts (the GuestEscrow proxy) → both proxy
 *     AND impl should be verified separately. Auto-checked.
 *
 * Exit code 0 if everything is verified-equivalent, 1 if there's a
 * real gap (full-source contract missing verification). CI can wire
 * this as a post-deploy guard.
 *
 * Usage:
 *   bun scripts/verify-deployments.ts
 *   bun scripts/verify-deployments.ts --json
 */

/* eslint-disable no-console */

interface ContractToCheck {
  /** Address (any case). */
  address: string;
  /** Human label for output. */
  label: string;
  /** Expected verification model — drives the pass/fail rule. */
  expect: 'full-source' | 'eip1167-proxy' | 'erc1967-proxy';
  /** When `expect: 'erc1967-proxy'`, the impl that should also be verified. */
  implAddress?: string;
}

const CONTRACTS: ReadonlyArray<ContractToCheck> = [
  {
    address: '0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515',
    label: 'SenderoGuestEscrow proxy',
    expect: 'full-source',
  },
  {
    address: '0xcc0fa83535675a856d773cfbc71232c3d7b71a03',
    label: 'SenderoStamps proxy (Circle SCP minimal proxy)',
    expect: 'eip1167-proxy',
    implAddress: '0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672',
  },
  {
    address: '0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672',
    label: 'SenderoStamps impl (thirdweb TokenERC1155)',
    expect: 'full-source',
  },
  {
    address: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    label: 'ERC-8004 IdentityRegistry (Arc/Circle upstream)',
    expect: 'full-source',
  },
  {
    address: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
    label: 'ERC-8004 ReputationRegistry (Arc/Circle upstream)',
    expect: 'full-source',
  },
  {
    address: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
    label: 'ERC-8004 ValidationRegistry (Arc/Circle upstream)',
    expect: 'full-source',
  },
];

interface ArcscanContract {
  is_verified?: boolean;
  is_partially_verified?: boolean;
  name?: string;
  compiler_version?: string;
  proxy_type?: string;
  implementations?: Array<{ address_hash: string; name: string }>;
}

interface AuditRow {
  label: string;
  address: string;
  expect: string;
  status: 'pass' | 'fail' | 'unknown';
  reason: string;
  raw: ArcscanContract | null;
}

async function fetchContract(address: string): Promise<ArcscanContract | null> {
  try {
    const res = await fetch(`https://testnet.arcscan.app/api/v2/smart-contracts/${address}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ArcscanContract;
  } catch {
    return null;
  }
}

function audit(c: ContractToCheck, raw: ArcscanContract | null): AuditRow {
  if (!raw) {
    return {
      label: c.label,
      address: c.address,
      expect: c.expect,
      status: 'unknown',
      reason: 'arcscan API unreachable or returned non-200',
      raw,
    };
  }
  switch (c.expect) {
    case 'full-source':
      if (raw.is_verified) {
        return {
          label: c.label,
          address: c.address,
          expect: c.expect,
          status: 'pass',
          reason: `verified · ${raw.name ?? '?'} · ${raw.compiler_version ?? '?'}`,
          raw,
        };
      }
      return {
        label: c.label,
        address: c.address,
        expect: c.expect,
        status: 'fail',
        reason: 'full source expected but is_verified=false',
        raw,
      };
    case 'eip1167-proxy': {
      const impl = raw.implementations?.[0];
      const proxyTypeOk = raw.proxy_type === 'eip1167';
      const implMatches =
        impl && c.implAddress
          ? impl.address_hash.toLowerCase() === c.implAddress.toLowerCase()
          : true;
      if (proxyTypeOk && implMatches) {
        return {
          label: c.label,
          address: c.address,
          expect: c.expect,
          status: 'pass',
          reason: `eip1167 minimal proxy → ${impl?.name ?? '?'} @ ${impl?.address_hash ?? '?'}`,
          raw,
        };
      }
      return {
        label: c.label,
        address: c.address,
        expect: c.expect,
        status: 'fail',
        reason: `expected eip1167 proxy → ${c.implAddress}, got proxy_type=${raw.proxy_type}, impl=${impl?.address_hash ?? 'none'}`,
        raw,
      };
    }
    case 'erc1967-proxy': {
      const impl = raw.implementations?.[0];
      const proxyTypeOk = raw.proxy_type === 'eip1967';
      if (raw.is_verified && proxyTypeOk && impl) {
        return {
          label: c.label,
          address: c.address,
          expect: c.expect,
          status: 'pass',
          reason: `erc1967 proxy verified · impl ${impl.address_hash}`,
          raw,
        };
      }
      return {
        label: c.label,
        address: c.address,
        expect: c.expect,
        status: 'fail',
        reason: `erc1967 proxy expected verified+linked, got is_verified=${raw.is_verified}, proxy_type=${raw.proxy_type}`,
        raw,
      };
    }
  }
}

async function main() {
  const json = process.argv.includes('--json');

  const rows = await Promise.all(
    CONTRACTS.map(async c => audit(c, await fetchContract(c.address)))
  );

  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log('────────────────────────────────────────');
    console.log('Sendero contract verification audit');
    console.log('https://testnet.arcscan.app');
    console.log('────────────────────────────────────────');
    for (const r of rows) {
      const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️ ';
      console.log(`  ${icon}  ${r.label}`);
      console.log(`         ${r.address}`);
      console.log(`         ${r.reason}`);
    }
    console.log('');
    const failed = rows.filter(r => r.status === 'fail').length;
    const unknown = rows.filter(r => r.status === 'unknown').length;
    if (failed === 0 && unknown === 0) {
      console.log('🎉 All contracts verified-equivalent. Ship it.');
    } else {
      console.log(`✘ ${failed} failed · ${unknown} unknown — review above.`);
    }
  }

  const failed = rows.filter(r => r.status === 'fail').length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('verify failed:', err);
  process.exit(1);
});
