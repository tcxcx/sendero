# Sendero Arc contracts

On-chain settlement layer for Sendero — pre-funded guest-link travel
escrow on Circle Arc. UUPS-upgradeable; state lives behind an ERC-7201
namespaced storage slot so implementations can evolve without
corrupting proxy state.

## Layout

```
contracts/
├── foundry.toml
├── lib/                              # forge install targets (gitignored)
│   ├── forge-std/
│   ├── openzeppelin-contracts/
│   ├── openzeppelin-contracts-upgradeable/
│   └── openzeppelin-foundry-upgrades/
├── src/
│   ├── SenderoGuestEscrow.sol
│   └── interfaces/
│       └── IGuestEscrow.sol
├── script/
│   └── Deploy.s.sol                  # Deploy | UpgradeImplementation | ValidateUpgrade | TransferOwnership | SetOperator
└── test/
    ├── SenderoGuestEscrow.t.sol
    └── SenderoGuestEscrow.fuzz.t.sol
```

## Setup

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge install OpenZeppelin/openzeppelin-contracts-upgradeable --no-commit
forge install OpenZeppelin/openzeppelin-foundry-upgrades --no-commit
forge build
forge test -vvv
```

Node.js is required — `openzeppelin-foundry-upgrades` shells out to the
OpenZeppelin Upgrades CLI for storage-layout validation.

## Deploy to Arc Testnet (UUPS proxy)

```bash
# Required env:
export ARC_RPC_URL=https://rpc.testnet.arc.network
export ARC_OPERATOR=0x...         # Sendero backend signer
export ARC_OWNER=0x...            # Safe multisig (upgrade authority)
export DEPLOYER_PK=0x...

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_RPC_URL \
  --private-key $DEPLOYER_PK \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://testnet.arcscan.app/api
```

USDC on Arc Testnet: `0x3600000000000000000000000000000000000000`.

### Upgrade an existing proxy

```bash
# Annotate the new impl with `/// @custom:oz-upgrades-from SenderoGuestEscrow`.
ARC_ESCROW_ADDRESS=0x... NEW_IMPL_NAME=SenderoGuestEscrowV2.sol \
  forge script script/Deploy.s.sol:UpgradeImplementation \
  --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PK --broadcast
```

`Upgrades.upgradeProxy` validates storage layout against the reference
contract before writing the new implementation slot.

### CI pre-flight

```bash
NEW_IMPL_NAME=SenderoGuestEscrowV2.sol \
  forge script script/Deploy.s.sol:ValidateUpgrade
```

Runs the same storage + opcode checks without broadcasting.

### Admin

```bash
ARC_ESCROW_ADDRESS=0x... NEW_OPERATOR=0x... \
  forge script script/Deploy.s.sol:SetOperator --broadcast ...

ARC_ESCROW_ADDRESS=0x... NEW_OWNER=0x... \
  forge script script/Deploy.s.sol:TransferOwnership --broadcast ...
