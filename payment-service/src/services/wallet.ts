/**
 * Wallet Service - Multi-Currency User Balance Management
 * 
 * Architecture: One wallet per user per currency (with optional category)
 * 
 * Features:
 * - Real balance: Withdrawable funds
 * - Bonus balance: Promotional funds (wagering required)
 * - Locked balance: Held for pending transactions
 * - Optional categories for ring-fenced funds
 * 
 * ═══════════════════════════════════════════════════════════════════
 * OPTIMIZATIONS FOR SCALE (Transactions grow fastest)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * 1. **Removed balanceBefore field** (saves ~8 bytes per tx)
 *    - Can calculate: balanceBefore = balance - amount (credit)
 *    - Or: balanceBefore = balance + amount (debit)
 *    - Still maintains full audit trail
 * 
 * 2. **Generic references (refId + refType)** instead of specific fields
 *    - OLD: bonusId, betId, gameRoundId, transactionId, etc.
 *    - NEW: refId + refType ('bonus', 'bet', 'game', 'transaction')
 *    - Extensible for ANY future entity type
 *    - One index covers all reference queries
 * 
 * 3. **Immutable transactions**
 *    - No updatedAt field (only createdAt)
 *    - Transactions never change after creation
 *    - Saves storage and reduces index size
 * 
 * 4. **TTL Indexes** (optional, enable in production)
 *    - Auto-delete transactions older than N years
 *    - Keep recent data hot, archive old data
 *    - Example: 2-year retention = -95% storage over time
 * 
 * 5. **Time-based partitioning** (recommended for millions of tx/day)
 *    - Separate collections per month/year
 *    - Example: transactions_2024_01, transactions_2024_02 (if partitioning is needed)
 *    - Queries hit smaller datasets
 *    - Easy to archive entire months
 * 
 * 6. **Amounts in integers** (already implemented)
 *    - Stored as cents: 1000 = $10.00
 *    - Avoids floating-point precision issues
 *    - Smaller storage, faster queries
 * 
 * 7. **Repository auto-timestamps**
 *    - createdAt added by repository
 *    - No manual timestamp management
 *    - Consistent across all entities
 */

import { createService, generateId, type, type Repository, type SagaContext, type ResolverContext, getDatabase, deleteCache, deleteCachePattern, logger, validateInput, findOneById, findOneAndUpdateById, requireAuth, getUserId, getTenantId, getOrCreateWallet, paginateCollection, extractDocumentId } from 'core-service';
import type { Wallet, WalletCategory } from '../types.js';
import { SYSTEM_CURRENCY } from '../constants.js';
import { emitPaymentEvent } from '../event-dispatcher.js';

// ═══════════════════════════════════════════════════════════════════
// User Wallets API - Clean client response format
// ═══════════════════════════════════════════════════════════════════

/**
 * Response format for userWallets query
 * 
 * Example response:
 * {
 *   userId: "player-123",
 *   currency: "EUR",
 *   totals: {
 *     realBalance: 1000,
 *     bonusBalance: 100,
 *     lockedBalance: 0,
 *     totalBalance: 1100,
 *     withdrawableBalance: 1000
 *   },
 *   wallets: [
 *     { category: "main", realBalance: 1000, bonusBalance: 0, ... },
 *     { category: "sports", realBalance: 0, bonusBalance: 100, ... },
 *     { category: "casino", realBalance: 0, bonusBalance: 0, ... }
 *   ]
 * }
 */
interface UserWalletsResponse {
  userId: string;
  currency: string;
  totals: {
    realBalance: number;
    bonusBalance: number;
    lockedBalance: number;
    totalBalance: number;
    withdrawableBalance: number;
    lifetimeDeposits: number;
    lifetimeWithdrawals: number;
    lifetimeFees: number;
  };
  wallets: {
    id: string;
    category: string;
    realBalance: number;
    bonusBalance: number;
    lockedBalance: number;
    totalBalance: number;
    status: string;
    lastActivityAt: Date;
  }[];
}

