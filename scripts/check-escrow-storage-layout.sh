#!/usr/bin/env bash
# scripts/check-escrow-storage-layout.sh
#
# CI gate for SenderoGuestEscrow storage upgrade-safety.
#
# The contract uses ERC-7201 namespaced storage exclusively. NO field
# may ever land at a regular storage slot — that would shift slots in a
# future upgrade and corrupt every existing Booking + Trip in storage.
#
# This script asserts `forge inspect ... storageLayout` reports zero
# slots. If a future change accidentally adds a top-level state variable
# (or removes the ERC-7201 wrapper), this exits non-zero and blocks CI.
#
# Run from repo root or contracts/. Used by CI + pre-merge hook.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/contracts"

EXPECTED='{"storage":[],"types":{}}'
ACTUAL="$(forge inspect SenderoGuestEscrow storage --json 2>/dev/null | tr -d '[:space:]')"

if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "[storage-layout] OK — SenderoGuestEscrow has zero regular storage slots (ERC-7201 invariant holds)"
  exit 0
fi

echo "[storage-layout] FAIL — regular storage slots detected in SenderoGuestEscrow."
echo "  expected: $EXPECTED"
echo "  actual:   $ACTUAL"
echo ""
echo "  Cause: a state variable was added outside the ERC-7201 namespaced"
echo "  storage struct. This breaks the upgrade-safety invariant — every"
echo "  existing Booking + Trip slot would shift on the next UUPS upgrade."
echo ""
echo "  Fix: move the new field into GuestEscrowStorage in"
echo "  contracts/src/SenderoGuestEscrow.sol, accessed via _getStorage()."
exit 1
