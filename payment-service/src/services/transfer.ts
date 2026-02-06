/**
 * Transfer Service - User-to-user transfers
 * 
 * Uses the shared createTransferWithTransactions helper for atomic operations.
 * Creates Transfer document + 2 Transaction documents (debit + credit) + updates wallets.
 */

import { 
  createService, 
  type, 
  type SagaContext, 
  validateInput, 
  createTransferWithTransactions,
  buildConnectionTypeSDL,
  type ClientSession,
} from 'core-service';
import { getUseMongoTransactions } from '../config.js';
import { db } from '../database.js';
import type { Transfer as PaymentTransfer, Transaction } from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// Transfer Types & Validation
// ═══════════════════════════════════════════════════════════════════

interface CreateTransferInput {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  tenantId?: string;
  feeAmount?: number;
  method?: string;
  externalRef?: string;
  description?: string;
  approvalMode?: 'direct' | 'pending';  // 'direct' = immediate approval (default), 'pending' = requires approval
}

type TransferCtx = SagaContext<PaymentTransfer, CreateTransferInput>;

const transferSchema = type({
  fromUserId: 'string',
  toUserId: 'string',
  amount: 'number > 0',
  currency: 'string',
  'tenantId?': 'string',
  'feeAmount?': 'number >= 0',
  'method?': 'string',
  'externalRef?': 'string',
  'description?': 'string',
  'approvalMode?': 'string',  // 'direct' or 'pending'
});

const transferSaga = [
  {
    name: 'createTransferWithTransactions',
    critical: true,
    execute: async ({ input, data, ...ctx }: TransferCtx): Promise<TransferCtx> => {
      const { fromUserId, toUserId, amount, currency, tenantId: tenantIdParam, feeAmount: feeAmountParam, method, externalRef, description, ...rest } = input;
      
      const tenantId = tenantIdParam || 'default-tenant';
      const feeAmount = feeAmountParam || 0;
      
      // Get session from saga context if available (for transaction support)
      const session = (data as any)._session as ClientSession | undefined;
      
      // Get database instance using service database accessor
      const database = await db.getDb();
      
      // Use the shared helper function (handles transfer + transactions + wallets atomically)
      const { transfer, debitTx, creditTx } = await createTransferWithTransactions({
        fromUserId,
        toUserId,
        amount,
        currency,
        tenantId,
        feeAmount,
        method: method || 'transfer',
        externalRef,
        description,
        // Pass any additional fields from rest
        ...rest,
      }, { 
        database,
        ...(session && { session })
      });
      
      // Return transfer as the primary entity (cast to payment-service Transfer type)
      // Note: core-service Transfer has 'failed' status, payment-service has 'used'|'expired'
      // The actual status will be 'approved' from createTransferWithTransactions
      return { 
        ...ctx, 
        input, 
        data: { 
          ...data, 
          transfer: transfer as unknown as PaymentTransfer, 
          debitTx, 
          creditTx,
          debitTransaction: debitTx,  // For GraphQL response compatibility
          creditTransaction: creditTx, // For GraphQL response compatibility
        }, 
        entity: transfer as unknown as PaymentTransfer
      };
    },
    compensate: async ({ data }: TransferCtx) => {
      // IMPORTANT: This empty compensate only works because useTransaction: true
      // MongoDB transaction handles rollback automatically
      // 
      // WARNING: Do NOT set useTransaction: false for financial operations
      // If you do, you must implement manual compensation here (create reverse transfer)
    },
  },
];

export const transferService = createService<PaymentTransfer, CreateTransferInput>({
  name: 'transfer',
  entity: {
    name: 'transfer',
    collection: 'transfers',
    graphqlType: `
      type Transfer { id: ID! fromUserId: String! toUserId: String! amount: Float! status: String! charge: String! meta: JSON createdAt: String! updatedAt: String }
      ${buildConnectionTypeSDL('TransferConnection', 'Transfer')}
      type CreateTransferResult { success: Boolean! transfer: Transfer debitTransaction: Transaction creditTransaction: Transaction sagaId: ID! errors: [String!] executionTimeMs: Int }
    `,
    graphqlInput: `input CreateTransferInput { fromUserId: String! toUserId: String! amount: Float! currency: String! tenantId: String feeAmount: Float method: String externalRef: String description: String approvalMode: String }`,
    validateInput: (input) => {
      const result = transferSchema(input);
      return validateInput(result) as CreateTransferInput | { errors: string[] };
    },
    indexes: [
      { fields: { fromUserId: 1, createdAt: -1 } },
      { fields: { toUserId: 1, createdAt: -1 } },
      { fields: { status: 1, createdAt: -1 } },
      { fields: { 'meta.externalRef': 1 }, options: { sparse: true, unique: true } },
    ],
  },
  saga: transferSaga,
  // CRITICAL: Financial operations MUST use transaction mode
  // Recovery system relies on this - see README "Saga, Transaction, and Recovery Boundaries"
  sagaOptions: {
    get useTransaction() { return getUseMongoTransactions(); }, // Financial ops
    maxRetries: 3,
  },
});