```

## Contract surface

See `src/interfaces/IGuestEscrow.sol` for the full API.

| Function | Caller | Purpose |
|---|---|---|
| `initialize` | once, at proxy deploy | Set USDC, operator, owner |
| `createTrip` | buyer | Lock USDC against a Peanut-style claim key |
| `batchCreateTrip` | buyer | Fund N trips in one tx |
| `claimTrip` | anyone with claim key + OTP | Enroll guest MSCA as authorized spender |
| `reserveForBooking` | guest or operator | Lock upper bound for a pending booking |
| `commitBooking` | **guest only** | Set actual Duffel price, release slack |
| `confirmDuffel` | operator | Record GDS order hash |
| `settleBooking` | operator | Pay vendor + fee |
| `refundBooking` | operator | Cancel booking, restore budget |
| `reclaimStuckBooking` | buyer | Escape hatch after RESERVE / CONFIRM timeout |
| `cancelTrip` | buyer or operator | Halt new reservations |
| `sweepUnspent` | buyer or operator | Return unused funds after expiry or cancel |
| `logAgentAction` | operator | Emit x402 agent-action trace |
| `setOperator` | owner | Rotate the backend signer |
| `pause` / `unpause` | owner | Circuit breaker on state-changing entrypoints |
| `_authorizeUpgrade` | owner | UUPS upgrade gate |

## Design notes

The design adapts Peanut Protocol's ephemeral-keypair claim pattern to
a multi-stage travel escrow:

- Claim credential is a throwaway private key shared via URL fragment.
- Signature binds the guest's wallet address to prevent mempool
  front-running.
- Out-of-band OTP preimage check adds a second factor against URL leakage.
- Multi-stage lifecycle: reserve → commit → confirm → settle, with an
  upper-bound reservation to absorb airline price drift.
- Buyer-side reclaim after timeouts guarantees funds aren't held hostage
  by an unresponsive operator.
- Reputation attestation happens off this contract — the guest's MSCA
  posts feedback to the existing ERC-8004 ReputationRegistry in a
  separate userOp, because ERC-8004 blocks agent owners from attesting
  their own agents.

### Upgrade safety

- UUPS via `UUPSUpgradeable`; `_authorizeUpgrade` gated by `onlyOwner`.
- ERC-7201 namespaced storage (`sendero.storage.GuestEscrow`) —
  `GuestEscrowStorage` is the only struct; new fields append to the
  struct rather than declaring new state variables.
- Implementation constructor calls `_disableInitializers()` to prevent
  direct initialization of the impl.
- All modifier-bearing external functions keep `nonReentrant` +
  `whenNotPaused`; upgrades must preserve this.

## Current deployment (Arc Testnet, chain 5042002)

| | Address |
|---|---|
| Proxy (`ERC1967Proxy`) | [`0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515` on Arc Scan](https://testnet.arcscan.app/address/0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515) |
| Implementation | [`0x2247783E3bE97DF822cB3C100D44D5C47e050bD5` on Arc Scan](https://testnet.arcscan.app/address/0x2247783E3bE97DF822cB3C100D44D5C47e050bD5) |
| Owner + operator | `0x0646FFe11b9aBcE0054Ce6F73025F06F3E91eC69` (treasury EOA) |
| Deploy block | 38197708 |
| USDC | `0x3600000000000000000000000000000000000000` |

Both contracts are verified on [testnet.arcscan.app](https://testnet.arcscan.app)
(Solidity `v0.8.24+commit.e11b9ed9`, optimizer on, `via_ir`).

## Next steps

### Before a fresh deploy (testnet or mainnet)

1. `forge install` all four deps (see [Setup](#setup)). `lib/` is gitignored.
2. Populate `ARC_RPC_URL`, `ARC_USDC_ADDRESS`, `ARC_OPERATOR`, `ARC_OWNER`,
   `DEPLOYER_PK`. On mainnet, `ARC_OWNER` **must** be a Safe multisig.
3. `forge test -vvv` — must be clean (55/55 today).
4. Run `forge script ... Deploy --broadcast --verify` (verifier flags in
   this README). `Upgrades.deployUUPSProxy` validates the impl first.
5. Write the new proxy + impl + deploy block to `.env.local` under the
   `ARC_ESCROW_*` keys and push them through `turbo.json`'s
   `globalPassThroughEnv`.
6. Update `apps/ponder` (`PONDER_ESCROW_ADDRESS`, `PONDER_ESCROW_START_BLOCK`)
   and restart the indexer so it backfills from the new deploy block.

### Before an upgrade (V2 impl)

1. Create `SenderoGuestEscrowV2.sol`. Add the custom tag
   `oz-upgrades-from SenderoGuestEscrow` on the contract so the plugin
   knows which predecessor to diff against.
2. **Storage rules**: do not declare new top-level state variables — add
   fields to the end of the existing `GuestEscrowStorage` struct only.
   Never reorder or change the type of existing fields, and keep the
   ERC-7201 namespace id unchanged.
3. If V2 needs new initialization logic, add a `reinitializeV2(...)`
   function guarded by `reinitializer(2)`. Never reuse `initializer`.
4. Add a forge test that deploys V1, executes real state transitions,
   upgrades to V2 via `Upgrades.upgradeProxy`, and asserts state
   survived and new logic works.
5. Run `ValidateUpgrade` in CI before the upgrade tx is submitted:
   `NEW_IMPL_NAME=SenderoGuestEscrowV2.sol forge script ... ValidateUpgrade`.
6. Execute `UpgradeImplementation` from the owner (Safe once rotated),
   then re-run `cast call $PROXY 'version()(string)'` and Arc Scan
   verify for the new impl address.

## Known gaps

Tracked so they don't slip. Not all are blockers for testnet.

- **Owner = operator = treasury EOA**. Single-key control over upgrades
  *and* operator rotation. Rotate `owner` to a Safe multisig and
  `operator` to a dedicated backend signer EOA before mainnet.
  Scripts: `TransferOwnership`, `SetOperator`.
- **No upgrade timelock.** Consider wrapping the Safe in
  `TimelockController` so upgrades require an enforced delay on
  mainnet — gives users a window to observe + exit.
- **No V1→V2 upgrade dry-run test.** The forge suite covers V1 logic
  but does not yet exercise `Upgrades.upgradeProxy`. Add when V2 lands.
- **No `.openzeppelin/` network manifest committed.** The foundry-upgrades
  plugin validates against the `oz-upgrades-from` annotation on the
  source, not a stored manifest. If we switch to Hardhat upgrades, we
  must commit `.openzeppelin/arc-testnet.json` etc.
- **`setOperator` is single-tx.** Owner swaps the operator in one
  transaction. Consider a 2-step rotation (pending → accept) for mainnet
  parity with `Ownable2Step`.
- **No static analysis in CI.** Slither + Mythril aren't wired yet; add
  before mainnet.
- **Mainnet not deployed.** Only Arc Testnet. Chain id + USDC address
  differ on Arc mainnet — rerun the fresh-deploy checklist.
- **OTP preimage is visible in calldata.** The recipient-bound claim
  signature prevents front-running of the claim itself, but the OTP
  preimage is not rotation-proof. Rotate claim codes for any trip whose
  link may have been observed.

## Related

- `apps/ponder/` — `@sendero/indexer`, Ponder indexer publishing a
  GraphQL read layer over escrow state. Indexes all lifecycle +
  admin/UUPS events (`OperatorUpdated`, `Paused`, `Unpaused`,
  `Upgraded`).
- `packages/guest/` — TypeScript helpers for claim keypairs, guest
  links, and client-side signing.
- `packages/arc/` — Arc RPC + ERC-8004 + ERC-8183 client.
- `packages/nanopayments/` — treasury-EOA payout splits.
