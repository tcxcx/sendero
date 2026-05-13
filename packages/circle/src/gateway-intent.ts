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
  const data = {
    tenantId: args.tenantId,
    gatewayTransferLogId: args.gatewayTransferLogId ?? null,
    signerKind: args.signerKind,
    sourceChain: args.sourceChain ?? null,
    destinationChain: args.destinationChain,
    amountMicroUsdc: args.amountMicroUsdc,
    recipientAddress: args.recipientAddress,
    burnIntentSalt: args.burnIntentSalt ?? null,
    metadata: args.metadata ?? undefined,
  };
  try {
    // When a gatewayTransferLogId is supplied we upsert on its UNIQUE
    // index so retries of the same transfer log idempotently resolve to
    // the same intent row. When it's absent (e.g. ad-hoc `transfer_via_gateway`
    // tool invocations, prefund spends) every call is a fresh intent and
    // we MUST create a new row — never reuse a sentinel id, otherwise
    // concurrent callers without a log id collide on a single row and the
    // second caller's `update` branch silently mutates the first caller's
    // intent.
    const row = args.gatewayTransferLogId
      ? await prisma.gatewayTransferIntent.upsert({
          where: { gatewayTransferLogId: args.gatewayTransferLogId },
          create: data,
          update: {},
          select: { id: true },
        })
      : await prisma.gatewayTransferIntent.create({
          data,
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
