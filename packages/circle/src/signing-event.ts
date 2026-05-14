import { prisma } from '@sendero/database';

import type { GatewaySignerCallerContext } from './gateway-signer';
import { createHash } from 'node:crypto';

export interface RecordSigningEventArgs {
  signerKind: string;
  signerAddress: string;
  principalId: string;
  caller?: GatewaySignerCallerContext;
  intentId?: string | null;
  messageKind: string;
  message: string | Uint8Array;
  signature?: string | Uint8Array | null;
  kmsKeyVersion: string | number;
  attestedImageDigest?: string | null;
  slsaSourceCommit?: string | null;
  complianceDecisionId?: string | null;
  approvalReceiptId?: string | null;
  revocationEpoch?: number;
}

export async function recordSigningEvent(args: RecordSigningEventArgs): Promise<void> {
  try {
    await prisma.signingEvent.create({
      data: {
        signerKind: args.signerKind,
        signerAddress: args.signerAddress,
        principalId: args.principalId,
        callerSurface: args.caller?.surface ?? 'unknown',
        callerUserId: args.caller?.userId ?? null,
        intentId: args.intentId ?? null,
        messageKind: args.messageKind,
        messageHash: hashMessage(args.message),
        signature: signatureBytes(args.signature),
        kmsKeyVersion: String(args.kmsKeyVersion),
        attestedImageDigest: args.attestedImageDigest ?? null,
        slsaSourceCommit: args.slsaSourceCommit ?? null,
        complianceDecisionId: args.complianceDecisionId ?? null,
        approvalReceiptId: args.approvalReceiptId ?? null,
        revocationEpoch: args.revocationEpoch ?? 0,
      },
    });
  } catch (err) {
    console.warn('[signing-event] write failed (non-fatal)', {
      principalId: args.principalId,
      signerAddress: args.signerAddress,
      messageKind: args.messageKind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function hashMessage(message: string | Uint8Array): Buffer {
  const bytes = typeof message === 'string' ? Buffer.from(message, 'utf8') : Buffer.from(message);
  return createHash('sha256').update(bytes).digest();
}

function signatureBytes(signature: string | Uint8Array | null | undefined): Buffer {
  if (!signature) return Buffer.alloc(0);
  if (typeof signature !== 'string') return Buffer.from(signature);
  const hex = signature.startsWith('0x') ? signature.slice(2) : signature;
  if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) {
    return Buffer.from(hex, 'hex');
  }
  return Buffer.from(signature, 'utf8');
}
