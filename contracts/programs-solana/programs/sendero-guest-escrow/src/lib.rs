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
//!   Committed → (operator records Duffel order + settles) → Settled
//!   Any state → (cancel / expire / sweep) → Refunded
//!
//! # Differences from Solidity reference
//!
//! - **Storage:** No ERC-7201 — Anchor PDAs replace the namespaced slot.
//!   `Trip` PDA seeded by `[b"trip", trip_id]`. `Booking` PDA seeded by
//!   `[b"booking", booking_id]`. `Vault` SPL TokenAccount seeded by
//!   `[b"vault", trip_id]` and authority is the Trip PDA.
//! - **USDC:** SPL Token escrow. `payment_mint` set at `initialize`.
//! - **Claim signatures:** Solidity uses ECDSA (secp256k1) signatures —
//!   port to Ed25519 via `solana_program::ed25519_program` precompile,
//!   verified by attaching a sibling `Ed25519Program` instruction in the
//!   same transaction. The signed message structure stays the same in
//!   spirit:
//!     `b"SENDERO_V1_GUEST_CLAIM" || program_id || trip_id || guest_claimant`
//! - **OTP brute-force lockout:** v1 ports the core flow only. v2 will
//!   add `failed_claim_attempts` + `claim_lockout_until` (matching v3.0.0
//!   of the Arc contract). Decision: 3-strike lockout pattern per Arc.
//! - **Operator role:** A single `operator` Pubkey on `Config`. Sendero
//!   backend signer. Same authorization model as Solidity. v1 uses an
//!   operator-driven commit path; the guest-signed commit (Solidity
//!   `commitBooking` requires `msg.sender == guestWallet`) ports in v2
//!   alongside Ed25519 verification on commits as well.
//!
//! # Authorization
//!
//! - `buyer = Trip.buyer` — pre-funds, can force-refund after timeouts,
//!   sweeps residual at expiry/cancel.
//! - `guest_claimant = Trip.guest_claimant` — set by `claim_trip` after
//!   sig + OTP. v1 reads it for audit only.
//! - `operator = Config.operator` — reserves / commits / settles /
//!   refunds bookings. Sendero backend signer.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions::{self as ix_sysvar, ID as IX_SYSVAR_ID};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8");

// security.txt — surfaces in Solana Explorer / SolanaFM / Solscan on
// the program page so reviewers, security researchers, and integrators
// can find contact + source + audit links without leaving the explorer.
// Matches the `securityContact` annotation on the Arc Solidity twin.
// `no-entrypoint` skips the macro during the IDL build (where there's
// no entrypoint to attach the ELF section to).
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Sendero Guest Escrow",
    project_url: "https://sendero.travel",
    contacts: "email:security@sendero.travel,link:https://sendero.travel/security,twitter:@senderotravel",
    policy: "https://sendero.travel/security/policy",
    preferred_languages: "en,es,pt",
    source_code: "https://github.com/criptopoeta/sendero/tree/main/contracts/programs-solana/programs/sendero-guest-escrow",
    auditors: "Unaudited — testnet beta. Mainnet promotion gated on third-party audit."
}

const CONFIG_SEED: &[u8] = b"config";
const TRIP_SEED: &[u8] = b"trip";
const BOOKING_SEED: &[u8] = b"booking";
const VAULT_SEED: &[u8] = b"vault";

/// Domain separator baked into claim signatures. Combined with the
/// program ID + trip_id + guest_claimant for cross-program safety.
/// Mirrors `SENDERO_SALT` in the Solidity reference.
const SENDERO_CLAIM_SALT: &[u8] = b"SENDERO_V1_GUEST_CLAIM";

/// Buyer can force-refund a Reserved booking this long after
/// reservation if the operator never progresses it.
const RESERVE_TIMEOUT_SECS: i64 = 60 * 60; // 1h
/// Buyer can force-refund a Committed booking this long after commit
/// if Duffel confirmation never lands.
const CONFIRM_TIMEOUT_SECS: i64 = 30 * 60; // 30min

