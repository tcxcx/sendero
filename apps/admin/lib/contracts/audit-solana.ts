/**
 * Solana RPC-backed audit for Anchor program deployments.
 *
 * Confirms a program account exists at the registered address, owned
 * by the BPF Loader Upgradeable, with its ProgramData authority
 * matching the registry's expected pubkey. Authority drift is the
 * #1 thing we want to catch — an unauthorized re-deploy could swap
 * program logic without anyone noticing.
 *
 * 10s timeout per RPC call. Cluster picked from the registry entry's
 * network field.
 */

import { Connection, PublicKey } from '@solana/web3.js';

import type { SolanaContractEntry } from './registry';

export type SolanaAuditStatus = 'pass' | 'fail' | 'unknown';

export interface SolanaAuditRow {
  status: SolanaAuditStatus;
  reason: string;
  /** ProgramData address (where bytecode lives). */
  programData: string | null;
  /** Authority pubkey that can re-deploy. */
  authority: string | null;
  /** Last deployed slot. */
  lastSlot: number | null;
  /** Bytecode size in bytes. */
  dataLength: number | null;
}

const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';

function rpcUrlFor(network: SolanaContractEntry['network']): string {
  if (network === 'sol-mainnet') return 'https://api.mainnet-beta.solana.com';
  return process.env.SENDERO_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
}

export async function auditSolanaProgram(entry: SolanaContractEntry): Promise<SolanaAuditRow> {
  const conn = new Connection(rpcUrlFor(entry.network), 'confirmed');

  let programInfo;
  try {
    programInfo = await Promise.race([
      conn.getAccountInfo(new PublicKey(entry.address)),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Solana RPC timeout (10s)')), 10_000)
      ),
    ]);
  } catch (err) {
    return {
      status: 'unknown',
      reason: err instanceof Error ? err.message : 'Solana RPC failed',
      programData: null,
      authority: null,
      lastSlot: null,
      dataLength: null,
    };
  }

  if (!programInfo) {
    return {
      status: 'fail',
      reason: 'Program account not found — not deployed on this cluster.',
      programData: null,
      authority: null,
      lastSlot: null,
      dataLength: null,
    };
  }

  if (programInfo.owner.toBase58() !== BPF_LOADER_UPGRADEABLE) {
    return {
      status: 'fail',
      reason: `Owner is ${programInfo.owner.toBase58()}, expected BPF Loader Upgradeable.`,
      programData: null,
      authority: null,
      lastSlot: null,
      dataLength: programInfo.data.length,
    };
  }

  // Upgradeable program account layout: 4-byte discriminator (LE u32 = 2)
  // + 32-byte ProgramData address. We slice the address bytes directly.
  const programDataPubkey = new PublicKey(programInfo.data.slice(4, 36));
  let programDataInfo;
  try {
    programDataInfo = await Promise.race([
      conn.getAccountInfo(programDataPubkey),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Solana RPC timeout (10s)')), 10_000)
      ),
    ]);
  } catch (err) {
    return {
      status: 'unknown',
      reason: err instanceof Error ? err.message : 'ProgramData fetch failed',
      programData: programDataPubkey.toBase58(),
      authority: null,
      lastSlot: null,
      dataLength: null,
    };
  }

  if (!programDataInfo) {
    return {
      status: 'fail',
      reason: 'ProgramData account missing (program orphaned).',
      programData: programDataPubkey.toBase58(),
      authority: null,
      lastSlot: null,
      dataLength: null,
    };
  }

  // ProgramData layout:
  //   0..4   = discriminator (u32 LE = 3)
  //   4..12  = slot (u64 LE)
  //   12..13 = upgrade-authority Option tag (1 = Some, 0 = None)
  //   13..45 = upgrade-authority pubkey (when tag = Some)
  //   45..   = bytecode
  const data = programDataInfo.data;
  const slot = Number(data.readBigUInt64LE(4));
  const hasAuthority = data[12] === 1;
  const authority = hasAuthority ? new PublicKey(data.slice(13, 45)).toBase58() : null;

  // External programs (Metaplex etc.) — we don't authority-check.
  // A program-data fetch that returns a live deploy is enough.
  if (entry.ownership === 'external') {
    return {
      status: 'pass',
      reason: hasAuthority
        ? `Live external program (Metaplex / upstream). Authority: ${authority}, slot ${slot}.`
        : `Live external program (locked / authority renounced). slot ${slot}.`,
      programData: programDataPubkey.toBase58(),
      authority,
      lastSlot: slot,
      dataLength: data.length - 45,
    };
  }

  if (authority !== entry.expectedAuthority) {
    return {
      status: 'fail',
      reason: hasAuthority
        ? `Authority drift — expected ${entry.expectedAuthority}, got ${authority}.`
        : 'Program authority is None (locked) — registry expected an authority.',
      programData: programDataPubkey.toBase58(),
      authority,
      lastSlot: slot,
      dataLength: data.length - 45,
    };
  }

  return {
    status: 'pass',
    reason: `Live, authority matches registry (slot ${slot}).`,
    programData: programDataPubkey.toBase58(),
    authority,
    lastSlot: slot,
    dataLength: data.length - 45,
  };
}
