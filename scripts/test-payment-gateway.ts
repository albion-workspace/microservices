/**
 * Payment Gateway Test Script
 * 
 * Tests wallet operations and transactions via GraphQL API
 */

const BASE_URL = 'http://localhost:3004';

// Dev token from payment-gateway startup
const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXYiLCJ0aWQiOiJkZXYiLCJyb2xlcyI6WyJhZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyIqOio6KiJdLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzY3ODY5OTg4LCJleHAiOjE3Njc4OTg3ODh9.WDLOnAYdZ3Dav7EVaMicm2UNgKIwBAQHOacm5SDgN-c';

// ANSI colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(60));
  log(`  ${title}`, colors.cyan);
  console.log('═'.repeat(60));
}

function logSuccess(message: string) {
  log(`✓ ${message}`, colors.green);
}

function logError(message: string) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`ℹ ${message}`, colors.dim);
}

// GraphQL request helper
async function graphql<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const response = await fetch(`${BASE_URL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEV_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  
  if (result.errors) {
    throw new Error(result.errors.map((e: any) => e.message).join(', '));
  }
  
  return result.data as T;
}

// ═══════════════════════════════════════════════════════════════════
// Test Cases
// ═══════════════════════════════════════════════════════════════════

async function testHealth() {
  logSection('1. Health Check');
  
  const data = await graphql(`{ health { status service uptime } }`);
  
  if (data.health?.status === 'healthy') {
    logSuccess('Health check passed');
    logInfo(`  Service: ${data.health.service}`);
    logInfo(`  Uptime: ${data.health.uptime}s`);
    return true;
  } else {
    logError('Health check failed');
    return false;
  }
}

async function testCreateWallet(): Promise<string | null> {
  logSection('2. Create Wallet');
  
  const userId = `test-user-${Date.now()}`;
  
  // Gateway uses JSON scalar for inputs
  const data = await graphql(`
    mutation CreateWallet($input: JSON) {
      createWallet(input: $input)
    }
  `, {
    input: {
      userId,
      currency: 'USD',
      category: 'main',
    },
  });
  
  const result = data.createWallet;
  
  if (result?.success && result?.wallet) {
    logSuccess(`Wallet created: ${result.wallet.id}`);
    logInfo(`  User: ${result.wallet.userId}`);
    logInfo(`  Currency: ${result.wallet.currency}`);
    logInfo(`  Category: ${result.wallet.category}`);
    logInfo(`  Balance: ${result.wallet.balance}`);
    return result.wallet.id;
  } else {
    logError(`Failed to create wallet: ${result?.errors?.join(', ') || 'Unknown error'}`);
    console.log('Response:', JSON.stringify(result, null, 2));
    return null;
  }
}

async function testCreateWalletTransaction(walletId: string, userId: string, type: string, amount: number): Promise<string | null> {
  logSection(`3. Create Wallet Transaction (${type})`);
  
  const data = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type,
      balanceType: 'real',
      currency: 'USD',
      amount,
      description: `Test ${type} transaction`,
    },
  });
  
  const result = data.createWalletTransaction;
  
  if (result?.success && result?.walletTransaction) {
    const tx = result.walletTransaction;
    logSuccess(`Transaction created: ${tx.id}`);
    logInfo(`  Type: ${tx.type}`);
    logInfo(`  Amount: ${tx.amount}`);
    logInfo(`  Balance Before: ${tx.balanceBefore}`);
    logInfo(`  Balance After: ${tx.balanceAfter}`);
    return tx.id;
  } else {
    logError(`Failed to create transaction: ${result?.errors?.join(', ') || 'Unknown error'}`);
    return null;
  }
}

async function testGetWallet(walletId: string) {
  logSection('4. Get Wallet');
  
  const data = await graphql(`
    query GetWallet($input: JSON) {
      wallet(input: $input)
    }
  `, { input: { id: walletId } });
  
  if (data.wallet) {
    const w = data.wallet;
    logSuccess(`Wallet retrieved: ${w.id}`);
    logInfo(`  Balance: ${w.balance}`);
    logInfo(`  Bonus Balance: ${w.bonusBalance}`);
    logInfo(`  Locked Balance: ${w.lockedBalance}`);
    logInfo(`  Lifetime Deposits: ${w.lifetimeDeposits}`);
    logInfo(`  Lifetime Withdrawals: ${w.lifetimeWithdrawals}`);
    return w;
  } else {
    logError('Wallet not found');
    return null;
  }
}

async function testListWalletTransactions(walletId: string) {
  logSection('5. List Wallet Transactions');
  
  const data = await graphql(`
    query ListTransactions($input: JSON) {
      walletTransactions(input: $input)
    }
  `, { input: { filter: { walletId } } });
  
  if (data.walletTransactions) {
    const { nodes, totalCount } = data.walletTransactions;
    logSuccess(`Found ${totalCount} transaction(s)`);
    
    for (const tx of nodes || []) {
      logInfo(`  ${tx.type}: ${tx.amount} (${tx.balanceBefore} → ${tx.balanceAfter})`);
    }
    return nodes || [];
  } else {
    logError('Failed to list transactions');
    return [];
  }
}

async function testDepositWithdrawFlow() {
  logSection('6. Complete Deposit/Withdrawal Flow');
  
  // Create a fresh wallet
  const userId = `flow-test-${Date.now()}`;
  
  log('\n--- Step 1: Create wallet ---', colors.yellow);
  const createData = await graphql(`
    mutation CreateWallet($input: JSON) {
      createWallet(input: $input)
    }
  `, {
    input: { userId, currency: 'EUR', category: 'main' },
  });
  
  if (!createData.createWallet?.success) {
    logError(`Failed: ${createData.createWallet?.errors?.join(', ') || 'Unknown error'}`);
    return false;
  }
  
  const walletId = createData.createWallet.wallet.id;
  logSuccess(`Wallet created: ${walletId}`);
  logInfo(`  Initial balance: ${createData.createWallet.wallet.balance}`);
  
  // Deposit
  log('\n--- Step 2: Deposit €100 ---', colors.yellow);
  const depositData = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type: 'deposit',
      balanceType: 'real',
      currency: 'EUR',
      amount: 100,
      description: 'Initial deposit',
    },
  });
  
  if (!depositData.createWalletTransaction?.success) {
    logError(`Failed: ${depositData.createWalletTransaction?.errors?.join(', ') || 'Unknown error'}`);
    return false;
  }
  
  logSuccess('Deposit successful');
  logInfo(`  Balance: 0 → ${depositData.createWalletTransaction.walletTransaction.balanceAfter}`);
  
  // Second deposit
  log('\n--- Step 3: Deposit €50 more ---', colors.yellow);
  const deposit2Data = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type: 'deposit',
      balanceType: 'real',
      currency: 'EUR',
      amount: 50,
      description: 'Second deposit',
    },
  });
  
  if (deposit2Data.createWalletTransaction?.success) {
    logSuccess('Second deposit successful');
    logInfo(`  Balance: ${deposit2Data.createWalletTransaction.walletTransaction.balanceBefore} → ${deposit2Data.createWalletTransaction.walletTransaction.balanceAfter}`);
  }
  
  // Withdrawal
  log('\n--- Step 4: Withdraw €30 ---', colors.yellow);
  const withdrawData = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type: 'withdrawal',
      balanceType: 'real',
      currency: 'EUR',
      amount: 30,
      description: 'Withdrawal',
    },
  });
  
  if (withdrawData.createWalletTransaction?.success) {
    logSuccess('Withdrawal successful');
    logInfo(`  Balance: ${withdrawData.createWalletTransaction.walletTransaction.balanceBefore} → ${withdrawData.createWalletTransaction.walletTransaction.balanceAfter}`);
  }
  
  // Check final balance
  log('\n--- Step 5: Verify final balance ---', colors.yellow);
  const walletData = await graphql(`
    query GetWallet($input: JSON) {
      wallet(input: $input)
    }
  `, { input: { id: walletId } });
  
  const wallet = walletData.wallet;
  const expectedBalance = 100 + 50 - 30; // 120
  
  if (wallet?.balance === expectedBalance) {
    logSuccess(`Final balance correct: €${wallet.balance}`);
    logInfo(`  Lifetime deposits: €${wallet.lifetimeDeposits}`);
    logInfo(`  Lifetime withdrawals: €${wallet.lifetimeWithdrawals}`);
    return true;
  } else {
    logError(`Balance mismatch! Expected: €${expectedBalance}, Got: €${wallet?.balance}`);
    return false;
  }
}

async function testInsufficientFunds() {
  logSection('7. Test Insufficient Funds');
  
  const userId = `insufficient-test-${Date.now()}`;
  
  // Create wallet with 0 balance
  const createData = await graphql(`
    mutation CreateWallet($input: JSON) {
      createWallet(input: $input)
    }
  `, {
    input: { userId, currency: 'USD', category: 'main' },
  });
  
  const walletId = createData.createWallet?.wallet?.id;
  if (!walletId) {
    logError('Failed to create wallet');
    return false;
  }
  logInfo(`Created wallet with balance: ${createData.createWallet.wallet.balance}`);
  
  // Try to withdraw - saga mutations return { success: false, errors: [...] } instead of throwing
  const withdrawData = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type: 'withdrawal',
      balanceType: 'real',
      currency: 'USD',
      amount: 100,
      description: 'Should fail',
    },
  });
  
  const result = withdrawData.createWalletTransaction;
  
  // Check if the mutation returned failure with insufficient funds error
  if (!result?.success && result?.errors?.some((e: string) => e.includes('Insufficient'))) {
    logSuccess('Correctly rejected: Insufficient funds');
    logInfo(`  Error: ${result.errors[0]}`);
    return true;
  } else if (result?.success) {
    logError('Should have failed with insufficient funds!');
    return false;
  } else {
    logError(`Unexpected result: ${JSON.stringify(result)}`);
    return false;
  }
}

async function testBonusBalance() {
  logSection('8. Test Bonus Balance');
  
  const userId = `bonus-test-${Date.now()}`;
  
  // Create wallet
  const createData = await graphql(`
    mutation CreateWallet($input: JSON) {
      createWallet(input: $input)
    }
  `, {
    input: { userId, currency: 'USD', category: 'main' },
  });
  
  const walletId = createData.createWallet?.wallet?.id;
  if (!walletId) {
    logError('Failed to create wallet');
    return false;
  }
  
  // Credit bonus balance
  log('\n--- Credit $25 bonus ---', colors.yellow);
  const bonusData = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type: 'bonus_credit',
      balanceType: 'bonus',  // Credit to bonus balance
      currency: 'USD',
      amount: 25,
      description: 'Welcome bonus',
    },
  });
  
  if (!bonusData.createWalletTransaction?.success) {
    logError(`Failed: ${bonusData.createWalletTransaction?.errors?.join(', ') || 'Unknown error'}`);
    return false;
  }
  
  logSuccess('Bonus credited');
  
  // Check wallet
  const walletData = await graphql(`
    query GetWallet($input: JSON) {
      wallet(input: $input)
    }
  `, { input: { id: walletId } });
  
  if (walletData.wallet?.bonusBalance === 25 && walletData.wallet?.balance === 0) {
    logSuccess('Bonus balance correct');
    logInfo(`  Real balance: ${walletData.wallet.balance}`);
    logInfo(`  Bonus balance: ${walletData.wallet.bonusBalance}`);
    return true;
  } else {
    logError('Balance mismatch');
    logInfo(`  Real balance: ${walletData.wallet?.balance}`);
    logInfo(`  Bonus balance: ${walletData.wallet?.bonusBalance}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n');
  log('╔═══════════════════════════════════════════════════════════════════╗', colors.magenta);
  log('║            PAYMENT GATEWAY TEST SUITE                             ║', colors.magenta);
  log('╚═══════════════════════════════════════════════════════════════════╝', colors.magenta);
  
  const results: { name: string; passed: boolean }[] = [];
  
  try {
    // 1. Health check
    results.push({ name: 'Health Check', passed: await testHealth() });
    
    // 2. Create wallet
    const walletId = await testCreateWallet();
    results.push({ name: 'Create Wallet', passed: !!walletId });
    
    if (walletId) {
      // 3. Create deposit transaction
      const depositId = await testCreateWalletTransaction(walletId, 'test-user', 'deposit', 100);
      results.push({ name: 'Create Deposit', passed: !!depositId });
      
      // 4. Get wallet
      const wallet = await testGetWallet(walletId);
      results.push({ name: 'Get Wallet', passed: !!wallet && wallet.balance === 100 });
      
      // 5. List transactions
      const txs = await testListWalletTransactions(walletId);
      results.push({ name: 'List Transactions', passed: txs.length > 0 });
    }
    
    // 6. Complete flow test
    results.push({ name: 'Deposit/Withdraw Flow', passed: await testDepositWithdrawFlow() });
    
    // 7. Insufficient funds
    results.push({ name: 'Insufficient Funds Check', passed: await testInsufficientFunds() });
    
    // 8. Bonus balance
    results.push({ name: 'Bonus Balance', passed: await testBonusBalance() });
    
  } catch (error: any) {
    logError(`Test suite error: ${error.message}`);
  }
  
  // Summary
  logSection('TEST SUMMARY');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  for (const result of results) {
    if (result.passed) {
      logSuccess(result.name);
    } else {
      logError(result.name);
    }
  }
  
  console.log('\n' + '─'.repeat(60));
  log(`Results: ${passed} passed, ${failed} failed`, passed === results.length ? colors.green : colors.red);
  
  process.exit(failed > 0 ? 1 : 0);
}

main();