#[program]
pub mod sendero_guest_escrow {
    use super::*;

    /// One-time init. Creates the Config PDA. Caller becomes owner;
    /// `operator` is the Sendero backend signer that drives the
    /// booking lifecycle.
    pub fn initialize(ctx: Context<Initialize>, operator: Pubkey) -> Result<()> {
        require!(operator != Pubkey::default(), GuestEscrowError::ZeroAddress);

        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.admin.key();
        config.operator = operator;
        config.payment_mint = ctx.accounts.payment_mint.key();
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit!(EscrowInitialized {
            owner: config.owner,
            operator: config.operator,
            payment_mint: config.payment_mint,
        });
        Ok(())
    }

    /// Buyer pre-funds a trip for a named guest. Trip starts in
    /// `PreFunded`. USDC moves from the buyer's token account into a
    /// per-trip vault PDA owned by the Trip account.
    ///
    /// `claim_pubkey` is the Ed25519 pubkey of the ephemeral keypair
    /// embedded in the share-link. `expected_otp_hash` is SHA-256 of
    /// the OTP (plaintext delivered out-of-band).
    pub fn pre_fund_trip(
        ctx: Context<PreFundTrip>,
        trip_id: [u8; 32],
        amount: u64,
        claim_pubkey: Pubkey,
        expiry: i64,
        expected_otp_hash: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GuestEscrowError::Paused);
        require!(amount > 0, GuestEscrowError::ZeroValue);
        require!(claim_pubkey != Pubkey::default(), GuestEscrowError::ZeroAddress);
        let now = Clock::get()?.unix_timestamp;
        require!(expiry > now, GuestEscrowError::Expired);

        // Move USDC from buyer → vault.
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.buyer_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;

        let trip = &mut ctx.accounts.trip;
        trip.trip_id = trip_id;
        trip.buyer = ctx.accounts.buyer.key();
        trip.claim_pubkey = claim_pubkey;
        trip.guest_claimant = Pubkey::default();
        trip.funded_amount = amount;
        trip.reserved_amount = 0;
        trip.spent_amount = 0;
        trip.expiry = expiry;
        trip.status = TripStatus::PreFunded;
        trip.expected_otp_hash = expected_otp_hash;
        trip.swept = false;
        trip.bump = ctx.bumps.trip;

