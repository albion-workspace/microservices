/**
 * Examples: Using Generic References
 * 
 * Shows how to work with refId/refType pattern
 * Like Mongoose populate but for MongoDB driver
 */

import { 
  resolveReference,
  resolveReferences,
  batchResolveReferences,
  referenceExists,
  validateReference,
  registerReferenceType
} from './reference-resolver.js';

// ═══════════════════════════════════════════════════════════════════
// Example 1: Create Transaction with Reference
// ═══════════════════════════════════════════════════════════════════

async function createBonusTransaction() {
  const bonusId = 'bonus-123';
  
  // Validate reference exists before creating transaction
  await validateReference(bonusId, 'bonus');
  
  // Create transaction with generic reference
  const transaction = {
    id: 'tx-456',
    walletId: 'wallet-789',
    userId: 'user-001',
    type: 'deposit',
    amount: 1000,
    balance: 5000,
    
    // Generic reference (works for ANY entity)
    refId: bonusId,
    refType: 'bonus',
    
    description: 'Bonus awarded',
    createdAt: new Date()
  };
  
  // Save to DB...
  return transaction;
}

// ═══════════════════════════════════════════════════════════════════
// Example 2: Query Transaction and Populate Reference
// ═══════════════════════════════════════════════════════════════════

async function getTransactionWithBonus(txId: string) {
  // Get transaction from DB
  const tx = await fetchTransaction(txId);
  
  // Resolve the reference (like Mongoose populate)
  const bonus = await resolveReference(tx.refId, tx.refType);
  
  return {
    ...tx,
    bonus  // Populated entity
  };
}

// ═══════════════════════════════════════════════════════════════════
// Example 3: List Transactions with References (Individual)
// ═══════════════════════════════════════════════════════════════════

async function listTransactionsWithRefs(userId: string) {
  // Get all transactions
  const transactions = await fetchUserTransactions(userId);
  
  // Populate all references
  const populated = await resolveReferences(transactions);
  
  return populated.map(tx => ({
    ...tx,
    relatedEntity: tx._ref  // The populated reference
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Example 4: Batch Resolve (Efficient for Large Lists)
// ═══════════════════════════════════════════════════════════════════

async function listTransactionsWithRefsBatch(userId: string) {
  // Get all transactions
  const transactions = await fetchUserTransactions(userId);
  
  // Batch resolve - Groups by type and fetches in batches
  // Much faster than individual queries!
  const populated = await batchResolveReferences(transactions);
  
  return populated;
}

// ═══════════════════════════════════════════════════════════════════
// Example 5: Different Reference Types
// ═══════════════════════════════════════════════════════════════════

async function createMixedTransactions() {
  return [
    // Bonus transaction
    {
      id: 'tx-1',
      type: 'deposit',
      amount: 1000,
      refId: 'bonus-123',
      refType: 'bonus'
    },
    
    // Bet transaction
    {
      id: 'tx-2',
      type: 'withdrawal',
      amount: 500,
      refId: 'bet-456',
      refType: 'bet'
    },
    
    // Game transaction
    {
      id: 'tx-3',
      type: 'deposit',
      amount: 2000,
      refId: 'game-789',
      refType: 'game'
    },
    
    // Payment transaction
    {
      id: 'tx-4',
      type: 'deposit',
      amount: 10000,
      refId: 'payment-abc',
      refType: 'transaction'
    }
  ];
}

// ═══════════════════════════════════════════════════════════════════
// Example 6: Check Reference Exists (Efficient)
// ═══════════════════════════════════════════════════════════════════

async function checkBonusExists(bonusId: string): Promise<boolean> {
  // Efficient check - only fetches { id: 1 }
  return await referenceExists(bonusId, 'bonus');
}

// ═══════════════════════════════════════════════════════════════════
// Example 7: Add New Reference Type (Extensible!)
// ═══════════════════════════════════════════════════════════════════

function setupCustomReferenceTypes() {
  // Add new entity types dynamically
  registerReferenceType('tournament', 'tournaments');
  registerReferenceType('mission', 'missions');
  registerReferenceType('achievement', 'achievements');
  
  // Now you can use these types:
  const tx = {
    refId: 'tournament-123',
    refType: 'tournament'  // Works!
  };
}

// ═══════════════════════════════════════════════════════════════════
// Example 8: GraphQL Resolver with References
// ═══════════════════════════════════════════════════════════════════

const resolvers = {
  WalletTransaction: {
    // Add a virtual field that resolves the reference
    relatedEntity: async (parent: any) => {
      return await resolveReference(parent.refId, parent.refType);
    }
  },
  
  Query: {
    walletTransactions: async (_: any, { userId }: any) => {
      const transactions = await fetchUserTransactions(userId);
      // References can be resolved on-demand via the virtual field
      return transactions;
    },
    
    walletTransactionsPopulated: async (_: any, { userId }: any) => {
      const transactions = await fetchUserTransactions(userId);
      // Or pre-populate for efficiency
      return await batchResolveReferences(transactions);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// Example 9: Comparison with Mongoose
// ═══════════════════════════════════════════════════════════════════

// MONGOOSE WAY:
async function mongooseExample() {
  // const tx = await Transaction.findById(id).populate('refId');
  // return tx.refId; // Populated object
}

// OUR WAY:
async function ourExample(id: string) {
  const tx = await fetchTransaction(id);
  const relatedEntity = await resolveReference(tx.refId, tx.refType);
  return { ...tx, relatedEntity };
}

// ═══════════════════════════════════════════════════════════════════
// Helpers (Mock implementations)
// ═══════════════════════════════════════════════════════════════════

async function fetchTransaction(id: string): Promise<any> {
  // Mock - replace with actual DB call
  return {
    id,
    type: 'deposit',
    amount: 1000,
    refId: 'bonus-123',
    refType: 'bonus'
  };
}

async function fetchUserTransactions(userId: string): Promise<any[]> {
  // Mock - replace with actual DB call
  return [
    { id: 'tx-1', userId, refId: 'bonus-1', refType: 'bonus' },
    { id: 'tx-2', userId, refId: 'bet-1', refType: 'bet' },
    { id: 'tx-3', userId, refId: 'bonus-2', refType: 'bonus' }
  ];
}

// ═══════════════════════════════════════════════════════════════════
// Export examples
// ═══════════════════════════════════════════════════════════════════

export {
  createBonusTransaction,
  getTransactionWithBonus,
  listTransactionsWithRefs,
  listTransactionsWithRefsBatch,
  createMixedTransactions,
  checkBonusExists,
  setupCustomReferenceTypes,
  resolvers as graphqlResolvers
};
