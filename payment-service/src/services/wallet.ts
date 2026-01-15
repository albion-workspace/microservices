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
 *    - Example: wallet_transactions_2024_01, wallet_transactions_2024_02
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

import { createService, generateId, type, type Repository, type SagaContext, type ResolverContext, getDatabase, deleteCache, deleteCachePattern, logger, validateInput } from 'core-service';
import type { Wallet, WalletTransaction, WalletCategory, WalletTransactionType } from '../types.js';
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
 * Custom resolvers for user wallet operations
 */
export const userWalletResolvers = {
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
      }), {
        realBalance: 0,
        bonusBalance: 0,
        lockedBalance: 0,
        totalBalance: 0,
        withdrawableBalance: 0,
        lifetimeDeposits: walletDocs.reduce((sum: number, w: any) => sum + (w.lifetimeDeposits || 0), 0),
        lifetimeWithdrawals: walletDocs.reduce((sum: number, w: any) => sum + (w.lifetimeWithdrawals || 0), 0),
      });
      
      return {
        userId,
        currency: (input.currency as string) || walletDocs[0]?.currency || 'EUR',
        totals,
        wallets,
      };
    },

    /**
     * Get a single wallet balance (simplified)
     * 
     * Query:
     * ```graphql
     * query GetWalletBalance($input: JSON) {
     *   walletBalance(input: $input)
     * }
     * ```
     * 
     * Variables:
     * ```json
     * { "input": { "userId": "player-123", "category": "sports", "currency": "EUR" } }
     * ```
     */
    walletBalance: async (args: Record<string, unknown>, ctx: ResolverContext) => {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Handle JSON input (args.input) or direct args
      const input = (args.input as Record<string, unknown>) || args;
      
      let wallet: any;
      
      if (input.walletId) {
        // Direct lookup by ID
        wallet = await walletsCollection.findOne({ id: input.walletId as string });
      } else {
        // Lookup by user + category + currency
        const userId = (input.userId as string) || ctx.user?.userId;
        if (!userId) throw new Error('userId or walletId is required');
        
        wallet = await walletsCollection.findOne({
          userId,
          category: (input.category as string) || 'main',
          currency: (input.currency as string) || 'EUR',
        });
      }
      
      if (!wallet) {
        return null;
      }
      
      return {
        walletId: wallet.id,
        userId: wallet.userId,
        category: wallet.category || 'main',
        currency: wallet.currency,
        realBalance: wallet.balance || 0,
        bonusBalance: wallet.bonusBalance || 0,
        lockedBalance: wallet.lockedBalance || 0,
        totalBalance: (wallet.balance || 0) + (wallet.bonusBalance || 0),
        withdrawableBalance: wallet.balance || 0,
        status: wallet.status,
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
}

type WalletCtx = SagaContext<Wallet, CreateWalletInput>;

const walletSchema = type({
  userId: 'string',
  currency: 'string',
  'tenantId?': 'string',
  'category?': 'string',
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
        tenantId: input.tenantId || 'default',
        userId: input.userId,
        currency: input.currency as any,
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
        lastActivityAt: String!
      }
      type WalletConnection { nodes: [Wallet!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateWalletResult { success: Boolean! wallet: Wallet sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateWalletInput { userId: String! currency: String! category: String tenantId: String }`,
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

// ═══════════════════════════════════════════════════════════════════
// Wallet Transaction Types & Validation (OPTIMIZED FOR SCALE)
// ═══════════════════════════════════════════════════════════════════

/**
 * Optimizations applied:
 * 1. Generic reference: refId + refType instead of bonusId/betId/etc
 * 2. Removed balanceBefore: Can be calculated from amount + isCredit
 * 3. Removed updatedAt: Transactions are immutable
 * 4. Compact metadata: Only essential fields
 */
interface CreateWalletTxInput {
  walletId: string;
  userId: string;
  type: string;           // WalletTransactionType (deposit, withdrawal, etc)
  balanceType: string;    // 'real' | 'bonus' | 'locked'
  currency: string;
  amount: number;         // Amount in cents (always positive)
  balance?: number;       // Wallet balance after transaction (calculated by saga if not provided)
  description?: string;
  
  // Generic reference pattern (extensible for any entity)
  refId?: string;         // Reference ID (bonus, bet, game, promotion, etc.)
  refType?: string;       // Reference type ('bonus', 'bet', 'game', 'promo', etc.)
}

type WalletTxCtx = SagaContext<WalletTransaction, CreateWalletTxInput>;

const walletTxSchema = type({
  walletId: 'string',
  userId: 'string',
  type: 'string',
  balanceType: '"real" | "bonus" | "locked"',
  currency: 'string',
  amount: 'number > 0',
  'balance?': 'number >= 0',  // Optional - calculated by saga if not provided
  'description?': 'string',
  'refId?': 'string',
  'refType?': 'string',
});

const walletTxSaga = [
  {
    name: 'loadWallet',
    critical: true,
    execute: async ({ input, data, ...ctx }: WalletTxCtx): Promise<WalletTxCtx> => {
      // Determine transaction type
      const creditTypes = ['deposit', 'win', 'refund', 'bonus_credit', 'transfer_in', 'release'];
      const isCredit = creditTypes.includes(input.type);
      data.isCredit = isCredit;
      
      // Load wallet from DB to get real balance
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      const walletDoc = await walletsCollection.findOne({ id: input.walletId });
      
      if (!walletDoc) {
        throw new Error(`Wallet not found: ${input.walletId}`);
      }
      data.wallet = walletDoc;
      
      const wallet = walletDoc as unknown as Wallet;
      
      // Determine which balance to use based on balanceType
      const balanceField = input.balanceType === 'bonus'
        ? 'bonusBalance'
        : input.balanceType === 'locked'
          ? 'lockedBalance'
          : 'balance';
      const currentBalance = (wallet as any)[balanceField] || 0;

      data.balanceField = balanceField;
      data.currentBalance = currentBalance; // Store for calculating balance

      // For debit operations, preliminary check (atomic check happens during update)
      if (!isCredit && currentBalance < input.amount) {
        throw new Error(`Insufficient funds. Available: ${currentBalance}, Required: ${input.amount}`);
      }
      
      return { ...ctx, input, data };
    },
  },
  {
    name: 'updateWalletBalance',
    critical: true,
    execute: async ({ input, data, ...ctx }: WalletTxCtx): Promise<WalletTxCtx> => {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      const isCredit = data.isCredit as boolean;
      const balanceField = data.balanceField as string;
      
      // For real balance operations, use ledger (source of truth)
      if (balanceField === 'balance') {
        try {
          const { 
            getLedger, 
            getOrCreateUserAccount, 
            getOrCreateProviderAccount,
            recordSystemFundProviderLedgerEntry,
            syncWalletBalanceFromLedger 
          } = await import('./ledger-service.js');
          const ledger = getLedger();
          const wallet = data.wallet as any;
          
          // Check if this is a provider wallet (userId starts with "provider-")
          const isProviderWallet = input.userId.startsWith('provider-');
          
          if (isProviderWallet) {
            // Provider wallet funding: System House -> Provider Account
            if (isCredit && input.type === 'deposit') {
              try {
                // Record system funding in ledger BEFORE updating wallet
                // Generate a unique wallet transaction ID to use as externalRef
                const walletTxId = `wallet-tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const ledgerTxId = await recordSystemFundProviderLedgerEntry(
                  input.userId, // providerId
                  input.amount,
                  input.currency,
                  wallet?.tenantId || 'default',
                  input.description || `System funding to provider ${input.userId}`,
                  walletTxId // Pass wallet transaction ID as externalRef
                );
                logger.info('Provider funding recorded in ledger', {
                  providerId: input.userId,
                  amount: input.amount,
                  currency: input.currency,
                  ledgerTxId,
                });
                // Mark that we should sync from ledger instead of direct update
                (data as any).syncFromLedger = true;
                // For provider funding, we'll sync from ledger instead of updating directly
                // Set a flag to skip the direct wallet update
                (data as any).skipDirectUpdate = true;
              } catch (ledgerError: any) {
                const errorMessage = ledgerError?.message || String(ledgerError);
                const errorStack = ledgerError?.stack;
                logger.error('Failed to record provider funding in ledger', {
                  error: errorMessage,
                  stack: errorStack,
                  providerId: input.userId,
                  amount: input.amount,
                  currency: input.currency,
                });
                // Don't fail the transaction - allow direct wallet update as fallback
                (data as any).skipDirectUpdate = false;
              }
            } else if (!isCredit) {
              // Debit from provider account - check balance
              const providerAccountId = await getOrCreateProviderAccount(input.userId, 'deposit', input.currency);
              const balance = await ledger.getBalance(providerAccountId);
              if (balance.balance < input.amount) {
                throw new Error(
                  `Insufficient balance in provider ledger. Available: ${balance.balance}, Required: ${input.amount}`
                );
              }
            }
          } else {
            // User wallet operations - record in ledger FIRST (ledger is source of truth)
            // For wallet transactions like bet, win, etc., we need to record them in ledger
            // Skip ledger recording for deposit/withdrawal (handled by their own sagas)
            const skipLedgerTypes = ['deposit', 'withdrawal'];
            if (!skipLedgerTypes.includes(input.type)) {
              try {
                const { recordWalletTransactionLedgerEntry } = await import('./ledger-service.js');
                const wallet = data.wallet as any;
                const tenantId = wallet?.tenantId || 'default';
                
                // Record wallet transaction in ledger BEFORE updating wallet
                // This ensures ledger is always the source of truth
                await recordWalletTransactionLedgerEntry(
                  input.userId,
                  input.type,
                  input.amount,
                  input.currency,
                  tenantId,
                  undefined, // walletTransactionId will be set after creation
                  input.description
                );
                
                // Mark that we should sync from ledger instead of direct update
                (data as any).syncFromLedger = true;
                (data as any).skipDirectUpdate = true;
                
                logger.info('Wallet transaction recorded in ledger', {
                  userId: input.userId,
                  type: input.type,
                  amount: input.amount,
                  currency: input.currency,
                });
              } catch (ledgerError: any) {
                // If ledger recording fails, log error but allow wallet update as fallback
                // This ensures backward compatibility
                logger.error('Failed to record wallet transaction in ledger', {
                  error: ledgerError?.message || String(ledgerError),
                  stack: ledgerError?.stack,
                  userId: input.userId,
                  type: input.type,
                  amount: input.amount,
                });
                // Don't fail - allow direct wallet update as fallback
                (data as any).skipDirectUpdate = false;
              }
            } else {
              // For deposit/withdrawal, just check balance (ledger entry created by their sagas)
              const userAccountId = await getOrCreateUserAccount(input.userId, 'real', input.currency);
              
              // Check balance for debits
              if (!isCredit) {
                const balance = await ledger.getBalance(userAccountId);
                if (balance.balance < input.amount) {
                  throw new Error(
                    `Insufficient balance in ledger. Available: ${balance.balance}, Required: ${input.amount}`
                  );
                }
              }
            }
          }
        } catch (ledgerError) {
          // If ledger check fails, fall back to wallet check (for backward compatibility)
          logger.warn('Ledger check failed, using wallet balance', { error: ledgerError });
        }
      }
      
      // Check if we should skip direct update (for provider funding via ledger)
      let skipDirectUpdate = (data as any).skipDirectUpdate === true;
      let balance: number = 0;
      
      if (skipDirectUpdate && balanceField === 'balance') {
        // For provider funding, sync directly from ledger (don't update wallet directly)
        // Wait for ledger transaction to be committed
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
          const { syncWalletBalanceFromLedger } = await import('./ledger-service.js');
          await syncWalletBalanceFromLedger(input.userId, input.walletId, input.currency);
          
          // Get the updated balance from wallet after sync
          const syncedWallet = await walletsCollection.findOne({ id: input.walletId });
          balance = (syncedWallet as any)?.[balanceField] || 0;
          
          logger.info('Wallet balance synced from ledger (skipped direct update)', {
            walletId: input.walletId,
            userId: input.userId,
            balance,
          });
        } catch (syncError) {
          logger.error('Failed to sync provider wallet balance from ledger', { 
            error: syncError,
            walletId: input.walletId,
            providerId: input.userId,
          });
          // Fall back to direct update if sync fails
          skipDirectUpdate = false;
        }
      }
      
      if (!skipDirectUpdate) {
        // Calculate the delta (positive for credit, negative for debit)
        const delta = isCredit ? input.amount : -input.amount;
        
        // Use atomic $inc for concurrency safety
        const incUpdate: Record<string, number> = { [balanceField]: delta };
        
        // Update lifetime stats atomically
        if (input.type === 'deposit') incUpdate.lifetimeDeposits = input.amount;
        else if (input.type === 'withdrawal') incUpdate.lifetimeWithdrawals = input.amount;
        
        // Build query - for debits, add balance check condition
        const query: Record<string, unknown> = { id: input.walletId };
        if (!isCredit) query[balanceField] = { $gte: input.amount };
        
        // Atomic update
        const result = await walletsCollection.findOneAndUpdate(
          query,
          { 
            $inc: incUpdate,
            $set: { lastActivityAt: new Date(), updatedAt: new Date() } 
          },
          { returnDocument: 'after' }
        );
        
        if (!result) {
          throw new Error(
            !isCredit 
              ? `Insufficient funds for ${input.type}. Required: ${input.amount}`
              : `Failed to update wallet balance`
          );
        }
        
        balance = (result as any)[balanceField] || 0;
        
        // Sync wallet balance from ledger for real balance (if not already synced)
        // IMPORTANT: Sync AFTER wallet update to ensure ledger transaction is complete
        if (balanceField === 'balance') {
          try {
            const { syncWalletBalanceFromLedger } = await import('./ledger-service.js');
            // Small delay to ensure ledger transaction is committed
            await new Promise(resolve => setTimeout(resolve, 100));
            await syncWalletBalanceFromLedger(input.userId, input.walletId, input.currency);
            // Re-read balance after sync to get the correct value
            const syncedWallet = await walletsCollection.findOne({ id: input.walletId });
            if (syncedWallet) {
              balance = (syncedWallet as any)[balanceField] || balance;
            }
          } catch (syncError) {
            logger.warn('Could not sync wallet balance from ledger', { error: syncError });
            // Don't fail the transaction if sync fails - wallet balance was already updated
          }
        }
      } else {
        // For ledger-recorded transactions, sync wallet from ledger (don't update directly)
        // Wait for ledger transaction to be committed
        await new Promise(resolve => setTimeout(resolve, 200));
        
        try {
          const { syncWalletBalanceFromLedger } = await import('./ledger-service.js');
          await syncWalletBalanceFromLedger(input.userId, input.walletId, input.currency);
          
          // Get the updated balance from wallet after sync
          const syncedWallet = await walletsCollection.findOne({ id: input.walletId });
          balance = (syncedWallet as any)?.[balanceField] || 0;
          
          logger.info('Wallet balance synced from ledger (ledger-recorded transaction)', {
            walletId: input.walletId,
            userId: input.userId,
            type: input.type,
            balance,
          });
        } catch (syncError) {
          logger.error('Failed to sync wallet balance from ledger after ledger transaction', { 
            error: syncError,
            walletId: input.walletId,
            userId: input.userId,
            type: input.type,
          });
          // Fall back to direct update if sync fails
          const delta = isCredit ? input.amount : -input.amount;
          const result = await walletsCollection.findOneAndUpdate(
            { id: input.walletId },
            { 
              $inc: { [balanceField]: delta },
              $set: { lastActivityAt: new Date(), updatedAt: new Date() } 
            },
            { returnDocument: 'after' }
          );
          balance = result ? ((result as any)[balanceField] || 0) : 0;
        }
      }
      
      // Update input with calculated balance (will be stored in transaction)
      input.balance = balance;
      
      // Invalidate ALL wallet caches (single + lists)
      await deleteCache(`wallets:id:${input.walletId}`);
      await deleteCachePattern('wallets:list:*'); // Invalidate all list caches
      
      return { ...ctx, input, data };
    },
    compensate: async ({ input, data }: WalletTxCtx) => {
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      const balanceField = input.balanceType === 'bonus' 
        ? 'bonusBalance' 
        : input.balanceType === 'locked' 
          ? 'lockedBalance' 
          : 'balance';
      
      const isCredit = data.isCredit as boolean;
      const reverseDelta = isCredit ? -input.amount : input.amount;
      
      await walletsCollection.updateOne(
        { id: input.walletId },
        { $inc: { [balanceField]: reverseDelta }, $set: { updatedAt: new Date() } }
      );
    },
  },
  {
    name: 'createTransaction',
    critical: true,
    execute: async ({ input, data, ...ctx }: WalletTxCtx): Promise<WalletTxCtx> => {
      const repo = data._repository as Repository<WalletTransaction>;
      const id = (data._generateId as typeof generateId)();
      
      const transaction: WalletTransaction = {
        id,
        walletId: input.walletId,
        userId: input.userId,
        tenantId: 'default',
        type: input.type as WalletTransactionType,
        balanceType: input.balanceType as 'real' | 'bonus' | 'locked',
        currency: input.currency as any,
        amount: input.amount,
        balance: input.balance, // Wallet balance after transaction
        description: input.description,
        // Generic reference pattern (extensible for any entity)
        refId: input.refId,
        refType: input.refType,
      } as WalletTransaction;
      
      await repo.create(transaction);
      return { ...ctx, input, data, entity: transaction };
    },
    compensate: async ({ entity, data }: WalletTxCtx) => {
      if (entity) {
        const repo = data._repository as Repository<WalletTransaction>;
        await repo.delete(entity.id);
      }
    },
  },
  {
    name: 'emitEvent',
    critical: false, // Non-critical - transaction is already saved
    execute: async ({ input, entity, data }: WalletTxCtx): Promise<WalletTxCtx> => {
      if (!entity) return { input, entity, data } as WalletTxCtx;
      
      // Emit event for cross-service integration + webhooks (unified)
      const eventType = input.type === 'deposit' 
        ? 'wallet.deposit.completed'
        : input.type === 'withdrawal'
          ? 'wallet.withdrawal.completed'
          : `wallet.${input.type}.completed`;
      
      try {
        // Use unified emitter - sends to both internal services AND webhooks
        await emitPaymentEvent(eventType as any, entity.tenantId, entity.userId, {
          transactionId: entity.id,
          walletId: entity.walletId,
          type: entity.type,
          amount: entity.amount,
          currency: entity.currency,
          balance: entity.balance,
          isFirstDeposit: data.isFirstDeposit, // For bonus service
        });
      } catch (err) {
        // Log but don't fail - event emission is non-critical
        logger.warn(`Failed to emit ${eventType}`, { error: err });
      }
      
      return { input, entity, data } as WalletTxCtx;
    },
  },
];

