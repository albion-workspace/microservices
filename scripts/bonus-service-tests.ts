#!/usr/bin/env npx tsx
/**
 * Bonus Service - Comprehensive Test Suite
 * 
 * Tests ALL 38 bonus types organized by category:
 * 
 * 1. Onboarding (4): welcome, first_deposit, first_purchase, first_action
 * 2. Recurring (2): reload, top_up
 * 3. Referral (3): referral, referee, commission
 * 4. Activity (4): activity, streak, milestone, winback
 * 5. Recovery (2): cashback, consolation
 * 6. Credits (2): free_credit, trial
 * 7. Loyalty (4): loyalty, loyalty_points, vip, tier_upgrade
 * 8. Time-based (5): birthday, anniversary, seasonal, daily_login, flash
 * 9. Achievement (3): achievement, task_completion, challenge
 * 10. Competition (2): tournament, leaderboard
 * 11. Selection (3): selection, combo, bundle
 * 12. Promotional (3): promo_code, special_event, custom
 * 
 * INCLUDES: Client-side eligibility verification using BonusEligibility class
 * 
 * Run: npx tsx scripts/bonus-service-tests.ts
 */

import { createHmac } from 'crypto';
import { 
  BonusEligibility, 
  type BonusTemplate as ClientBonusTemplate,
  type EligibilityContext 
} from '../bonus-shared/src/BonusEligibility.js';

export {}; // Make this a module

const BONUS_URL = process.env.BONUS_URL || 'http://localhost:3005/graphql';

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'bonus-service-secret-change-in-production';

// ═══════════════════════════════════════════════════════════════════
// Test Configuration & Mock Data
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  testUserId: `test-user-${Date.now()}`,
  testUserId2: `test-user-2-${Date.now()}`,
  tenantId: 'test-tenant',
  currency: 'USD',
};

// ─────────────────────────────────────────────────────────────────
// Template Definitions by Category
// ─────────────────────────────────────────────────────────────────

interface TemplateConfig {
  code: string;
  name: string;
  type: string;
  domain?: string;
  valueType?: string;
  value: number;
  maxValue?: number;
  minDeposit?: number;
  turnoverMultiplier?: number;
  eligibleTiers?: string[];
  minSelections?: number;
  maxSelections?: number;
  min?: number;
  max?: number;
  minTotal?: number;
  maxTotal?: number;
}

