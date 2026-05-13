import { type Prisma, prisma } from '@sendero/database';

export type GatewayTransferIntentState =
  | 'prepared'
  | 'burn_signed'
  | 'burn_attested'
  | 'mint_submitted'
  | 'mint_confirmed'
  | 'mint_failed_retriable'
  | 'mint_failed_terminal';

export type GatewayIntentSignerKind =
  | 'custodial-eoa'
  | 'app-kit-principal'
  | 'confidential-space'
  | 'smart-account-1271';

export interface CreateGatewayTransferIntentArgs {
  tenantId: string;
  gatewayTransferLogId?: string | null;
  signerKind: GatewayIntentSignerKind | string;
  sourceChain?: string | null;
  destinationChain: string;
  amountMicroUsdc: bigint;
  recipientAddress: string;
  burnIntentSalt?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface MarkGatewayTransferIntentArgs {
  intentId: string | null | undefined;
  state: GatewayTransferIntentState;
  attestation?: string | null;
  apiSignature?: string | null;
  burnIntentSalt?: string | null;
  burnTxHash?: string | null;
  mintTxHash?: string | null;
  failedReason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export async function createGatewayTransferIntent(
  args: CreateGatewayTransferIntentArgs
): Promise<string | null> {
  if (!args.tenantId || args.amountMicroUsdc <= 0n) return null;
  try {
    const row = await prisma.gatewayTransferIntent.upsert({
      where: args.gatewayTransferLogId
        ? { gatewayTransferLogId: args.gatewayTransferLogId }
        : { id: '00000000-0000-0000-0000-000000000000' },
      create: {
        tenantId: args.tenantId,
        gatewayTransferLogId: args.gatewayTransferLogId ?? null,
        signerKind: args.signerKind,
        sourceChain: args.sourceChain ?? null,
        destinationChain: args.destinationChain,
        amountMicroUsdc: args.amountMicroUsdc,
        recipientAddress: args.recipientAddress,
        burnIntentSalt: args.burnIntentSalt ?? null,
        metadata: args.metadata ?? undefined,
      },
      update: {},
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.warn('[gateway-intent] create failed (non-fatal)', {
      tenantId: args.tenantId,
      gatewayTransferLogId: args.gatewayTransferLogId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function markGatewayTransferIntent(
  args: MarkGatewayTransferIntentArgs
): Promise<void> {
  if (!args.intentId) return;
  try {
    await prisma.gatewayTransferIntent.update({
      where: { id: args.intentId },
      data: {
        state: args.state,
        ...(args.attestation !== undefined ? { attestation: args.attestation } : {}),
        ...(args.apiSignature !== undefined ? { apiSignature: args.apiSignature } : {}),
        ...(args.burnIntentSalt !== undefined ? { burnIntentSalt: args.burnIntentSalt } : {}),
        ...(args.burnTxHash !== undefined ? { burnTxHash: args.burnTxHash } : {}),
        ...(args.mintTxHash !== undefined ? { mintTxHash: args.mintTxHash } : {}),
        ...(args.failedReason !== undefined
          ? { failedReason: args.failedReason?.slice(0, 500) ?? null }
          : {}),
        ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
      },
    });
  } catch (err) {
    console.warn('[gateway-intent] state update failed (non-fatal)', {
      intentId: args.intentId,
      state: args.state,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function decimalUsdcToMicro(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}
