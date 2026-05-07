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
//! # Storage layout
//!
//! - `Config` PDA singleton at `[b"config"]` — admin, payment_mint,
//!   platform_treasury_ata, fees, job_counter.
//! - `Job` PDA at `[b"job", job_id.to_le_bytes()]` — one per job.
//! - `Vault` SPL TokenAccount at `[b"vault", job_id.to_le_bytes()]`
//!   owned by its Job PDA — holds the USDC escrow for that job.
//!   Created on `fund`, drained on `complete` / `reject` /
//!   `claim_refund`.
//!
//! # Authorization
//!
//! - `client = Job.client` — only the client can `set_provider`,
//!   `fund`, `reject` while Open.
//! - `provider = Job.provider` — only the provider can `set_budget`
//!   and `submit`.
//! - `evaluator = Job.evaluator` — only the evaluator can `complete`
//!   or `reject` after Funded/Submitted.
//! - `claim_refund` — anyone can call after expired_at when status ∈
//!   {Funded, Submitted}; tokens always go back to the original client.
//!
//! # Phasing
//!
//! - This commit (state + accounts + initialize + create_job +
//!   set_provider + set_budget). Bodies for `fund` / `submit` /
//!   `complete` / `reject` / `claim_refund` land in the sibling
//!   commit so each diff stays within the size budget.
//! - Hooks: Solidity's `IACPHook` callbacks are out of scope for v1.
//!   `Job.hook_program` is captured but only `Pubkey::default()` is
//!   accepted at `create_job`.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9");

const BPS_DENOMINATOR: u16 = 10_000;
/// Mirrors Solidity's `expiredAt <= block.timestamp + 5 minutes` guard.
const MIN_EXPIRY_LEAD: i64 = 5 * 60;
const CONFIG_SEED: &[u8] = b"config";
const JOB_SEED: &[u8] = b"job";
const VAULT_SEED: &[u8] = b"vault";

#[program]
pub mod agentic_commerce {
    use super::*;

    /// One-time init. Caller becomes admin. Sets payment_mint + fees +
    /// platform treasury token account.
    pub fn initialize(
        ctx: Context<Initialize>,
        platform_fee_bp: u16,
        evaluator_fee_bp: u16,
    ) -> Result<()> {
        require!(
            (platform_fee_bp as u32) + (evaluator_fee_bp as u32) <= BPS_DENOMINATOR as u32,
            AgenticCommerceError::FeesTooHigh
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.payment_mint = ctx.accounts.payment_mint.key();
        config.platform_treasury = ctx.accounts.platform_treasury.key();
        config.platform_fee_bp = platform_fee_bp;
        config.evaluator_fee_bp = evaluator_fee_bp;
        config.job_counter = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Create a new job in `Open` state. `job_id` MUST equal
    /// `config.job_counter + 1` so the PDA seed is deterministic and
    /// stable for follow-up instructions.
    pub fn create_job(
        ctx: Context<CreateJob>,
        job_id: u64,
        provider: Pubkey,
        evaluator: Pubkey,
        expired_at: i64,
        description: String,
        hook_program: Pubkey,
    ) -> Result<()> {
        require!(
            evaluator != Pubkey::default(),
            AgenticCommerceError::ZeroAddress
        );

        let now = Clock::get()?.unix_timestamp;
        require!(
            expired_at > now + MIN_EXPIRY_LEAD,
            AgenticCommerceError::ExpiryTooShort
        );
        require!(
            description.len() <= Job::MAX_DESCRIPTION_LEN,
            AgenticCommerceError::DescriptionTooLong
        );
        // v1: only the no-op hook is accepted. Phase 2+ widens this.
        require!(
            hook_program == Pubkey::default(),
            AgenticCommerceError::HookNotWhitelisted
        );

        let config = &mut ctx.accounts.config;
        require!(
            job_id == config.job_counter + 1,
            AgenticCommerceError::InvalidJobId
        );
        config.job_counter = job_id;

        let job = &mut ctx.accounts.job;
        job.id = job_id;
        job.client = ctx.accounts.client.key();
        job.provider = provider;
        job.evaluator = evaluator;
        job.description = description;
        job.budget = 0;
        job.expired_at = expired_at;
        job.status = JobStatus::Open;
        job.hook_program = hook_program;
        job.has_budget = false;
        job.bump = ctx.bumps.job;

        emit!(JobCreated {
            job_id,
            client: job.client,
            provider: job.provider,
            evaluator: job.evaluator,
            expired_at,
            hook_program,
        });
        Ok(())
    }

    /// Client assigns the provider when it was left unset at
    /// `create_job` (Solidity's `setProvider` semantics).
    pub fn set_provider(
        ctx: Context<JobAdmin>,
        _job_id: u64,
        new_provider: Pubkey,
    ) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(job.status == JobStatus::Open, AgenticCommerceError::WrongStatus);
        require!(
            job.client == ctx.accounts.signer.key(),
            AgenticCommerceError::Unauthorized
        );
        require!(
            job.provider == Pubkey::default(),
            AgenticCommerceError::WrongStatus
        );
        require!(
            new_provider != Pubkey::default(),
            AgenticCommerceError::ZeroAddress
        );
        job.provider = new_provider;
        emit!(ProviderSet {
            job_id: job.id,
            provider: new_provider,
        });
        Ok(())
    }

    /// Provider sets the price. Solidity allows zero (no-op fund), but
    /// require positive here so subsequent fee math doesn't degenerate.
    pub fn set_budget(ctx: Context<JobAdmin>, _job_id: u64, amount: u64) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(job.status == JobStatus::Open, AgenticCommerceError::WrongStatus);
        require!(
            job.provider == ctx.accounts.signer.key(),
            AgenticCommerceError::Unauthorized
        );
        require!(amount > 0, AgenticCommerceError::ZeroBudget);
        job.budget = amount;
        job.has_budget = true;
        emit!(BudgetSet { job_id: job.id, amount });
        Ok(())
    }

