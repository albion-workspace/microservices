/**
 * Transaction Service - Saga-based payment processing
 */

import { createService, generateId, type, type Repository, type SagaContext, getDatabase, validateInput, logger } from 'core-service';
import type { Transaction, ProviderConfig, TransactionStatus } from '../types.js';
import { 
  recordDepositLedgerEntry, 
  recordWithdrawalLedgerEntry,
  syncWalletBalanceFromLedger,
  getOrCreateProviderAccount,
} from './ledger-service.js';

// ═══════════════════════════════════════════════════════════════════
// Provider Config Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateProviderConfigInput {
  provider: string;
  name: string;
  tenantId?: string;
  supportedMethods: string[];
  supportedCurrencies: string[];
  feeType?: string;
  feePercentage?: number;
}

type ProviderCtx = SagaContext<ProviderConfig, CreateProviderConfigInput>;

const providerSchema = type({
  provider: 'string',
  name: 'string >= 3',
  supportedMethods: 'string[]',
  supportedCurrencies: 'string[]',
  'tenantId?': 'string',
  'feeType?': 'string',
  'feePercentage?': 'number',
});

const providerSaga = [
  {
    name: 'createProvider',
    critical: true,
    execute: async ({ input, data, ...ctx }: ProviderCtx): Promise<ProviderCtx> => {
      const repo = data._repository as Repository<ProviderConfig>;
      const id = (data._generateId as typeof generateId)();
      
      const config: ProviderConfig = {
        id,
        tenantId: input.tenantId || 'default',
        provider: input.provider as any,
        name: input.name,
        isActive: true,
        isDefault: false,
        credentials: {},
        supportedMethods: input.supportedMethods as any[],
        supportedCurrencies: input.supportedCurrencies as any[],
        feeType: (input.feeType || 'percentage') as any,
        feePercentage: input.feePercentage || 2.9,
        autoCapture: true,
        supportRefund: true,
        supportPartialRefund: true,
        priority: 0,
      } as ProviderConfig;
      
      await repo.create(config);
      
      // Create provider accounts in ledger for deposit and withdrawal
      try {
        await getOrCreateProviderAccount(config.id, 'deposit', input.supportedCurrencies[0] || 'USD');
        await getOrCreateProviderAccount(config.id, 'withdrawal', input.supportedCurrencies[0] || 'USD');
        logger.info('Provider ledger accounts created', { providerId: config.id });
      } catch (ledgerError) {
        logger.warn('Could not create provider ledger accounts', { 
          error: ledgerError,
          providerId: config.id,
        });
        // Continue - provider config is created, ledger accounts can be created later
      }
      
      return { ...ctx, input, data, entity: config };
    },
    compensate: async ({ entity, data }: ProviderCtx) => {
      if (entity) {
        const repo = data._repository as Repository<ProviderConfig>;
        await repo.delete(entity.id);
      }
    },
  },
];

export const providerConfigService = createService<ProviderConfig, CreateProviderConfigInput>({
  name: 'providerConfig',
  entity: {
    name: 'providerConfig',
    collection: 'provider_configs',
    graphqlType: `
      type ProviderConfig { id: ID! provider: String! name: String! isActive: Boolean! supportedMethods: [String!]! supportedCurrencies: [String!]! feePercentage: Float }
      type ProviderConfigConnection { nodes: [ProviderConfig!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateProviderConfigResult { success: Boolean! providerConfig: ProviderConfig sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateProviderConfigInput { provider: String! name: String! tenantId: String supportedMethods: [String!]! supportedCurrencies: [String!]! feeType: String feePercentage: Float }`,
    validateInput: (input) => {
      const result = providerSchema(input);
      return validateInput(result) as CreateProviderConfigInput | { errors: string[] };
    },
    indexes: [
      { fields: { tenantId: 1, provider: 1 }, options: { unique: true } },
      { fields: { tenantId: 1, isActive: 1 } },
    ],
  },
  saga: providerSaga,
  // No transaction needed for config changes (no money involved)
});

// ═══════════════════════════════════════════════════════════════════
// Deposit Transaction Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateDepositInput {
  userId: string;
  tenantId?: string;
  amount: number;
  currency: string;
  method?: string;
}

type DepositCtx = SagaContext<Transaction, CreateDepositInput>;

