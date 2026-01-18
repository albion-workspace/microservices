/**
 * Default Role Definitions
 * 
 * Pre-configured roles for common use cases:
 * - Banking: branch manager, teller, customer service, etc.
 * - Crypto Wallet: admin, trader, user, etc.
 * - Foreign Exchange: broker, trader, analyst, etc.
 * - Betting Platform: admin, agent, player, etc.
 */

import type { Role } from 'access-engine';

/**
 * Default role definitions for common scenarios
 * Uses access-engine's Role type
 */
export const DEFAULT_ROLES: Role[] = [
  // ═══════════════════════════════════════════════════════════════
  // System Roles (Global)
  // ═══════════════════════════════════════════════════════════════
  
  {
    name: 'super-admin',
    displayName: 'Super Administrator',
    description: 'Full system access across all tenants and contexts',
    permissions: ['*:*:*'],
    priority: 100,
    active: true,
  },
  
  {
    name: 'admin',
    displayName: 'Administrator',
    description: 'Administrative access within tenant',
    permissions: ['*:*:*'],
    priority: 90,
    active: true,
  },
  
  {
    name: 'system',
    displayName: 'System User',
    description: 'System-level user for automated processes',
    permissions: ['system:*:*'],
    priority: 80,
    active: true,
  },
  
  {
    name: 'user',
    displayName: 'Regular User',
    description: 'Standard user with basic permissions',
    permissions: ['user:read:own', 'user:update:own'],
    priority: 10,
    active: true,
  },
  
  // ═══════════════════════════════════════════════════════════════
  // Banking Roles
  // ═══════════════════════════════════════════════════════════════
  
  {
    name: 'branch-manager',
    displayName: 'Branch Manager',
    description: 'Manager of a bank branch',
    inherits: ['user'],
    permissions: [
      'branch:*:*',
      'account:*:*',
      'transaction:*:*',
      'user:read:*',
      'user:update:*',
    ],
    priority: 70,
    active: true,
  },
  
  {
    name: 'teller',
    displayName: 'Bank Teller',
    description: 'Bank teller with transaction processing permissions',
    inherits: ['user'],
    permissions: [
      'transaction:create:*',
      'transaction:read:*',
      'account:read:*',
      'account:update:*',
    ],
    priority: 50,
    active: true,
  },
  
  {
    name: 'customer-service',
    displayName: 'Customer Service',
    description: 'Customer service representative',
    inherits: ['user'],
    permissions: [
      'account:read:*',
      'account:update:*',
      'user:read:*',
      'user:update:*',
    ],
    priority: 40,
    active: true,
  },
  
  // ═══════════════════════════════════════════════════════════════
  // Crypto Wallet Roles
  // ═══════════════════════════════════════════════════════════════
  
  {
    name: 'crypto-admin',
    displayName: 'Crypto Administrator',
    description: 'Administrator for crypto wallet platform',
    inherits: ['admin'],
    permissions: [
      'wallet:*:*',
      'transaction:*:*',
      'blockchain:*:*',
    ],
    priority: 85,
    active: true,
  },
  
  {
    name: 'crypto-trader',
    displayName: 'Crypto Trader',
    description: 'Trader with trading permissions',
    inherits: ['user'],
    permissions: [
      'wallet:read:*',
      'wallet:update:*',
      'transaction:create:*',
      'transaction:read:*',
      'trading:*:*',
    ],
    priority: 60,
    active: true,
  },
  
  // ═══════════════════════════════════════════════════════════════
  // Foreign Exchange Roles
  // ═══════════════════════════════════════════════════════════════
  
  {
    name: 'forex-broker',
    displayName: 'Forex Broker',
    description: 'Forex broker with trading permissions',
    inherits: ['user'],
    permissions: [
      'trading:*:*',
      'account:*:*',
      'transaction:*:*',
      'market:*:read',
    ],
    priority: 65,
    active: true,
  },
  
  {
    name: 'forex-trader',
    displayName: 'Forex Trader',
    description: 'Forex trader',
    inherits: ['user'],
    permissions: [
      'trading:create:*',
      'trading:read:*',
      'account:read:*',
      'market:*:read',
    ],
    priority: 55,
    active: true,
  },
  
  {
    name: 'forex-analyst',
    displayName: 'Forex Analyst',
    description: 'Forex market analyst',
    inherits: ['user'],
    permissions: [
      'market:*:read',
      'trading:read:*',
      'account:read:*',
    ],
    priority: 45,
    active: true,
  },
  
  // ═══════════════════════════════════════════════════════════════
  // Betting Platform Roles
  // ═══════════════════════════════════════════════════════════════
  
  {
    name: 'betting-admin',
    displayName: 'Betting Administrator',
    description: 'Administrator for betting platform',
    inherits: ['admin'],
    permissions: [
      'betting:*:*',
      'player:*:*',
      'agent:*:*',
      'transaction:*:*',
    ],
    priority: 85,
    active: true,
  },
  
  {
    name: 'agent',
    displayName: 'Betting Agent',
    description: 'Betting agent with player management permissions',
    inherits: ['user'],
    permissions: [
      'player:create:*',
      'player:read:*',
      'player:update:*',
      'betting:read:*',
      'transaction:read:*',
    ],
    priority: 60,
    active: true,
  },
  
  {
    name: 'player',
    displayName: 'Betting Player',
    description: 'Betting platform player',
    inherits: ['user'],
    permissions: [
      'betting:create:*',
      'betting:read:own',
      'account:read:own',
      'transaction:read:own',
    ],
    priority: 30,
    active: true,
  },
  
  // ═══════════════════════════════════════════════════════════════
  // Payment Gateway Roles
  // ═══════════════════════════════════════════════════════════════
  
  {
    name: 'payment-gateway',
    displayName: 'Payment Gateway',
    description: 'Payment gateway system user',
    inherits: ['system'],
    permissions: [
      'payment:*:*',
      'transaction:*:*',
      'wallet:*:*',
    ],
    priority: 75,
    active: true,
  },
  
  {
    name: 'payment-provider',
    displayName: 'Payment Provider',
    description: 'Payment provider system user',
    inherits: ['system'],
    permissions: [
      'payment:*:*',
      'transaction:*:*',
    ],
    priority: 75,
    active: true,
  },
];

/**
 * Get default roles for a specific use case
 */
export function getDefaultRolesForUseCase(useCase: 'banking' | 'crypto' | 'forex' | 'betting' | 'all'): RoleDefinition[] {
  if (useCase === 'all') {
    return DEFAULT_ROLES;
  }
  
  const useCaseMap: Record<string, string[]> = {
    banking: ['branch-manager', 'teller', 'customer-service'],
    crypto: ['crypto-admin', 'crypto-trader'],
    forex: ['forex-broker', 'forex-trader', 'forex-analyst'],
    betting: ['betting-admin', 'agent', 'player'],
  };
  
  const roleNames = useCaseMap[useCase] || [];
  const systemRoles = ['super-admin', 'admin', 'system', 'user'];
  
  return DEFAULT_ROLES.filter(
    (role) => systemRoles.includes(role.name) || roleNames.includes(role.name)
  );
}
