import { ensureUserIdentity } from '@sendero/tools/provision-identity';

const userId = process.argv[2];
if (!userId) {
  console.error('Usage: bun run scripts/provision-traveler-identity.ts <userId>');
  process.exit(1);
}

const result = await ensureUserIdentity({ userId });
console.log(JSON.stringify(result, null, 2));
if (result.txHash) {
  console.log(`Arcscan: https://testnet.arcscan.app/tx/${result.txHash}`);
}
process.exit(0);
