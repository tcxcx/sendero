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

## Related

- `apps/ponder/` — `@sendero/indexer`, Ponder indexer publishing a
  GraphQL read layer over escrow state.
- `packages/sendero-guest/` — TypeScript helpers for claim keypairs, guest
  links, and client-side signing.
- `packages/sendero-arc/` — Arc RPC + ERC-8004 + ERC-8183 client.
- `packages/sendero-nanopayments/` — treasury-EOA payout splits.