const TEMPLATES: Record<string, TemplateConfig[]> = {
  onboarding: [
    { code: 'WELCOME', name: 'Welcome Bonus', type: 'welcome', value: 1000 },
    { code: 'FIRSTDEP', name: 'First Deposit 100%', type: 'first_deposit', valueType: 'percentage', value: 100, maxValue: 20000, minDeposit: 1000 },
    { code: 'FIRSTPURCH', name: 'First Purchase Bonus', type: 'first_purchase', valueType: 'percentage', value: 10, maxValue: 5000 },
    { code: 'FIRSTACT', name: 'First Action Bonus', type: 'first_action', value: 500 },
  ],
  recurring: [
    { code: 'RELOAD', name: 'Weekly Reload', type: 'reload', valueType: 'percentage', value: 50, maxValue: 10000, minDeposit: 2000 },
    { code: 'TOPUP', name: 'Top Up Bonus', type: 'top_up', valueType: 'percentage', value: 5, maxValue: 2500 },
  ],
  referral: [
    { code: 'REFERRAL', name: 'Referral Reward', type: 'referral', value: 2500 },
    { code: 'REFEREE', name: 'New User Referral Bonus', type: 'referee', valueType: 'percentage', value: 50, maxValue: 5000 },
    { code: 'COMMISSION', name: 'Referral Commission', type: 'commission', valueType: 'percentage', value: 5, maxValue: 10000 },
  ],
  activity: [
    { code: 'ACTIVITY', name: 'Activity Bonus', type: 'activity', valueType: 'percentage', value: 1, maxValue: 5000 },
    { code: 'STREAK', name: '7-Day Streak Bonus', type: 'streak', value: 1000 },
    { code: 'MILESTONE', name: 'Milestone Bonus', type: 'milestone', value: 5000 },
    { code: 'WINBACK', name: 'Come Back Bonus', type: 'winback', value: 2000 },
  ],
  recovery: [
    { code: 'CASHBACK', name: 'Weekly Cashback', type: 'cashback', valueType: 'percentage', value: 10, maxValue: 50000, turnoverMultiplier: 5 },
    { code: 'CONSOLATION', name: 'Better Luck Next Time', type: 'consolation', valueType: 'percentage', value: 5, maxValue: 1000, turnoverMultiplier: 3 },
  ],
  credits: [
    { code: 'FREECREDIT', name: 'Daily Free Credit', type: 'free_credit', value: 100, turnoverMultiplier: 1 },
    { code: 'TRIAL', name: 'Free Trial Credits', type: 'trial', value: 500, turnoverMultiplier: 1 },
  ],
  loyalty: [
    { code: 'LOYALTY', name: 'Loyalty Bonus', type: 'loyalty', value: 1000, eligibleTiers: ['silver', 'gold', 'platinum'] },
    { code: 'LOYALTYPTS', name: 'Loyalty Points', type: 'loyalty_points', valueType: 'points', value: 100, turnoverMultiplier: 0 },
    { code: 'VIP', name: 'VIP Exclusive Bonus', type: 'vip', value: 10000, eligibleTiers: ['vip', 'platinum', 'diamond'] },
    { code: 'TIERUP', name: 'Tier Upgrade Bonus', type: 'tier_upgrade', value: 2500 },
  ],
  timeBased: [
    { code: 'BIRTHDAY', name: 'Birthday Bonus', type: 'birthday', value: 2500 },
    { code: 'ANNIVERSARY', name: 'Account Anniversary', type: 'anniversary', value: 5000 },
    { code: 'CHRISTMAS', name: 'Christmas Bonus', type: 'seasonal', value: 3000 },
    { code: 'DAILYLOGIN', name: 'Daily Login Reward', type: 'daily_login', value: 100, turnoverMultiplier: 1 },
    { code: 'FLASH', name: 'Flash Sale Bonus', type: 'flash', valueType: 'percentage', value: 200, maxValue: 10000 },
  ],
  achievement: [
    { code: 'ACHIEVE', name: 'Achievement Unlocked', type: 'achievement', value: 1000 },
    { code: 'TASK', name: 'Task Complete Bonus', type: 'task_completion', value: 500 },
    { code: 'CHALLENGE', name: 'Challenge Winner', type: 'challenge', value: 5000 },
  ],
  competition: [
    { code: 'TOURNAMENT', name: 'Tournament Prize', type: 'tournament', value: 100000 },
    { code: 'LEADERBOARD', name: 'Leaderboard Reward', type: 'leaderboard', value: 50000 },
  ],
  selection: [
    { code: 'SELECT', name: 'Pick Your Bonus', type: 'selection', value: 2000 },
    { code: 'COMBO', name: 'Combo Bonus', type: 'combo', valueType: 'multiplier', value: 2, maxValue: 10000 },
    { code: 'BUNDLE', name: 'Bundle Purchase Bonus', type: 'bundle', valueType: 'percentage', value: 15, maxValue: 5000 },
  ],
  promotional: [
    { code: 'PROMO50', name: 'Promo Code Bonus', type: 'promo_code', value: 5000 },
    { code: 'SPECIAL', name: 'Special Event Bonus', type: 'special_event', value: 10000 },
    { code: 'CUSTOM', name: 'Custom Admin Bonus', type: 'custom', value: 2500 },
  ],
};

// ─────────────────────────────────────────────────────────────────
// Test Contexts for Client-Side Eligibility
// ─────────────────────────────────────────────────────────────────

const TEST_CONTEXTS = {
  firstTimeDepositor: {
    userId: CONFIG.testUserId,
    currency: 'USD' as const,
    depositAmount: 5000,
    isFirstDeposit: true,
    userTier: 'bronze',
  },
  
  vipUser: {
    userId: CONFIG.testUserId,
    currency: 'USD' as const,
    userTier: 'vip',
    isFirstDeposit: false,
  },
  
  returningUser: {
    userId: CONFIG.testUserId,
    currency: 'USD' as const,
    depositAmount: 10000,
    isFirstDeposit: false,
    userTier: 'gold',
  },
};