        emit!(TripPreFunded {
            trip_id,
            buyer: trip.buyer,
            claim_pubkey,
            amount,
            expiry,
        });
        Ok(())
    }

    /// Guest claims the trip with a recipient-bound Ed25519 signature
    /// (verified by the sibling `Ed25519Program` instruction) plus the
    /// OTP preimage. Status: `PreFunded → Active`.
    ///
    /// Caller is a relayer (Sendero backend or guest's own wallet);
    /// authorization comes from the Ed25519 sig + OTP, not from the
    /// transaction signer.
    pub fn claim_trip(
        ctx: Context<ClaimTrip>,
        trip_id: [u8; 32],
        otp_preimage: Vec<u8>,
        guest_claimant: Pubkey,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GuestEscrowError::Paused);
        let trip = &mut ctx.accounts.trip;
        require!(trip.status == TripStatus::PreFunded, GuestEscrowError::WrongStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now < trip.expiry, GuestEscrowError::Expired);
        require!(guest_claimant != Pubkey::default(), GuestEscrowError::ZeroAddress);

        // OTP gate: SHA-256(otp_preimage) must equal expected_otp_hash.
        let otp_hash = anchor_lang::solana_program::hash::hash(&otp_preimage).to_bytes();
        require!(
            otp_hash == trip.expected_otp_hash,
            GuestEscrowError::InvalidOtp
        );

        // Build the canonical signed message:
        //   SENDERO_V1_GUEST_CLAIM || program_id || trip_id || guest_claimant
        let program_id = crate::ID;
        let mut msg = Vec::with_capacity(
            SENDERO_CLAIM_SALT.len() + 32 + 32 + 32,
        );
        msg.extend_from_slice(SENDERO_CLAIM_SALT);
        msg.extend_from_slice(program_id.as_ref());
        msg.extend_from_slice(&trip_id);
        msg.extend_from_slice(guest_claimant.as_ref());

        // Verify a sibling Ed25519Program instruction at index 0 of
        // this transaction signed `msg` with `trip.claim_pubkey`.
        verify_ed25519_sibling_ix(
            &ctx.accounts.instructions_sysvar,
            &trip.claim_pubkey,
            &msg,
        )?;

        trip.guest_claimant = guest_claimant;
        trip.status = TripStatus::Active;

        emit!(TripClaimed {
            trip_id,
            guest_claimant,
        });
        Ok(())
    }

    /// Operator reserves an upper-bound amount on a booking before
    /// quoting Duffel. v1: operator-only. Booking PDA created here.
    pub fn reserve_booking(
        ctx: Context<ReserveBooking>,
        trip_id: [u8; 32],
        booking_id: [u8; 32],
        upper_bound: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GuestEscrowError::Paused);
        require!(
            ctx.accounts.config.operator == ctx.accounts.operator.key(),
            GuestEscrowError::Unauthorized
        );
        let trip = &mut ctx.accounts.trip;
        require!(trip.status == TripStatus::Active, GuestEscrowError::WrongStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now < trip.expiry, GuestEscrowError::Expired);
        require!(upper_bound > 0, GuestEscrowError::ZeroValue);

        let available = trip
            .funded_amount
            .checked_sub(trip.reserved_amount)
            .and_then(|v| v.checked_sub(trip.spent_amount))
            .ok_or(GuestEscrowError::InsufficientFunds)?;
        require!(upper_bound <= available, GuestEscrowError::InsufficientFunds);

        trip.reserved_amount = trip
            .reserved_amount
            .checked_add(upper_bound)
            .ok_or(GuestEscrowError::InsufficientFunds)?;

        let booking = &mut ctx.accounts.booking;
        booking.trip_id = trip_id;
        booking.booking_id = booking_id;
        booking.upper_bound = upper_bound;
        booking.actual_amount = 0;
        booking.fee_amount = 0;
        booking.vendor = Pubkey::default();
        booking.duffel_order_ref = [0u8; 32];
        booking.reserved_at = now;
        booking.committed_at = 0;
        booking.status = BookingStatus::Reserved;
        booking.bump = ctx.bumps.booking;

        emit!(BookingReserved {
            trip_id,
            booking_id,
            upper_bound,
        });
        Ok(())
    }

    /// Operator commits at the actual quoted price (≤ upper_bound) and
    /// records the vendor + fee split. v1: operator-only.
    pub fn commit_booking(
        ctx: Context<BookingAdmin>,
        _trip_id: [u8; 32],
        _booking_id: [u8; 32],
        vendor_amount: u64,
        fee_amount: u64,
        vendor: Pubkey,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GuestEscrowError::Paused);
        require!(
            ctx.accounts.config.operator == ctx.accounts.operator.key(),
            GuestEscrowError::Unauthorized
        );
        require!(vendor != Pubkey::default(), GuestEscrowError::ZeroAddress);

        let booking = &mut ctx.accounts.booking;
        require!(
            booking.status == BookingStatus::Reserved,
            GuestEscrowError::WrongStatus
        );

        let actual = vendor_amount
            .checked_add(fee_amount)
            .ok_or(GuestEscrowError::QuoteExceedsBound)?;
        require!(actual > 0, GuestEscrowError::ZeroValue);
        require!(actual <= booking.upper_bound, GuestEscrowError::QuoteExceedsBound);

        // Slack returns to the trip's available pool — drop reserved
        // by the difference, set booking.upper_bound to actual.
        let slack = booking.upper_bound - actual;
        if slack > 0 {
            let trip = &mut ctx.accounts.trip;
            trip.reserved_amount = trip
                .reserved_amount
                .checked_sub(slack)
                .ok_or(GuestEscrowError::InsufficientFunds)?;
            booking.upper_bound = actual;
        }

        let now = Clock::get()?.unix_timestamp;
        booking.actual_amount = actual;
        booking.fee_amount = fee_amount;
        booking.vendor = vendor;
        booking.committed_at = now;
        booking.status = BookingStatus::Committed;

        emit!(BookingCommitted {
            booking_id: booking.booking_id,
            vendor_amount,
            fee_amount,
            vendor,
            slack,
        });
        Ok(())
    }

    /// Operator settles after Duffel confirmation lands. Splits the
    /// vault: `vendor_amount` → vendor token account, `fee_amount` →
    /// operator token account. Status: `Committed → Settled`.
    pub fn settle_booking(
        ctx: Context<SettleBooking>,
        trip_id: [u8; 32],
        _booking_id: [u8; 32],
        duffel_order_ref: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GuestEscrowError::Paused);
        require!(
            ctx.accounts.config.operator == ctx.accounts.operator.key(),
            GuestEscrowError::Unauthorized
        );
        require!(duffel_order_ref != [0u8; 32], GuestEscrowError::ZeroValue);

        // Defense-in-depth: vendor_token_account and operator_token_account
        // must NOT be the same account. If they were, the second SPL
        // transfer would over-credit the same account and the
        // bookkeeping math (settle_amount split into vendor + fee)
        // would silently lose track of the fee leg's destination.
        require!(
            ctx.accounts.vendor_token_account.key() != ctx.accounts.operator_token_account.key(),
            GuestEscrowError::DuplicateTokenAccount
        );

        let booking = &ctx.accounts.booking;
        require!(
            booking.status == BookingStatus::Committed,
            GuestEscrowError::WrongStatus
        );
        require!(
            booking.vendor == ctx.accounts.vendor_token_account.owner,
            GuestEscrowError::Unauthorized
        );

        let vendor_amount = booking.actual_amount.saturating_sub(booking.fee_amount);
        let fee_amount = booking.fee_amount;
        let total = booking.actual_amount;

        let trip_bump = ctx.accounts.trip.bump;
        let signer_seeds: &[&[u8]] = &[TRIP_SEED, &trip_id, &[trip_bump]];
        let signer = &[signer_seeds];

        // vendor leg
        if vendor_amount > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.vendor_token_account.to_account_info(),
                    authority: ctx.accounts.trip.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi, vendor_amount)?;
        }

        // operator fee leg
        if fee_amount > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.operator_token_account.to_account_info(),
                    authority: ctx.accounts.trip.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi, fee_amount)?;
        }

        // Effects after interactions: state already gated above.
        let trip = &mut ctx.accounts.trip;
        trip.reserved_amount = trip
            .reserved_amount
            .checked_sub(total)
            .ok_or(GuestEscrowError::InsufficientFunds)?;
        trip.spent_amount = trip
            .spent_amount
            .checked_add(total)
            .ok_or(GuestEscrowError::InsufficientFunds)?;

        let booking = &mut ctx.accounts.booking;
        booking.duffel_order_ref = duffel_order_ref;
        booking.status = BookingStatus::Settled;

        emit!(BookingSettled {
            booking_id: booking.booking_id,
            vendor: booking.vendor,
            vendor_amount,
            fee_amount,
            duffel_order_ref,
        });
        Ok(())
    }

    /// Operator-initiated refund. Releases the booking's reservation
    /// back to the trip's available pool. Status: `Reserved | Committed
    /// → Refunded`. No on-chain token transfer — the funds were always
    /// in the trip vault, only the bookkeeping changes.
    pub fn refund_booking(
        ctx: Context<BookingAdmin>,
        _trip_id: [u8; 32],
        _booking_id: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GuestEscrowError::Paused);
        require!(
            ctx.accounts.config.operator == ctx.accounts.operator.key(),
            GuestEscrowError::Unauthorized
        );

        let booking = &mut ctx.accounts.booking;
        require!(
            booking.status == BookingStatus::Reserved
                || booking.status == BookingStatus::Committed,
            GuestEscrowError::WrongStatus
        );

        let amt = booking.upper_bound;
        let trip = &mut ctx.accounts.trip;
        trip.reserved_amount = trip
            .reserved_amount
            .checked_sub(amt)
            .ok_or(GuestEscrowError::InsufficientFunds)?;
        booking.status = BookingStatus::Refunded;

        emit!(BookingRefunded {
            booking_id: booking.booking_id,
            amount: amt,
        });
        Ok(())
    }

    /// Buyer-initiated force-refund after timeouts.
    /// - Reserved + > RESERVE_TIMEOUT since reservation → ok
    /// - Committed (no Duffel ref) + > CONFIRM_TIMEOUT since commit → ok
    pub fn reclaim_stuck_booking(
        ctx: Context<BuyerReclaim>,
        _trip_id: [u8; 32],
        _booking_id: [u8; 32],
    ) -> Result<()> {
        let booking = &mut ctx.accounts.booking;
        let trip = &mut ctx.accounts.trip;
        require!(
            ctx.accounts.buyer.key() == trip.buyer,
            GuestEscrowError::Unauthorized
        );

        let now = Clock::get()?.unix_timestamp;
        match booking.status {
            BookingStatus::Reserved => {
                require!(
                    now > booking.reserved_at + RESERVE_TIMEOUT_SECS,
                    GuestEscrowError::NotYetReclaimable
                );
            }
            BookingStatus::Committed => {
                require!(
                    booking.duffel_order_ref == [0u8; 32],
                    GuestEscrowError::AlreadyConfirmed
                );
                require!(
                    now > booking.committed_at + CONFIRM_TIMEOUT_SECS,
                    GuestEscrowError::NotYetReclaimable
                );
            }
            _ => return err!(GuestEscrowError::WrongStatus),
        }

        let amt = booking.upper_bound;
        trip.reserved_amount = trip
            .reserved_amount
            .checked_sub(amt)
            .ok_or(GuestEscrowError::InsufficientFunds)?;
        booking.status = BookingStatus::Refunded;

        emit!(BookingReclaimed {
            booking_id: booking.booking_id,
            amount: amt,
        });
        Ok(())
    }

    /// Buyer or operator cancels the trip. Requires no outstanding
    /// reservations (caller refunds bookings first).
    pub fn cancel_trip(ctx: Context<CancelTrip>, _trip_id: [u8; 32]) -> Result<()> {
        let trip = &mut ctx.accounts.trip;
        let caller = ctx.accounts.caller.key();
        require!(
            caller == trip.buyer || caller == ctx.accounts.config.operator,
            GuestEscrowError::Unauthorized
        );
        require!(
            trip.status != TripStatus::Cancelled && trip.status != TripStatus::Expired,
            GuestEscrowError::WrongStatus
        );
        require!(trip.reserved_amount == 0, GuestEscrowError::ReservationsOutstanding);

        trip.status = TripStatus::Cancelled;
        emit!(TripCancelled { trip_id: trip.trip_id });
        Ok(())
    }

    /// Buyer or operator sweeps unspent USDC back to the buyer once
    /// the trip is cancelled or expired. Idempotent: `swept` flag
    /// guards re-entry.
    pub fn sweep_trip_residual(
        ctx: Context<SweepTrip>,
        trip_id: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let caller = ctx.accounts.caller.key();

        // Read-only checks first, then drop the borrow before the CPI
        // so the same `ctx.accounts.trip` can serve as `authority`.
        {
            let trip = &ctx.accounts.trip;
            require!(
                caller == trip.buyer || caller == ctx.accounts.config.operator,
                GuestEscrowError::Unauthorized
            );
            require!(
                trip.status == TripStatus::Cancelled || now >= trip.expiry,
                GuestEscrowError::StillActive
            );
            require!(!trip.swept, GuestEscrowError::NothingToSweep);
            require!(trip.reserved_amount == 0, GuestEscrowError::ReservationsOutstanding);
        }

        let returnable = ctx
            .accounts
            .trip
            .funded_amount
            .checked_sub(ctx.accounts.trip.spent_amount)
            .ok_or(GuestEscrowError::NothingToSweep)?;
        require!(returnable > 0, GuestEscrowError::NothingToSweep);

        let trip_bump = ctx.accounts.trip.bump;
        let signer_seeds: &[&[u8]] = &[TRIP_SEED, &trip_id, &[trip_bump]];
        let signer = &[signer_seeds];
        let cpi = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.trip.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi, returnable)?;

        // Effects after interactions — re-borrow mutably now that the
        // CPI is done.
        let trip = &mut ctx.accounts.trip;
        trip.swept = true;
        if now >= trip.expiry && trip.status != TripStatus::Cancelled {
            trip.status = TripStatus::Expired;
        }
        emit!(TripSwept {
            trip_id,
            amount: returnable,
        });
        Ok(())
    }

    /// Owner rotates the operator. Mirrors Solidity `setOperator`.
    pub fn set_operator(ctx: Context<OwnerOnly>, new_operator: Pubkey) -> Result<()> {
        require!(new_operator != Pubkey::default(), GuestEscrowError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        require!(
            config.owner == ctx.accounts.owner.key(),
            GuestEscrowError::Unauthorized
        );
        config.operator = new_operator;
        emit!(OperatorUpdated { operator: new_operator });
        Ok(())
    }

    /// Owner pauses / unpauses. Pause blocks pre-fund / claim / booking
    /// lifecycle but never the buyer's reclaim/sweep paths — buyers
    /// must always be able to extract funds.
    pub fn set_paused(ctx: Context<OwnerOnly>, paused: bool) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.owner == ctx.accounts.owner.key(),
            GuestEscrowError::Unauthorized
        );
        config.paused = paused;
        emit!(PausedSet { paused });
        Ok(())
    }
}