    /// Client funds the escrow vault. Status `Open → Funded`. Solidity
    /// uses `safeTransferFrom`; here we use `token::transfer` with the
    /// client as the signer authority. The vault TokenAccount is
    /// created lazily by the `init` constraint on FundJob.
    pub fn fund(ctx: Context<FundJob>, _job_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let job = &ctx.accounts.job;
        require!(job.status == JobStatus::Open, AgenticCommerceError::WrongStatus);
        require!(
            job.client == ctx.accounts.client.key(),
            AgenticCommerceError::Unauthorized
        );
        require!(
            job.provider != Pubkey::default(),
            AgenticCommerceError::ProviderNotSet
        );
        require!(now < job.expired_at, AgenticCommerceError::WrongStatus);
        require!(job.has_budget, AgenticCommerceError::ZeroBudget);

        let amount = job.budget;
        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.client_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.client.to_account_info(),
            },
        );
        token::transfer(cpi, amount)?;

        let job = &mut ctx.accounts.job;
        job.status = JobStatus::Funded;
        emit!(JobFunded {
            job_id: job.id,
            client: job.client,
            amount,
        });
        Ok(())
    }

    /// Provider submits a `[u8; 32]` deliverable hash. Status
    /// `Funded → Submitted`.
    pub fn submit(
        ctx: Context<JobAdmin>,
        _job_id: u64,
        deliverable: [u8; 32],
    ) -> Result<()> {
        let job = &mut ctx.accounts.job;
        require!(
            job.status == JobStatus::Funded,
            AgenticCommerceError::WrongStatus
        );
        require!(
            job.provider == ctx.accounts.signer.key(),
            AgenticCommerceError::Unauthorized
        );
        job.status = JobStatus::Submitted;
        emit!(JobSubmitted {
            job_id: job.id,
            provider: job.provider,
            deliverable,
        });
        Ok(())
    }

    /// Evaluator approves. Splits escrow and pays out via 3 SPL
    /// transfers, signed by the Job PDA. Status `Submitted →
    /// Completed`.
    pub fn complete(
        ctx: Context<CompleteJob>,
        _job_id: u64,
        reason: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.job.status == JobStatus::Submitted,
            AgenticCommerceError::WrongStatus
        );
        require!(
            ctx.accounts.job.evaluator == ctx.accounts.evaluator.key(),
            AgenticCommerceError::Unauthorized
        );

        let amount = ctx.accounts.job.budget;
        let platform_fee_bp = ctx.accounts.config.platform_fee_bp as u128;
        let evaluator_fee_bp = ctx.accounts.config.evaluator_fee_bp as u128;
        let amount_u128 = amount as u128;

        let platform_fee =
            (amount_u128 * platform_fee_bp / BPS_DENOMINATOR as u128) as u64;
        let evaluator_fee =
            (amount_u128 * evaluator_fee_bp / BPS_DENOMINATOR as u128) as u64;
        let net = amount
            .checked_sub(platform_fee)
            .and_then(|v| v.checked_sub(evaluator_fee))
            .ok_or(AgenticCommerceError::FeeMathOverflow)?;

        // PDA signer seeds — Job PDA is the vault authority + signs
        // the transfer-out CPIs.
        let job_id_bytes = ctx.accounts.job.id.to_le_bytes();
        let job_bump = ctx.accounts.job.bump;
        let signer_seeds: &[&[u8]] = &[JOB_SEED, &job_id_bytes, &[job_bump]];
        let signer = &[signer_seeds];

        if platform_fee > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.platform_treasury_ata.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi, platform_fee)?;
        }
        if evaluator_fee > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.evaluator_token_account.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi, evaluator_fee)?;
            emit!(EvaluatorFeePaid {
                job_id: ctx.accounts.job.id,
                evaluator: ctx.accounts.job.evaluator,
                amount: evaluator_fee,
            });
        }
        if net > 0 {
            let cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.provider_token_account.to_account_info(),
                    authority: ctx.accounts.job.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi, net)?;
        }

        let job = &mut ctx.accounts.job;
        job.status = JobStatus::Completed;
        emit!(JobCompleted {
            job_id: job.id,
            evaluator: job.evaluator,
            reason,
        });
        emit!(PaymentReleased {
            job_id: job.id,
            provider: job.provider,
            amount: net,
        });
        Ok(())
    }

    /// Reject. Solidity authorization shape:
    ///   - Open: client only.
    ///   - Funded / Submitted: evaluator only.
    /// When funds were already escrowed, refund the full budget to
    /// the client.
    pub fn reject(
        ctx: Context<RefundOrReject>,
        _job_id: u64,
        reason: [u8; 32],
    ) -> Result<()> {
        let job_status = ctx.accounts.job.status;
        let signer_key = ctx.accounts.caller.key();
        match job_status {
            JobStatus::Open => {
                require!(
                    ctx.accounts.job.client == signer_key,
                    AgenticCommerceError::Unauthorized
                );
            }
            JobStatus::Funded | JobStatus::Submitted => {
                require!(
                    ctx.accounts.job.evaluator == signer_key,
                    AgenticCommerceError::Unauthorized
                );
            }
            _ => return err!(AgenticCommerceError::WrongStatus),
        }

        let had_funds = matches!(job_status, JobStatus::Funded | JobStatus::Submitted);
        if had_funds && ctx.accounts.job.budget > 0 {
            transfer_full_vault_to_client(&ctx)?;
            emit!(Refunded {
                job_id: ctx.accounts.job.id,
                client: ctx.accounts.job.client,
                amount: ctx.accounts.job.budget,
            });
        }

        let job = &mut ctx.accounts.job;
        job.status = JobStatus::Rejected;
        emit!(JobRejected {
            job_id: job.id,
            rejector: signer_key,
            reason,
        });
        Ok(())
    }

    /// After `expired_at`, anyone can claim the refund for the
    /// original client. Status `Funded` / `Submitted` → `Expired`.
    pub fn claim_refund(ctx: Context<RefundOrReject>, _job_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let job_status = ctx.accounts.job.status;
        require!(
            job_status == JobStatus::Funded || job_status == JobStatus::Submitted,
            AgenticCommerceError::WrongStatus
        );
        require!(
            now >= ctx.accounts.job.expired_at,
            AgenticCommerceError::WrongStatus
        );

        if ctx.accounts.job.budget > 0 {
            transfer_full_vault_to_client(&ctx)?;
            emit!(Refunded {
                job_id: ctx.accounts.job.id,
                client: ctx.accounts.job.client,
                amount: ctx.accounts.job.budget,
            });
        }

        let job = &mut ctx.accounts.job;
        job.status = JobStatus::Expired;
        emit!(JobExpired { job_id: job.id });
        Ok(())
    }
}

