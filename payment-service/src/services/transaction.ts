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
} from 'core-service';
import type { Transaction, Transfer } from '../types.js';
import { createTransferWithTransactions, type ClientSession } from 'core-service';
import crypto from 'crypto';

/**
 * Helper function to generate externalRef for idempotency
 * Creates a hash-based externalRef if externalTransactionId is not provided
 */
function generateExternalRef(
  type: 'deposit' | 'withdrawal',
  fromUserId: string,
  toUserId: string,
  amount: number,
  currency: string,
  externalTransactionId?: string,
  method?: string
): string {
  if (externalTransactionId) {
    return externalTransactionId;
  }
  
  const timeWindow = Math.floor(Date.now() / (5 * 60 * 1000));
  const hashData = method 
    ? `${fromUserId}-${toUserId}-${amount}-${currency}-${method}-${timeWindow}`
    : `${fromUserId}-${toUserId}-${amount}-${currency}-${timeWindow}`;
  const hash = crypto.createHash('sha256').update(hashData).digest('hex').substring(0, 32);
  return `${type}-${hash}`;
}

/**
 * Helper function to check for duplicate transfers
 * Throws error if duplicate is found
 */
async function checkDuplicateTransfer(
  externalRef: string,
  type: 'deposit' | 'withdrawal'
): Promise<void> {
  const db = getDatabase();
  const transfersCollection = db.collection('transfers');
  const existing = await transfersCollection.findOne({
    'meta.externalRef': externalRef,
    status: { $in: ['pending', 'active', 'approved'] },
  });
  
  if (existing) {
    logger.warn(`Duplicate ${type} detected - transfer already exists`, {
      externalRef,
      existingTransferId: existing.id,
    });
    throw new Error(`Duplicate ${type} detected. A transfer with the same externalRef already exists (${existing.id})`);
  }
}

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
    name: 'createTransferAndTransactions',
    critical: true,
    execute: async ({ input, data, ...ctx }: DepositCtx): Promise<DepositCtx> => {
      // Destructure input for cleaner code
      const { userId: toUserId, amount, currency, tenantId: tenantIdParam, method: methodParam, fromUserId: fromUserIdValue, ...rest } = input;
      
      const tenantId = tenantIdParam || 'default-tenant';
      const method = methodParam || 'deposit';
      const externalTransactionId = (rest as any).externalTransactionId;
      
      // Generate externalRef and check for duplicates
      const externalRef = generateExternalRef(
        'deposit',
        fromUserIdValue,
        toUserId,
        amount,
        currency,
        externalTransactionId,
        method
      );
      
      await checkDuplicateTransfer(externalRef, 'deposit');
      
      // Get session from saga context if available (for transaction support)
      const session = (data as any)._session as ClientSession | undefined;
      
      // Create transfer using helper function (passes session if available)
      // Generate a generic description (only add method detail if it's a specific payment method)
      const methodDisplay = method || 'system';
      const isGenericMethod = !methodDisplay || methodDisplay === 'system' || methodDisplay === 'deposit';
      const description = isGenericMethod 
        ? 'Deposit'
        : `Deposit via ${methodDisplay.charAt(0).toUpperCase() + methodDisplay.slice(1)}`;
      
      const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
        fromUserId: fromUserIdValue,
        toUserId,
        amount,
        currency,
        tenantId,
        feeAmount: data.feeAmount as number,
        method: method || 'system',
        externalRef,
        description,
        // Payment-specific details from rest params
        ...rest,
        externalTransactionId,
      }, session);
      
      // Return credit transaction as the primary entity
      return { ...ctx, input, data: { ...data, transfer, debitTx, creditTx }, entity: creditTx };
    },
    compensate: async ({ data }: DepositCtx) => {
      // Transfer saga handles its own compensation
      if ((data as any).transfer) {
        // Transfer compensation will rollback transactions and wallets
      }
    },
  },
];

