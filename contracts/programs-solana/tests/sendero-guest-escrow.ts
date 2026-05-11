/**
 * sendero_guest_escrow — Phase 2 smoke test.
 *
 * Verifies the IDL builds + the program ID matches the declared
 * deploy address. The full lifecycle test (pre_fund → claim →
 * reserve → commit → settle, with Ed25519 sibling-instruction)
 * lands in Phase 2.x alongside the test fixtures for the OTP gate
 * and the recipient-bound signature.
 *
 * Run:
 *   cd contracts/programs-solana
 *   bun install
 *   anchor build      # generates target/types/sendero_guest_escrow
 *   anchor test       # spins localnet + runs this + agentic-commerce
 *
 * Why this is enough as a smoke test:
 * - If the Rust program failed to compile to a valid IDL, the
 *   `target/types/sendero_guest_escrow` import would error at the
 *   very top of this file (TS module resolution).
 * - If `declare_id!` in lib.rs drifts from Anchor.toml, the program
 *   ID assertion catches it before any on-chain call.
 *
 * Phase 2.x will add: USDC mint setup → pre_fund_trip → claim_trip
 * with `Ed25519Program.createInstructionWithPublicKey` sibling →
 * reserve / commit / settle / refund, plus negative tests for the
 * bad-sig + bad-OTP paths.
 */

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { expect } from 'chai';

import { SenderoGuestEscrow } from '../target/types/sendero_guest_escrow';

const DECLARED_PROGRAM_ID = '9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8';

describe('sendero_guest_escrow — smoke', () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.SenderoGuestEscrow as Program<SenderoGuestEscrow>;

  it('IDL loads', () => {
    expect(program.idl.metadata?.name ?? program.idl.name).to.equal('sendero_guest_escrow');
  });

  it('program ID matches declare_id! in lib.rs', () => {
    expect(program.programId.toBase58()).to.equal(DECLARED_PROGRAM_ID);
  });

  it('exposes the v1 instruction surface', () => {
    const expected = [
      'initialize',
      'preFundTrip',
      'claimTrip',
      'reserveBooking',
      'commitBooking',
      'settleBooking',
      'refundBooking',
      'reclaimStuckBooking',
      'cancelTrip',
      'sweepTripResidual',
      'setOperator',
      'setPaused',
    ];
    const actual = program.idl.instructions.map(ix => ix.name);
    for (const name of expected) {
      expect(actual).to.include(name);
    }
  });
});
