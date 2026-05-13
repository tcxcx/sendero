/**
 * Gateway v5 Step 5 — KMS rewrap for Gateway signer rows.
 *
 * Dry-run by default. Use --apply after selecting a canary tenant/user.
 *
 * Examples:
 *   bun apps/app/scripts/migrate-kek-to-kms.ts --tenant ten_123
 *   bun apps/app/scripts/migrate-kek-to-kms.ts --tenant ten_123 --apply
 *   bun apps/app/scripts/migrate-kek-to-kms.ts --all-tenants --limit 10 --apply
 *
 * KMS key selection:
 *   SENDERO_GATEWAY_SIGNER_KMS_KEY_RESOURCE
 *   SENDERO_GATEWAY_SIGNER_KMS_KEY_TEMPLATE
 *
 * The template may include {tenantId}, {userId}, or {principalId}.
 */

import { prisma } from '@sendero/database';
import { decrypt, decryptKmsEnvelope, encryptKmsEnvelope } from '@sendero/encryption';
import { privateKeyToAccount } from 'viem/accounts';

type PrincipalKind = 'tenant' | 'user';

interface Cli {
  apply: boolean;
  allTenants: boolean;
  allUsers: boolean;
  tenantIds: string[];
  userIds: string[];
  limit: number;
}

interface RewrapRow {
  kind: PrincipalKind;
  principalId: string;
  address: string;
  encryptedPrivateKey: string;
  kekVersion: number;
  kekProvider: 'env_v1' | 'kms_v1';
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    apply: false,
    allTenants: false,
    allUsers: false,
    tenantIds: [],
    userIds: [],
    limit: 25,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') cli.apply = true;
    else if (arg === '--all-tenants') cli.allTenants = true;
    else if (arg === '--all-users') cli.allUsers = true;
    else if (arg === '--tenant') cli.tenantIds.push(requiredValue(argv, ++i, arg));
    else if (arg === '--user') cli.userIds.push(requiredValue(argv, ++i, arg));
    else if (arg === '--limit') cli.limit = Number(requiredValue(argv, ++i, arg));
    else if (arg === '--help' || arg === '-h') usage(0);
    else throw new Error(`unknown arg: ${arg}`);
  }
  if (!Number.isInteger(cli.limit) || cli.limit < 1 || cli.limit > 500) {
    throw new Error('--limit must be an integer between 1 and 500');
  }
  if (!cli.allTenants && !cli.allUsers && cli.tenantIds.length === 0 && cli.userIds.length === 0) {
    throw new Error(
      'select at least one principal: --tenant, --user, --all-tenants, or --all-users'
    );
  }
  return cli;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(code: number): never {
  console.log(`Usage:
  bun apps/app/scripts/migrate-kek-to-kms.ts --tenant <tenantId> [--apply]
  bun apps/app/scripts/migrate-kek-to-kms.ts --user <userId> [--apply]
  bun apps/app/scripts/migrate-kek-to-kms.ts --all-tenants [--limit 25] [--apply]
  bun apps/app/scripts/migrate-kek-to-kms.ts --all-users [--limit 25] [--apply]`);
  process.exit(code);
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const rows = await loadRows(cli);
  if (rows.length === 0) {
    console.log('[kms-rewrap] no env-v1 signer rows matched');
    return;
  }

  console.log(`[kms-rewrap] mode=${cli.apply ? 'apply' : 'dry-run'} rows=${rows.length}`);
  for (const row of rows) {
    await rewrapRow(row, cli.apply);
  }
}

async function loadRows(cli: Cli): Promise<RewrapRow[]> {
  const rows: RewrapRow[] = [];
  if (cli.tenantIds.length > 0 || cli.allTenants) {
    const tenantRows = await prisma.tenantGatewaySigner.findMany({
      where: {
        kekProvider: 'env_v1',
        ...(cli.allTenants ? {} : { tenantId: { in: cli.tenantIds } }),
      },
      orderBy: { updatedAt: 'asc' },
      take: cli.allTenants ? cli.limit : undefined,
    });
    rows.push(
      ...tenantRows.map(row => ({
        kind: 'tenant' as const,
        principalId: row.tenantId,
        address: row.address,
        encryptedPrivateKey: row.encryptedPrivateKey,
        kekVersion: row.kekVersion,
        kekProvider: row.kekProvider,
      }))
    );
  }

  if (cli.userIds.length > 0 || cli.allUsers) {
    const userRows = await prisma.userGatewaySigner.findMany({
      where: {
        kekProvider: 'env_v1',
        ...(cli.allUsers ? {} : { userId: { in: cli.userIds } }),
      },
      orderBy: { updatedAt: 'asc' },
      take: cli.allUsers ? cli.limit : undefined,
    });
    rows.push(
      ...userRows.map(row => ({
        kind: 'user' as const,
        principalId: row.userId,
        address: row.address,
        encryptedPrivateKey: row.encryptedPrivateKey,
        kekVersion: row.kekVersion,
        kekProvider: row.kekProvider,
      }))
    );
  }
  return rows;
}