export const depositService = createService<Transaction, CreateDepositInput>({
  name: 'deposit',
  entity: {
    name: 'deposit',
    collection: 'transactions',
    graphqlType: `
      type Transaction { 
        id: ID! 
        userId: String! 
        amount: Float! 
        balance: Float! 
        objectId: String 
        objectModel: String 
        charge: String! 
        meta: JSON 
        createdAt: String!
        # Computed fields (mapped from meta and charge)
        type: String
        status: String
        currency: String
        feeAmount: Float
        netAmount: Float
        fromUserId: String
        toUserId: String
        description: String
        metadata: JSON
      }
      type TransactionConnection { nodes: [Transaction!]! totalCount: Int! pageInfo: PageInfo! }
      # Transfer type will be defined by transferService (referenced here)
      type CreateDepositResult { success: Boolean! deposit: Transaction transfer: Transfer sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateDepositInput { userId: String! amount: Float! currency: String! tenantId: String method: String fromUserId: String! }`,
    validateInput: (input) => {
      const result = depositSchema(input);
      return validateInput(result) as CreateDepositInput | { errors: string[] };
    },
    indexes: [
      { fields: { userId: 1, createdAt: -1 } },
      { fields: { userId: 1, charge: 1, createdAt: -1 } },
      { fields: { objectModel: 1, objectId: 1 } },
      { fields: { 'meta.externalRef': 1, charge: 1 }, options: { sparse: true, unique: true } },
      { fields: { 'meta.walletId': 1, createdAt: -1 } },
    ],
  },
  saga: depositSaga,
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
    name: 'calculateFees',
    critical: true,
    execute: async ({ input, data, ...ctx }: WithdrawalCtx): Promise<WithdrawalCtx> => {
      const feePercentage = 1.0; // 1% withdrawal fee
      const feeAmount = Math.round(input.amount * (feePercentage / 100) * 100) / 100;
      data.feeAmount = feeAmount;
      data.netAmount = input.amount - feeAmount;
      return { ...ctx, input, data };
    },
  },
  {
    name: 'checkBalance',
    critical: true,
    execute: async ({ input, data, ...ctx }: WithdrawalCtx): Promise<WithdrawalCtx> => {
      const totalRequired = input.amount + (data.feeAmount as number);
      
      const db = getDatabase();
      const walletsCollection = db.collection('wallets');
      
      const wallet = await walletsCollection.findOne({ 
        userId: input.userId, 
        currency: input.currency,
        tenantId: input.tenantId || 'default-tenant'
      });
      
      if (!wallet) {
        throw new Error(`Wallet not found for user ${input.userId} and currency ${input.currency}`);
      }
      
      const balance = (wallet as any).balance || 0;
      if (balance < totalRequired) {
        throw new Error(`Insufficient balance. Required: ${totalRequired}, Available: ${balance}`);
      }
      
      data.walletId = (wallet as any).id;
      return { ...ctx, input, data };
    },
  },
  {
    name: 'createTransferAndTransactions',
    critical: true,
    execute: async ({ input, data, ...ctx }: WithdrawalCtx): Promise<WithdrawalCtx> => {
      // Destructure input for cleaner code
      const { userId: fromUserId, toUserId, amount, currency, tenantId: tenantIdParam, method, ...rest } = input;
      
      const tenantId = tenantIdParam || 'default-tenant';
      const externalTransactionId = (rest as any).externalTransactionId;
      
      // Generate externalRef and check for duplicates
      const externalRef = generateExternalRef(
        'withdrawal',
        fromUserId,
        toUserId,
        amount,
        currency,
        externalTransactionId
      );
      
      await checkDuplicateTransfer(externalRef, 'withdrawal');
      
      // Get session from saga context if available (for transaction support)
      const session = (data as any)._session as ClientSession | undefined;
      
      // Create transfer using helper function (passes session if available)
      // Generate a generic description (only add method detail if it's a specific payment method)
      const methodDisplay = method || 'system';
      const isGenericMethod = !methodDisplay || methodDisplay === 'system' || methodDisplay === 'withdrawal';
      const description = isGenericMethod 
        ? 'Withdrawal'
        : `Withdrawal via ${methodDisplay.charAt(0).toUpperCase() + methodDisplay.slice(1)}`;
      
      const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
        fromUserId,
        toUserId,
        amount: amount + (data.feeAmount as number), // Total amount (including fee)
        currency,
        tenantId,
        feeAmount: data.feeAmount as number,
        method,
        externalRef,
        description,
        // Payment-specific details from rest params
        ...rest,
        externalTransactionId,
      }, session);
      
      return { ...ctx, input, data: { ...data, transfer, debitTx, creditTx }, entity: debitTx };
    },
    compensate: async ({ data }: WithdrawalCtx) => {
      // Transfer saga handles its own compensation
    },
  },
];

