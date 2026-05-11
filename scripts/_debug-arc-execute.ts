/**
 * Debug: simulate the userOp's inner execute(self, 0, addOwnersCalldata)
 * with the EntryPoint as the caller — the actual runtime context the
 * userOp lands in. This bypasses the bundler entirely so we see the
 * real revert.
 *
 * Run: bun scripts/_debug-arc-execute.ts
 */
import {
  createPublicClient,
  encodeFunctionData,
  http,
  type Address,
  type Hex,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';

const MSCA: Address = '0xdF17bb2BEad222A63EF529485A5207600ecCe5B9';
const ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const NEW_OWNER: Address = '0x18a02dBc44d60927AA1CcF3036205c1b174E21Eb';

const bootstrapKey = process.env.SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY as Hex | undefined;
if (!bootstrapKey) {
  console.error('SENDERO_ARC_BOOTSTRAP_PRIVATE_KEY missing');
  process.exit(1);
}
const bootstrap = privateKeyToAccount(bootstrapKey);

const client = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

const EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes calldata func)',
]);

const ADD_OWNERS_ABI = parseAbi([
  'function addOwners(address[] ownersToAdd, uint256[] weightsToAdd, (uint256 x, uint256 y)[] publicKeyOwnersToAdd, uint256[] publicKeyWeightsToAdd, uint256 newThresholdWeight)',
]);

const KNOWN_ERROR_SELECTORS: Record<string, string> = {
  '0x534a471c': 'unknown_view_revert (raw "SJG")',
  '0x6d4fdb09': 'unknown_custom_error (4byte lookup needed)',
};

async function main() {
  console.log('=== current state ===');
  console.log('MSCA:           ', MSCA);
  console.log('bootstrap EOA:  ', bootstrap.address);
  console.log('NEW_OWNER:      ', NEW_OWNER);
  console.log('');

  const addOwnersCalldata = encodeFunctionData({
    abi: ADD_OWNERS_ABI,
    functionName: 'addOwners',
    args: [[NEW_OWNER], [1n], [], [], 1n],
  });

  console.log('=== 1. simulate execute() called from EntryPoint ===');
  // This is what happens in the userOp: bundler calls EntryPoint.handleOps,
  // EntryPoint calls account.execute(self, 0, addOwnersCalldata).
  try {
    await client.simulateContract({
      address: MSCA,
      abi: EXECUTE_ABI,
      functionName: 'execute',
      args: [MSCA, 0n, addOwnersCalldata],
      account: ENTRY_POINT_V07,
    });
    console.log('OK — no revert from EntryPoint as caller');
  } catch (e) {
    const err = e as Error;
    const match = err.message.match(/0x[0-9a-f]{8}/i);
    const sel = match ? match[0].toLowerCase() : 'no-selector';
    console.log(`REVERTED with selector ${sel}: ${KNOWN_ERROR_SELECTORS[sel] ?? 'unknown'}`);
    // dig into cause for raw details
    // biome-ignore lint/suspicious/noExplicitAny: debug
    const cause = (e as any).cause;
    if (cause?.data) console.log('  raw data:', cause.data);
    console.log('  full msg:', err.message.split('\n').slice(0, 3).join(' | '));
  }
  console.log('');

  console.log('=== 2. simulate execute() called from bootstrap EOA ===');
  // What if we sent the tx directly without bundler — does the MSCA
  // recognize the bootstrap as authorized via runtime validation?
  try {
    await client.simulateContract({
      address: MSCA,
      abi: EXECUTE_ABI,
      functionName: 'execute',
      args: [MSCA, 0n, addOwnersCalldata],
      account: bootstrap.address,
    });
    console.log('OK — bootstrap-direct call would succeed');
  } catch (e) {
    const err = e as Error;
    const match = err.message.match(/0x[0-9a-f]{8}/i);
    const sel = match ? match[0].toLowerCase() : 'no-selector';
    console.log(`REVERTED with selector ${sel}: ${KNOWN_ERROR_SELECTORS[sel] ?? 'unknown'}`);
  }
  console.log('');

  console.log('=== 3. WeightedMultisig plugin: query owners via plugin-pluginContract ===');
  // Per Circle docs, the WeightedWebauthnMultisigPlugin holds the owner
  // registry at its OWN address, keyed by the MSCA. Sendero embeds the
  // plugin address as WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS.
  const PLUGIN: Address = '0x0000000C984AFf541D6cE86Bb697e68ec57873C8'; // @sendero/multisig::WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS
  console.log('plugin:', PLUGIN);
  const PLUGIN_ABI = parseAbi([
    'function ownershipInfoOf(address account) view returns (address[] owners, uint256[] weights, (uint256,uint256)[] publicKeys, uint256[] publicKeyWeights, uint256 thresholdWeight, uint256 totalWeight)',
    'function checkIsOwners(address account, address[] ownersToCheck) view returns (bool)',
  ]);
  try {
    const info = await client.readContract({
      address: PLUGIN,
      abi: PLUGIN_ABI,
      functionName: 'ownershipInfoOf',
      args: [MSCA],
    });
    console.log('EOA owners:   ', info[0]);
    console.log('EOA weights:  ', info[1].map(w => w.toString()));
    console.log('webauthn count:', info[2].length);
    console.log('threshold:    ', info[4].toString());
    console.log('totalWeight:  ', info[5].toString());
  } catch (e) {
    console.log('plugin.ownershipInfoOf reverted:', (e as Error).message.split('\n')[0]);
    console.log('  → likely plugin NOT installed on this MSCA, OR plugin address wrong');
  }
}

main().catch(console.error);
