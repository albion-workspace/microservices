/**
 * Payment Gateway - Real World Scenario Test
 * 
 * Scenario: iGaming Platform with Welcome Bonus
 * 
 * Setup:
 * - Payment Providers: PayPal, Stripe
 * - System Bonus Wallet: Pool for awarding bonuses to users
 * - User has multiple wallets: main, sports, casino
 * 
 * Flow:
 * 1. System has a bonus pool wallet with €10,000
 * 2. New user registers → creates wallets (main, sports, casino)
 * 3. User makes first deposit of €1,000 via Stripe
 * 4. First deposit triggers welcome bonus:
 *    - €100 bonus credited to sports wallet (10% of deposit)
 *    - Casino wallet stays at €0
 *    - Bonus is debited from system bonus pool
 * 5. Verify all balances are correct
 */

const BASE_URL = 'http://localhost:3004';

// Dev token from payment-gateway startup
const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXYiLCJ0aWQiOiJkZXYiLCJyb2xlcyI6WyJhZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyIqOio6KiJdLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzY3ODcwNzU3LCJleHAiOjE3Njc4OTk1NTd9.pAtc2Y-M8p_VDIaXxKsyBSEZ6V0TS_01N5Zl9vfoqec';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  blue: '\x1b[34m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '═'.repeat(70));
  log(`  ${title}`, colors.cyan + colors.bold);
  console.log('═'.repeat(70));
}

function logStep(step: string) {
  log(`\n▶ ${step}`, colors.yellow);
}

function logSuccess(message: string) {
  log(`  ✓ ${message}`, colors.green);
}