export const withdrawalService = createService<Transaction, CreateWithdrawalInput>({
  name: 'withdrawal',
  entity: {
    name: 'withdrawal',
    collection: 'transactions',
    graphqlType: `
      type CreateWithdrawalResult { success: Boolean! withdrawal: Transaction transfer: Transfer sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateWithdrawalInput { userId: String! amount: Float! currency: String! method: String! tenantId: String toUserId: String! bankAccount: String walletAddress: String }`,
    validateInput: (input) => {
      const result = withdrawalSchema(input);
      return validateInput(result) as CreateWithdrawalInput | { errors: string[] };
    },
    indexes: [
      { fields: { userId: 1, createdAt: -1 } },
      { fields: { userId: 1, charge: 1, createdAt: -1 } },
      { fields: { objectModel: 1, objectId: 1 } },
      { fields: { 'meta.externalRef': 1, charge: 1 }, options: { sparse: true, unique: true } },
    ],
  },
  saga: withdrawalSaga,
  sagaOptions: {
    useTransaction: process.env.MONGO_TRANSACTIONS !== 'false',
    maxRetries: 3,
  },
});

// ═══════════════════════════════════════════════════════════════════
// Transactions Query Resolver (unified query for all transactions)
// ═══════════════════════════════════════════════════════════════════

// ✅ Unified transactions query - fetches all transactions (deposits + withdrawals) together
export const transactionsQueryResolver = async (args: Record<string, unknown>) => {
      const db = getDatabase();
      const transactionsCollection = db.collection('transactions');
      
      const first = (args.first as number) || 100;
      const skip = (args.skip as number) || 0;
      const filter = (args.filter as Record<string, unknown>) || {};
      
      // Build MongoDB query
      const query: Record<string, unknown> = {};
      
      // Filter by type/charge if specified (support both charge and type for backward compatibility)
      if (filter.type) {
        // Support filtering by charge (credit/debit) or objectModel (deposit, withdrawal, etc.)
        if (filter.type === 'credit' || filter.type === 'debit') {
          query.charge = filter.type;
        } else {
          // For other types like 'deposit', 'withdrawal', filter by objectModel
          query.objectModel = filter.type;
        }
      }
      
      // Filter by userId if specified
      if (filter.userId) {
        query.userId = filter.userId;
      }
      
      // Filter by status if specified (transactions don't have status, but transfers do)
      // This filter is kept for backward compatibility but won't match anything
      // Status filtering should be done on transfers, not transactions
      
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
          type: tx.charge || tx.type, // Use charge (credit/debit) or fallback to type
          status: tx.status || 'completed', // Transactions are immutable, default to completed
          amount: tx.amount,
          currency: tx.meta?.currency || tx.currency, // Currency is in meta object
          feeAmount: tx.meta?.feeAmount || tx.feeAmount,
          netAmount: tx.meta?.netAmount || tx.netAmount,
          balance: tx.balance, // Wallet balance after transaction
          charge: tx.charge, // credit or debit
          fromUserId: tx.meta?.fromUserId || tx.fromUserId, // May be in meta or direct
          toUserId: tx.meta?.toUserId || tx.toUserId, // May be in meta or direct
          createdAt: tx.createdAt,
          description: tx.meta?.description || tx.description,
          metadata: tx.meta || tx.metadata,
          objectId: tx.objectId,
          objectModel: tx.objectModel,
        })),
        totalCount,
        pageInfo: {
          hasNextPage: skip + first < totalCount,
          hasPreviousPage: skip > 0,
        },
      };
};