async function rewrapRow(row: RewrapRow, apply: boolean): Promise<void> {
  const contextId = row.principalId;
  const plaintext = await decrypt({
    ciphertext: row.encryptedPrivateKey,
    purpose: 'gateway-signer',
    contextId,
    kekVersion: row.kekVersion,
  });
  const account = privateKeyToAccount(plaintext as `0x${string}`);
  if (account.address.toLowerCase() !== row.address.toLowerCase()) {
    throw new Error(
      `${row.kind}:${row.principalId} stored address ${row.address} but env decrypt derives ` +
        `${account.address}`
    );
  }

  const kmsKeyName = resolveKmsKeyName(row.kind, row.principalId);
  const { envelope, metadata } = await encryptKmsEnvelope({
    plaintext,
    purpose: 'gateway-signer',
    contextId,
    kmsKeyName,
  });
  const roundTrip = await decryptKmsEnvelope({
    envelope,
    purpose: 'gateway-signer',
    contextId,
  });
  if (roundTrip !== plaintext) {
    throw new Error(`${row.kind}:${row.principalId} KMS envelope roundtrip mismatch`);
  }

  console.log('[kms-rewrap] prepared', {
    kind: row.kind,
    principalId: row.principalId,
    address: row.address,
    kmsKeyName: metadata.kmsKeyName,
    kmsKeyVersion: metadata.kmsKeyVersion,
    envelopeBytes: envelope.length,
  });

  if (!apply) return;

  const data = {
    kekProvider: 'kms_v1' as const,
    newEnvelope: envelope,
    kmsKeyResource: metadata.kmsKeyName,
    kmsKeyVersion: metadata.kmsKeyVersion ?? null,
  };
  const result =
    row.kind === 'tenant'
      ? await prisma.tenantGatewaySigner.updateMany({
          where: {
            tenantId: row.principalId,
            kekProvider: 'env_v1',
            encryptedPrivateKey: row.encryptedPrivateKey,
            kekVersion: row.kekVersion,
          },
          data,
        })
      : await prisma.userGatewaySigner.updateMany({
          where: {
            userId: row.principalId,
            kekProvider: 'env_v1',
            encryptedPrivateKey: row.encryptedPrivateKey,
            kekVersion: row.kekVersion,
          },
          data,
        });
  if (result.count !== 1) {
    throw new Error(`${row.kind}:${row.principalId} compare-and-swap updated ${result.count} rows`);
  }
  console.log(`[kms-rewrap] applied ${row.kind}:${row.principalId}`);
}

function resolveKmsKeyName(kind: PrincipalKind, principalId: string): string {
  const exact =
    kind === 'tenant'
      ? process.env.SENDERO_TENANT_GATEWAY_SIGNER_KMS_KEY_RESOURCE
      : process.env.SENDERO_USER_GATEWAY_SIGNER_KMS_KEY_RESOURCE;
  const resource = exact ?? process.env.SENDERO_GATEWAY_SIGNER_KMS_KEY_RESOURCE;
  if (resource) return resource;

  const template =
    (kind === 'tenant'
      ? process.env.SENDERO_TENANT_GATEWAY_SIGNER_KMS_KEY_TEMPLATE
      : process.env.SENDERO_USER_GATEWAY_SIGNER_KMS_KEY_TEMPLATE) ??
    process.env.SENDERO_GATEWAY_SIGNER_KMS_KEY_TEMPLATE;
  if (!template) {
    throw new Error(
      'KMS key not configured. Set SENDERO_GATEWAY_SIGNER_KMS_KEY_RESOURCE or ' +
        'SENDERO_GATEWAY_SIGNER_KMS_KEY_TEMPLATE.'
    );
  }
  const tenantId = kind === 'tenant' ? principalId : '';
  const userId = kind === 'user' ? principalId : '';
  return template
    .replaceAll('{principalId}', principalId)
    .replaceAll('{tenantId}', tenantId)
    .replaceAll('{userId}', userId);
}

main()
  .catch(err => {
    console.error('[kms-rewrap] failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