export const walletTransactionService = createService<WalletTransaction, CreateWalletTxInput>({
  name: 'walletTransaction',
  entity: {
    name: 'walletTransaction',
    collection: 'wallet_transactions',
    graphqlType: `
      type WalletTransaction {
        id: ID!
        walletId: String!
        userId: String!
        type: String!
        balanceType: String!
        currency: String!
        amount: Float!
        balance: Float!
        refId: String
        refType: String
        description: String
        createdAt: String!
      }
      type WalletTransactionConnection { nodes: [WalletTransaction!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateWalletTransactionResult { success: Boolean! walletTransaction: WalletTransaction sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateWalletTransactionInput {
      walletId: String!
      userId: String!
      type: String!
      balanceType: String!
      currency: String!
      amount: Float!
      description: String
      refId: String
      refType: String
    }`,
    validateInput: (input) => {
      const result = walletTxSchema(input);
      return validateInput(result) as CreateWalletTxInput | { errors: string[] };
    },
    indexes: [
      // Core queries (wallet history)
      { fields: { walletId: 1, createdAt: -1 } },
      { fields: { userId: 1, currency: 1, createdAt: -1 } },
      { fields: { userId: 1, type: 1, createdAt: -1 } },
      
      // Generic reference lookups (replaces transactionId, bonusId, betId indexes)
      { fields: { refType: 1, refId: 1 } },
      
      // RECOMMENDED: TTL index for auto-archiving old transactions
      // Automatically delete transactions older than 2 years to manage collection size
      // Uncomment in production:
      // { fields: { createdAt: 1 }, options: { expireAfterSeconds: 63072000 } }, // 2 years
      
      // RECOMMENDED: Partitioning strategy for very high volume
      // Create separate collections per month/year: wallet_transactions_2024_01, etc.
      // Implement in repository layer or use MongoDB sharding
    ],
  },
  saga: walletTxSaga,
  // Transactions require MongoDB replica set (default in docker-compose)
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});
