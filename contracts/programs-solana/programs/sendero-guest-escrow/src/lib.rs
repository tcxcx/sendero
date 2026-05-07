//! `sendero_guest_escrow` — Solana port of SenderoGuestEscrow.sol.
//!
//! Pre-funded guest-link travel escrow. Mirrors the Arc reference
//! implementation. Corporate buyer pre-funds USDC for a named guest;
//! guest claims via an ephemeral keypair (Peanut-Protocol-style,
//! recipient-bound signature) plus an OTP second factor.
//!
//! # Trip lifecycle
//!
//!   PreFunded → (claim) → Active
//!   Active    → (reserve booking) → Reserved
//!   Reserved  → (commit at quoted price) → Committed
//!   Committed → (operator records Duffel order) → Settled
//!   Any state → (cancel / expire) → Refunded
//!
//! # Differences from Solidity reference
//!
//! - **Storage:** No ERC-7201 — Anchor PDAs replace the namespaced slot.
//!   `Trip` PDA seeded by `[b"trip", trip_id]`. `Booking` PDA seeded by
//!   `[b"booking", booking_id]`.
//! - **USDC:** SPL Token escrow. `payment_mint` set at `initialize`.
//! - **Claim signatures:** Solidity uses ECDSA (secp256k1) signatures —
//!   port to Ed25519 via `solana_program::ed25519_program` precompile,
//!   verified by attaching a sibling `Ed25519Program` instruction in the
//!   same transaction. The signed message structure stays the same:
//!   `keccak256("SENDERO_V1_GUEST_CLAIM" || chainid || program_id || trip_id || recipient || nonce)`.
//! - **OTP brute-force lockout:** v1 ports the core flow only. v2 will
//!   add `failed_claim_attempts` + `claim_lockout_until` (matching v3.0.0
//!   of the Arc contract). Decision: 3-strike lockout pattern per Arc.
//! - **Operator role:** A single `operator` Pubkey on `Config`. Sendero
//!   backend signer. Same authorization model as Solidity.
//!
//! # Authorization
//!
//! - `buyer = Trip.buyer` — pre-funds, can force-refund after timeouts.
//! - `guest = Trip.guest_claimant` — set by `claim_trip()` after sig+OTP.
//! - `operator = Config.operator` — reserves / commits / settles bookings.
//!
//! # Phase 2 scope (this turn lays the skeleton, Phase 2 fills it)

use anchor_lang::prelude::*;

declare_id!("9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8");

