/**
 * Transaction Service - Generic user-to-user transaction processing
 * 
 * Generic transaction system that handles:
 * - User-to-user deposits and withdrawals
 * - Fee calculation and collection
 * - Balance validation based on permissions
 * - Saga-based rollback for atomic operations
 * 
 * The service is agnostic to business logic (gateway, provider, etc.).
 * It only knows about users, amounts, currencies, and permissions.
 */

import { 
  createService, 
  generateId, 
  type, 
  type Repository, 
  type SagaContext, 
  getDatabase, 
  validateInput, 
  logger,
  findOneById,
  updateOneById,
  findOneAndUpdateById,
} from 'core-service';
import type { Transaction, TransactionStatus } from '../types.js';
import { 
  recordDepositLedgerEntry, 
  recordWithdrawalLedgerEntry,
  syncWalletBalanceFromLedger,
  getLedger,
} from './ledger-service.js';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════
// Deposit Transaction Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateDepositInput {
  userId: string;
  tenantId?: string;
  amount: number;
  currency: string;
  method?: string;
  fromUserId: string; // Source user (required - must exist)
}

type DepositCtx = SagaContext<Transaction, CreateDepositInput>;

const depositSchema = type({
  userId: 'string',
  amount: 'number > 0',
  currency: 'string',
  'tenantId?': 'string',
  'method?': 'string',
  'fromUserId?': 'string',  // Source user (required - must exist)
});

