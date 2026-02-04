use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("KngKLPcRedit1111111111111111111111111111");

const CREDIT_UNIT: u64 = 100_000;

#[program]
pub mod kangklip_credits {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, usdc_mint: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.spender = ctx.accounts.authority.key();
        config.usdc_mint = usdc_mint;
        config.credit_unit = CREDIT_UNIT;
        config.bump = *ctx.bumps.get("config").unwrap();
        Ok(())
    }

    pub fn set_spender(ctx: Context<SetSpender>, spender: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.spender = spender;
        Ok(())
    }

    pub fn pay_usdc(ctx: Context<PayUsdc>, amount_base_units: u64) -> Result<()> {
        require!(amount_base_units > 0, CreditsError::InvalidAmount);
        let config = &ctx.accounts.config;
        require!(
            ctx.accounts.usdc_mint.key() == config.usdc_mint,
            CreditsError::InvalidMint
        );
        require!(
            ctx.accounts.user_usdc.mint == config.usdc_mint,
            CreditsError::InvalidMint
        );
        require!(
            ctx.accounts.vault_usdc.mint == config.usdc_mint,
            CreditsError::InvalidMint
        );
        require!(
            ctx.accounts.user_usdc.owner == ctx.accounts.user.key(),
            CreditsError::InvalidOwner
        );
        require!(
            ctx.accounts.vault_usdc.owner == ctx.accounts.config.key(),
            CreditsError::InvalidOwner
        );

        let credits_to_add = amount_base_units / config.credit_unit;
        require!(credits_to_add > 0, CreditsError::BelowMinimum);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.vault_usdc.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount_base_units)?;

        let user_credit = &mut ctx.accounts.user_credit;
        user_credit.user = ctx.accounts.user.key();
        user_credit.credits = user_credit
            .credits
            .checked_add(credits_to_add)
            .ok_or(CreditsError::Overflow)?;
        user_credit.bump = *ctx.bumps.get("user_credit").unwrap();

        emit!(Paid {
            user: ctx.accounts.user.key(),
            amount_base_units,
            credits_added: credits_to_add,
            new_balance: user_credit.credits,
        });
        Ok(())
    }

    pub fn withdraw_usdc(ctx: Context<WithdrawUsdc>, amount_base_units: u64) -> Result<()> {
        require!(amount_base_units > 0, CreditsError::InvalidAmount);
        let config = &ctx.accounts.config;
        require!(
            ctx.accounts.treasury_usdc.mint == config.usdc_mint,
            CreditsError::InvalidMint
        );
        require!(
            ctx.accounts.vault_usdc.mint == config.usdc_mint,
            CreditsError::InvalidMint
        );
        require!(
            ctx.accounts.vault_usdc.owner == config.key(),
            CreditsError::InvalidOwner
        );

        let seeds = &[b"config", config.authority.as_ref(), &[config.bump]];
        let signer = &[&seeds[..]];
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_usdc.to_account_info(),
            to: ctx.accounts.treasury_usdc.to_account_info(),
            authority: ctx.accounts.config.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new_with_signer(cpi_program, cpi_accounts, signer), amount_base_units)?;

        emit!(Withdrawn {
            authority: ctx.accounts.authority.key(),
            amount_base_units,
        });
        Ok(())
    }

    // Admin/spender-only debit of user credits.
    pub fn consume_credit(ctx: Context<ConsumeCredit>, amount: u64) -> Result<()> {
        require!(amount > 0, CreditsError::InvalidAmount);
        let config = &ctx.accounts.config;
        require!(
            ctx.accounts.spender.key() == config.spender,
            CreditsError::Unauthorized
        );
        let user_credit = &mut ctx.accounts.user_credit;
        require!(user_credit.user == ctx.accounts.user.key(), CreditsError::InvalidOwner);
        require!(user_credit.credits >= amount, CreditsError::InsufficientCredits);
        user_credit.credits = user_credit
            .credits
            .checked_sub(amount)
            .ok_or(CreditsError::Overflow)?;

        emit!(CreditUsed {
            user: ctx.accounts.user.key(),
            amount,
            new_balance: user_credit.credits,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::LEN,
        seeds = [b"config", authority.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSpender<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority,
        seeds = [b"config", authority.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct PayUsdc<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserCredit::LEN,
        seeds = [b"credit", user.key().as_ref()],
        bump
    )]
    pub user_credit: Account<'info, UserCredit>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawUsdc<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority,
        seeds = [b"config", authority.key().as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ConsumeCredit<'info> {
    #[account(mut)]
    pub spender: Signer<'info>,
    #[account(
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: user is verified via the UserCredit account.
    pub user: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"credit", user.key().as_ref()],
        bump = user_credit.bump
    )]
    pub user_credit: Account<'info, UserCredit>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub spender: Pubkey,
    pub usdc_mint: Pubkey,
    pub credit_unit: u64,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 32 + 32 + 32 + 8 + 1;
}

#[account]
pub struct UserCredit {
    pub user: Pubkey,
    pub credits: u64,
    pub bump: u8,
}

impl UserCredit {
    pub const LEN: usize = 32 + 8 + 1;
}

#[event]
pub struct Paid {
    pub user: Pubkey,
    pub amount_base_units: u64,
    pub credits_added: u64,
    pub new_balance: u64,
}

#[event]
pub struct Withdrawn {
    pub authority: Pubkey,
    pub amount_base_units: u64,
}

#[event]
pub struct CreditUsed {
    pub user: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
}

#[error_code]
pub enum CreditsError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid owner")]
    InvalidOwner,
    #[msg("Amount below minimum credit unit")]
    BelowMinimum,
    #[msg("Credits overflow")]
    Overflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient credits")]
    InsufficientCredits,
}