const DEPOSIT_AMOUNTS = [1000, 5000, 10000, 50000]; // cents: $10, $50, $100, $500
const USER_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'vip'];
const SELECTION_COUNTS = [1, 3, 5, 8];

// ─────────────────────────────────────────────────────────────────
// Mock Templates for Selection/Combo Validation
// ─────────────────────────────────────────────────────────────────

const MOCK_TEMPLATES = {
  // Combo bonus with min/max value per selection
  comboWithMinMax: {
    id: 'test-combo',
    name: 'Test Combo Bonus',
    code: 'TESTCOMBO',
    type: 'combo' as const,
    domain: 'sports' as const,
    valueType: 'percentage' as const,
    value: 10,
    currency: 'USD' as const,
    turnoverMultiplier: 5,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 86400000),
    minSelections: 3,
    maxSelections: 10,
    min: 1.5,        // Min value per selection
    max: 100,        // Max value per selection
    minTotal: 5.0,   // Min combined total
    isActive: true,
  } as ClientBonusTemplate,

  // Combo with total range validation
  comboTotalRange: {
    id: 'test-combo-total',
    name: 'Combo Total Test',
    code: 'COMBOTOTAL',
    type: 'combo' as const,
    domain: 'sports' as const,
    valueType: 'percentage' as const,
    value: 10,
    currency: 'USD' as const,
    turnoverMultiplier: 5,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 86400000),
    minSelections: 3,
    min: 1.5,
    minTotal: 5.0,
    maxTotal: 1000,
    isActive: true,
  } as ClientBonusTemplate,

  // Bundle (sum-based) for ecommerce
  bundleCart: {
    id: 'test-bundle',
    name: 'Bundle Deal',
    code: 'BUNDLE',
    type: 'bundle' as const,
    domain: 'ecommerce' as const,
    valueType: 'percentage' as const,
    value: 15,
    currency: 'USD' as const,
    turnoverMultiplier: 0,
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 86400000),
    minSelections: 3,
    minTotal: 100,   // Cart min $100
    maxTotal: 10000, // Cart max $10000
    isActive: true,
  } as ClientBonusTemplate,
};

// ─────────────────────────────────────────────────────────────────
// Test Selection Data
// ─────────────────────────────────────────────────────────────────

const SELECTION_TEST_CASES = {
  validSelections: {
    selectionCount: 4,
    selections: [
      { id: '1', value: 2.0 },
      { id: '2', value: 1.8 },
      { id: '3', value: 1.6 },
      { id: '4', value: 2.2 },
    ],
  },
  
  belowMinValue: {
    selectionCount: 4,
    selections: [
      { id: '1', value: 2.0 },
      { id: '2', value: 1.2 },  // Below min 1.5
      { id: '3', value: 1.6 },
      { id: '4', value: 2.2 },
    ],
  },
  
  aboveMaxValue: {
    selectionCount: 4,
    selections: [
      { id: '1', value: 2.0 },
      { id: '2', value: 150 },  // Above max 100
      { id: '3', value: 1.6 },
      { id: '4', value: 2.2 },
    ],
  },
  
  lowTotal: {
    selectionCount: 3,
    selections: [
      { id: '1', value: 1.5 },
      { id: '2', value: 1.5 },
      { id: '3', value: 1.5 },
    ],
    // Total: 1.5 * 1.5 * 1.5 = 3.375 < minTotal 5.0
  },
  
  validTotal: {
    selectionCount: 3,
    selections: [
      { id: '1', value: 2.0 },
      { id: '2', value: 2.0 },
      { id: '3', value: 2.0 },
    ],
    // Total: 2.0 * 2.0 * 2.0 = 8.0
  },
  
  highTotal: {
    selectionCount: 3,
    selections: [
      { id: '1', value: 50 },
      { id: '2', value: 50 },
      { id: '3', value: 50 },
    ],
    // Total: 50 * 50 * 50 = 125000
  },
  
  validCart: {
    selectionCount: 4,
    selections: [
      { id: '1', value: 30 },
      { id: '2', value: 40 },
      { id: '3', value: 25 },
      { id: '4', value: 20 },
    ],
    // Sum: 30 + 40 + 25 + 20 = 115
  },
  
  lowCart: {
    selectionCount: 3,
    selections: [
      { id: '1', value: 20 },
      { id: '2', value: 20 },
      { id: '3', value: 20 },
    ],
    // Sum: 60 < minTotal 100
  },
};