#[program]
pub mod sendero_guest_escrow {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>, _operator: Pubkey) -> Result<()> {
        // Spec: Init Config PDA at [b"config"]. Set payment_mint, operator,
        // owner. owner = upgrade authority equivalent; operator = Sendero
        // backend signer that can advance booking state.
        Ok(())
    }

    /// Buyer pre-funds a trip for a named guest. Trip starts in PreFunded.
    pub fn pre_fund_trip(
        _ctx: Context<PreFundTrip>,
        _trip_id: [u8; 32],
        _amount: u64,
        _claim_pubkey: Pubkey,
        _expiry: i64,
    ) -> Result<()> {
        // Spec: Allocate Trip PDA, transfer USDC from buyer to escrow PDA
        // token account, record claim_pubkey (Ed25519 pubkey of the
        // ephemeral keypair embedded in the share-link).
        Ok(())
    }

    /// Guest claims the trip with a recipient-bound signature + OTP digest.
    pub fn claim_trip(
        _ctx: Context<ClaimTrip>,
        _trip_id: [u8; 32],
        _otp_hash: [u8; 32],
        _recipient_signature: Vec<u8>,
    ) -> Result<()> {
        // Spec: Verify Ed25519 signature via solana_program::ed25519_program
        // sibling instruction. Verify OTP hash matches stored
        // expected_otp_hash. Set Trip.guest_claimant. Status:
        // PreFunded → Active.
        Ok(())
    }

    /// Operator reserves an upper-bound amount on a booking before
    /// quoting Duffel.
    pub fn reserve_booking(
        _ctx: Context<BookingAction>,
        _trip_id: [u8; 32],
        _booking_id: [u8; 32],
        _upper_bound: u64,
    ) -> Result<()> {
        Ok(())
    }

    /// Operator commits at the actual quoted price ≤ upper_bound.
    pub fn commit_booking(
        _ctx: Context<BookingAction>,
        _booking_id: [u8; 32],
        _quoted_price: u64,
    ) -> Result<()> {
        Ok(())
    }

    /// Operator settles to vendor payout address after Duffel
    /// confirmation lands.
    pub fn settle_booking(
        _ctx: Context<SettleBooking>,
        _booking_id: [u8; 32],
        _duffel_order_ref: [u8; 32],
    ) -> Result<()> {
        Ok(())
    }

    /// Buyer or operator refunds. Conditions per Solidity:
    /// - RESERVED + > 1h since reservation → buyer can force-refund
    /// - COMMITTED + > 30min since commit → buyer can force-refund
    pub fn refund_booking(_ctx: Context<RefundBooking>, _booking_id: [u8; 32]) -> Result<()> {
        Ok(())
    }

    pub fn sweep_trip_residual(_ctx: Context<SweepTrip>, _trip_id: [u8; 32]) -> Result<()> {
        // Status: Active → all unspent USDC back to buyer when trip
        // expires or is cancelled.
        Ok(())
    }
}

// ──────────────────── Account contexts (skeletons) ────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PreFundTrip<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimTrip<'info> {
    /// Sendero relayer pays rent + sends the tx. The actual
    /// authorization comes from the Ed25519 sibling instruction.
    #[account(mut)]
    pub relayer: Signer<'info>,
    /// CHECK: validated against the Ed25519 sibling instruction.
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct BookingAction<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct SettleBooking<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundBooking<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct SweepTrip<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
}

// ──────────────────── State accounts ────────────────────

#[account]
pub struct Config {
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub payment_mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct Trip {
    pub trip_id: [u8; 32],
    pub buyer: Pubkey,
    /// Ed25519 pubkey of the ephemeral guest keypair (embedded in
    /// share-link). After `claim_trip`, this is replaced with the
    /// guest's actual wallet via `guest_claimant`.
    pub claim_pubkey: Pubkey,
    pub guest_claimant: Pubkey,
    pub funded_amount: u64,
    pub spent_amount: u64,
    pub expiry: i64,
    pub status: TripStatus,
    /// SHA-256 of the OTP. Plaintext OTP is delivered out-of-band.
    pub expected_otp_hash: [u8; 32],
    pub bump: u8,
}

#[account]
pub struct Booking {
    pub trip_id: [u8; 32],
    pub booking_id: [u8; 32],
    pub upper_bound: u64,
    pub quoted_price: u64,
    pub vendor_payout: Pubkey,
    pub duffel_order_ref: [u8; 32],
    pub reserved_at: i64,
    pub committed_at: i64,
    pub status: BookingStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TripStatus {
    PreFunded,
    Active,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum BookingStatus {
    Reserved,
    Committed,
    Settled,
    Refunded,
}

// ──────────────────── Errors ────────────────────

#[error_code]
pub enum GuestEscrowError {
    #[msg("Trip does not exist")]
    InvalidTrip,
    #[msg("Booking does not exist")]
    InvalidBooking,
    #[msg("Trip/Booking is not in the required state for this action")]
    WrongStatus,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Trip has expired")]
    Expired,
    #[msg("Claim signature did not verify against the embedded pubkey")]
    InvalidClaimSignature,
    #[msg("OTP hash did not match")]
    InvalidOtp,
    #[msg("Quoted price exceeds upper bound")]
    QuoteExceedsBound,
    #[msg("Insufficient escrow balance")]
    InsufficientFunds,
}