/**
 * Unified wallet resolvers - All wallet balance and transaction queries
 * Architecture: Wallets + Transactions + Transfers
 * - Wallets = Source of truth for balances
 * - Transactions = The ledger (each transaction is a ledger entry)
 * - Transfers = User-to-user operations (creates 2 transactions)
 */
export const walletResolvers = {
  Query: {
    /**
     * Get all wallets for a user with aggregated totals
     * 
     * Query:
     * ```graphql
     * query GetUserWallets($input: JSON) {
     *   userWallets(input: $input)
     * }
     * ```
     * 
     * Variables (get all wallets):
     * ```json
     * { "input": { "userId": "player-123", "currency": "EUR" } }
     * ```
     * 
     * Variables (get specific category):
     * ```json
     * { "input": { "userId": "player-123", "currency": "EUR", "category": "sports" } }
     * ```
     */
    userWallets: async (args: Record<string, unknown>, ctx: ResolverContext): Promise<UserWalletsResponse | null> => {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Handle JSON input (args.input) or direct args
      const input = (args.input as Record<string, unknown>) || args;
      
      // Use authenticated user's ID if not provided (self-service)
      const userId = (input.userId as string) || ctx.user?.userId;
      if (!userId) {
        throw new Error('userId is required');
      }
      
      // Build query
      const query: Record<string, unknown> = { userId };
      if (input.currency) query.currency = input.currency as string;
      if (input.category) query.category = input.category as string;
      
      // Fetch wallets for this user (filtered by category if specified)
      const walletDocs = await walletsCollection.find(query).toArray();
      
      if (walletDocs.length === 0) {
        return null;
      }
      
      // Map wallets to clean format
      const wallets = walletDocs.map((w: any) => ({
        id: w.id,
        category: w.category || 'main',
        realBalance: w.balance || 0,
        bonusBalance: w.bonusBalance || 0,
        lockedBalance: w.lockedBalance || 0,
        totalBalance: (w.balance || 0) + (w.bonusBalance || 0),
        status: w.status || 'active',
        lastActivityAt: w.lastActivityAt,
      }));
      
      // Calculate totals across all wallets
      const totals = wallets.reduce((acc, w) => ({
        realBalance: acc.realBalance + w.realBalance,
        bonusBalance: acc.bonusBalance + w.bonusBalance,
        lockedBalance: acc.lockedBalance + w.lockedBalance,
        totalBalance: acc.totalBalance + w.totalBalance,
        withdrawableBalance: acc.withdrawableBalance + w.realBalance, // Only real balance is withdrawable
        lifetimeDeposits: acc.lifetimeDeposits,
        lifetimeWithdrawals: acc.lifetimeWithdrawals,
        lifetimeFees: acc.lifetimeFees,
      }), {
        realBalance: 0,
        bonusBalance: 0,
        lockedBalance: 0,
        totalBalance: 0,
        withdrawableBalance: 0,
        lifetimeDeposits: walletDocs.reduce((sum: number, w: any) => sum + (w.lifetimeDeposits || 0), 0),
        lifetimeWithdrawals: walletDocs.reduce((sum: number, w: any) => sum + (w.lifetimeWithdrawals || 0), 0),
        lifetimeFees: walletDocs.reduce((sum: number, w: any) => sum + (w.lifetimeFees || 0), 0),
      });
      
      return {
        userId,
        currency: (input.currency as string) || walletDocs[0]?.currency || SYSTEM_CURRENCY,
        totals,
        wallets,
      };
    },

    /**
     * Get user's wallet balance
     * Uses wallet directly - wallets are the source of truth
     * 
     * Supports both formats:
     * 1. Direct args: walletBalance(userId: String, category: String, currency: String)
     * 2. JSON input: walletBalance(input: JSON)
     */
    walletBalance: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      
      // Handle JSON input format (args.input) or direct args
      const input = (args.input as Record<string, unknown>) || args;
      
      // Extract parameters from input or direct args
      const userId = (input.userId as string) || getUserId(ctx);
      const category = (input.category as string) || (input.subtype as string) || 'main';
      const currency = (input.currency as string) || SYSTEM_CURRENCY;
      const walletId = input.walletId as string | undefined;
      
      try {
        const tenantId = getTenantId(ctx) || 'default-tenant';
        const db = getDatabase();
        const walletsCollection = db.collection('wallets');
        
        let wallet: any;
        
        if (walletId) {
          // Lookup by walletId (if provided)
          wallet = await walletsCollection.findOne({ id: walletId });
          if (!wallet) {
            return null;
          }
        } else {
          // Try to find wallet by userId + currency + category
          wallet = await walletsCollection.findOne({
            userId,
            currency,
            tenantId,
            category: category || 'main',
          });
          
          // If not found and category is 'main' (or default), use getOrCreateWallet
          if (!wallet && (!category || category === 'main')) {
            wallet = await getOrCreateWallet(userId, currency, tenantId);
          }
          
          // If still not found, return null (non-main categories must be created explicitly)
          if (!wallet) {
            return null;
          }
        }
        
        const balance = (wallet as any).balance || 0;
        const bonusBalance = (wallet as any).bonusBalance || 0;
        const lockedBalance = (wallet as any).lockedBalance || 0;
        const availableBalance = balance - lockedBalance;
        
        // Get allowNegative directly from wallet (wallet-level permissions)
        const allowNegative = (wallet as any).allowNegative ?? false;
        
        // Return unified format (supports both GraphQL types)
        return {
          walletId: (wallet as any).id,
          userId: (wallet as any).userId || userId,
          category: (wallet as any).category || category,
          currency: (wallet as any).currency || currency,
          balance,
          availableBalance,
          pendingIn: 0, // Not tracked separately - use transactions for pending
          pendingOut: 0, // Not tracked separately - use transactions for pending
          allowNegative,
          realBalance: balance,
          bonusBalance,
          lockedBalance,
          totalBalance: balance + bonusBalance,
          withdrawableBalance: balance,
          status: (wallet as any).status || 'active',
        };
      } catch (error) {
        logger.error('Failed to get wallet balance', { error, userId, category });
        throw new Error(`Failed to get wallet balance: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    
    /**
     * Get user balances by currency (for multi-currency support)
     * Uses wallets directly
     */
    userBalances: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const userId = args.userId as string || getUserId(ctx);
      const currencies = (args.currencies as string[]) || [SYSTEM_CURRENCY];
      
      try {
        const tenantId = getTenantId(ctx) || 'default-tenant';
        const balances: Array<{
          currency: string;
          balance: number;
          availableBalance: number;
          allowNegative: boolean;
        }> = [];
        
        for (const currency of currencies) {
          // Get or create wallet (creates if doesn't exist)
          const wallet = await getOrCreateWallet(userId, currency, tenantId);
          
          const balance = (wallet as any).balance || 0;
          const lockedBalance = (wallet as any).lockedBalance || 0;
          const availableBalance = balance - lockedBalance;
          
          // Get allowNegative directly from wallet (wallet-level permissions)
          const allowNegative = (wallet as any).allowNegative ?? false;
          
          balances.push({
            currency,
            balance,
            availableBalance,
            allowNegative,
          });
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
     * Uses wallets directly - optimized for admin dashboard
     */
    bulkWalletBalances: async (
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
        const tenantId = getTenantId(ctx) || 'default-tenant';
        const db = getDatabase();
        
        // Fetch existing wallets in one query
        const wallets = await db.collection('wallets').find(
          { userId: { $in: userIds }, currency, category: subtype },
          { projection: { userId: 1, id: 1, balance: 1, bonusBalance: 1, lockedBalance: 1, allowNegative: 1 } }
        ).toArray();
        
        // Create a map for quick lookup
        const walletMap = new Map<string, any>();
        wallets.forEach((wallet: any) => {
          walletMap.set(wallet.userId, wallet);
        });
        
        // Build results - get or create wallets for users that don't have one
        const balances: Array<{
          userId: string;
          walletId: string;
          balance: number;
          availableBalance: number;
          pendingIn: number;
          pendingOut: number;
          allowNegative: boolean;
        }> = [];
        
        for (const userId of userIds) {
          let wallet = walletMap.get(userId);
          
          // Get or create wallet if it doesn't exist
          // Use getOrCreateWallet which handles race conditions and duplicate key errors
          if (!wallet) {
            try {
              wallet = await getOrCreateWallet(userId, currency, tenantId);
              // Re-fetch from map in case it was created by another concurrent call
              // This prevents duplicate key errors
              const existingWallet = walletMap.get(userId);
              if (existingWallet) {
                wallet = existingWallet;
              } else {
                // Add to map for future iterations
                walletMap.set(userId, wallet);
              }
            } catch (error: any) {
              // If duplicate key error, fetch the existing wallet
              if (error.code === 11000 || error.message?.includes('duplicate key')) {
                logger.debug('Wallet already exists (race condition), fetching existing wallet', {
                  userId,
                  currency,
                  tenantId,
                });
                // Re-fetch wallets to get the one that was just created
                const existingWallets = await db.collection('wallets').find(
                  { userId: { $in: userIds }, currency, category: subtype },
                  { projection: { userId: 1, id: 1, balance: 1, bonusBalance: 1, lockedBalance: 1, allowNegative: 1 } }
                ).toArray();
                const foundWallet = existingWallets.find((w: any) => w.userId === userId);
                if (foundWallet) {
                  wallet = foundWallet;
                  walletMap.set(userId, wallet);
                } else {
                  // If still not found, try one more time with getOrCreateWallet
                  wallet = await getOrCreateWallet(userId, currency, tenantId);
                  walletMap.set(userId, wallet);
                }
              } else {
                throw error;
              }
            }
          }
          
          const balance = wallet.balance || 0;
          const lockedBalance = wallet.lockedBalance || 0;
          const availableBalance = balance - lockedBalance;
          
          // Get allowNegative directly from wallet (wallet-level permissions)
          const allowNegative = wallet.allowNegative ?? false;
          
          const walletId = extractDocumentId(wallet);
          balances.push({
            userId,
            walletId: walletId || '',
            balance,
            availableBalance,
            pendingIn: 0,
            pendingOut: 0,
            allowNegative,
          });
        }
        
        return {
          balances,
        };
      } catch (error) {
        logger.error('Failed to get bulk wallet balances', { error, userIds });
        throw new Error(`Failed to get bulk wallet balances: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    
    /**
     * ✅ Get transactions with filtering and pagination
     * Uses transactions collection (transactions ARE the ledger)
     * For audit, reconciliation, and debugging purposes
     */
    transactionHistory: async (
      args: Record<string, unknown>,
      ctx: ResolverContext
    ) => {
      requireAuth(ctx);
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      
      const first = (args.first as number) || 100;
      const after = args.after as string | undefined;
      const last = args.last as number | undefined;
      const before = args.before as string | undefined;
      const filter = (args.filter as Record<string, unknown>) || {};
      
      // Build MongoDB query filter
      const queryFilter: Record<string, unknown> = {};
      
      // Filter by charge type if specified
      if (filter.charge) {
        queryFilter.charge = filter.charge;
      }
      
      // Filter by wallet if specified
      if (filter.walletId) {
        queryFilter.walletId = filter.walletId;
      }
      
      // Filter by userId if specified
      if (filter.userId) {
        queryFilter.userId = filter.userId;
      }
      
      // Filter by currency if specified
      if (filter.currency) {
        queryFilter.currency = filter.currency;
      }
      
      // Filter by status if specified
      if (filter.status) {
        queryFilter.status = filter.status;
      }
      
      // Filter by externalRef if specified
      if (filter.externalRef) {
        queryFilter.externalRef = { $regex: filter.externalRef, $options: 'i' };
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
        queryFilter.createdAt = dateFilter;
      }
      
      // Use cursor-based pagination (O(1) performance)
      const result = await paginateCollection(transactionsCollection, {
        first: first ? Math.min(Math.max(1, first), 100) : undefined, // Max 100 per page
        after,
        last: last ? Math.min(Math.max(1, last), 100) : undefined,
        before,
        filter: queryFilter,
        sortField: 'createdAt',
        sortDirection: 'desc',
      });
      
      return {
        nodes: result.edges.map((edge: { node: any; cursor: string }) => {
          const tx = edge.node as any;
          return {
            _id: tx._id?.toString() || tx.id,
            type: tx.charge, // debit or credit
            fromWalletId: tx.charge === 'debit' ? tx.walletId : null, // For debit, walletId is the source
            toWalletId: tx.charge === 'credit' ? tx.walletId : null, // For credit, walletId is the destination
            amount: tx.amount,
            currency: tx.currency,
            description: tx.meta?.description,
            externalRef: tx.externalRef,
            status: tx.status || 'completed',
            createdAt: tx.createdAt,
            metadata: tx.meta,
          };
        }),
        totalCount: result.totalCount,
        pageInfo: result.pageInfo,
      };
    },
  },
  Mutation: {},
};


// ═══════════════════════════════════════════════════════════════════
// Wallet Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateWalletInput {
  userId: string;
  tenantId?: string;
  currency: string;
  category?: string;  // Optional: 'main', 'casino', 'sports', etc.
  allowNegative?: boolean;  // Optional: allow wallet to go negative
  creditLimit?: number;  // Optional: credit limit for negative balances
}

type WalletCtx = SagaContext<Wallet, CreateWalletInput>;

const walletSchema = type({
  userId: 'string',
  currency: 'string',
  'tenantId?': 'string',
  'category?': 'string',
  'allowNegative?': 'boolean',
  'creditLimit?': 'number',
});

const walletSaga = [
  {
    name: 'checkExisting',
    critical: true,
    execute: async ({ input, data, ...ctx }: WalletCtx): Promise<WalletCtx> => {
      const repo = data._repository as Repository<Wallet>;
      const category = input.category || 'main';
      
      // Check for existing wallet with same user + currency + category
      const existing = await repo.findOne({
        userId: input.userId,
        currency: input.currency,
        category,
      } as any);
      
      if (existing) {
        throw new Error(`Wallet already exists for this user, currency (${input.currency}), and category (${category})`);
      }
      return { ...ctx, input, data };
    },
  },
  {
    name: 'createWallet',
    critical: true,
    execute: async ({ input, data, ...ctx }: WalletCtx): Promise<WalletCtx> => {
      const repo = data._repository as Repository<Wallet>;
      const id = (data._generateId as typeof generateId)();
      const now = new Date();
      
      const wallet: Wallet = {
        id,
        tenantId: input.tenantId || 'default-tenant',
        userId: input.userId,
        currency: input.currency as any,
        allowNegative: input.allowNegative ?? false,
        creditLimit: input.creditLimit,
        category: (input.category || 'main') as WalletCategory,
        
        // Balances start at 0
        balance: 0,
        bonusBalance: 0,
        lockedBalance: 0,
        
        // Limits
        dailyWithdrawalUsed: 0,
        lastWithdrawalReset: now,
        monthlyWithdrawalUsed: 0,
        lastMonthlyReset: now,
        
        // Status
        status: 'active',
        isVerified: false,
        verificationLevel: 'none',
        
        // Stats
        lastActivityAt: now,
        lifetimeDeposits: 0,
        lifetimeWithdrawals: 0,
        lifetimeFees: 0,
      } as Wallet;
      
      await repo.create(wallet);
      return { ...ctx, input, data, entity: wallet };
    },
    compensate: async ({ entity, data }: WalletCtx) => {
      if (entity) {
        const repo = data._repository as Repository<Wallet>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const walletService = createService<Wallet, CreateWalletInput>({
  name: 'wallet',
  entity: {
    name: 'wallet',
    collection: 'wallets',
    graphqlType: `
      type Wallet { 
        id: ID! 
        userId: String! 
        currency: String! 
        category: String
        balance: Float! 
        bonusBalance: Float! 
        lockedBalance: Float!
        availableBalance: Float
        withdrawableBalance: Float
        status: String! 
        isVerified: Boolean!
        verificationLevel: String!
        lifetimeDeposits: Float!
        lifetimeWithdrawals: Float!
        lifetimeFees: Float!
        lastActivityAt: String!
        allowNegative: Boolean
        creditLimit: Float
      }
      type WalletConnection { nodes: [Wallet!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateWalletResult { success: Boolean! wallet: Wallet sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateWalletInput { userId: String! currency: String! category: String tenantId: String allowNegative: Boolean creditLimit: Float }`,
    validateInput: (input) => {
      const result = walletSchema(input);
      return validateInput(result) as CreateWalletInput | { errors: string[] };
    },
    indexes: [
      // Unique constraint: one wallet per user+currency+category
      { fields: { userId: 1, tenantId: 1, currency: 1, category: 1 }, options: { unique: true } },
      // Fast lookup by user
      { fields: { userId: 1, status: 1 } },
      // Admin queries
      { fields: { tenantId: 1, status: 1 } },
      { fields: { tenantId: 1, currency: 1 } },
    ],
  },
  saga: walletSaga,
  // Transactions require MongoDB replica set (default in docker-compose)
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});

/**
 * GraphQL type definitions for all wallet queries
 * Architecture: Wallets + Transactions + Transfers
 */
export const walletTypes = `
  type WalletBalance {
    walletId: String!
    userId: String!
    category: String!
    currency: String!
    balance: Float!
    availableBalance: Float!
    pendingIn: Float!
    pendingOut: Float!
    allowNegative: Boolean!
    realBalance: Float!
    bonusBalance: Float!
    lockedBalance: Float!
    totalBalance: Float!
    withdrawableBalance: Float!
    status: String!
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
  
  type BulkWalletBalance {
    userId: String!
    walletId: String!
    balance: Float!
    availableBalance: Float!
    pendingIn: Float!
    pendingOut: Float!
    allowNegative: Boolean!
  }
  
  type BulkWalletBalancesResponse {
    balances: [BulkWalletBalance!]!
  }
  
  type TransactionHistory {
    _id: String!
    type: String!
    fromWalletId: String
    toWalletId: String
    amount: Float!
    currency: String!
    description: String
    externalRef: String
    status: String!
    createdAt: String!
    metadata: JSON
  }
  
  type TransactionHistoryConnection {
    nodes: [TransactionHistory!]!
    totalCount: Int!
    pageInfo: PageInfo!
  }
  
  extend type Query {
    """
    Get all wallets for a user with aggregated totals
    """
    userWallets(input: JSON): UserWalletsResponse
    
    """
    Get user's wallet balance
    Uses wallets collection (source of truth)
    
    Supports both formats:
    - Direct args: walletBalance(userId: String, category: String, currency: String)
    - JSON input: walletBalance(input: JSON)
    """
    walletBalance(
      userId: String
      category: String
      currency: String
      input: JSON
    ): WalletBalance
    
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
    bulkWalletBalances(
      userIds: [String!]!
      category: String
      currency: String
    ): BulkWalletBalancesResponse!
    
    """
    ✅ Get transactions with filtering and pagination
    Uses transactions collection (transactions ARE the ledger)
    For audit, reconciliation, and debugging purposes
    """
    transactionHistory(
      first: Int
      after: String
      last: Int
      before: String
      filter: JSON
    ): TransactionHistoryConnection!
  }
`;