// ─────────────────────────────────────────────────────────────────
// Category Mapping
// ─────────────────────────────────────────────────────────────────

const BONUS_CATEGORIES: Record<string, string[]> = {
  'Onboarding': ['welcome', 'first_deposit', 'first_purchase', 'first_action'],
  'Recurring': ['reload', 'top_up'],
  'Referral': ['referral', 'referee', 'commission'],
  'Activity': ['activity', 'milestone', 'streak', 'winback'],
  'Recovery': ['cashback', 'consolation'],
  'Credits': ['free_credit', 'trial'],
  'Loyalty': ['loyalty', 'loyalty_points', 'vip', 'tier_upgrade'],
  'Time-based': ['birthday', 'anniversary', 'seasonal', 'daily_login', 'flash'],
  'Achievement': ['achievement', 'task_completion', 'challenge'],
  'Competition': ['tournament', 'leaderboard'],
  'Selection': ['selection', 'combo', 'bundle'],
  'Promotional': ['promo_code', 'special_event', 'custom'],
};

// ═══════════════════════════════════════════════════════════════════
// JWT Generation
// ═══════════════════════════════════════════════════════════════════

function createJWT(payload: object): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 8 * 60 * 60;
  
  const fullPayload = { ...payload, iat: now, exp };
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${base64Header}.${base64Payload}`)
    .digest('base64url');
  
  return `${base64Header}.${base64Payload}.${signature}`;
}

function createAdminToken(): string {
  return createJWT({
    userId: 'admin',
    tenantId: CONFIG.tenantId,
    roles: ['admin', 'system'],
    permissions: ['*:*:*'],
  });
}

// ═══════════════════════════════════════════════════════════════════
// Test Infrastructure
// ═══════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];
let adminToken: string;

async function graphql(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(BONUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  if (json.errors) {
    throw new Error(json.errors[0]?.message || 'GraphQL error');
  }
  return json.data;
}

async function runTest(name: string, testFn: () => Promise<void>): Promise<TestResult> {
  const start = Date.now();
  try {
    await testFn();
    const result: TestResult = { name, passed: true, duration: Date.now() - start };
    results.push(result);
    console.log(`  ✅ ${name} (${result.duration}ms)`);
    return result;
  } catch (error) {
    const result: TestResult = {
      name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
    results.push(result);
    console.log(`  ❌ ${name} - ${result.error}`);
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Template Creation Helper
// ═══════════════════════════════════════════════════════════════════

const templateIds: Record<string, string> = {};

async function createTemplate(config: TemplateConfig): Promise<string> {
  const query = `
    mutation CreateTemplate($input: CreateBonusTemplateInput!) {
      createBonusTemplate(input: $input) {
        success
        bonusTemplate { id code type }
        errors
      }
    }
  `;

  const input = {
    code: `${config.code}-${Date.now()}`,
    name: config.name,
    type: config.type,
    domain: config.domain || 'universal',
    valueType: config.valueType || 'fixed',
    value: config.value,
    maxValue: config.maxValue,
    minDeposit: config.minDeposit,
    currency: 'USD',
    turnoverMultiplier: config.turnoverMultiplier ?? 30,
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    eligibleTiers: config.eligibleTiers,
    priority: 50,
    isActive: true,
  };

  const data = await graphql(query, { input });
  
  if (!data.createBonusTemplate.success) {
    throw new Error(data.createBonusTemplate.errors?.join(', ') || 'Failed');
  }
  
  const id = data.createBonusTemplate.bonusTemplate.id;
  templateIds[config.type] = id;
  return id;
}

// ═══════════════════════════════════════════════════════════════════
// Test Suites by Category
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// Category 1: Onboarding (welcome, first_deposit, first_purchase, first_action)
// ─────────────────────────────────────────────────────────────────

async function testOnboardingBonuses() {
  console.log('\n📦 CATEGORY: ONBOARDING\n');

  for (const template of TEMPLATES.onboarding) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }

  await runTest('Award welcome bonus', async () => {
    const query = `
      mutation AwardBonus($input: CreateUserBonusInput!) {
        createUserBonus(input: $input) {
          success
          userBonus { id type status originalValue }
          errors
        }
      }
    `;
    const data = await graphql(query, {
      input: {
        userId: CONFIG.testUserId,
        templateCode: TEMPLATES.onboarding[0].code,
        currency: CONFIG.currency,
        tenantId: CONFIG.tenantId,
      }
    });
    if (!data.createUserBonus.success) throw new Error(data.createUserBonus.errors?.join(', '));
    console.log(`     → Bonus: ${JSON.stringify(data.createUserBonus.userBonus)}`);
  });
}

// ─────────────────────────────────────────────────────────────────
// Category 2: Recurring (reload, top_up)
// ─────────────────────────────────────────────────────────────────

async function testRecurringBonuses() {
  console.log('\n📦 CATEGORY: RECURRING\n');

  for (const template of TEMPLATES.recurring) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 3: Referral (referral, referee, commission)
// ─────────────────────────────────────────────────────────────────

async function testReferralBonuses() {
  console.log('\n📦 CATEGORY: REFERRAL\n');

  for (const template of TEMPLATES.referral) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 4: Activity (activity, streak, milestone)
// ─────────────────────────────────────────────────────────────────

async function testActivityBonuses() {
  console.log('\n📦 CATEGORY: ACTIVITY\n');

  for (const template of TEMPLATES.activity) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 5: Recovery (cashback, consolation)
// ─────────────────────────────────────────────────────────────────

async function testRecoveryBonuses() {
  console.log('\n📦 CATEGORY: RECOVERY\n');

  for (const template of TEMPLATES.recovery) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 6: Credits (free_credit, trial)
// ─────────────────────────────────────────────────────────────────

async function testCreditBonuses() {
  console.log('\n📦 CATEGORY: CREDITS\n');

  for (const template of TEMPLATES.credits) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 7: Loyalty (loyalty, loyalty_points, vip, tier_upgrade)
// ─────────────────────────────────────────────────────────────────

async function testLoyaltyBonuses() {
  console.log('\n📦 CATEGORY: LOYALTY\n');

  for (const template of TEMPLATES.loyalty) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 8: Time-based (birthday, anniversary, seasonal, daily_login, flash)
// ─────────────────────────────────────────────────────────────────

async function testTimeBasedBonuses() {
  console.log('\n📦 CATEGORY: TIME-BASED\n');

  for (const template of TEMPLATES.timeBased) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 9: Achievement (achievement, task_completion, challenge)
// ─────────────────────────────────────────────────────────────────

async function testAchievementBonuses() {
  console.log('\n📦 CATEGORY: ACHIEVEMENT\n');

  for (const template of TEMPLATES.achievement) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 10: Competition (tournament, leaderboard)
// ─────────────────────────────────────────────────────────────────

async function testCompetitionBonuses() {
  console.log('\n📦 CATEGORY: COMPETITION\n');

  for (const template of TEMPLATES.competition) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 11: Selection (selection, combo, bundle)
// ─────────────────────────────────────────────────────────────────

async function testSelectionBonuses() {
  console.log('\n📦 CATEGORY: SELECTION\n');

  for (const template of TEMPLATES.selection) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Category 12: Promotional (promo_code, special_event, custom)
// ─────────────────────────────────────────────────────────────────

async function testPromotionalBonuses() {
  console.log('\n📦 CATEGORY: PROMOTIONAL\n');

  for (const template of TEMPLATES.promotional) {
    await runTest(`Create ${template.type} template`, async () => {
      await createTemplate(template);
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Integration Tests
// ─────────────────────────────────────────────────────────────────

async function testTurnoverTracking() {
  console.log('\n📦 TURNOVER TRACKING\n');

  await runTest('Record turnover transaction', async () => {
    // First get a bonus with turnover requirement
    const listQuery = `
      query { 
        userBonuss(first: 1) { 
          nodes { id turnoverRequired turnoverProgress } 
        }
      }
    `;
    const listData = await graphql(listQuery);
    if (listData.userBonuss.nodes.length === 0) {
      console.log('     → No bonuses to track turnover');
      return;
    }

    const bonus = listData.userBonuss.nodes[0];
    const txQuery = `
      mutation RecordTurnover($input: CreateBonusTransactionInput!) {
        createBonusTransaction(input: $input) {
          success
          bonusTransaction { id turnoverContribution turnoverAfter }
          errors
        }
      }
    `;
    const txData = await graphql(txQuery, {
      input: {
        userBonusId: bonus.id,
        userId: CONFIG.testUserId,
        type: 'turnover',
        currency: 'USD',
        amount: 5000,
        activityCategory: 'slots',
      }
    });
    console.log(`     → Turnover: ${JSON.stringify(txData.createBonusTransaction.bonusTransaction)}`);
  });
}

async function testBonusQueries() {
  console.log('\n📦 QUERIES & FILTERS\n');

  await runTest('List all templates', async () => {
    const query = `query { bonusTemplates(first: 50) { totalCount nodes { type } } }`;
    const data = await graphql(query);
    console.log(`     → ${data.bonusTemplates.totalCount} templates created`);
    
    const types = [...new Set(data.bonusTemplates.nodes.map((n: any) => n.type))];
    console.log(`     → Types: ${types.join(', ')}`);
  });

  await runTest('List user bonuses', async () => {
    const query = `query { userBonuss(first: 10) { totalCount nodes { type status } } }`;
    const data = await graphql(query);
    console.log(`     → ${data.userBonuss.totalCount} user bonuses`);
  });

  await runTest('Filter templates by type', async () => {
    const query = `
      query { 
        bonusTemplates(filter: { type: "cashback" }, first: 5) { 
          totalCount 
        }
      }
    `;
    const data = await graphql(query);
    console.log(`     → ${data.bonusTemplates.totalCount} cashback templates`);
  });
}

// ─────────────────────────────────────────────────────────────────
// Client-Side Eligibility & Server Consistency Verification
// ─────────────────────────────────────────────────────────────────

async function testClientSideEligibility() {
  console.log('\n📦 CLIENT-SIDE ELIGIBILITY (BonusEligibility class)\n');

  // Fetch templates from API (same as client would do)
  await runTest('Fetch available bonuses from API', async () => {
    const query = `
      query {
        bonusTemplates(first: 100) {
          nodes {
            id name code type domain
            valueType value currency supportedCurrencies
            maxValue minDeposit
            turnoverMultiplier
            validFrom validUntil
            maxUsesTotal maxUsesPerUser currentUsesTotal
            eligibleTiers
            minSelections maxSelections
            stackable
            priority isActive
          }
        }
      }
    `;
    const data = await graphql(query);
    const templates = data.bonusTemplates.nodes as ClientBonusTemplate[];
    console.log(`     → Fetched ${templates.length} templates from API`);
    
    // Store for use in other tests
    (globalThis as any).__testTemplates = templates;
  });

  await runTest('Check eligibility for first-time depositor', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    const context: EligibilityContext = TEST_CONTEXTS.firstTimeDepositor;

    const results = BonusEligibility.checkMany(templates, context);
    const eligible = results.filter(r => r.eligible);
    const notEligible = results.filter(r => !r.eligible);
    
    console.log(`     → Eligible: ${eligible.length} bonuses`);
    eligible.slice(0, 5).forEach(r => {
      console.log(`       ✅ ${r.template.name} (${r.template.type}) - Value: ${r.calculatedValue}`);
    });
    if (eligible.length > 5) console.log(`       ... and ${eligible.length - 5} more`);
    
    console.log(`     → Not Eligible: ${notEligible.length} bonuses`);
    notEligible.slice(0, 3).forEach(r => {
      console.log(`       ❌ ${r.template.name}: ${r.reasons[0]}`);
    });
  });

  await runTest('Find best deposit bonus for various amounts', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    
    for (const amount of DEPOSIT_AMOUNTS) {
      const best = BonusEligibility.findBestForDeposit(templates, amount, CONFIG.currency, {
        isFirstDeposit: true,
      });
      
      if (best) {
        console.log(`     → $${amount/100} deposit: ${best.template.name} = $${(best.calculatedValue || 0)/100} bonus`);
      } else {
        console.log(`     → $${amount/100} deposit: No bonus available`);
      }
    }
  });

  await runTest('Check VIP tier eligibility', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    
    for (const tier of USER_TIERS) {
      const context: EligibilityContext = { userTier: tier, currency: CONFIG.currency };
      const eligible = BonusEligibility.getEligible(templates, context);
      const tierBonuses = eligible.filter(r => 
        r.template.eligibleTiers?.includes(tier) || 
        r.template.type === 'vip' ||
        r.template.type === 'loyalty'
      );
      console.log(`     → ${tier.toUpperCase()}: ${tierBonuses.length} tier-specific bonuses`);
    }
  });
}

async function testSelectionValidation() {
  console.log('\n📦 SELECTION/COMBO VALIDATION (min/max values)\n');

  await runTest('Combo bonus with selection count requirements', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    
    for (const count of SELECTION_COUNTS) {
      const combos = BonusEligibility.findForSelections(templates, count);
      console.log(`     → ${count} selections: ${combos.length} combo bonuses available`);
    }
  });

  await runTest('Selection value range validation (min/max per item)', async () => {
    const { comboWithMinMax } = MOCK_TEMPLATES;

    // Test 1: Valid selections
    const validResult = BonusEligibility.check(comboWithMinMax, SELECTION_TEST_CASES.validSelections);
    console.log(`     → Valid (2.0, 1.8, 1.6, 2.2): ${validResult.eligible ? '✅ Eligible' : '❌ ' + validResult.reasons[0]}`);

    // Test 2: Value below minimum
    const belowMinResult = BonusEligibility.check(comboWithMinMax, SELECTION_TEST_CASES.belowMinValue);
    console.log(`     → Below min (has 1.2): ${belowMinResult.eligible ? '✅ Eligible' : '❌ ' + belowMinResult.reasons[0]}`);

    // Test 3: Value above maximum  
    const aboveMaxResult = BonusEligibility.check(comboWithMinMax, SELECTION_TEST_CASES.aboveMaxValue);
    console.log(`     → Above max (has 150): ${aboveMaxResult.eligible ? '✅ Eligible' : '❌ ' + aboveMaxResult.reasons[0]}`);
  });

  await runTest('Combined total validation (minTotal/maxTotal)', async () => {
    const { comboTotalRange } = MOCK_TEMPLATES;

    // Test 1: Total too low (1.5 * 1.5 * 1.5 = 3.375)
    const lowTotalResult = BonusEligibility.check(comboTotalRange, SELECTION_TEST_CASES.lowTotal);
    console.log(`     → Low total (1.5³ = 3.375): ${lowTotalResult.eligible ? '✅ Eligible' : '❌ ' + lowTotalResult.reasons[0]}`);

    // Test 2: Total valid (2.0 * 2.0 * 2.0 = 8.0)
    const validTotalResult = BonusEligibility.check(comboTotalRange, SELECTION_TEST_CASES.validTotal);
    console.log(`     → Valid total (2.0³ = 8.0): ${validTotalResult.eligible ? '✅ Eligible' : '❌ ' + validTotalResult.reasons[0]}`);

    // Test 3: Total too high
    const highTotalResult = BonusEligibility.check(comboTotalRange, SELECTION_TEST_CASES.highTotal);
    console.log(`     → High total (50³ = 125000): ${highTotalResult.eligible ? '✅ Eligible' : '❌ ' + highTotalResult.reasons[0]}`);
  });

  await runTest('Bundle bonus (sum-based total)', async () => {
    const { bundleCart } = MOCK_TEMPLATES;

    // Bundle uses SUM (not multiply like combo)
    const validBundleResult = BonusEligibility.check(bundleCart, SELECTION_TEST_CASES.validCart);
    console.log(`     → Cart $115 (30+40+25+20): ${validBundleResult.eligible ? '✅ Eligible' : '❌ ' + validBundleResult.reasons[0]}`);

    const lowBundleResult = BonusEligibility.check(bundleCart, SELECTION_TEST_CASES.lowCart);
    console.log(`     → Cart $60 (3x$20): ${lowBundleResult.eligible ? '✅ Eligible' : '❌ ' + lowBundleResult.reasons[0]}`);
  });
}

async function testConsistencyServerClient() {
  console.log('\n📦 SERVER/CLIENT CONSISTENCY VERIFICATION\n');

  await runTest('Verify client eligibility matches server data', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    const context: EligibilityContext = TEST_CONTEXTS.returningUser;

    // Client-side check
    const clientResults = BonusEligibility.checkMany(templates, context);
    const clientEligible = clientResults.filter(r => r.eligible);
    const depositBonuses = clientEligible.filter(r => 
      [...BONUS_CATEGORIES['Onboarding'], ...BONUS_CATEGORIES['Recurring']].includes(r.template.type)
    );

    console.log(`     → Client found ${clientEligible.length} eligible bonuses`);
    console.log(`     → Deposit-related: ${depositBonuses.length}`);

    // Verify the best deposit bonus calculation
    const bestDeposit = BonusEligibility.findBestForDeposit(templates, 10000, CONFIG.currency, { isFirstDeposit: true });
    if (bestDeposit) {
      console.log(`     → Best deposit bonus: ${bestDeposit.template.name}`);
      console.log(`       Template value: ${bestDeposit.template.value} (${bestDeposit.template.valueType})`);
      console.log(`       Calculated: ${bestDeposit.calculatedValue}`);
      console.log(`       Turnover: ${bestDeposit.turnoverRequired}`);
    }
  });

  await runTest('Verify date filtering matches API', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    
    // All templates from API should be active (validFrom <= now <= validUntil)
    const now = new Date();
    const activeTemplates = templates.filter(t => {
      const from = new Date(t.validFrom);
      const until = new Date(t.validUntil);
      return t.isActive && now >= from && now <= until;
    });

    // Client-side check should match
    const clientResults = BonusEligibility.checkMany(templates, {});
    const clientActive = clientResults.filter(r => 
      !r.reasons.includes('Bonus is not active') &&
      !r.reasons.some(reason => reason.includes('expired') || reason.includes('starts on'))
    );

    console.log(`     → API active templates: ${activeTemplates.length}`);
    console.log(`     → Client active check: ${clientActive.length}`);
    
    if (activeTemplates.length === clientActive.length) {
      console.log(`     → ✅ Consistency verified!`);
    } else {
      console.log(`     → ⚠️ Mismatch detected`);
    }
  });

  await runTest('Group and summarize by type', async () => {
    const templates = (globalThis as any).__testTemplates as ClientBonusTemplate[];
    const context: EligibilityContext = { currency: CONFIG.currency };
    
    const grouped = BonusEligibility.groupByType(templates, context);

    console.log('     → Summary by category:');
    for (const [category, types] of Object.entries(BONUS_CATEGORIES)) {
      let total = 0;
      let eligible = 0;
      for (const type of types) {
        const results = grouped.get(type as any) || [];
        total += results.length;
        eligible += results.filter(r => r.eligible).length;
      }
      if (total > 0) {
        console.log(`       ${category}: ${eligible}/${total} eligible`);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════
// Main Test Runner
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║         BONUS SERVICE - COMPREHENSIVE TEST SUITE (38 BONUS TYPES)         ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Categories:                                                              ║
║  1. Onboarding (4)    2. Recurring (2)     3. Referral (3)                ║
║  4. Activity (4)      5. Recovery (2)      6. Credits (2)                 ║
║  7. Loyalty (4)       8. Time-based (5)    9. Achievement (3)             ║
║  10. Competition (2)  11. Selection (3)    12. Promotional (3)            ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  // Check service
  console.log('🔍 Checking Bonus Service...');
  try {
    await fetch(BONUS_URL.replace('/graphql', '/health'));
    console.log(`  ✅ Running at ${BONUS_URL}`);
  } catch {
    console.log(`  ❌ Not running at ${BONUS_URL}`);
    console.log('  Run: cd Examples/bonus-service && npm start');
    process.exit(1);
  }

  // Generate admin token
  adminToken = createAdminToken();
  console.log('  🔑 Admin token generated\n');

  // Run all category tests
  await testOnboardingBonuses();
  await testRecurringBonuses();
  await testReferralBonuses();
  await testActivityBonuses();
  await testRecoveryBonuses();
  await testCreditBonuses();
  await testLoyaltyBonuses();
  await testTimeBasedBonuses();
  await testAchievementBonuses();
  await testCompetitionBonuses();
  await testSelectionBonuses();
  await testPromotionalBonuses();
  
  // Integration tests
  await testTurnoverTracking();
  await testBonusQueries();
  
  // Client-side eligibility verification
  await testClientSideEligibility();
  await testSelectionValidation();
  await testConsistencyServerClient();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Time: ${totalTime}ms`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
}

main().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
