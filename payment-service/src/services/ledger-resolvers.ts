/**
 * GraphQL Resolvers for Ledger Account Balances
 * 
 * Simplified: Only user accounts - roles/permissions determine capabilities
 */

import { getLedger } from './ledger-service.js';
import { requireAuth, getUserId, getTenantId, logger, getDatabase, type ResolverContext } from 'core-service';
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
    
    /**
     * ✅ Get ledger transactions with filtering and pagination
     * For audit, reconciliation, and debugging purposes
     */
    ledgerTransactions: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const db = getDatabase();
      const ledgerTransactionsCollection = db.collection('ledger_transactions');
      
      const first = (args.first as number) || 100;
      const skip = (args.skip as number) || 0;
      const filter = (args.filter as Record<string, unknown>) || {};
      
      // Build MongoDB query
      const query: Record<string, unknown> = {};
      
      // Filter by type if specified
      if (filter.type) {
        query.type = filter.type;
      }
      
      // Filter by account if specified
      if (filter.fromAccountId) {
        query.fromAccountId = filter.fromAccountId;
      }
      if (filter.toAccountId) {
        query.toAccountId = filter.toAccountId;
      }
      if (filter.accountId) {
        query.$or = [
          { fromAccountId: filter.accountId },
          { toAccountId: filter.accountId },
        ];
      }
      
      // Filter by currency if specified
      if (filter.currency) {
        query.currency = filter.currency;
      }
      
      // Filter by status if specified
      if (filter.status) {
        query.status = filter.status;
      }
      
      // Filter by externalRef if specified
      if (filter.externalRef) {
        query.externalRef = { $regex: filter.externalRef, $options: 'i' };
      }
      
      // Filter by date range if specified
      if (filter.dateFrom || filter.dateTo) {
        const dateFilter: Record<string, unknown> = {};
        if (filter.dateFrom) {
          dateFilter.$gte = new Date(filter.dateFrom as string);
        }
        if (filter.dateTo) {
          const toDate = new Date(filter.dateTo as string);
          toDate.setHours(23, 59, 59, 999); // Include full day
          dateFilter.$lte = toDate;
        }
        query.createdAt = dateFilter;
      }
      
      // Execute query
      const [nodes, totalCount] = await Promise.all([
        ledgerTransactionsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(first)
          .toArray(),
        ledgerTransactionsCollection.countDocuments(query),
      ]);
      
      return {
        nodes: nodes.map((tx: any) => ({
          _id: tx._id,
          type: tx.type,
          fromAccountId: tx.fromAccountId,
          toAccountId: tx.toAccountId,
          amount: tx.amount,
          currency: tx.currency,
          description: tx.description,
          externalRef: tx.externalRef,
          status: tx.status,
          createdAt: tx.createdAt,
          metadata: tx.metadata,
        })),
        totalCount,
        pageInfo: {
          hasNextPage: skip + first < totalCount,
          hasPreviousPage: skip > 0,
        },
      };
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
  
  type LedgerTransaction {
    _id: String!
    type: String!
    fromAccountId: String!
    toAccountId: String!
    amount: Float!
    currency: String!
    description: String
    externalRef: String
    status: String!
    createdAt: String!
    metadata: JSON
  }
  
  type LedgerTransactionConnection {
    nodes: [LedgerTransaction!]!
    totalCount: Int!
    pageInfo: PageInfo!
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
    
    """
    ✅ Get ledger transactions with filtering and pagination
    For audit, reconciliation, and debugging purposes
    """
    ledgerTransactions(
      first: Int
      skip: Int
      filter: JSON
    ): LedgerTransactionConnection!
  }
`;
