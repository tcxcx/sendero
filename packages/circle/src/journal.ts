import { type Prisma, prisma } from '@sendero/database';

import { createHash } from 'node:crypto';

export type JournalDirection = 'debit' | 'credit';
export type JournalAsset = 'USDC' | 'EURC';
export type JournalContextKind =
  | 'deposit'
  | 'spend'
  | 'bridge'
  | 'fee'
  | 'booking_confirm'
  | 'booking_settle'
  | 'gateway_sweep'
  | 'recovery';

export type JournalAccount =
  | `asset:gateway:${string}`
  | `asset:dcw:${string}`
  | `liability:user:${string}`
  | `liability:tenant:${string}`
  | 'revenue:fee'
  | 'expense:gas';

export type JournalLeg = {
  transactionId?: string;
  tenantId: string;
  userId?: string | null;
  complianceDecisionId?: string | null;
  account: JournalAccount;
  direction: JournalDirection;
  amountMicroUsdc: bigint;
  asset?: JournalAsset;
  contextKind: JournalContextKind;
  contextRef: string;
  metadata?: Prisma.InputJsonValue | null;
};

export type BalancedJournalLegs = readonly [JournalLeg, JournalLeg, ...JournalLeg[]];

export type WriteJournalResult =
  | { status: 'disabled' }
  | { status: 'written'; transactionId: string; count: number }
  | { status: 'duplicate'; transactionId: string }
  | { status: 'failed'; transactionId?: string; error: string };

type JournalDb = {
  journalEntry: {
    createMany(args: {
      data: Prisma.JournalEntryCreateManyInput[];
      skipDuplicates?: boolean;
    }): Promise<{ count: number }>;
  };
};

const ACCOUNT_RE =
  /^(asset:(gateway|dcw):[A-Za-z0-9_-]+|liability:(user|tenant):[A-Za-z0-9_-]+|revenue:fee|expense:gas)$/;

export const journalAccounts = {
  gatewayAsset: (chain: string): JournalAccount => `asset:gateway:${chain}`,
  dcwAsset: (chain: string): JournalAccount => `asset:dcw:${chain}`,
  userLiability: (userId: string): JournalAccount => `liability:user:${userId}`,
  tenantLiability: (tenantId: string): JournalAccount => `liability:tenant:${tenantId}`,
  revenueFee: (): JournalAccount => 'revenue:fee',
  expenseGas: (): JournalAccount => 'expense:gas',
} as const;

export function journalShadowWritesEnabled(): boolean {
  const raw = process.env.SENDERO_JOURNAL_SHADOW_WRITES ?? process.env.SENDERO_JOURNAL_SHADOW_WRITE;
  return raw === '1' || raw === 'true';
}

export function journalTransactionId(scope: string, ref: string): string {
  const hash = createHash('sha256').update(`${scope}:${ref}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

export async function writeJournalEntry(
  legs: BalancedJournalLegs,
  options?: {
    db?: JournalDb;
    enabled?: boolean;
    failClosed?: boolean;
  }
): Promise<WriteJournalResult> {
  const enabled = options?.enabled ?? journalShadowWritesEnabled();
  if (!enabled) return { status: 'disabled' };

  const db = options?.db ?? prisma;
  let transactionId: string | undefined;
  try {
    transactionId = normalizeAndValidateTransactionId(legs);
    const data = legs.map((leg, legIndex) => ({
      transactionId,
      legIndex,
      tenantId: leg.tenantId,
      userId: leg.userId ?? null,
      complianceDecisionId: leg.complianceDecisionId ?? null,
      account: leg.account,
      direction: leg.direction,
      amountMicroUsdc: leg.amountMicroUsdc,
      asset: leg.asset ?? 'USDC',
      contextKind: leg.contextKind,
      contextRef: leg.contextRef,
      metadata: leg.metadata ?? undefined,
    }));

    const result = await db.journalEntry.createMany({ data, skipDuplicates: true });
    if (result.count === 0) return { status: 'duplicate', transactionId };
    return { status: 'written', transactionId, count: result.count };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (options?.failClosed) throw err;
    console.warn('[journal] shadow write failed', { transactionId, error });
    return { status: 'failed', transactionId, error };
  }
}

function normalizeAndValidateTransactionId(legs: BalancedJournalLegs): string {
  const first = legs[0];
  const transactionId =
    first.transactionId ?? journalTransactionId(first.contextKind, first.contextRef);
  let debit = 0n;
  let credit = 0n;

  for (const leg of legs) {
    if (!leg.tenantId) throw new Error('journal leg tenantId required');
    if (!leg.contextKind || !leg.contextRef) throw new Error('journal context required');
    if (leg.tenantId !== first.tenantId) throw new Error('all journal legs must share tenantId');
    if (leg.contextKind !== first.contextKind || leg.contextRef !== first.contextRef) {
      throw new Error('all journal legs must share context');
    }
    if (leg.transactionId && leg.transactionId !== transactionId) {
      throw new Error('all journal legs must share transactionId');
    }
    if (!ACCOUNT_RE.test(leg.account)) {
      throw new Error(`invalid journal account: ${leg.account}`);
    }
    if (leg.amountMicroUsdc <= 0n) {
      throw new Error('journal amountMicroUsdc must be positive');
    }
    if (leg.direction === 'debit') debit += leg.amountMicroUsdc;
    else credit += leg.amountMicroUsdc;
  }

  if (debit !== credit) {
    throw new Error(`unbalanced journal legs: debit=${debit} credit=${credit}`);
  }
  return transactionId;
}