// ──────────────────── Ed25519 sibling-instruction verification ────────────────────

/// Verify that the FIRST instruction of the current transaction is a
/// call to the Ed25519Program signing `expected_msg` with
/// `expected_pubkey`.
///
/// Layout reference: https://docs.solanalabs.com/runtime/programs#ed25519-program
///
///   data[0]                      = number of signatures (we require 1)
///   data[1]                      = padding (must be 0)
///   data[2..4]                   = signature_offset (u16 LE)
///   data[4..6]                   = signature_instruction_index (u16 LE, `u16::MAX` = same ix)
///   data[6..8]                   = public_key_offset (u16 LE)
///   data[8..10]                  = public_key_instruction_index (u16 LE)
///   data[10..12]                 = message_data_offset (u16 LE)
///   data[12..14]                 = message_data_size (u16 LE)
///   data[14..16]                 = message_instruction_index (u16 LE)
///   then the actual signature, pubkey, and message payload follow.
fn verify_ed25519_sibling_ix(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &Pubkey,
    expected_msg: &[u8],
) -> Result<()> {
    require_keys_eq!(
        *instructions_sysvar.key,
        IX_SYSVAR_ID,
        GuestEscrowError::InvalidClaimSignature
    );

    let ix = ix_sysvar::load_instruction_at_checked(0, instructions_sysvar)
        .map_err(|_| error!(GuestEscrowError::InvalidClaimSignature))?;
    require_keys_eq!(
        ix.program_id,
        ed25519_program::ID,
        GuestEscrowError::InvalidClaimSignature
    );

    let data = &ix.data;
    require!(data.len() >= 16, GuestEscrowError::InvalidClaimSignature);
    require!(data[0] == 1 && data[1] == 0, GuestEscrowError::InvalidClaimSignature);

    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let msg_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let msg_size = u16::from_le_bytes([data[12], data[13]]) as usize;

    require!(
        data.len() >= pubkey_offset + 32,
        GuestEscrowError::InvalidClaimSignature
    );
    require!(
        data.len() >= msg_offset + msg_size,
        GuestEscrowError::InvalidClaimSignature
    );

    let pk_bytes = &data[pubkey_offset..pubkey_offset + 32];
    let msg_bytes = &data[msg_offset..msg_offset + msg_size];

    require!(
        pk_bytes == expected_pubkey.as_ref(),
        GuestEscrowError::InvalidClaimSignature
    );
    require!(
        msg_bytes == expected_msg,
        GuestEscrowError::InvalidClaimSignature
    );
    Ok(())
}

