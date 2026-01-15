/**
 * GraphQL Resolvers for Ledger Account Balances
 * 
 * Provides queries to check ledger account balances for providers and users.
 */

import { getLedger } from './ledger-service.js';
import { requireAuth, getUserId, getTenantId, logger, type ResolverContext } from 'core-service';

/**
 * GraphQL resolvers for ledger account queries
 */
export const ledgerResolvers = {
  Query: {
    /**
     * Get user's ledger account balance
     */
    ledgerAccountBalance: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const userId = args.userId as string || getUserId(ctx);
      const subtype = (args.subtype as string) || 'real';
      const currency = (args.currency as string) || 'USD';
      
      try {
        const ledger = getLedger();
        const accountId = ledger.getUserAccountId(userId, subtype as any);
        
        // Check if account exists first (bonus accounts may not exist if no ledger transactions yet)
        const account = await ledger.getAccount(accountId);
        if (!account) {
          // Account doesn't exist yet - return zero balance (will be created on first transaction)
          // This is common for bonus accounts since bonus_credit transactions update wallet directly
          logger.debug('User ledger account not found, returning zero balance', { userId, subtype, currency });
          return {
            accountId,
            userId,
            subtype,
            currency,
            balance: 0,
            availableBalance: 0,
            pendingIn: 0,
            pendingOut: 0,
          };
        }
        
        const balance = await ledger.getBalance(accountId);
        
        return {
          accountId,
          userId,
          subtype,
          currency,
          balance: balance.balance,
          availableBalance: balance.availableBalance,
          pendingIn: balance.pendingIn,
          pendingOut: balance.pendingOut,
        };
      } catch (error) {
        // If account not found error, return zero balance (graceful handling)
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Account not found') || errorMessage.includes('not found')) {
          logger.debug('User ledger account not found, returning zero balance', { userId, subtype, currency });
          const ledger = getLedger();
          return {
            accountId: ledger.getUserAccountId(userId, subtype as any),
            userId,
            subtype,
            currency,
            balance: 0,
            availableBalance: 0,
            pendingIn: 0,
            pendingOut: 0,
          };
        }
        
        logger.error('Failed to get ledger account balance', { error, userId, subtype });
        throw new Error(`Failed to get ledger account balance: ${errorMessage}`);
      }
    },
    
    /**
     * Get provider's ledger account balance
     */
    providerLedgerBalance: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const providerId = args.providerId as string;
      const subtype = (args.subtype as 'deposit' | 'withdrawal') || 'deposit';
      const currency = (args.currency as string) || 'USD';
      
      if (!providerId) {
        throw new Error('providerId is required');
      }
      
      try {
        const ledger = getLedger();
        const accountId = ledger.getProviderAccountId(providerId, subtype);
        
        // Check if account exists, if not return zero balance
        const account = await ledger.getAccount(accountId);
        if (!account) {
          // Account doesn't exist yet - return zero balance (will be created on first transaction)
          return {
            accountId,
            providerId,
            subtype,
            currency,
            balance: 0,
            availableBalance: 0,
            pendingIn: 0,
            pendingOut: 0,
          };
        }
        
        const balance = await ledger.getBalance(accountId);
        
        return {
          accountId,
          providerId,
          subtype,
          currency,
          balance: balance.balance,
          availableBalance: balance.availableBalance,
          pendingIn: balance.pendingIn,
          pendingOut: balance.pendingOut,
        };
      } catch (error) {
        // If account not found error, return zero balance
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Account not found') || errorMessage.includes('not found')) {
          logger.debug('Provider ledger account not found, returning zero balance', { providerId, subtype });
          const ledger = getLedger();
          return {
            accountId: ledger.getProviderAccountId(providerId, subtype),
            providerId,
            subtype,
            currency,
            balance: 0,
            availableBalance: 0,
            pendingIn: 0,
            pendingOut: 0,
          };
        }
        
        logger.error('Failed to get provider ledger balance', { error, providerId, subtype });
        throw new Error(`Failed to get provider ledger balance: ${errorMessage}`);
      }
    },
    
    /**
     * Get bonus pool balance
     */
    bonusPoolBalance: async (
      args: Record<string, unknown>,
      _ctx: ResolverContext
    ) => {
      const currency = (args.currency as string) || 'USD';
      
      try {
        const ledger = getLedger();
        const accountId = ledger.getSystemAccountId('bonus_pool');
        const balance = await ledger.getBalance(accountId);
        
        return {
          accountId,
          currency,
          balance: balance.balance,
          availableBalance: balance.availableBalance,
        };
      } catch (error) {
        logger.error('Failed to get bonus pool balance', { error, currency });
        throw new Error(`Failed to get bonus pool balance: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    
    /**
     * Get system house account balance (Platform Reserve)
     * Returns balances per currency (cannot sum different currencies)
     */
    systemHouseBalance: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const tenantId = getTenantId(ctx) || 'default-tenant';
      const currencies = (args.currencies as string[]) || ['USD', 'EUR', 'GBP'];
      
      try {
        const ledger = getLedger();
        const balancesByCurrency: Record<string, number> = {};
        
        // Get balances from all currency-specific system house accounts
        for (const currency of currencies) {
          try {
            const accountId = `system:house:${currency.toLowerCase()}:${tenantId}`;
            const account = await ledger.getAccount(accountId);
            if (account) {
              const balance = await ledger.getBalance(accountId);
              balancesByCurrency[currency] = balance.balance;
            } else {
              balancesByCurrency[currency] = 0;
            }
          } catch (err) {
            // Account might not exist for this currency - set to 0
            balancesByCurrency[currency] = 0;
            logger.debug('System house account not found for currency', { currency, tenantId });
          }
        }
        
        // Calculate total in primary currency (EUR) for display
        // Note: In a real system, you'd want to convert currencies, but for now we'll use EUR as base
        const primaryCurrency = 'EUR';
        const totalBalance = balancesByCurrency[primaryCurrency] || 0;
        
        return {
          totalBalance,
          balancesByCurrency,
          tenantId,
          currencies,
          primaryCurrency,
        };
      } catch (error) {
        logger.error('Failed to get system house balance', { error, tenantId });
        throw new Error(`Failed to get system house balance: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  },
  Mutation: {},
};

/**
 * GraphQL type definitions for ledger queries
 */
export const ledgerTypes = `
  type LedgerAccountBalance {
    accountId: String!
    userId: String
    providerId: String
    subtype: String!
    currency: String!
    balance: Float!
    availableBalance: Float!
    pendingIn: Float!
    pendingOut: Float!
  }
  
  type BonusPoolBalance {
    accountId: String!
    currency: String!
    balance: Float!
    availableBalance: Float!
  }
  
  type SystemHouseBalance {
    totalBalance: Float!
    balancesByCurrency: JSON!
    tenantId: String!
    currencies: [String!]!
    primaryCurrency: String!
  }
  
  extend type Query {
    """
    Get user's ledger account balance (real, bonus, or locked)
    """
    ledgerAccountBalance(
      userId: String
      subtype: String
      currency: String
    ): LedgerAccountBalance
    
    """
    Get provider's ledger account balance (deposit or withdrawal)
    """
    providerLedgerBalance(
      providerId: String!
      subtype: String
      currency: String
    ): LedgerAccountBalance
    
    """
    Get bonus pool balance
    """
    bonusPoolBalance(currency: String): BonusPoolBalance
    
    """
    Get system house account balance (Platform Reserve)
    Sum of all currency-specific system house accounts
    """
    systemHouseBalance(currencies: [String!]): SystemHouseBalance
  }
`;