function logError(message: string) {
  log(`  ✗ ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`    ${message}`, colors.dim);
}

function logBalance(label: string, amount: number, currency = '€') {
  const color = amount > 0 ? colors.green : amount < 0 ? colors.red : colors.dim;
  log(`    ${label}: ${color}${currency}${amount.toFixed(2)}${colors.reset}`, colors.reset);
}

// GraphQL helper
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

// ═══════════════════════════════════════════════════════════════════════════
// Wallet Operations
// ═══════════════════════════════════════════════════════════════════════════

interface Wallet {
  id: string;
  userId: string;
  currency: string;
  category: string;
  balance: number;
  bonusBalance: number;
  lockedBalance: number;
  lifetimeDeposits: number;
  lifetimeWithdrawals: number;
}

async function createWallet(userId: string, currency: string, category: string): Promise<Wallet | null> {
  const data = await graphql(`
    mutation CreateWallet($input: JSON) {
      createWallet(input: $input)
    }
  `, {
    input: { userId, currency, category },
  });
  
  if (data.createWallet?.success) {
    return data.createWallet.wallet;
  }
  
  // If wallet already exists, try to find it
  if (data.createWallet?.errors?.some((e: string) => e.includes('already exists'))) {
    const existing = await graphql(`
      query FindWallet($input: JSON) {
        wallets(input: $input)
      }
    `, { input: { filter: { userId, currency, category } } });
    
    if (existing.wallets?.nodes?.length > 0) {
      return existing.wallets.nodes[0];
    }
  }
  
  console.error('Create wallet error:', data.createWallet?.errors);
  return null;
}

async function getWallet(id: string): Promise<Wallet | null> {
  const data = await graphql(`
    query GetWallet($input: JSON) {
      wallet(input: $input)
    }
  `, { input: { id } });
  
  return data.wallet;
}

async function createTransaction(
  walletId: string,
  userId: string,
  type: string,
  balanceType: 'real' | 'bonus' | 'locked',
  currency: string,
  amount: number,
  description: string
): Promise<{ success: boolean; transaction?: any; errors?: string[] }> {
  const data = await graphql(`
    mutation CreateWalletTransaction($input: JSON) {
      createWalletTransaction(input: $input)
    }
  `, {
    input: {
      walletId,
      userId,
      type,
      balanceType,
      currency,
      amount,
      description,
    },
  });
  
  return {
    success: data.createWalletTransaction?.success ?? false,
    transaction: data.createWalletTransaction?.walletTransaction,
    errors: data.createWalletTransaction?.errors,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider Config Operations
// ═══════════════════════════════════════════════════════════════════════════

async function createProviderConfig(name: string, provider: string, methods: string[], credentials: Record<string, string>) {
  const data = await graphql(`
    mutation CreateProviderConfig($input: JSON) {
      createProviderConfig(input: $input)
    }
  `, {
    input: {
      name,
      provider,
      isActive: true,
      priority: provider === 'stripe' ? 1 : 2,
      supportedMethods: methods,
      supportedCurrencies: ['EUR', 'USD', 'GBP'],
      minDeposit: 10,
      maxDeposit: 50000,
      minWithdrawal: 20,
      maxWithdrawal: 10000,
      depositFeePercent: 0,
      withdrawalFeePercent: 1.5,
      credentials,
    },
  });
  
  return data.createProviderConfig;
}

// ═══════════════════════════════════════════════════════════════════════════
// Real World Scenario Test
// ═══════════════════════════════════════════════════════════════════════════

async function runRealScenario() {
  console.log('\n');
  log('╔═══════════════════════════════════════════════════════════════════════════╗', colors.magenta);
  log('║         PAYMENT GATEWAY - REAL WORLD SCENARIO TEST                        ║', colors.magenta);
  log('║                                                                           ║', colors.magenta);
  log('║  Scenario: iGaming Platform with First Deposit Welcome Bonus              ║', colors.magenta);
  log('╚═══════════════════════════════════════════════════════════════════════════╝', colors.magenta);

  const timestamp = Date.now();
  const runId = Math.random().toString(36).substring(2, 8);
  const SYSTEM_USER_ID = `system-bonus-pool-${runId}`;
  const END_USER_ID = `player-${runId}-${timestamp}`;
  const CURRENCY = 'EUR';
  
  // Bonus configuration
  const WELCOME_BONUS_PERCENT = 10; // 10% of first deposit
  const MAX_WELCOME_BONUS = 100;    // Max €100
  const INITIAL_BONUS_POOL = 10000; // System starts with €10,000 bonus pool

  let systemBonusWallet: Wallet | null = null;
  let userMainWallet: Wallet | null = null;
  let userSportsWallet: Wallet | null = null;
  let userCasinoWallet: Wallet | null = null;

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1: Setup Payment Providers
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 1: Setup Payment Providers');
  
  logStep('Creating Stripe provider configuration...');
  const stripeConfig = await createProviderConfig(
    'Stripe EU',
    'stripe',
    ['card', 'apple_pay', 'google_pay'],
    { apiKey: 'sk_test_xxx', webhookSecret: 'whsec_xxx' }
  );
  if (stripeConfig?.success) {
    logSuccess('Stripe provider configured');
    logInfo(`Provider ID: ${stripeConfig.providerConfig?.id}`);
  } else {
    logInfo('Stripe provider already exists or failed');
  }
  
  logStep('Creating PayPal provider configuration...');
  const paypalConfig = await createProviderConfig(
    'PayPal EU',
    'paypal',
    ['paypal', 'paypal_credit'],
    { clientId: 'xxx', clientSecret: 'xxx' }
  );
  if (paypalConfig?.success) {
    logSuccess('PayPal provider configured');
    logInfo(`Provider ID: ${paypalConfig.providerConfig?.id}`);
  } else {
    logInfo('PayPal provider already exists or failed');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 2: Setup System Bonus Pool
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 2: Setup System Bonus Pool');
  
  logStep('Creating system bonus pool wallet...');
  systemBonusWallet = await createWallet(SYSTEM_USER_ID, CURRENCY, 'bonus-pool');
  
  if (systemBonusWallet) {
    logSuccess(`System bonus wallet created: ${systemBonusWallet.id}`);
    
    logStep('Funding system bonus pool with €10,000...');
    const fundResult = await createTransaction(
      systemBonusWallet.id,
      SYSTEM_USER_ID,
      'deposit',
      'real',
      CURRENCY,
      INITIAL_BONUS_POOL,
      'Initial bonus pool funding'
    );
    
    if (fundResult.success) {
      logSuccess('System bonus pool funded');
      logBalance('Pool Balance', INITIAL_BONUS_POOL);
    } else {
      logError(`Failed to fund: ${fundResult.errors?.join(', ')}`);
    }
  } else {
    logError('Failed to create system bonus wallet');
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 3: New User Registration - Create User Wallets
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 3: New User Registration');
  log(`\n  New player: ${END_USER_ID}`, colors.blue);
  
  logStep('Creating user main wallet...');
  userMainWallet = await createWallet(END_USER_ID, CURRENCY, 'main');
  if (userMainWallet) {
    logSuccess(`Main wallet created: ${userMainWallet.id}`);
    logBalance('Balance', 0);
  }
  
  logStep('Creating user sports wallet...');
  userSportsWallet = await createWallet(END_USER_ID, CURRENCY, 'sports');
  if (userSportsWallet) {
    logSuccess(`Sports wallet created: ${userSportsWallet.id}`);
    logBalance('Balance', 0);
    logBalance('Bonus Balance', 0);
  }
  
  logStep('Creating user casino wallet...');
  userCasinoWallet = await createWallet(END_USER_ID, CURRENCY, 'casino');
  if (userCasinoWallet) {
    logSuccess(`Casino wallet created: ${userCasinoWallet.id}`);
    logBalance('Balance', 0);
    logBalance('Bonus Balance', 0);
  }

  if (!userMainWallet || !userSportsWallet || !userCasinoWallet) {
    logError('Failed to create all user wallets');
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 4: User Makes First Deposit via Stripe
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 4: User First Deposit (€1,000 via Stripe)');
  
  const DEPOSIT_AMOUNT = 1000;
  
  logStep(`Processing deposit of €${DEPOSIT_AMOUNT} to main wallet...`);
  
  // In real scenario, this would go through Stripe SDK, webhook callback, etc.
  // Here we simulate the successful deposit credit
  const depositResult = await createTransaction(
    userMainWallet.id,
    END_USER_ID,
    'deposit',
    'real',
    CURRENCY,
    DEPOSIT_AMOUNT,
    'First deposit via Stripe (card ending 4242)'
  );
  
  if (depositResult.success) {
    logSuccess('Deposit successful!');
    logInfo(`Transaction ID: ${depositResult.transaction?.id}`);
    logBalance('Balance Before', depositResult.transaction?.balanceBefore ?? 0);
    logBalance('Balance After', depositResult.transaction?.balanceAfter ?? 0);
    logInfo(`Provider: Stripe`);
    logInfo(`Method: card (•••• 4242)`);
  } else {
    logError(`Deposit failed: ${depositResult.errors?.join(', ')}`);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 5: First Deposit Bonus Trigger
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 5: First Deposit Welcome Bonus');
  
  // Calculate bonus: 10% of deposit, max €100
  const calculatedBonus = Math.min(
    DEPOSIT_AMOUNT * (WELCOME_BONUS_PERCENT / 100),
    MAX_WELCOME_BONUS
  );
  
  log(`\n  Bonus Rules:`, colors.blue);
  logInfo(`• ${WELCOME_BONUS_PERCENT}% of first deposit`);
  logInfo(`• Maximum bonus: €${MAX_WELCOME_BONUS}`);
  logInfo(`• Deposit: €${DEPOSIT_AMOUNT} → Bonus: €${calculatedBonus}`);
  logInfo(`• Target: Sports wallet (bonus balance)`);
  
  logStep('Debiting bonus from system pool...');
  const debitPoolResult = await createTransaction(
    systemBonusWallet.id,
    SYSTEM_USER_ID,
    'bonus_award',
    'real',
    CURRENCY,
    calculatedBonus,
    `Welcome bonus for ${END_USER_ID}`
  );
  
  if (debitPoolResult.success) {
    logSuccess('System pool debited');
    logBalance('Pool Before', debitPoolResult.transaction?.balanceBefore ?? 0);
    logBalance('Pool After', debitPoolResult.transaction?.balanceAfter ?? 0);
  } else {
    logError(`Failed to debit pool: ${debitPoolResult.errors?.join(', ')}`);
    return;
  }
  
  logStep('Crediting welcome bonus to user sports wallet...');
  const creditBonusResult = await createTransaction(
    userSportsWallet.id,
    END_USER_ID,
    'bonus_credit',
    'bonus',  // Credit to BONUS balance, not real
    CURRENCY,
    calculatedBonus,
    'Welcome Bonus - First Deposit (10% up to €100)'
  );
  
  if (creditBonusResult.success) {
    logSuccess('Bonus credited to sports wallet!');
    logBalance('Bonus Before', creditBonusResult.transaction?.balanceBefore ?? 0);
    logBalance('Bonus After', creditBonusResult.transaction?.balanceAfter ?? 0);
  } else {
    logError(`Failed to credit bonus: ${creditBonusResult.errors?.join(', ')}`);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 6: Client API - Get User Wallets (userWallets query)
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 6: Client API - Get User Wallets');
  
  log(`\n  Using userWallets query for clean client response...`, colors.blue);
  
  const userWalletsResponse = await graphql(`
    query GetUserWallets($input: JSON) {
      userWallets(input: $input)
    }
  `, { input: { userId: END_USER_ID, currency: CURRENCY } });
  
  if (userWalletsResponse.userWallets) {
    const data = userWalletsResponse.userWallets;
    
    logSuccess('User wallets retrieved successfully!');
    
    log(`\n  📊 API Response Format (what client receives):`, colors.cyan);
    console.log(colors.dim + JSON.stringify(data, null, 2) + colors.reset);
    
    log(`\n  Summary:`, colors.yellow);
    logInfo(`User: ${data.userId}`);
    logInfo(`Currency: ${data.currency}`);
    
    log(`\n  Totals:`, colors.yellow);
    logBalance('Real Balance', data.totals.realBalance);
    logBalance('Bonus Balance', data.totals.bonusBalance);
    logBalance('Total Balance', data.totals.totalBalance);
    logBalance('Withdrawable', data.totals.withdrawableBalance);
    logBalance('Lifetime Deposits', data.totals.lifetimeDeposits);
    logBalance('Lifetime Withdrawals', data.totals.lifetimeWithdrawals);
    
    log(`\n  Wallets by Category:`, colors.yellow);
    for (const w of data.wallets) {
      log(`\n    ${w.category.toUpperCase()}:`, colors.cyan);
      logInfo(`  ID: ${w.id}`);
      logBalance('  Real', w.realBalance);
      logBalance('  Bonus', w.bonusBalance);
      logBalance('  Total', w.totalBalance);
      logInfo(`  Status: ${w.status}`);
    }
  } else {
    logError('Failed to get user wallets');
  }

  // Test userWallets with category filter (get only sports wallet)
  log(`\n  Testing userWallets with category filter (sports only)...`, colors.blue);
  
  const sportsOnlyResponse = await graphql(`
    query GetUserWallets($input: JSON) {
      userWallets(input: $input)
    }
  `, { input: { userId: END_USER_ID, currency: CURRENCY, category: 'sports' } });
  
  if (sportsOnlyResponse.userWallets) {
    logSuccess('Sports wallet only retrieved!');
    console.log(colors.dim + JSON.stringify(sportsOnlyResponse.userWallets, null, 2) + colors.reset);
  }

  // Also test walletBalance for single wallet
  log(`\n  Testing walletBalance query (single wallet)...`, colors.blue);
  
  const sportsBalanceResponse = await graphql(`
    query GetWalletBalance($input: JSON) {
      walletBalance(input: $input)
    }
  `, { input: { userId: END_USER_ID, category: 'sports', currency: CURRENCY } });
  
  if (sportsBalanceResponse.walletBalance) {
    logSuccess('Sports wallet balance retrieved!');
    console.log(colors.dim + JSON.stringify(sportsBalanceResponse.walletBalance, null, 2) + colors.reset);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 7: Verify Final State
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('PHASE 7: Final Balance Verification');
  
  // Refresh all wallets
  const finalSystemWallet = await getWallet(systemBonusWallet.id);
  const finalMainWallet = await getWallet(userMainWallet.id);
  const finalSportsWallet = await getWallet(userSportsWallet.id);
  const finalCasinoWallet = await getWallet(userCasinoWallet.id);
  
  log(`\n  System Bonus Pool:`, colors.blue);
  logBalance('Real Balance', finalSystemWallet?.balance ?? 0);
  logInfo(`Expected: €${INITIAL_BONUS_POOL - calculatedBonus}`);
  
  log(`\n  User: ${END_USER_ID}`, colors.blue);
  
  log(`\n  Main Wallet (${finalMainWallet?.id}):`, colors.yellow);
  logBalance('Real Balance', finalMainWallet?.balance ?? 0);
  logBalance('Bonus Balance', finalMainWallet?.bonusBalance ?? 0);
  logBalance('Lifetime Deposits', finalMainWallet?.lifetimeDeposits ?? 0);
  
  log(`\n  Sports Wallet (${finalSportsWallet?.id}):`, colors.yellow);
  logBalance('Real Balance', finalSportsWallet?.balance ?? 0);
  logBalance('Bonus Balance', finalSportsWallet?.bonusBalance ?? 0);
  logInfo(`← Welcome bonus credited here!`);
  
  log(`\n  Casino Wallet (${finalCasinoWallet?.id}):`, colors.yellow);
  logBalance('Real Balance', finalCasinoWallet?.balance ?? 0);
  logBalance('Bonus Balance', finalCasinoWallet?.bonusBalance ?? 0);
  logInfo(`← No bonus (sports-only welcome offer)`);

  // ─────────────────────────────────────────────────────────────────────────
  // Assertions
  // ─────────────────────────────────────────────────────────────────────────
  
  logSection('TEST ASSERTIONS');
  
  const assertions: { name: string; passed: boolean; expected: any; actual: any }[] = [
    {
      name: 'System pool decreased by bonus amount',
      passed: finalSystemWallet?.balance === INITIAL_BONUS_POOL - calculatedBonus,
      expected: INITIAL_BONUS_POOL - calculatedBonus,
      actual: finalSystemWallet?.balance,
    },
    {
      name: 'User main wallet has deposit',
      passed: finalMainWallet?.balance === DEPOSIT_AMOUNT,
      expected: DEPOSIT_AMOUNT,
      actual: finalMainWallet?.balance,
    },
    {
      name: 'User main wallet lifetime deposits correct',
      passed: finalMainWallet?.lifetimeDeposits === DEPOSIT_AMOUNT,
      expected: DEPOSIT_AMOUNT,
      actual: finalMainWallet?.lifetimeDeposits,
    },
    {
      name: 'User sports wallet bonus balance has welcome bonus',
      passed: finalSportsWallet?.bonusBalance === calculatedBonus,
      expected: calculatedBonus,
      actual: finalSportsWallet?.bonusBalance,
    },
    {
      name: 'User sports wallet real balance is 0',
      passed: finalSportsWallet?.balance === 0,
      expected: 0,
      actual: finalSportsWallet?.balance,
    },
    {
      name: 'User casino wallet bonus balance is 0',
      passed: finalCasinoWallet?.bonusBalance === 0,
      expected: 0,
      actual: finalCasinoWallet?.bonusBalance,
    },
    {
      name: 'User casino wallet real balance is 0',
      passed: finalCasinoWallet?.balance === 0,
      expected: 0,
      actual: finalCasinoWallet?.balance,
    },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const assertion of assertions) {
    if (assertion.passed) {
      logSuccess(assertion.name);
      passed++;
    } else {
      logError(`${assertion.name} (expected: ${assertion.expected}, got: ${assertion.actual})`);
      failed++;
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log('\n' + '═'.repeat(70));
  log('  SCENARIO SUMMARY', colors.cyan + colors.bold);
  console.log('═'.repeat(70));
  
  log(`
  Flow Completed:
  ───────────────
  1. ✓ Payment providers configured (Stripe, PayPal)
  2. ✓ System bonus pool created (€${INITIAL_BONUS_POOL})
  3. ✓ New user registered with 3 wallets (main, sports, casino)
  4. ✓ User deposited €${DEPOSIT_AMOUNT} via Stripe → main wallet
  5. ✓ First deposit triggered welcome bonus
  6. ✓ Client API tested (userWallets, walletBalance)
  7. ✓ €${calculatedBonus} bonus credited to sports wallet
  8. ✓ Casino wallet remains at €0 (sports-only offer)

  Final Balances:
  ───────────────
  System Bonus Pool:    €${finalSystemWallet?.balance?.toFixed(2)} (was €${INITIAL_BONUS_POOL})
  User Main Wallet:     €${finalMainWallet?.balance?.toFixed(2)} real
  User Sports Wallet:   €${finalSportsWallet?.balance?.toFixed(2)} real + €${finalSportsWallet?.bonusBalance?.toFixed(2)} bonus
  User Casino Wallet:   €${finalCasinoWallet?.balance?.toFixed(2)} real + €${finalCasinoWallet?.bonusBalance?.toFixed(2)} bonus
`, colors.dim);

  console.log('─'.repeat(70));
  log(`  Results: ${passed} passed, ${failed} failed`, failed === 0 ? colors.green : colors.red);
  console.log('─'.repeat(70) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run the scenario
runRealScenario().catch((err) => {
  console.error('Scenario failed:', err);
  process.exit(1);
});