const depositSchema = type({
  userId: 'string',
  amount: 'number > 0',
  currency: 'string',
  'tenantId?': 'string',
  'method?': 'string',
  'providerId?': 'string',
  'providerName?': 'string',
});

const depositSaga = [
  {
    name: 'calculateFees',
    critical: true,
    execute: async ({ input, data, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      const feePercentage = 2.9; // Would come from provider config
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
      const repo = data._repository as Repository<Transaction>;
      const id = (data._generateId as typeof generateId)();
      
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
        providerId: 'default-provider',
        providerName: 'stripe' as any,
        initiatedAt: new Date(),
        statusHistory: [{
          timestamp: new Date(),
          newStatus: 'pending' as TransactionStatus,
          reason: 'Deposit initiated',
          triggeredBy: 'user',
        }],
      } as Transaction;
      
      await repo.create(transaction);
      return { ...ctx, input, data, entity: transaction };
    },
    compensate: async ({ entity, data }: DepositCtx) => {
      if (entity) {
        const repo = data._repository as Repository<Transaction>;
        await repo.update(entity.id, { status: 'cancelled' as TransactionStatus });
      }
    },
  },
  {
    name: 'processWithProvider',
    critical: true,
    execute: async ({ input, data, entity, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      if (!entity) throw new Error('No transaction');
      
      const repo = data._repository as Repository<Transaction>;
      const providerTxId = `stripe_${Date.now()}`;
      
      await repo.update(entity.id, {
        status: 'processing' as TransactionStatus,
        providerTransactionId: providerTxId,
        statusHistory: [...entity.statusHistory, {
          timestamp: new Date(),
          previousStatus: 'pending' as TransactionStatus,
          newStatus: 'processing' as TransactionStatus,
          reason: 'Sent to provider',
          triggeredBy: 'system',
        }],
      });
      
      entity.status = 'processing' as TransactionStatus;
      entity.providerTransactionId = providerTxId;
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
      const netAmount = data.netAmount as number;
      const feeAmount = data.feeAmount as number;
      const providerId = entity.providerId || 'default-provider';
      
      // Record in ledger (Provider -> User) - ledger is source of truth
      try {
        // Ensure externalRef is always set (use transaction ID or generate one to avoid duplicate key errors)
        const externalRef = entity.id || entity.providerTransactionId || crypto.randomUUID();
        
        await recordDepositLedgerEntry(
          providerId,
          input.userId,
          input.amount,
          feeAmount,
          input.currency,
          input.tenantId || 'default',
          externalRef, // Always set to avoid duplicate key errors
          `Deposit via ${entity.providerName}`
        );
        
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
          const syncedWallet = await walletsCollection.findOne({ id: (wallet as any).id });
          if (syncedWallet) {
            wallet = syncedWallet;
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
  // In production: awaits webhook from payment provider (Stripe, PayPal, etc.)
  // For testing: use approveTransaction/declineTransaction mutations
];

export const depositService = createService<Transaction, CreateDepositInput>({
  name: 'deposit',
  entity: {
    name: 'deposit',
    collection: 'transactions',
    graphqlType: `
      type Transaction { id: ID! userId: String! type: String! status: String! amount: Float! currency: String! feeAmount: Float! netAmount: Float! providerName: String! createdAt: String! }
      type TransactionConnection { nodes: [Transaction!]! totalCount: Int! pageInfo: PageInfo! }
      type CreateDepositResult { success: Boolean! deposit: Transaction sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateDepositInput { userId: String! amount: Float! currency: String! tenantId: String method: String }`,
    validateInput: (input) => {
      const result = depositSchema(input);
      return validateInput(result) as CreateDepositInput | { errors: string[] };
    },
    indexes: [
      { fields: { userId: 1, type: 1, status: 1 } },
      { fields: { providerTransactionId: 1 } },
      { fields: { createdAt: -1 } },
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
  'providerId?': 'string',
  'providerName?': 'string',
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
        const { checkUserWithdrawalBalance } = await import('./ledger-service.js');
        const balanceCheck = await checkUserWithdrawalBalance(
          input.userId,
          input.amount,
          feeAmount,
          input.currency
        );
        
        if (!balanceCheck.sufficient) {
          throw new Error(
            `Insufficient balance in ledger. Available: ${balanceCheck.available}, Required: ${balanceCheck.required}`
          );
        }
        
        // Also check wallet balance for consistency
        const walletBalance = (wallet as any).balance || 0;
        if (walletBalance < totalRequired) {
          logger.warn('Wallet balance mismatch with ledger', {
            userId: input.userId,
            walletBalance,
            ledgerBalance: balanceCheck.available,
            required: totalRequired,
          });
          // Sync wallet from ledger
          const { syncWalletBalanceFromLedger } = await import('./ledger-service.js');
          await syncWalletBalanceFromLedger(input.userId, (wallet as any).id, input.currency);
          // Re-check wallet balance after sync
          const updatedWallet = await walletsCollection.findOne({ id: (wallet as any).id });
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
        providerId: 'default-provider',
        providerName: 'bank_transfer' as any,
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
        await repo.update(entity.id, { status: 'cancelled' as TransactionStatus });
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
      const totalAmount = input.amount + (data.feeAmount as number);
      const feeAmount = data.feeAmount as number;
      const providerId = entity.providerId || 'default-provider';
      
      // Record in ledger (User -> Provider) - ledger is source of truth
      try {
        // Ensure externalRef is always set (use transaction ID or generate one to avoid duplicate key errors)
        const withdrawalExternalRef = entity.id || entity.providerTransactionId || crypto.randomUUID();
        
        await recordWithdrawalLedgerEntry(
          providerId,
          input.userId,
          input.amount,
          feeAmount,
          input.currency,
          input.tenantId || 'default',
          withdrawalExternalRef, // Always set to avoid duplicate key errors
          `Withdrawal via ${entity.providerName}`
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
          transactionId: entity.id,
        });
        throw ledgerError; // Fail the saga if ledger fails
      }
      
      // Update transaction status to processing
      const repo = data._repository as Repository<Transaction>;
      await repo.update(entity.id, {
        status: 'processing' as TransactionStatus,
        statusHistory: [...entity.statusHistory, {
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
            },
            $set: { updatedAt: new Date() }
          }
        );
      }
    },
  },
  // NOTE: Transaction stays in "processing" status with funds held
  // In production: awaits manual approval or auto-approval based on limits/KYC/AML
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
  Query: {},
  Mutation: {
    approveTransaction: async (args: Record<string, unknown>) => {
      const transactionId = args.transactionId as string;
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      
      const transaction = await transactionsCollection.findOne({ id: transactionId });
      if (!transaction) {
        throw new Error(`Transaction ${transactionId} not found`);
      }
      
      if ((transaction as any).status !== 'processing') {
        throw new Error(`Transaction must be in processing status. Current: ${(transaction as any).status}`);
      }
      
      // Update transaction to completed
      await transactionsCollection.updateOne(
        { id: transactionId },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            statusHistory: [
              ...((transaction as any).statusHistory || []),
              {
                timestamp: new Date(),
                previousStatus: 'processing',
                newStatus: 'completed',
                reason: 'Manually approved',
                triggeredBy: 'admin',
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
      
      const transaction = await transactionsCollection.findOne({ id: transactionId });
      if (!transaction) {
        throw new Error(`Transaction ${transactionId} not found`);
      }
      
      if ((transaction as any).status !== 'processing') {
        throw new Error(`Transaction must be in processing status. Current: ${(transaction as any).status}`);
      }
      
      const txData = transaction as any;
      
      // If it's a deposit, rollback the credited amount
      if (txData.type === 'deposit') {
        await walletsCollection.updateOne(
          { userId: txData.userId, currency: txData.currency },
          {
            $inc: {
              balance: -txData.netAmount,
              lifetimeDeposits: -txData.amount,
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      
      // If it's a withdrawal, return the held funds
      if (txData.type === 'withdrawal') {
        const totalAmount = txData.amount + txData.feeAmount;
        await walletsCollection.updateOne(
          { userId: txData.userId, currency: txData.currency },
          {
            $inc: {
              balance: totalAmount,
              lifetimeWithdrawals: -txData.amount,
            },
            $set: { updatedAt: new Date() },
          }
        );
      }
      
      // Update transaction to failed
      await transactionsCollection.updateOne(
        { id: transactionId },
        {
          $set: {
            status: 'failed',
            statusHistory: [
              ...(txData.statusHistory || []),
              {
                timestamp: new Date(),
                previousStatus: 'processing',
                newStatus: 'failed',
                reason,
                triggeredBy: 'admin',
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