/// Transfer the entire vault back to the client's token account,
/// signed by the Job PDA. Used by both `reject` (when funded) and
/// `claim_refund`.
fn transfer_full_vault_to_client(ctx: &Context<RefundOrReject>) -> Result<()> {
    let amount = ctx.accounts.vault.amount;
    if amount == 0 {
        return Ok(());
    }
    let job_id_bytes = ctx.accounts.job.id.to_le_bytes();
    let job_bump = ctx.accounts.job.bump;
    let seeds: &[&[u8]] = &[JOB_SEED, &job_id_bytes, &[job_bump]];
    let signer = &[seeds];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.client_token_account.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi, amount)
}

// ──────────────────── Account contexts ────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub payment_mint: Account<'info, Mint>,
    /// Token account (already-existing ATA on the platform treasury
    /// MSCA / Squads vault) that receives platform-fee payouts.
    #[account(token::mint = payment_mint)]
    pub platform_treasury: Account<'info, TokenAccount>,
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
#[instruction(job_id: u64)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = client,
        space = Job::DISCRIMINATOR.len() + Job::INIT_SPACE,
        seeds = [JOB_SEED, &job_id.to_le_bytes()],
        bump
    )]
    pub job: Account<'info, Job>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct JobAdmin<'info> {
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, &job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, Job>,
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct FundJob<'info> {
    #[account(mut)]
    pub client: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [JOB_SEED, &job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, Job>,
    #[account(address = config.payment_mint)]
    pub payment_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = client,
        seeds = [VAULT_SEED, &job_id.to_le_bytes()],
        bump,
        token::mint = payment_mint,
        token::authority = job,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = payment_mint, token::authority = client)]
    pub client_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct CompleteJob<'info> {
    pub evaluator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [JOB_SEED, &job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, Job>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &job_id.to_le_bytes()],
        bump,
        token::authority = job,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.payment_mint,
        address = config.platform_treasury
    )]
    pub platform_treasury_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.payment_mint,
        token::authority = job.provider
    )]
    pub provider_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.payment_mint,
        token::authority = job.evaluator
    )]
    pub evaluator_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct RefundOrReject<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [JOB_SEED, &job_id.to_le_bytes()],
        bump = job.bump
    )]
    pub job: Account<'info, Job>,
    #[account(
        mut,
        seeds = [VAULT_SEED, &job_id.to_le_bytes()],
        bump,
        token::authority = job,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = config.payment_mint,
        token::authority = job.client
    )]
    pub client_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ──────────────────── State ────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub payment_mint: Pubkey,
    /// Token account (not wallet) that receives platform-fee payouts.
    pub platform_treasury: Pubkey,
    pub platform_fee_bp: u16,
    pub evaluator_fee_bp: u16,
    pub job_counter: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Job {
    pub id: u64,
    pub client: Pubkey,
    pub provider: Pubkey,
    pub evaluator: Pubkey,
    #[max_len(256)]
    pub description: String,
    pub budget: u64,
    pub expired_at: i64,
    pub status: JobStatus,
    pub hook_program: Pubkey,
    pub has_budget: bool,
    pub bump: u8,
}

impl Job {
    pub const MAX_DESCRIPTION_LEN: usize = 256;
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JobStatus {
    Open,
    Funded,
    Submitted,
    Completed,
    Rejected,
    Expired,
}

// ──────────────────── Errors (mirror Solidity custom errors) ────────────────────

#[error_code]
pub enum AgenticCommerceError {
    #[msg("Job does not exist or invalid id")]
    InvalidJob,
    #[msg("job_id must equal config.job_counter + 1")]
    InvalidJobId,
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
    #[msg("Hook program is not whitelisted (v1: only Pubkey::default() allowed)")]
    HookNotWhitelisted,
    #[msg("Description exceeds 256-byte cap")]
    DescriptionTooLong,
    #[msg("Fee math overflow")]
    FeeMathOverflow,
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
pub struct ProviderSet {
    pub job_id: u64,
    pub provider: Pubkey,
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
