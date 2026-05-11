/**
 * Debug-only: simulate `addOwners` on the deployed Arc MSCA to surface
 * the real revert reason that the bundler is swallowing.
 *
 * Run: bun /tmp/debug-arc-addowners.ts
 */
import { createPublicClient, http, type Address, type Hex, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

const MSCA: Address = '0xdF17bb2BEad222A63EF529485A5207600ecCe5B9';
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const NEW_OWNER: Address = '0x18a02dBc44d60927AA1CcF3036205c1b174E21Eb';

const bootstrapKey = process.env.SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY as Hex | undefined;
if (!bootstrapKey) {
  console.error('SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY missing');
  process.exit(1);
}
const bootstrap = privateKeyToAccount(bootstrapKey);

const client = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

const ABI = parseAbi([
  'function addOwners(address[] ownersToAdd, uint256[] weightsToAdd, (uint256 x, uint256 y)[] publicKeyOwnersToAdd, uint256[] publicKeyWeightsToAdd, uint256 newThresholdWeight)',
  'function getOwnerIds() view returns (bytes30[])',
  'function checkIsOwners(address[] ownersToCheck) view returns (bool)',
  'function ownershipInfoOf() view returns (address[] owners, uint256[] weights, (uint256,uint256)[] publicKeys, uint256[] publicKeyWeights, uint256 thresholdWeight, uint256 totalWeight)',
]);

async function main() {
  console.log('=== MSCA contract code present? ===');
  const code = await client.getCode({ address: MSCA });
  console.log(`code length=${code?.length ?? 0} (>2 = deployed)`);
  console.log('');

  console.log('=== bootstrap EOA address ===');
  console.log(bootstrap.address);
  console.log('');

  console.log('=== current owners on the MSCA ===');
  try {
    const info = await client.readContract({
      address: MSCA,
      abi: ABI,
      functionName: 'ownershipInfoOf',
    });
    console.log('EOA owners:    ', info[0]);
    console.log(
      'EOA weights:   ',
      info[1].map(w => w.toString())
    );
    console.log('webauthn count:', info[2].length);
    console.log('threshold:     ', info[4].toString());
    console.log('totalWeight:   ', info[5].toString());
  } catch (e) {
    console.error('ownershipInfoOf failed:', (e as Error).message);
  }
  console.log('');

  console.log('=== simulate addOwners — REAL revert reason will surface here ===');
  try {
    await client.simulateContract({
      address: MSCA,
      abi: ABI,
      functionName: 'addOwners',
      args: [[NEW_OWNER], [1n], [], [], 1n],
      account: bootstrap.address, // caller = bootstrap EOA, simulating self-call from MSCA
    });
    console.log('simulation OK — no revert');
  } catch (e) {
    const err = e as Error;
    console.error('SIMULATION REVERT:');
    console.error(err.message);
    console.error('---');
    // viem usually attaches a `cause` with the inner revert data
    // biome-ignore lint/suspicious/noExplicitAny: debug
    const cause = (e as any).cause;
    if (cause) console.error('cause:', cause.message ?? cause);
  }
}

main().catch(console.error);
