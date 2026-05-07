//! `agentic_commerce` — Solana port of ERC-8183 AgenticCommerce.
//!
//! Mirrors the Arc reference implementation
//! (`AgenticCommerce.sol`, deployed at
//! `0x0747EEf0706327138c69792bF28Cd525089e4583` on Arc Testnet).
//!
//! # Job lifecycle (matches Solidity exactly)
//!
//!   Open → Funded → Submitted → Completed
//!                ↘ Rejected
//!                ↘ Expired (claim_refund after expiredAt)
//!
//! # Differences from Solidity reference
//!
//! - **Storage:** Each `Job` lives at a PDA seeded by
//!   `[b"job", job_counter.to_le_bytes()]`. Counter on a singleton
//!   `Config` PDA (`[b"config"]`) — equivalent to `jobCounter` storage var.
//! - **USDC:** SPL Token transfers with `anchor_spl::token`. `paymentToken`
//!   is the USDC mint configured at `initialize`. Devnet mint
//!   `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
//! - **Hooks:** Solidity's `IACPHook` callbacks become CPI calls into a
//!   user-supplied `hook_program` when `Job.hook_program` is non-default.
//!   Whitelist enforced via `Config.whitelisted_hooks` Vec.
//! - **Fees:** Same bps math (platform_fee_bp + evaluator_fee_bp ≤ 10000).
//!   Treasury is a token-account address, not a wallet — caller passes it.
//! - **Reentrancy:** Anchor's account-mutability + CPI guard handles this
//!   without explicit reentrancy lock. We still use `#[access_control(...)]`
//!   to assert state transitions atomically.
//!
//! # Authorization model
//!
//! - `client = Job.client` — only the client can `fund` / `complete`
//!   (when client is also evaluator) / call `set_provider` while the
//!   provider is still default.
//! - `provider = Job.provider` — only the provider can `set_budget` /
//!   `submit`.
//! - `evaluator = Job.evaluator` — only the evaluator can `complete` /
//!   `reject` after `Funded`/`Submitted`.

use anchor_lang::prelude::*;

declare_id!("4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9");

#[program]
pub mod agentic_commerce {
    use super::*;

    /// One-time init. Sets payment_mint (USDC), platform fee config, admin.
    pub fn initialize(_ctx: Context<Initialize>, _admin: Pubkey) -> Result<()> {
        // Phase 1 — implementation lands in next turn.
        // Spec:
        //   - Init Config PDA singleton at seeds=[b"config"].
        //   - Set payment_mint, platform_fee_bp=0, evaluator_fee_bp=0.
        //   - Set admin (multisig pubkey for production).
        //   - Whitelist Pubkey::default() as the no-op hook.
        Ok(())
    }

    /// Create a new job. Mirrors `createJob(provider, evaluator, expiredAt, description, hook)`.
    /// Allocates a `Job` PDA, increments `Config.job_counter`, sets status=Open.
    pub fn create_job(
        _ctx: Context<CreateJob>,
        _provider: Pubkey,
        _evaluator: Pubkey,
        _expired_at: i64,
        _description: String,
        _hook_program: Pubkey,
    ) -> Result<()> {
        // Spec:
        //   - Assert evaluator != Pubkey::default()
        //   - Assert expired_at > Clock::get()?.unix_timestamp + 5 minutes
        //   - Assert hook_program is whitelisted (or default)
        //   - Emit JobCreated event mirroring Solidity event signature
        Ok(())
    }

    pub fn set_provider(_ctx: Context<JobAction>, _provider: Pubkey) -> Result<()> {
        // Solidity's setProvider — only the client can call, only when status=Open
        // and current provider is default.
        Ok(())
    }

    pub fn set_budget(_ctx: Context<JobAction>, _amount: u64) -> Result<()> {
        // Provider sets price. Stamps `job_has_budget=true`.
        Ok(())
    }

    pub fn fund(_ctx: Context<FundJob>) -> Result<()> {
        // Client transfers USDC from their token account into the escrow
        // PDA's token account. Status: Open → Funded.
        // Pre: provider != default, block.timestamp < expired_at, status=Open.
        Ok(())
    }

    pub fn submit(_ctx: Context<JobAction>, _deliverable: [u8; 32]) -> Result<()> {
        // Provider submits 32-byte deliverable hash. Status → Submitted.
        Ok(())
    }

