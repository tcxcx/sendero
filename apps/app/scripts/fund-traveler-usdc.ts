/**
 * One-shot funder: send a tiny amount of USDC from the platform treasury
 * DCW to a traveler's DCW so they can pay native gas to call register().
 *
 * Usage: bun run scripts/fund-traveler-usdc.ts <destinationAddress> [amount]
 */
import { transferUSDC, getTransaction } from '@sendero/circle/wallets';

const ARC_TESTNET_USDC_TOKEN_ID = '15dc2b5d-0994-58b0-bf8c-3a0501148ee8';

const dest = process.argv[2];
const amount = process.argv[3] || '0.1';
if (!dest) {
  console.error('Usage: bun run scripts/fund-traveler-usdc.ts <destinationAddress> [amount]');
  process.exit(1);
}

const result = await transferUSDC({
  destinationAddress: dest,
  amount,
  tokenId: ARC_TESTNET_USDC_TOKEN_ID,
  refId: `fund-traveler:${dest}`,
});

console.log(`tx submitted: ${result.transactionId} (state=${result.state})`);

const startedAt = Date.now();
while (Date.now() - startedAt < 90_000) {
  const tx = await getTransaction(result.transactionId);
  const state = tx?.transaction?.state;
  const txHash = tx?.transaction?.txHash;
  if (state === 'COMPLETE' && txHash) {
    console.log(`COMPLETE txHash=${txHash}`);
    console.log(`Arcscan: https://testnet.arcscan.app/tx/${txHash}`);
    process.exit(0);
  }
  if (state === 'FAILED') {
    console.error(`FAILED: ${JSON.stringify(tx, null, 2)}`);
    process.exit(2);
  }
  await new Promise(r => setTimeout(r, 2000));
}
console.error('TIMEOUT (90s)');
process.exit(3);