// ──────────────────── Account contexts ────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub payment_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32])]
pub struct PreFundTrip<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = buyer,
        space = Trip::DISCRIMINATOR.len() + Trip::INIT_SPACE,
        seeds = [TRIP_SEED, &trip_id],
        bump
    )]
    pub trip: Account<'info, Trip>,
    #[account(address = config.payment_mint)]
    pub payment_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        seeds = [VAULT_SEED, &trip_id],
        bump,
        token::mint = payment_mint,
        token::authority = trip,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = payment_mint, token::authority = buyer)]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32])]
pub struct ClaimTrip<'info> {
    /// Sendero relayer pays rent + sends the tx. The actual
    /// authorization comes from the Ed25519 sibling instruction.
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
    /// CHECK: validated against `IX_SYSVAR_ID` inside the handler.
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32], booking_id: [u8; 32])]
pub struct ReserveBooking<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
    #[account(
        init,
        payer = operator,
        space = Booking::DISCRIMINATOR.len() + Booking::INIT_SPACE,
        seeds = [BOOKING_SEED, &booking_id],
        bump
    )]
    pub booking: Account<'info, Booking>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32], booking_id: [u8; 32])]
pub struct BookingAdmin<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
    #[account(
        mut,
        seeds = [BOOKING_SEED, &booking_id],
        bump = booking.bump,
        constraint = booking.trip_id == trip_id @ GuestEscrowError::InvalidBooking,
    )]
    pub booking: Account<'info, Booking>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32], booking_id: [u8; 32])]
