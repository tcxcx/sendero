/**
 * Server-safe Circle Modular Smart Contract Account address derivation.
 *
 * Replaces the call to `toCircleSmartAccount` from
 * `@circle-fin/modular-wallets-core`, which fails server-side with
 * "window is not defined" because Circle's SDK pulls in WebAuthn /
 * browser entropy code transitively. The CREATE2 derivation is
 * deterministic + pure-EVM math — we replicate it here using viem
 * primitives so server actions can compute the counterfactual address
 * without any browser plumbing.
 *
 * Constants pinned to Circle's `@circle-fin/modular-wallets-core@1.0.13`
 * deploys. If the SDK ever changes the salt, plugin manifest, or
 * initialization wrapper, the test below will diverge from the SDK's
 * own `computeAddress(owner)` and we'll catch it.
 *
 * Reference: dist/index.js → `computeAddress(owner)` for EOA path.
 */

import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  pad,
  type Address,
  type Hex,
} from 'viem';

// ── Pinned Circle constants (mirror dist/index.js) ────────────────

/** UpgradableMSCAFactory — the same address on Arc + every other
 *  Circle-supported chain. */
const FACTORY_ADDRESS: Address = '0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD';

/** UpgradableMSCA implementation — the proxy delegates here. */
const UPGRADABLE_MSCA_IMPL: Address = '0xA70F1296869DA9D7CB69578123F21888E6dB2B62';

/** Weighted WebAuthn multisig plugin (the only plugin Circle's SDK
 *  installs at deploy time). EOA owners are stored alongside any
 *  WebAuthn owners on the same plugin. */
const WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN: Address = '0x0000000C984AFf541D6cE86Bb697e68ec57873C8';
const WEIGHTED_WEBAUTHN_MULTISIG_MANIFEST_HASH: Hex =
  '0xa043327d77a74c1c55cfa799284b831fe09535a88b9f5fa4173d334e5ba0fd91';

/** ERC1967-flavored proxy creation bytecode Circle's factory deploys.
 *  Pinned to Circle SDK's `ERC1769_PROXY.creationCode`. */
const ERC1967_PROXY_CREATION_CODE: Hex =
  '0x60806040526102d38038038061001481610194565b92833981019060408183031261018f5780516001600160a01b03811680820361018f5760208381015190936001600160401b03821161018f570184601f8201121561018f5780519061006d610068836101cf565b610194565b9582875285838301011161018f57849060005b83811061017b57505060009186010152813b15610163577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b03191682179055604051907fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b600080a28351156101455750600080848461012c96519101845af4903d1561013c573d61011c610068826101cf565b908152600081943d92013e6101ea565b505b6040516085908161024e8239f35b606092506101ea565b9250505034610154575061012e565b63b398979f60e01b8152600490fd5b60249060405190634c9c8ce360e01b82526004820152fd5b818101830151888201840152869201610080565b600080fd5b6040519190601f01601f191682016001600160401b038111838210176101b957604052565b634e487b7160e01b600052604160045260246000fd5b6001600160401b0381116101b957601f01601f191660200190565b9061021157508051156101ff57805190602001fd5b604051630a12f52160e11b8152600490fd5b81511580610244575b610222575090565b604051639996b31560e01b81526001600160a01b039091166004820152602490fd5b50803b1561021a56fe60806040527f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc54600090819081906001600160a01b0316368280378136915af43d82803e15604b573d90f35b3d90fdfea26469706673582212204c5a8d3706486893377786ce0546dcd68cc8da5f34f8cc074c787db78fc29df764736f6c63430008180033';

/** Default salt — matches Circle SDK's `getSalt()` (zero bytes32). */
const DEFAULT_SALT: Hex = pad('0x', { size: 32 });

/** Default weight + threshold for a single-owner bootstrap. The
 *  multisig plugin gets re-weighted to real members + threshold via a
 *  follow-up `updateMultisigWeights` userOp. */
const OWNER_WEIGHT = 1n;
const THRESHOLD_WEIGHT = 1n;

const PLUGIN_INSTALL_DATA_ABI = [
  { name: 'initialOwners', type: 'address[]' },
  { name: 'ownerWeights', type: 'uint256[]' },
  {
    name: 'initialPublicKeyOwners',
    type: 'tuple[]',
    components: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
    ],
  },
  { name: 'publicKeyOwnerWeights', type: 'uint256[]' },
  { name: 'thresholdWeight', type: 'uint256' },
] as const;

const INITIALIZE_UPGRADABLE_MSCA_ABI = [
  {
    type: 'function',
    name: 'initializeUpgradableMSCA',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plugins', type: 'address[]' },
      { name: 'manifestHashes', type: 'bytes32[]' },
      { name: 'pluginInstallData', type: 'bytes[]' },
    ],
    outputs: [],
  },
] as const;

// ── Public API ────────────────────────────────────────────────────

export interface ComputeArcMscaInput {
  /** EOA owner address (the bootstrap signer). */
  owner: Address;
  /** Optional salt override. Defaults to Circle SDK's zero-bytes32. */
  salt?: Hex;
}

export interface ComputeArcMscaResult {
  /** The deterministic counterfactual MSCA address. */
  address: Address;
  /** Sender = pad(owner, 32). */
  sender: Hex;
  /** Salt as passed (default = zero). */
  salt: Hex;
  /** mixedSalt = keccak256(abi.encode(sender, salt)). The factory uses
   *  this as the actual CREATE2 salt. */
  mixedSalt: Hex;
  /** initializeUpgradableMSCA call data — used by the factory to
   *  install the multisig plugin at deploy time. */
  initializingData: Hex;
}

/**
 * Compute the counterfactual Circle MSCA address for an EOA owner.
 *
 * Pure function — no RPC, no `window`. Result matches Circle SDK's
 * `computeAddress(owner)` for EOA owners byte-for-byte.
 */
export function computeArcMscaAddress(input: ComputeArcMscaInput): ComputeArcMscaResult {
  const sender = pad(input.owner, { size: 32 });
  const salt = input.salt ?? DEFAULT_SALT;

  // Single-EOA-owner plugin install: [owner], [1], [], [], 1
  const pluginInstallParams = encodeAbiParameters(PLUGIN_INSTALL_DATA_ABI, [
    [input.owner],
    [OWNER_WEIGHT],
    [],
    [],
    THRESHOLD_WEIGHT,
  ]);

  // initializeUpgradableMSCA([plugin], [manifestHash], [pluginInstallParams])
  const initializingData = encodeFunctionData({
    abi: INITIALIZE_UPGRADABLE_MSCA_ABI,
    functionName: 'initializeUpgradableMSCA',
    args: [
      [WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN],
      [WEIGHTED_WEBAUTHN_MULTISIG_MANIFEST_HASH],
      [pluginInstallParams],
    ],
  });

  // The factory CREATE2's the proxy with mixedSalt = keccak(sender || salt).
  const mixedSalt = keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [sender, salt])
  );

  // Proxy bytecode = creationCode + abi.encode(impl, initData)
  const bytecode = encodePacked(
    ['bytes', 'bytes'],
    [
      ERC1967_PROXY_CREATION_CODE,
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes' }],
        [UPGRADABLE_MSCA_IMPL, initializingData]
      ),
    ]
  );

  const address = getContractAddress({
    bytecode,
    from: FACTORY_ADDRESS,
    opcode: 'CREATE2',
    salt: mixedSalt,
  });

  return { address, sender, salt, mixedSalt, initializingData };
}

/** Re-export the factory address for callers wiring the deploy
 *  userOp's `initCode`. */
export { FACTORY_ADDRESS as ARC_MSCA_FACTORY_ADDRESS };