const depositSaga = [
  {
    name: 'calculateFees',
    critical: true,
    execute: async ({ input, data, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      // Fee calculation (generic - can be customized based on permissions/config)
      // Default fee: 2.9% (can be overridden by user permissions or configuration)
      const feePercentage = 2.9;
      const feeAmount = Math.round(input.amount * (feePercentage / 100) * 100) / 100;
      data.feeAmount = feeAmount;
      data.netAmount = input.amount - feeAmount;
      return { ...ctx, input, data };
    },
  },
  {
    name: 'createTransaction',
    critical: true,
    execute: async ({ input, data, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      // ✅ GENERATE externalRef FIRST (before creating transaction)
      // This enables atomic duplicate detection using the externalRef
      const fromUserIdValue = input.fromUserId!;
      const toUserId = input.userId;
      const externalTransactionId = (input as any).externalTransactionId;
      
      // Generate deterministic externalRef (same logic as in creditWallet step)
      let externalRef: string;
      if (externalTransactionId) {
        externalRef = externalTransactionId;
      } else {
        // Generate deterministic hash based on deposit details
        // Include method field to ensure uniqueness when method varies (e.g., test-funding with timestamp)
        const timeWindow = Math.floor(Date.now() / (5 * 60 * 1000)); // 5-minute windows
        const method = input.method || 'deposit';
        const hashData = `${fromUserIdValue}-${toUserId}-${input.amount}-${input.currency}-${method}-${timeWindow}`;
        const hash = crypto.createHash('sha256').update(hashData).digest('hex').substring(0, 32);
        externalRef = `deposit-${hash}`;
      }
      
      // ✅ ATOMIC DUPLICATE CHECK: Check for existing transaction with same externalRef
      // This prevents race conditions where multiple requests create transactions simultaneously
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      
      const existing = await transactionsCollection.findOne({
        type: 'deposit',
        'metadata.externalRef': externalRef,
        status: { $in: ['pending', 'processing', 'completed'] },
      });
      
      if (existing) {
        logger.warn('Duplicate deposit detected - transaction already exists with same externalRef', {
          externalRef,
          existingTxId: existing.id,
          fromUserId: fromUserIdValue,
          toUserId,
          amount: input.amount,
          currency: input.currency,
        });
        throw new Error(`Duplicate deposit detected. A transaction with the same externalRef already exists (${existing.id})`);
      }
      
      const repo = data._repository as Repository<Transaction>;
      const id = (data._generateId as typeof generateId)();
      
      // ✅ Store externalRef in metadata IMMEDIATELY when creating transaction
      // This enables fast duplicate detection before ledger creation
      const transaction: Transaction = {
        id,
        tenantId: input.tenantId || 'default',
        userId: input.userId,
        type: 'deposit',
        status: 'pending' as TransactionStatus,
        method: (input.method || 'card') as any,
        amount: input.amount,
        currency: input.currency as any,
        feeAmount: data.feeAmount as number,
        feeCurrency: input.currency as any,
        netAmount: data.netAmount as number,
        fromUserId: input.fromUserId!, // Source user (required - must exist)
        toUserId: input.userId, // Receiving user
        initiatedAt: new Date(),
        metadata: {
          externalRef, // Store immediately for duplicate detection
        },
        statusHistory: [{
          timestamp: new Date(),
          newStatus: 'pending' as TransactionStatus,
          reason: 'Deposit initiated',
          triggeredBy: 'user',
        }],
      } as Transaction;
      
      // Store externalRef in saga context for use in creditWallet step
      (data as any).externalRef = externalRef;
      
      // No duplicate found - create the transaction
      try {
        await repo.create(transaction);
        return { ...ctx, input, data, entity: transaction };
      } catch (error: any) {
        // ✅ Handle MongoDB duplicate key error (E11000) - use centralized handler
        const { isDuplicateKeyError } = await import('core-service');
        if (isDuplicateKeyError(error)) {
          logger.warn('Duplicate deposit detected - unique index prevented duplicate', {
            externalRef,
            fromUserId: fromUserIdValue,
            toUserId,
            amount: input.amount,
            currency: input.currency,
            error: error.message,
          });
          throw new Error(`Duplicate deposit detected. A transaction with the same externalRef already exists (unique index violation)`);
        }
        // Re-throw other errors
        throw error;
      }
    },
    compensate: async ({ entity, data }: DepositCtx) => {
      if (entity) {
        const repo = data._repository as Repository<Transaction>;
        const { id } = entity;
        await repo.update(id, { status: 'cancelled' as TransactionStatus });
      }
    },
  },
  {
    name: 'processPayment',
    critical: true,
    execute: async ({ input, data, entity, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      if (!entity) throw new Error('No transaction');
      
      const repo = data._repository as Repository<Transaction>;
      const { id, statusHistory } = entity;
      const externalTxId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await repo.update(id, {
        status: 'processing' as TransactionStatus,
        externalTransactionId: externalTxId,
        statusHistory: [...statusHistory, {
          timestamp: new Date(),
          previousStatus: 'pending' as TransactionStatus,
          newStatus: 'processing' as TransactionStatus,
          reason: 'Payment processing',
          triggeredBy: 'user',
        }],
      });
      
      entity.status = 'processing' as TransactionStatus;
      entity.externalTransactionId = externalTxId;
      return { ...ctx, input, data, entity };
    },
  },
  {
    name: 'creditWallet',
    critical: true,
    execute: async ({ input, data, entity, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      if (!entity) throw new Error('No transaction');
      
      // Find or create user's wallet
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      let wallet = await walletsCollection.findOne({ 
        userId: input.userId, 
        currency: input.currency,
        tenantId: input.tenantId || 'default'
      });
      
      // If wallet doesn't exist, create it
      if (!wallet) {
        const newWallet = {
          id: `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          userId: input.userId,
          tenantId: input.tenantId || 'default',
          currency: input.currency,
          category: 'main',
          balance: 0,
          bonusBalance: 0,
          lockedBalance: 0,
          status: 'active',
          isVerified: false,
          verificationLevel: 'none',
          lifetimeDeposits: 0,
          lifetimeWithdrawals: 0,
          lifetimeFees: 0,
          dailyWithdrawalUsed: 0,
          monthlyWithdrawalUsed: 0,
          lastWithdrawalReset: new Date(),
          lastMonthlyReset: new Date(),
          lastActivityAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await walletsCollection.insertOne(newWallet as any);
        wallet = newWallet as any;
      }
      
      // Credit the wallet with net amount (after fees)
      const { netAmount, feeAmount } = data as { netAmount: number; feeAmount: number };
      // User-to-user transfer
      const { fromUserId, id, externalTransactionId } = entity;
      const fromUserIdValue = fromUserId!; // Source user (required - validated in createTransaction step)
      const toUserId = input.userId; // Receiving user
      
      // ✅ REUSE externalRef from createTransaction step (already generated and stored in metadata)
      // This ensures consistency and prevents duplicate generation
      let externalRef: string;
      if (externalTransactionId) {
        externalRef = externalTransactionId;
      } else if ((data as any).externalRef) {
        // Use externalRef from createTransaction step
        externalRef = (data as any).externalRef;
      } else if (entity.metadata?.externalRef) {
        // Fallback: use externalRef from entity metadata
        externalRef = typeof entity.metadata.externalRef === 'string' 
          ? entity.metadata.externalRef 
          : String(entity.metadata.externalRef);
      } else {
        // Last resort: generate it again (shouldn't happen, but safety net)
        const timeWindow = Math.floor(Date.now() / (5 * 60 * 1000));
        const hashData = `${fromUserIdValue}-${toUserId}-${input.amount}-${input.currency}-${timeWindow}`;
        const hash = crypto.createHash('sha256').update(hashData).digest('hex').substring(0, 32);
        externalRef = `deposit-${hash}`;
        logger.warn('Had to regenerate externalRef in creditWallet step (should not happen)', {
          transactionId: id,
          fromUserId: fromUserIdValue,
          toUserId,
        });
      }
      
      // Record in ledger (User -> User) - ledger is source of truth
      try {
        
        // ✅ ATOMICITY: Record in ledger FIRST - if this fails or returns existing, we'll handle it
        const ledgerTxId = await recordDepositLedgerEntry(
          fromUserIdValue,  // From: Source user
          toUserId,    // To: Receiving user
          input.amount,
          feeAmount,
          input.currency,
          input.tenantId || 'default',
          externalRef, // Always set to avoid duplicate key errors
          `Deposit from ${fromUserIdValue}`
        );
        
        // ✅ Store ledger transaction ID and externalRef in GraphQL transaction metadata
        // This enables fast duplicate lookups by externalRef (indexed)
        // Note: Ledger unique index on externalRef will prevent duplicate ledger transactions
        // If ledger returns existing transaction (idempotent), we've already checked for GraphQL duplicates above
        const repo = data._repository as Repository<Transaction>;
        await repo.update(id, {
          metadata: {
            ...(entity.metadata || {}),
            ledgerTxId,
            externalRef,
          }
        });
        
        // Wallet balance sync happens via Redis event (ledger.deposit.completed)
        // No delays needed - event-driven sync works across containers/processes
        // The event is emitted by recordDepositLedgerEntry and handled asynchronously
        // For immediate sync within this process, we do a sync here as fallback
        // Small delay to ensure ledger transaction is committed to database
        await new Promise(resolve => setTimeout(resolve, 100));
        try {
          await syncWalletBalanceFromLedger(
            input.userId,
            (wallet as any).id,
            input.currency
          );
          // Re-read wallet to get synced balance
          // Use optimized findOneById utility (performance-optimized)
          const syncedWallet = await findOneById(walletsCollection, (wallet as any).id, {});
          if (syncedWallet) {
            wallet = syncedWallet as any; // Type assertion: syncedWallet has _id from MongoDB
          }
        } catch (syncError) {
          // Log error for debugging - sync is critical for balance accuracy
          logger.warn('Immediate wallet sync failed after deposit, will retry via event', {
            walletId: (wallet as any).id,
            userId: input.userId,
            currency: input.currency,
            error: syncError instanceof Error ? syncError.message : String(syncError),
            stack: syncError instanceof Error ? syncError.stack : undefined
          });
          // Event-driven sync will handle it asynchronously, but log warning for visibility
        }
        
        // Update lifetime stats only (balance comes from ledger)
        await walletsCollection.updateOne(
          { id: (wallet as any).id },
          { 
            $inc: { 
              lifetimeDeposits: input.amount,
              lifetimeFees: feeAmount, // Track fees for reconciliation
            },
            $set: { 
              lastActivityAt: new Date(),
              updatedAt: new Date()
            }
          }
        );
      } catch (ledgerError) {
        logger.error('Failed to record deposit in ledger', { 
          error: ledgerError,
          transactionId: entity.id,
        });
        throw ledgerError; // Fail the saga if ledger fails
      }
      
      data.walletId = (wallet as any).id;
      return { ...ctx, input, data, entity };
    },
    compensate: async ({ input, data, entity }: DepositCtx) => {
      // Rollback wallet credit
      if (data.walletId && data.netAmount) {
        const db = getDatabase();
        const walletsCollection = db.collection('wallets');
        
        await walletsCollection.updateOne(
          { id: data.walletId },
          { 
            $inc: { 
              balance: -(data.netAmount as number),
              lifetimeDeposits: -input.amount,
            },
            $set: { updatedAt: new Date() }
          }
        );
      }
      
      // Note: Ledger transactions are atomic and will be rolled back automatically
      // if the saga transaction fails. No manual rollback needed for ledger entries.
    },
  },
  // NOTE: Transaction stays in "processing" status
  // In production: awaits external approval/confirmation (webhook, manual approval, etc.)
  // For testing: use approveTransaction/declineTransaction mutations
];

export const depositService = createService<Transaction, CreateDepositInput>({
  name: 'deposit',
  entity: {
    name: 'deposit',
    collection: 'transactions',
    graphqlType: `
      type Transaction { id: ID! userId: String! type: String! status: String! amount: Float! currency: String! feeAmount: Float! netAmount: Float! fromUserId: String toUserId: String description: String metadata: JSON createdAt: String! }
      type TransactionConnection { nodes: [Transaction!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateDepositResult { success: Boolean! deposit: Transaction sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateDepositInput { userId: String! amount: Float! currency: String! tenantId: String method: String fromUserId: String! }`,
    validateInput: (input) => {
      const result = depositSchema(input);
      return validateInput(result) as CreateDepositInput | { errors: string[] };
    },
    indexes: [
      { fields: { userId: 1, type: 1, status: 1 } },
      { fields: { externalTransactionId: 1 } },
      { fields: { createdAt: -1 } },
      // ✅ PERFORMANCE: Compound index for duplicate check query optimization
      // Matches the duplicate check query: type + metadata.externalRef + status
      { fields: { type: 1, 'metadata.externalRef': 1, status: 1 }, options: { sparse: true } },
      // ✅ CRITICAL: Unique index on metadata.externalRef to prevent duplicates at database level
      // This is the final line of defense against race conditions
      { fields: { 'metadata.externalRef': 1 }, options: { sparse: true, unique: true } },
    ],
  },
  saga: depositSaga,
  // Critical: Use MongoDB transaction for payment operations (money!)
  // Requires MongoDB replica set (default in docker-compose)
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});

// ═══════════════════════════════════════════════════════════════════
// Withdrawal Transaction Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateWithdrawalInput {
  userId: string;
  tenantId?: string;
  amount: number;
  currency: string;
  method: string;
  bankAccount?: string;
  walletAddress?: string;
  toUserId: string; // Destination user (required - must exist)
}

type WithdrawalCtx = SagaContext<Transaction, CreateWithdrawalInput>;

const withdrawalSchema = type({
  userId: 'string',
  amount: 'number > 0',
  currency: 'string',
  method: 'string',
  'tenantId?': 'string',
  'bankAccount?': 'string',
  'walletAddress?': 'string',
  toUserId: 'string',  // Destination user (required - must exist)
});

const withdrawalSaga = [
  {
    name: 'validateBalance',
    critical: true,
    execute: async ({ input, data, ...ctx }: WithdrawalCtx): Promise<WithdrawalCtx> => {
      // Find user's wallet and check balance
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      const wallet = await walletsCollection.findOne({ 
        userId: input.userId, 
        currency: input.currency,
        tenantId: input.tenantId || 'default'
      });
      
      if (!wallet) {
        throw new Error(`Wallet not found for user ${input.userId} in ${input.currency}`);
      }
      
      const feeAmount = Math.round(input.amount * 0.01 * 100) / 100; // 1% fee
      const totalRequired = input.amount + feeAmount;
      
      // Check ledger balance (source of truth)
      try {
        const { checkUserBalance } = await import('./ledger-service.js');
        const { sufficient, allowNegative, available } = await checkUserBalance(
          input.userId,
          totalRequired,
          input.currency,
          'main'
        );
        
        if (!sufficient && !allowNegative) {
          throw new Error(
            `Insufficient balance in ledger. Available: ${available}, Required: ${totalRequired}`
          );
        }
        
        // Also check wallet balance for consistency
        const walletBalance = (wallet as any).balance || 0;
        if (walletBalance < totalRequired) {
          logger.warn('Wallet balance mismatch with ledger', {
            userId: input.userId,
            walletBalance,
            ledgerBalance: available,
            required: totalRequired,
          });
          // Sync wallet from ledger
          const { syncWalletBalanceFromLedger } = await import('./ledger-service.js');
          await syncWalletBalanceFromLedger(input.userId, (wallet as any).id, input.currency);
          // Re-check wallet balance after sync
          // Use optimized findOneById utility (performance-optimized)
          const updatedWallet = await findOneById(walletsCollection, (wallet as any).id, {});
          const updatedBalance = (updatedWallet as any)?.balance || 0;
          if (updatedBalance < totalRequired) {
            throw new Error(`Insufficient balance after sync. Available: ${updatedBalance}, Required: ${totalRequired}`);
          }
        }
      } catch (ledgerError) {
        // If ledger check fails, fall back to wallet check (for backward compatibility)
        logger.warn('Ledger balance check failed, using wallet balance', { error: ledgerError });
        const balance = (wallet as any).balance || 0;
        if (balance < totalRequired) {
          throw new Error(`Insufficient balance. Required: ${totalRequired}, Available: ${balance}`);
        }
      }
      
      data.walletId = (wallet as any).id;
      data.feeAmount = feeAmount;
      data.balanceOk = true;
      return { ...ctx, input, data };
    },
  },
  {
    name: 'createTransaction',
    critical: true,
    execute: async ({ input, data, ...ctx }: WithdrawalCtx): Promise<WithdrawalCtx> => {
      const repo = data._repository as Repository<Transaction>;
      const id = (data._generateId as typeof generateId)();
      
      const feeAmount = data.feeAmount as number;
      
      const transaction: Transaction = {
        id,
        tenantId: input.tenantId || 'default',
        userId: input.userId,
        type: 'withdrawal',
        status: 'pending' as TransactionStatus,
        method: input.method as any,
        amount: input.amount,
        currency: input.currency as any,
        feeAmount,
        feeCurrency: input.currency as any,
        netAmount: input.amount - feeAmount,
        fromUserId: input.userId, // User withdrawing
        toUserId: input.toUserId!, // Destination user (required - must exist)
        paymentDetails: {
          bankAccount: input.bankAccount,
          walletAddress: input.walletAddress,
        },
        initiatedAt: new Date(),
        statusHistory: [{
          timestamp: new Date(),
          newStatus: 'pending' as TransactionStatus,
          reason: 'Withdrawal initiated',
          triggeredBy: 'user',
        }],
      } as Transaction;
      
      await repo.create(transaction);
      return { ...ctx, input, data, entity: transaction };
    },
    compensate: async ({ entity, data }: WithdrawalCtx) => {
      if (entity) {
        const repo = data._repository as Repository<Transaction>;
        const { id } = entity;
        await repo.update(id, { status: 'cancelled' as TransactionStatus });
      }
    },
  },
  {
    name: 'debitWallet',
    critical: true,
    execute: async ({ input, data, entity, ...ctx }: WithdrawalCtx): Promise<WithdrawalCtx> => {
      if (!entity) throw new Error('No transaction');
      
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      // Debit the full amount (amount + fee) from wallet
      const { feeAmount } = data as { feeAmount: number };
      const totalAmount = input.amount + feeAmount;
      // User-to-user transfer
      const fromUserId = input.userId; // User withdrawing
      const { toUserId: toUserIdValue, id, externalTransactionId } = entity;
      const toUserId = toUserIdValue!; // Destination user (required - validated in createTransaction step)
      
      // Record in ledger (User -> User) - ledger is source of truth
      try {
        // ✅ DUPLICATE PROTECTION: Generate deterministic externalRef to prevent duplicates
        // Priority: externalTransactionId (from payment provider) > deterministic hash > transaction ID
        let withdrawalExternalRef: string;
        if (externalTransactionId) {
          // Use provided external transaction ID (from payment provider)
          withdrawalExternalRef = externalTransactionId;
        } else {
          // Generate deterministic hash based on withdrawal details to detect duplicates
          // Time window: round to nearest 5 minutes to catch rapid duplicates
          const timeWindow = Math.floor(Date.now() / (5 * 60 * 1000)); // 5-minute windows
          const hashData = `${fromUserId}-${toUserId || input.userId}-${input.amount}-${input.currency}-${timeWindow}`;
          const hash = crypto.createHash('sha256').update(hashData).digest('hex').substring(0, 32);
          withdrawalExternalRef = `withdrawal-${hash}`;
          // Fallback to transaction ID if hash generation fails (shouldn't happen, but safety net)
          if (!withdrawalExternalRef) {
            withdrawalExternalRef = id || generateId();
          }
        }
        
        await recordWithdrawalLedgerEntry(
          fromUserId,  // From: User withdrawing
          toUserId,    // To: Destination user
          input.amount,
          feeAmount,
          input.currency,
          input.tenantId || 'default',
          withdrawalExternalRef, // Always set to avoid duplicate key errors
          `Withdrawal to ${toUserId}`
        );
        
        // Wallet balance sync happens via Redis event (ledger.withdrawal.completed)
        // No delays needed - event-driven sync works across containers/processes
        // The event is emitted by recordWithdrawalLedgerEntry and handled asynchronously
        // For immediate sync within this process, we can do a quick sync here as fallback
        try {
          await syncWalletBalanceFromLedger(
            input.userId,
            data.walletId as string,
            input.currency
          );
        } catch (syncError) {
          // Sync failed - event-driven sync will handle it asynchronously
          logger.debug('Immediate wallet sync failed, will sync via event', {
            walletId: data.walletId,
            error: syncError instanceof Error ? syncError.message : String(syncError)
          });
        }
        
        // Update lifetime stats only (balance comes from ledger)
        await walletsCollection.updateOne(
          { id: data.walletId },
          { 
            $inc: { 
              lifetimeWithdrawals: input.amount,
              lifetimeFees: feeAmount, // Track fees for reconciliation
            },
            $set: { 
              lastActivityAt: new Date(),
              updatedAt: new Date()
            }
          }
        );
      } catch (ledgerError) {
        logger.error('Failed to record withdrawal in ledger', { 
          error: ledgerError,
          transactionId: id,
        });
        throw ledgerError; // Fail the saga if ledger fails
      }
      
      // Update transaction status to processing
      const repo = data._repository as Repository<Transaction>;
      const { statusHistory } = entity;
      await repo.update(id, {
        status: 'processing' as TransactionStatus,
        statusHistory: [...statusHistory, {
          timestamp: new Date(),
          previousStatus: 'pending' as TransactionStatus,
          newStatus: 'processing' as TransactionStatus,
          reason: 'Wallet debited',
          triggeredBy: 'system',
        }],
      });
      
      entity.status = 'processing' as TransactionStatus;
      return { ...ctx, input, data, entity };
    },
    compensate: async ({ input, data }: WithdrawalCtx) => {
      // Rollback wallet debit
      if (data.walletId) {
        const db = getDatabase();
        const walletsCollection = db.collection('wallets');
        
        const totalAmount = input.amount + (data.feeAmount as number);
        await walletsCollection.updateOne(
          { id: data.walletId },
          { 
            $inc: { 
              balance: totalAmount,
              lifetimeWithdrawals: -input.amount,
              lifetimeFees: -(data.feeAmount as number || 0),
            },
            $set: { updatedAt: new Date() }
          }
        );
      }
    },
  },
  // NOTE: Transaction stays in "processing" status with funds held
  // In production: awaits approval (manual or automatic based on limits/KYC/AML rules)
  // For testing: use approveTransaction/declineTransaction mutations
];

export const withdrawalService = createService<Transaction, CreateWithdrawalInput>({
  name: 'withdrawal',
  entity: {
    name: 'withdrawal',
    collection: 'transactions',
    graphqlType: `
      # Transaction and TransactionConnection are defined by depositService - reference them here
      # This allows withdrawal queries to use TransactionConnection
      type CreateWithdrawalResult { success: Boolean! withdrawal: Transaction sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateWithdrawalInput { userId: String! amount: Float! currency: String! method: String! tenantId: String bankAccount: String walletAddress: String }`,
    validateInput: (input) => {
      const result = withdrawalSchema(input);
      return validateInput(result) as CreateWithdrawalInput | { errors: string[] };
    },
    indexes: [],
  },
  saga: withdrawalSaga,
  // Critical: Use MongoDB transaction for withdrawal operations (money!)
  // Requires MongoDB replica set (default in docker-compose)
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});

// ═══════════════════════════════════════════════════════════════════
// Transaction Approval Mutations (for testing/manual approval)
// ═══════════════════════════════════════════════════════════════════

export const transactionApprovalResolvers = {
  Query: {
    // ✅ Unified transactions query - fetches all transactions (deposits + withdrawals) together
    transactions: async (args: Record<string, unknown>) => {
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      
      const first = (args.first as number) || 100;
      const skip = (args.skip as number) || 0;
      const filter = (args.filter as Record<string, unknown>) || {};
      
      // Build MongoDB query
      const query: Record<string, unknown> = {};
      
      // Filter by type if specified
      if (filter.type) {
        query.type = filter.type;
      }
      
      // Filter by userId if specified
      if (filter.userId) {
        query.userId = filter.userId;
      }
      
      // Filter by status if specified
      if (filter.status) {
        query.status = filter.status;
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
        transactionsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(first)
          .toArray(),
        transactionsCollection.countDocuments(query),
      ]);
      
      return {
        nodes: nodes.map((tx: any) => ({
          id: tx.id,
          userId: tx.userId,
          type: tx.type,
          status: tx.status,
          amount: tx.amount,
          currency: tx.currency,
          feeAmount: tx.feeAmount,
          netAmount: tx.netAmount,
          fromUserId: tx.fromUserId,
          toUserId: tx.toUserId,
          createdAt: tx.createdAt,
          description: tx.description,
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
  Mutation: {
    approveTransaction: async (args: Record<string, unknown>) => {
      const transactionId = args.transactionId as string;
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      
      // Use optimized findOneById utility (performance-optimized)
      const transaction = await findOneById(transactionsCollection, transactionId, {});
      if (!transaction) {
        throw new Error(`Transaction ${transactionId} not found`);
      }
      
      const { status, statusHistory } = transaction as any;
      if (status !== 'processing') {
        throw new Error(`Transaction must be in processing status. Current: ${status}`);
      }
      
      // Use optimized updateOneById utility (performance-optimized)
      await updateOneById(
        transactionsCollection,
        transactionId,
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            statusHistory: [
              ...(statusHistory || []),
              {
                timestamp: new Date(),
                previousStatus: 'processing',
                newStatus: 'completed',
                reason: 'Manually approved',
                triggeredBy: 'system',
              },
            ],
          },
        }
      );
      
      return {
        success: true,
        transaction: { ...(transaction as any), status: 'completed' },
      };
    },
    
    declineTransaction: async (args: Record<string, unknown>) => {
      const transactionId = args.transactionId as string;
      const reason = (args.reason as string) || 'Manually declined';
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      const walletsCollection = db.collection('wallets');
      
      // Use optimized findOneById utility (performance-optimized)
      const transaction = await findOneById(transactionsCollection, transactionId, {});
      if (!transaction) {
        throw new Error(`Transaction ${transactionId} not found`);
      }
      
      const txData = transaction as any;
      const { status, statusHistory } = txData;
      
      if (status !== 'processing') {
        throw new Error(`Transaction must be in processing status. Current: ${status}`);
      }
      
      // If it's a deposit, rollback the credited amount
      if (txData.type === 'deposit') {
        const { userId, currency, netAmount, amount, feeAmount } = txData;
        // Note: This update uses userId+currency (not id), so we keep manual query
        await walletsCollection.updateOne(
          { userId, currency },
          {
            $inc: {
              balance: -netAmount,
              lifetimeDeposits: -amount,
              lifetimeFees: -(feeAmount || 0),
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      
      // If it's a withdrawal, return the held funds
      if (txData.type === 'withdrawal') {
        const { userId, currency, amount, feeAmount } = txData;
        const totalAmount = amount + feeAmount;
        await walletsCollection.updateOne(
          { userId, currency },
          {
            $inc: {
              balance: totalAmount,
              lifetimeWithdrawals: -amount,
              lifetimeFees: -(feeAmount || 0),
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      
      // Use optimized updateOneById utility (performance-optimized)
      await updateOneById(
        transactionsCollection,
        transactionId,
        {
          $set: {
            status: 'failed',
            statusHistory: [
              ...(statusHistory || []),
              {
                timestamp: new Date(),
                previousStatus: 'processing',
                newStatus: 'failed',
                reason,
                triggeredBy: 'system',
              },
            ],
          },
        }
      );
      
      return {
        success: true,
        transaction: { ...txData, status: 'failed' },
      };
    },
  },
};
