# Circle CLI — Arc Testnet: USDC decimals mis-report + Gateway deposit balance mismatch

Filed: 2026-05-13 (UTC) by the Sendero team (tomas.cordero.esp@gmail.com).
Reproduced cleanly and independently on the dates noted below.

## Summary

On Circle CLI `@circle-fin/cli@0.0.1` against Arc Testnet (chain id `5042002`,
RPC `https://rpc.testnet.arc.network`), two independent bugs surface on the
same wallet/balance path:

1. `circle wallet balance --output json` reports the Arc Testnet USDC token
   metadata as `decimals: 18`, but the on-chain USDC contract at
   `0x3600000000000000000000000000000000000000` actually exposes
   `decimals() = 6` (raw `eth_call` returns `0x06`). The CLI's numeric
   `amount` field is still human-readable (`"21"` for 21 USDC), so the bug
   is isolated to the `token.decimals` field of the JSON envelope, which
   any downstream automation will trust.

2. `circle gateway deposit … --chain ARC-TESTNET --method direct` refuses
   to proceed with `Error: Gateway deposit requires at least 5 USDC on
   ARC-TESTNET. Current USDC balance is 0.`, even though `circle wallet
   balance` on the same address on the same chain reports `21` USDC and
   a raw `balanceOf` call returns `21000000` atomic units (= 21 USDC at
   the actual 6 decimals). The two CLI subcommands appear to be reading
   balances through different code paths against Arc Testnet and only
   one of them works.

Both bugs are reproducible with no other state. The wallet was created
through the CLI and was funded through the CLI's own faucet flow.

## Environment

| Field                    | Value                                                                 |
|--------------------------|-----------------------------------------------------------------------|
| Circle CLI version       | `0.0.1` (`circle --version` → `0.0.1`)                                |
| npm package              | `@circle-fin/cli@0.0.1`                                               |
| OS                       | macOS 15.7.1 (Darwin 24.6.0 arm64)                                    |
| Date of repro            | 2026-05-13                                                            |
| Chain                    | Arc Testnet (chain id `5042002`)                                      |
| Public RPC used          | `https://rpc.testnet.arc.network`                                     |
| USDC contract            | `0x3600000000000000000000000000000000000000`                          |
| Wallet under test        | `0xb79e4987bc58057a322cd9bcface4944dd6a6cc7`                          |
| Wallet type              | Circle agent wallet (created via `circle wallet create`)              |
| Auth session             | `circle wallet status` → `Type: agent`, `Status: VALID`               |

The wallet contract is **not yet deployed on-chain** (Circle MSCA address
reserved via CREATE2, materialized lazily on first send). `eth_getCode`
returns `0x` for the address — we mention this in case Circle's deposit
pre-check is mistakenly resolving the balance through a code-path that
requires the smart-account contract to exist on-chain. The plain ERC-20
`balanceOf(address)` view is independent of that and works correctly,
which is the discrepancy this bug report is about.

## Bug 1 — `circle wallet balance` reports Arc Testnet USDC `decimals: 18`, on-chain value is `6`

### Repro

```bash
circle wallet balance \
  --address 0xb79e4987bc58057a322cd9bcface4944dd6a6cc7 \
  --chain ARC-TESTNET \
  --output json
```

### Expected

`token.decimals` matches what the on-chain USDC contract reports for
`decimals()`. For Arc Testnet, that is `6` (consistent with USDC on
every other EVM chain Circle supports).

### Actual

```json
{
  "data": {
    "balances": [
      {
        "amount": "21",
        "token": {
          "name": "USDC",
          "symbol": "USDC",
          "blockchain": "ARC-TESTNET",
          "decimals": 18,
          "isNative": true
        }
      }
    ]
  }
}
```

`decimals: 18` is wrong. Note that `amount: "21"` is still a
human-readable value, so the bug is confined to the `token.decimals`
metadata field, not the displayed amount. Any downstream code that
multiplies `amount × 10**decimals` to recover atomic units will be
off by 12 orders of magnitude.

