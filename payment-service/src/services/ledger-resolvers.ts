/**
 * GraphQL Resolvers for Ledger Account Balances
 * 
 * Simplified: Only user accounts - roles/permissions determine capabilities
 */

import { getLedger } from './ledger-service.js';
import { requireAuth, getUserId, getTenantId, logger, type ResolverContext } from 'core-service';
import { SYSTEM_CURRENCY } from '../constants.js';

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
      const subtype = (args.subtype as string) || 'main';
      const currency = (args.currency as string) || SYSTEM_CURRENCY;
      
      try {
        const ledger = getLedger();
        const accountId = ledger.getUserAccountId(userId, subtype as any);
        
        // Check if account exists first
        const account = await ledger.getAccount(accountId);
        if (!account) {
          // Account doesn't exist yet - return zero balance
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
            allowNegative: false,
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
          allowNegative: account.allowNegative || false,
        };
      } catch (error) {
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
            allowNegative: false,
          };
        }
        
        logger.error('Failed to get ledger account balance', { error, userId, subtype });
        throw new Error(`Failed to get ledger account balance: ${errorMessage}`);
      }
    },
    
    /**
     * Get user balances by currency (for multi-currency support)
     */
    userBalances: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const userId = args.userId as string || getUserId(ctx);
      const currencies = (args.currencies as string[]) || [SYSTEM_CURRENCY];
      
      try {
        const ledger = getLedger();
        const balances: Array<{
          currency: string;
          balance: number;
          availableBalance: number;
          allowNegative: boolean;
        }> = [];
        
        for (const currency of currencies) {
          const accountId = ledger.getUserAccountId(userId, 'main' as any);
          const account = await ledger.getAccount(accountId);
          
          if (account && account.currency === currency) {
            const balance = await ledger.getBalance(accountId);
            balances.push({
              currency,
              balance: balance.balance,
              availableBalance: balance.availableBalance,
              allowNegative: account.allowNegative || false,
            });
          } else {
            balances.push({
              currency,
              balance: 0,
              availableBalance: 0,
              allowNegative: false,
            });
          }
        }
        
        return {
          userId,
          balances,
        };
      } catch (error) {
        logger.error('Failed to get user balances', { error, userId });
        throw new Error(`Failed to get user balances: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    
    /**
     * ✅ PERFORMANT: Get balances for multiple users in one query
     * Accepts array of userIds and returns balances for all users
     * Optimized for admin dashboard - fetches all balances in one shot
     */
    bulkLedgerBalances: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const userIds = (args.userIds as string[]) || [];
      const subtype = (args.subtype as string) || 'main';
      const currency = (args.currency as string) || SYSTEM_CURRENCY;
      
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return {
          balances: [],
        };
      }
      
      try {
        const ledger = getLedger();
        const balances: Array<{
          userId: string;
          accountId: string;
          balance: number;
          availableBalance: number;
          pendingIn: number;
          pendingOut: number;
          allowNegative: boolean;
        }> = [];
        
        // Fetch all balances in parallel for performance
        const balancePromises = userIds.map(async (userId) => {
          try {
            const accountId = ledger.getUserAccountId(userId, subtype as any);
            const account = await ledger.getAccount(accountId);
            
            if (!account) {
              // Account doesn't exist - return zero balance
              return {
                userId,
                accountId,
                balance: 0,
                availableBalance: 0,
                pendingIn: 0,
                pendingOut: 0,
                allowNegative: false,
              };
            }
            
            // Only return balance for requested currency
            if (account.currency !== currency) {
              return {
                userId,
                accountId,
                balance: 0,
                availableBalance: 0,
                pendingIn: 0,
                pendingOut: 0,
                allowNegative: account.allowNegative || false,
              };
            }
            
            const balance = await ledger.getBalance(accountId);
            
            return {
              userId,
              accountId,
              balance: balance.balance,
              availableBalance: balance.availableBalance,
              pendingIn: balance.pendingIn,
              pendingOut: balance.pendingOut,
              allowNegative: account.allowNegative || false,
            };
          } catch (error) {
            logger.warn('Failed to get balance for user', { userId, error });
            // Return zero balance on error
            return {
              userId,
              accountId: ledger.getUserAccountId(userId, subtype as any),
              balance: 0,
              availableBalance: 0,
              pendingIn: 0,
              pendingOut: 0,
              allowNegative: false,
            };
          }
        });
        
        const results = await Promise.all(balancePromises);
        
        return {
          balances: results,
        };
      } catch (error) {
        logger.error('Failed to get bulk ledger balances', { error, userIds });
        throw new Error(`Failed to get bulk ledger balances: ${error instanceof Error ? error.message : String(error)}`);
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
    userId: String!
    subtype: String!
    currency: String!
    balance: Float!
    availableBalance: Float!
    pendingIn: Float!
    pendingOut: Float!
    allowNegative: Boolean!
  }
  
  type UserBalance {
    currency: String!
    balance: Float!
    availableBalance: Float!
    allowNegative: Boolean!
  }
  
  type UserBalances {
    userId: String!
    balances: [UserBalance!]!
  }
  
  type BulkLedgerBalance {
    userId: String!
    accountId: String!
    balance: Float!
    availableBalance: Float!
    pendingIn: Float!
    pendingOut: Float!
    allowNegative: Boolean!
  }
  
  type BulkLedgerBalancesResponse {
    balances: [BulkLedgerBalance!]!
  }
  
  extend type Query {
    """
    Get user's ledger account balance
    """
    ledgerAccountBalance(
      userId: String
      subtype: String
      currency: String
    ): LedgerAccountBalance
    
    """
    Get user balances for multiple currencies
    """
    userBalances(
      userId: String
      currencies: [String!]
    ): UserBalances
    
    """
    ✅ PERFORMANT: Get balances for multiple users in one query
    Optimized for admin dashboard - fetches all balances efficiently
    """
    bulkLedgerBalances(
      userIds: [String!]!
      subtype: String
      currency: String
    ): BulkLedgerBalancesResponse!
  }
`;