pub struct SettleBooking<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
    #[account(
        mut,
        seeds = [BOOKING_SEED, &booking_id],
        bump = booking.bump,
        constraint = booking.trip_id == trip_id @ GuestEscrowError::InvalidBooking,
    )]
    pub booking: Account<'info, Booking>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &trip_id],
        bump,
        token::authority = trip,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = config.payment_mint)]
    pub vendor_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.payment_mint,
        token::authority = config.operator
    )]
    pub operator_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32], booking_id: [u8; 32])]
pub struct BuyerReclaim<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
    #[account(
        mut,
        seeds = [BOOKING_SEED, &booking_id],
        bump = booking.bump,
        constraint = booking.trip_id == trip_id @ GuestEscrowError::InvalidBooking,
    )]
    pub booking: Account<'info, Booking>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32])]
pub struct CancelTrip<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
}

#[derive(Accounts)]
#[instruction(trip_id: [u8; 32])]
pub struct SweepTrip<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [TRIP_SEED, &trip_id], bump = trip.bump)]
    pub trip: Account<'info, Trip>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &trip_id],
        bump,
        token::authority = trip,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.payment_mint,
        token::authority = trip.buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

// ──────────────────── State accounts ────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub payment_mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Trip {
    pub trip_id: [u8; 32],
    pub buyer: Pubkey,
    /// Ed25519 pubkey of the ephemeral guest keypair (embedded in
    /// share-link). After `claim_trip`, this is replaced with the
    /// guest's actual wallet via `guest_claimant`.
    pub claim_pubkey: Pubkey,
    pub guest_claimant: Pubkey,
    pub funded_amount: u64,
    pub reserved_amount: u64,
    pub spent_amount: u64,
    pub expiry: i64,
    pub status: TripStatus,
    /// SHA-256 of the OTP. Plaintext OTP is delivered out-of-band.
    pub expected_otp_hash: [u8; 32],
    pub swept: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Booking {
    pub trip_id: [u8; 32],
    pub booking_id: [u8; 32],
    /// Mutates from upper-bound to actual_amount on commit (slack
    /// returns to the trip's available pool).
    pub upper_bound: u64,
    pub actual_amount: u64,
    pub fee_amount: u64,
    pub vendor: Pubkey,
    pub duffel_order_ref: [u8; 32],
    pub reserved_at: i64,
    pub committed_at: i64,
    pub status: BookingStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TripStatus {
    PreFunded,
    Active,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
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
    #[msg("Booking does not match the supplied trip")]
    InvalidBooking,
    #[msg("Trip/Booking is not in the required state for this action")]
    WrongStatus,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Trip has expired")]
    Expired,
    #[msg("Trip is still active and cannot be swept")]
    StillActive,
    #[msg("Trip has outstanding reservations")]
    ReservationsOutstanding,
    #[msg("Nothing to sweep")]
    NothingToSweep,
    #[msg("Booking is not yet reclaimable (timeouts not elapsed)")]
    NotYetReclaimable,
    #[msg("Booking already has a Duffel confirmation recorded")]
    AlreadyConfirmed,
    #[msg("Claim signature did not verify against the embedded pubkey + message")]
    InvalidClaimSignature,
    #[msg("OTP preimage hash did not match")]
    InvalidOtp,
    #[msg("Quoted price exceeds upper bound")]
    QuoteExceedsBound,
    #[msg("Insufficient escrow balance")]
    InsufficientFunds,
    #[msg("Address cannot be the default/zero pubkey")]
    ZeroAddress,
    #[msg("Value must be greater than zero")]
    ZeroValue,
    #[msg("Program is paused")]
    Paused,
    #[msg("vendor and operator token accounts must differ — duplicate would lose the fee leg")]
    DuplicateTokenAccount,
}

// ──────────────────── Events ────────────────────

#[event]
pub struct EscrowInitialized {
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub payment_mint: Pubkey,
}

#[event]
pub struct TripPreFunded {
    pub trip_id: [u8; 32],
    pub buyer: Pubkey,
    pub claim_pubkey: Pubkey,
    pub amount: u64,
    pub expiry: i64,
}

#[event]
pub struct TripClaimed {
    pub trip_id: [u8; 32],
    pub guest_claimant: Pubkey,
}

#[event]
pub struct BookingReserved {
    pub trip_id: [u8; 32],
    pub booking_id: [u8; 32],
    pub upper_bound: u64,
}

#[event]
pub struct BookingCommitted {
    pub booking_id: [u8; 32],
    pub vendor_amount: u64,
    pub fee_amount: u64,
    pub vendor: Pubkey,
    pub slack: u64,
}

#[event]
pub struct BookingSettled {
    pub booking_id: [u8; 32],
    pub vendor: Pubkey,
    pub vendor_amount: u64,
    pub fee_amount: u64,
    pub duffel_order_ref: [u8; 32],
}

#[event]
pub struct BookingRefunded {
    pub booking_id: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct BookingReclaimed {
    pub booking_id: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct TripCancelled {
    pub trip_id: [u8; 32],
}

#[event]
pub struct TripSwept {
    pub trip_id: [u8; 32],
    pub amount: u64,
}

#[event]
pub struct OperatorUpdated {
    pub operator: Pubkey,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}