### Evidence — on-chain `decimals()` is `6`

```bash
curl -sS -X POST https://rpc.testnet.arc.network \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x3600000000000000000000000000000000000000","data":"0x313ce567"},"latest"]}'
```

```json
{"jsonrpc":"2.0","id":1,"result":"0x0000000000000000000000000000000000000000000000000000000000000006"}
```

`0x06` = `6`.

### Suggested fix

Pull `decimals` from token metadata fetched on-chain (the same
`eth_call` shown above against the configured USDC address per chain),
or — if a static table is preferred for speed — align the Arc Testnet
row of that table with the rest of the USDC catalog (which is `6`
everywhere). The CLI already has the on-chain RPC plumbing (it uses it
for `balanceOf`), so reading `decimals()` once on session start would
close this cleanly. If the discovery surface `/v1/x402/supported` (or
its successor) ends up exposing per-chain USDC decimals, that's also a
safe source — its value for Arc Testnet matches the on-chain `6`.

## Bug 2 — `circle gateway deposit` reports `Current USDC balance is 0` despite the wallet holding USDC

### Repro

Pre-condition: same wallet as above, holding 21 USDC on Arc Testnet
(confirmed via both `circle wallet balance` and raw `balanceOf` —
evidence below).

```bash
circle gateway deposit \
  --address 0xb79e4987bc58057a322cd9bcface4944dd6a6cc7 \
  --amount 5 \
  --chain ARC-TESTNET \
  --method direct
```

### Expected

The deposit either proceeds (or, if it can't proceed for some other
reason, it fails with a reason consistent with what the wallet balance
subcommand reports). The pre-check should not report `Current USDC
balance is 0` while the sibling balance command on the same address /
chain reports 21 USDC.

### Actual

```text
Error: Gateway deposit requires at least 5 USDC on ARC-TESTNET. Current USDC balance is 0.
```

Exit code: `0` (the CLI exits cleanly even though it surfaced an
`Error:` line — separate minor issue worth flagging).

### Evidence — wallet does hold 21 USDC

CLI (same session, immediately before the failing deposit):

```bash
circle wallet balance \
  --address 0xb79e4987bc58057a322cd9bcface4944dd6a6cc7 \
  --chain ARC-TESTNET --output json
```

```json
{"data":{"balances":[{"amount":"21","token":{"name":"USDC","symbol":"USDC","blockchain":"ARC-TESTNET","decimals":18,"isNative":true}}]}}
```

Raw `eth_call` to `balanceOf(address)` on the USDC contract:

```bash
curl -sS -X POST https://rpc.testnet.arc.network \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"eth_call","params":[{"to":"0x3600000000000000000000000000000000000000","data":"0x70a08231000000000000000000000000b79e4987bc58057a322cd9bcface4944dd6a6cc7"},"latest"]}'
```

```json
{"jsonrpc":"2.0","id":2,"result":"0x0000000000000000000000000000000000000000000000000000000001406f40"}
```

`0x1406f40` = `21000000` atomic units = **21 USDC at the actual 6 decimals**.

Smart-account contract is not yet on-chain (this may or may not be
related; flagging just in case the deposit path resolves balance
through a contract that has to exist):

```bash
curl -sS -X POST https://rpc.testnet.arc.network \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":3,"method":"eth_getCode","params":["0xb79e4987bc58057a322cd9bcface4944dd6a6cc7","latest"]}'
```

```json
{"jsonrpc":"2.0","id":3,"result":"0x"}
```

### Suggested fix

Whatever balance-read the `gateway deposit` pre-check uses for Arc
Testnet, align it with the read used by `wallet balance` — that one
returns the right answer against the same address on the same chain.
If the deposit path is using a Gateway-specific indexer or RPC route
that hasn't been wired up for Arc Testnet yet, please either wire it
through to the same RPC the balance command uses, or return a more
specific error (`Arc Testnet not yet supported for Gateway deposits`
or similar) so we know it's a coverage issue rather than a balance
mismatch.