    pub fn complete(_ctx: Context<CompleteJob>, _reason: [u8; 32]) -> Result<()> {
        // Evaluator approves. Status → Completed. Splits escrow to:
        //   - platform_treasury: (budget * platform_fee_bp) / 10000
        //   - evaluator: (budget * evaluator_fee_bp) / 10000
        //   - provider: net (the rest)
        // All transfers via anchor_spl::token::transfer with the escrow PDA
        // signer seeds.
        Ok(())
    }

    pub fn reject(_ctx: Context<JobAction>, _reason: [u8; 32]) -> Result<()> {
        // Open → client only. Funded/Submitted → evaluator only.
        // Refunds full budget to client when funds were already in escrow.
        Ok(())
    }

    pub fn claim_refund(_ctx: Context<ClaimRefund>) -> Result<()> {
        // Anyone can call after expired_at if status ∈ {Funded, Submitted}.
        // Status → Expired, full budget refunded to client.
        Ok(())
    }
}

// ──────────────────── Account contexts (skeletons — bodies in Phase 1) ────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JobAction<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct FundJob<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
}

#[derive(Accounts)]
pub struct CompleteJob<'info> {
    #[account(mut)]
    pub evaluator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
}

// ──────────────────── State accounts ────────────────────

#[account]
pub struct Config {
    /// Admin signer — can update fees, treasury, hook whitelist.
    pub admin: Pubkey,
    /// USDC mint (SPL token) — devnet `4zMMC9srt5Ri…`.
    pub payment_mint: Pubkey,
    /// Token account that receives the platform fee cut. Treasury MSCA.
    pub platform_treasury: Pubkey,
    /// 0-10000 basis points. platform_fee_bp + evaluator_fee_bp ≤ 10000.
    pub platform_fee_bp: u16,
    pub evaluator_fee_bp: u16,
    /// Auto-incrementing job id seeder. Mirrors Solidity `jobCounter`.
    pub job_counter: u64,
    /// Whitelisted hook programs. Default `Pubkey::default()` always allowed.
    pub whitelisted_hooks: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
pub struct Job {
    pub id: u64,
    pub client: Pubkey,
    pub provider: Pubkey,
    pub evaluator: Pubkey,
    /// Free-form. Bound at 256 bytes to keep PDA size stable.
    pub description: String,
    pub budget: u64,
    pub expired_at: i64,
    pub status: JobStatus,
    pub hook_program: Pubkey,
    pub has_budget: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
    Open,
    Funded,
    Submitted,
    Completed,
    Rejected,
    Expired,
}

// ──────────────────── Errors (mirror Solidity's custom errors) ────────────────────

#[error_code]
pub enum AgenticCommerceError {
    #[msg("Job does not exist or invalid id")]
    InvalidJob,
    #[msg("Job is not in the required state for this action")]
    WrongStatus,
    #[msg("Caller is not authorized for this action")]
    Unauthorized,
    #[msg("Address cannot be the default/zero pubkey")]
    ZeroAddress,
    #[msg("Expiry must be at least 5 minutes in the future")]
    ExpiryTooShort,
    #[msg("Budget must be greater than zero")]
    ZeroBudget,
    #[msg("Provider has not been set")]
    ProviderNotSet,
    #[msg("platform_fee_bp + evaluator_fee_bp exceeds 10000")]
    FeesTooHigh,
    #[msg("Hook program is not whitelisted")]
    HookNotWhitelisted,
}

// ──────────────────── Events (mirror Solidity events) ────────────────────

#[event]
pub struct JobCreated {
    pub job_id: u64,
    pub client: Pubkey,
    pub provider: Pubkey,
    pub evaluator: Pubkey,
    pub expired_at: i64,
    pub hook_program: Pubkey,
}

#[event]
pub struct BudgetSet {
    pub job_id: u64,
    pub amount: u64,
}

#[event]
pub struct JobFunded {
    pub job_id: u64,
    pub client: Pubkey,
    pub amount: u64,
}

#[event]
pub struct JobSubmitted {
    pub job_id: u64,
    pub provider: Pubkey,
    pub deliverable: [u8; 32],
}

#[event]
pub struct JobCompleted {
    pub job_id: u64,
    pub evaluator: Pubkey,
    pub reason: [u8; 32],
}

#[event]
pub struct JobRejected {
    pub job_id: u64,
    pub rejector: Pubkey,
    pub reason: [u8; 32],
}

#[event]
pub struct JobExpired {
    pub job_id: u64,
}

#[event]
pub struct PaymentReleased {
    pub job_id: u64,
    pub provider: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EvaluatorFeePaid {
    pub job_id: u64,
    pub evaluator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Refunded {
    pub job_id: u64,
    pub client: Pubkey,
    pub amount: u64,
}