## Funding history (so the repro is reproducible end-to-end)

1. 2026-05-13 ~02:05 UTC: `circle wallet login tomas.cordero.esp@gmail.com --testnet --init` followed by `--otp` step, then `circle wallet create` against the testnet session.
2. `circle wallet fund --chain ARC-TESTNET --token usdc` — succeeded, increased the wallet's USDC balance from `0` to `21` USDC on Arc Testnet.
3. `circle wallet balance --chain ARC-TESTNET` now reports `21` USDC (with the wrong `decimals: 18`, per Bug 1).
4. `circle gateway deposit … --method direct --chain ARC-TESTNET` reports `Current USDC balance is 0`, per Bug 2.

## Impact

This blocks the Sendero agent wallet (a Circle agent wallet) from
depositing into the Gateway pool on Arc Testnet from the CLI, which in
turn blocks x402 settle on Arc Testnet — every paid call against
`/v1/x402` resolves to "Insufficient Gateway balance" because we
cannot route USDC into Gateway through the CLI on this chain. We can
work around it with a direct `GatewayWallet` contract call, but that
defeats the point of having `circle gateway deposit` as a wrapped,
audited entry point. The decimals mis-report on Bug 1 is a smaller
production risk for us specifically (we normalize on the atomic
amount we read from RPC), but it will silently corrupt any agent that
trusts the JSON envelope as the source of truth — which is exactly
what a `--output json` flag invites.

## Workarounds we tried (none worked from the CLI itself)

- `--method eco` instead of `--method direct` — same pre-check, same
  `Current USDC balance is 0`.
- Re-running `circle wallet fund` to push the balance higher — balance
  observed via `wallet balance` increases, deposit pre-check still
  reads `0`.
- Re-logging in (`circle wallet logout` → `login --testnet`) to
  refresh any cached session state — no change.
- Restricting the deposit amount to `--amount 1` — same error,
  rewritten as `at least 1 USDC … Current USDC balance is 0`.
- Forcing the RPC explicitly via `--rpc-url https://rpc.testnet.arc.network`
  on the `wallet balance` side — confirms the balance reads 21 USDC
  against the public RPC; deposit does not accept an `--rpc-url`
  override (or, if it does, the pre-check isn't honoring it).

The only working path today is a direct `GatewayWallet.deposit(...)`
write through `circle wallet execute` (or our own signer), bypassing
`circle gateway deposit` entirely.

## Suggested fix — recap

- **Bug 1 (decimals).** Source `token.decimals` from on-chain
  `decimals()` (or from a per-chain table that has the right value
  for Arc Testnet — `6`, matching every other USDC deployment). The
  CLI already speaks the RPC needed to call `decimals()`.
- **Bug 2 (gateway deposit balance).** Align the balance read used by
  the `gateway deposit` pre-check with the one used by `wallet
  balance`. They should not disagree on the same `(address, chain)`
  pair. If Arc Testnet is not yet supported by the Gateway deposit
  surface, please return a clearer error (`not yet supported` rather
  than `Current USDC balance is 0`).

## Contact

Happy to provide additional traces, transaction hashes from the
faucet drip, or live repro on request. Reachable at
`tomas.cordero.esp@gmail.com`. Thanks for the CLI — overall flow is
genuinely great, and we wanted to file these two cleanly so they
don't bite the next team to land on Arc Testnet.

## Filed where

- GitHub issue on `circlefin/skills` (public Circle repo with issues
  enabled; `circlefin/cli` is private so it's the closest tracker).
- Cross-posted via the Circle Developer Discord `#cli` channel.
- Emailed to the `@circle-fin/cli` package maintainer listed on npm
  (`mengda.lei@circle.com`).
