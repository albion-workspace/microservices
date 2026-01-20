import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Wallet, 
  Send, 
  RefreshCw, 
  ArrowDownCircle, 
  ArrowUpCircle,
  FileText,
  Settings,
  Plus,
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Building,
} from 'lucide-react'
import { graphql as gql, SERVICE_URLS } from '../lib/auth'
import { useAuth } from '../lib/auth-context'
import { getRoleNames, hasRole, isSystem as checkIsSystem } from '../lib/access'
import { graphql as graphqlQuery, SERVICE_URLS as GRAPHQL_SERVICE_URLS } from '../lib/graphql-utils'

const PAYMENT_URL = SERVICE_URLS.payment

// Global GraphQL function wrapper with auth token
async function graphqlWithAuth<T = any>(
  url: string,
  query: string, 
  variables?: Record<string, unknown>,
  token?: string,
  options?: { operation?: string; showResponse?: boolean }
): Promise<T> {
  if (token) {
    return graphqlQuery<T>(url, query, variables, token, options)
  }
  // Fallback to generated token (legacy support)
  return gql<T>('payment', query, variables)
}

function formatCurrency(amount: number, currency: string | null | undefined = 'EUR'): string {
  // Ensure currency is valid, default to EUR if null/undefined/invalid
  const validCurrency = currency && typeof currency === 'string' && currency.length > 0 ? currency : 'EUR'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: validCurrency,
  }).format(amount / 100)
}

type TabId = 'wallets' | 'transactions' | 'ledger' | 'reconciliation' | 'settings'

export default function PaymentGateway() {
  const [activeTab, setActiveTab] = useState<TabId>('wallets')
  
  const tabs = [
    { id: 'wallets' as const, label: 'Wallets', icon: Wallet },
    { id: 'transactions' as const, label: 'Transactions', icon: ArrowDownCircle },
    { id: 'ledger' as const, label: 'Transfers', icon: FileText },
    { id: 'reconciliation' as const, label: 'Reconciliation', icon: FileText },
    { id: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Payment Gateway</h1>
        <p className="page-subtitle">Manage wallets, transactions, reconciliation, and provider settings</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={16} style={{ marginRight: 8 }} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'wallets' && <WalletsTab />}
      {activeTab === 'transactions' && <TransactionsTab />}
      {activeTab === 'ledger' && <LedgerTab />}
      {activeTab === 'reconciliation' && <ReconciliationTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// WALLETS TAB - Payment Flow: System → Provider → User
// ═══════════════════════════════════════════════════════════════════

// Provider icons mapping (for display)
const PROVIDER_ICONS: Record<string, { icon: string; color: string }> = {
  'payment-provider@system.com': { icon: '💳', color: '#635BFF' },
  'payment-gateway@system.com': { icon: '🏦', color: '#003087' },
  'default': { icon: '💳', color: '#635BFF' },
}

function WalletsTab() {
  const queryClient = useQueryClient()
  const { tokens, user } = useAuth()
  const authToken = tokens?.accessToken
  
  // Active section
  const [activeSection, setActiveSection] = useState<'system' | 'provider' | 'user'>('system')
  
  // System funding form - use real provider user ID
  const [systemFundForm, setSystemFundForm] = useState({ provider: '', amount: '10000', currency: 'EUR' })
  
  // Provider to User form - use real provider user ID
  const [providerToUserForm, setProviderToUserForm] = useState({ 
    provider: '', 
    userId: '', 
    amount: '100', 
    currency: 'EUR' 
  })
  
  // User operations form - use real provider user ID
  const [userDepositForm, setUserDepositForm] = useState({ userId: '', amount: '100', currency: 'EUR', provider: '', fromUserId: '' })
  const [userWithdrawForm, setUserWithdrawForm] = useState({ userId: '', amount: '50', currency: 'EUR', provider: '', bankAccount: '' })
  
  // New user wallet form
  const [newUserForm, setNewUserForm] = useState({ userId: '', currency: 'EUR', category: 'main' })
  
  // Wallet categories for sports betting and other use cases
  const walletCategories = [
    { value: 'main', label: 'Main Wallet', description: 'General purpose wallet' },
    { value: 'sports', label: 'Sports Betting', description: 'Ring-fenced for sports betting' },
    { value: 'casino', label: 'Casino', description: 'Ring-fenced for casino games' },
    { value: 'poker', label: 'Poker', description: 'Ring-fenced for poker' },
    { value: 'bonus', label: 'Bonus', description: 'Bonus funds wallet' },
  ]
  
  // Loading states for complex operations
  const [isFundingProvider, setIsFundingProvider] = useState(false)
  const [isFundingUser, setIsFundingUser] = useState(false)

  // Simple state for wallets - no React Query caching issues
  const [walletsList, setWalletsList] = useState<any[]>([])
  const [walletsLoading, setWalletsLoading] = useState(false)
  const [walletsVersion, setWalletsVersion] = useState(0) // Force re-render trigger
  
  // Real users from auth service
  const [systemUsers, setSystemUsers] = useState<any[]>([])
  const [gatewayUsers, setGatewayUsers] = useState<any[]>([])
  const [providerUsers, setProviderUsers] = useState<any[]>([])
  const [regularUsers, setRegularUsers] = useState<any[]>([])
  
  // Wallet balances state - now supports multi-currency (replaces ledger balances)
  const [providerWalletBalances, setProviderWalletBalances] = useState<Record<string, Record<string, number>>>({}) // userId -> currency -> balance
  const [systemHouseBalance, setSystemHouseBalance] = useState<number | null>(null)
  const [systemHouseBalancesByCurrency, setSystemHouseBalancesByCurrency] = useState<Record<string, number>>({})
  const [systemPrimaryCurrency, setSystemPrimaryCurrency] = useState<string>('EUR')
  const [systemBalanceFetched, setSystemBalanceFetched] = useState(false)
  const [walletBalancesLoading, setWalletBalancesLoading] = useState(false)
  
  // Base currency selection - controls which currency the system primarily works with
  const [baseCurrency, setBaseCurrency] = useState<string>('EUR')
  const [supportedCurrencies] = useState<string[]>(['EUR', 'USD', 'GBP', 'BTC', 'ETH']) // Add more as needed
  
  // Fetch users from auth service by role dynamically
  const fetchUsers = async (): Promise<{ system: any[]; gateway: any[]; providers: any[]; regular: any[] }> => {
    if (!authToken) {
      console.warn('[Users] No auth token available')
      return { system: [], gateway: [], providers: [], regular: [] }
    }
    
    try {
      // Fetch users by role using the new usersByRole query (from AUTH service)
      const [systemResult, gatewayResult, providerResult, allUsersResult] = await Promise.all([
        // System users: system role only
        graphqlWithAuth(GRAPHQL_SERVICE_URLS.auth, `
          query GetSystemUsers($first: Int) {
            usersByRole(role: "system", first: $first) {
              nodes {
                id
                email
                roles
                permissions
              }
            }
          }
        `, { first: 100 }, authToken, { operation: 'query', showResponse: false }).catch((err) => {
          return { usersByRole: { nodes: [] } }
        }),
        
        // Gateway users: payment-gateway role
        graphqlWithAuth(GRAPHQL_SERVICE_URLS.auth, `
          query GetGatewayUsers($first: Int) {
            usersByRole(role: "payment-gateway", first: $first) {
              nodes {
                id
                email
                roles
                permissions
              }
            }
          }
        `, { first: 100 }, authToken, { operation: 'query', showResponse: false }).catch((err) => {
          return { usersByRole: { nodes: [] } }
        }),
        
        // Provider users: payment-provider role
        graphqlWithAuth(GRAPHQL_SERVICE_URLS.auth, `
          query GetProviderUsers($first: Int) {
            usersByRole(role: "payment-provider", first: $first) {
              nodes {
                id
                email
                roles
                permissions
              }
            }
          }
        `, { first: 100 }, authToken, { operation: 'query', showResponse: false }).then((result) => {
          console.log('[Users] Provider users query result:', result);
          return result;
        }).catch((err) => {
          console.error('[Users] Provider users query error:', err);
          return { usersByRole: { nodes: [] } }
        }),
        
        // Also get system role users
        graphqlWithAuth(GRAPHQL_SERVICE_URLS.auth, `
          query GetSystemRoleUsers($first: Int) {
            usersByRole(role: "system", first: $first) {
              nodes {
                id
                email
                roles
                permissions
              }
            }
          }
        `, { first: 100 }, authToken, { operation: 'query', showResponse: false }).catch((err) => {
          return { usersByRole: { nodes: [] } }
        }),
      ])
      
      // Get all users - this works even if usersByRole fails
      const allUsersResult2 = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.auth, `
        query GetAllUsers($first: Int) {
          users(first: $first) {
            nodes {
              id
              email
              roles
              permissions
            }
          }
        }
      `, { first: 100 }, authToken, { operation: 'query', showResponse: false }).catch((err) => {
        return { users: { nodes: [] } }
      })
      
      const allUsersFallback = allUsersResult2?.users?.nodes || []
      
      // Check if usersByRole queries succeeded (they return empty nodes on error)
      const gatewayUsersCount = gatewayResult?.usersByRole?.nodes?.length || 0
      const providerUsersCount = providerResult?.usersByRole?.nodes?.length || 0
      const systemRoleUsersCount = allUsersResult?.usersByRole?.nodes?.length || 0
      
      // If all usersByRole queries returned empty AND we have users from GetAllUsers, use fallback
      const usersByRoleFailed = (gatewayUsersCount === 0 && 
                                  providerUsersCount === 0 && systemRoleUsersCount === 0 && allUsersFallback.length > 0)
      
      // If usersByRole queries failed OR if we have users but no role-based results, use fallback
      if (usersByRoleFailed) {
        console.warn('[Users] ⚠️ Using fallback: filtering allUsers by role (token may need refresh)')
        
        // Filter users by role from the allUsersFallback list using access-engine utilities
        // Note: 'admin' is now a business role, only 'system' has full access
        const systemRoleUsersFromAll = allUsersFallback.filter((u: any) => {
          return hasRole(u.roles, 'system');
        });
        const gatewayUsersFromAll = allUsersFallback.filter((u: any) => {
          return hasRole(u.roles, 'payment-gateway');
        });
        const providerUsersFromAll = allUsersFallback.filter((u: any) => {
          return hasRole(u.roles, 'payment-provider');
        });
        
        // System role users only
        const combinedSystem = [...systemRoleUsersFromAll]
          .filter((u, idx, arr) => arr.findIndex(v => v.id === u.id) === idx) // Remove duplicates
        
        setSystemUsers(combinedSystem)
        setGatewayUsers(gatewayUsersFromAll)
        setProviderUsers(providerUsersFromAll)
        
        const systemIds = new Set(combinedSystem.map((u: any) => u.id))
        const gatewayIds = new Set(gatewayUsersFromAll.map((u: any) => u.id))
        const providerIds = new Set(providerUsersFromAll.map((u: any) => u.id))
        
        const regular = allUsersFallback.filter((u: any) => 
          !systemIds.has(u.id) && 
          !gatewayIds.has(u.id) && 
          !providerIds.has(u.id)
        )
        
        setRegularUsers(regular)
        const userSummary = { 
          system: combinedSystem.length, 
          gateway: gatewayUsersFromAll.length, 
          providers: providerUsersFromAll.length, 
          regular: regular.length,
          systemIds: combinedSystem.map((u: any) => u.id),
          gatewayIds: gatewayUsersFromAll.map((u: any) => u.id),
          providerIds: providerUsersFromAll.map((u: any) => u.id)
        }
        console.log('[Users] ✅ Categorized (fallback):', userSummary)
        // Return users for immediate use
        return { system: combinedSystem, gateway: gatewayUsersFromAll, providers: providerUsersFromAll, regular }
      }
      
      // Normal flow: use results from usersByRole queries
      // Filter system users from allUsers (admin is now a business role, only system has full access)
      const allUsers = allUsersResult?.users?.nodes || []
      const systemRoleUsers = allUsers.filter((u: any) => {
        return hasRole(u.roles || [], 'system')
      })
      const system = [...systemRoleUsers]
        .filter((u, idx, arr) => arr.findIndex(v => v.id === u.id) === idx) // Remove duplicates
      
      const gateway = gatewayResult?.usersByRole?.nodes || []
      const providers = providerResult?.usersByRole?.nodes || []
      
      console.log('[Users] Normal flow results:', {
        systemUsers: system.length,
        systemRoleUsers: systemRoleUsers.length,
        gateway: gateway.length,
        providers: providers.length,
        providerDetails: providers.map((p: any) => ({ id: p.id, email: p.email, roles: p.roles })),
      });
      
      const systemIds = new Set(system.map((u: any) => u.id))
      const gatewayIds = new Set(gateway.map((u: any) => u.id))
      const providerIds = new Set(providers.map((u: any) => u.id))
      
      const regular = allUsers.filter((u: any) => 
        !systemIds.has(u.id) && 
        !gatewayIds.has(u.id) && 
        !providerIds.has(u.id)
      )
      
      setSystemUsers(system)
      setGatewayUsers(gateway)
      setProviderUsers(providers)
      setRegularUsers(regular)
      console.log('[Users] ✅ Categorized:', { system: system.length, gateway: gateway.length, providers: providers.length, regular: regular.length })
      
      // Return users for immediate use (avoiding state update race condition)
      return { system, gateway, providers, regular }
    } catch (err) {
      console.error('[Users] ❌ Error:', err)
      return { system: [], gateway: [], providers: [], regular: [] }
    }
  }
  
  // Fetch wallets function - returns the wallets directly
  const fetchWallets = async (): Promise<any[]> => {
    setWalletsLoading(true)
    try {
      // Fetch all wallets (logged by GraphQL utility)
      const walletsResult = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
        query ListWallets($first: Int) {
          wallets(first: $first) {
            nodes {
              id
              userId
              currency
              category
              balance
              bonusBalance
              lockedBalance
              status
            }
            totalCount
          }
        }
      `, { first: 100 }, authToken)
      
      const wallets = walletsResult?.wallets?.nodes || []
      return wallets
    } catch (err) {
      console.error('[Wallets] ❌ Error:', err)
      return []
    } finally {
      setWalletsLoading(false)
    }
  }
  
  // ✅ PERFORMANT: Fetch wallet balances for all users in ONE query
  // Uses bulkWalletBalances GraphQL query for optimal performance
  // Accepts users as parameters to avoid race condition with state updates
  const fetchProviderWalletBalances = async (usersToFetch?: { providers: any[], gateway: any[], system: any[], regular?: any[] }) => {
    if (!authToken || !user) return
    
    // Only fetch wallet balances if user is system
    const isSystem = checkIsSystem(user)
    if (!isSystem) {
      setWalletBalancesLoading(false)
      return
    }
    
    setWalletBalancesLoading(true)
    try {
      const balances: Record<string, Record<string, number>> = {} // userId -> currency -> balance
      
      // Use provided users or fall back to state (for backwards compatibility)
      const providers = usersToFetch?.providers || providerUsers
      const gateway = usersToFetch?.gateway || gatewayUsers
      const system = usersToFetch?.system || systemUsers
      const regular = usersToFetch?.regular || regularUsers
      
      // Collect all user IDs
      const allUsersToFetch = [...providers, ...gateway, ...system, ...regular]
      const userIds = allUsersToFetch.map(u => u.id)
      
      if (userIds.length === 0) {
        console.log('[Wallet] No users to fetch balances for')
        setProviderWalletBalances({})
        setWalletBalancesLoading(false)
        return
      }
      
      // ✅ SINGLE QUERY: Fetch all balances for all currencies in parallel
      const balancePromises = supportedCurrencies.map(async (currency) => {
        try {
          const result = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
            query BulkWalletBalances($userIds: [String!]!, $category: String, $currency: String!) {
              bulkWalletBalances(userIds: $userIds, category: $category, currency: $currency) {
                balances {
                  userId
                  walletId
                  balance
                  availableBalance
                  allowNegative
                }
              }
            }
          `, {
            userIds: userIds,
            category: 'main',
            currency: currency
          }, authToken)
          
          if (result?.bulkWalletBalances?.balances) {
            // Map balances by userId
            result.bulkWalletBalances.balances.forEach((balanceEntry: any) => {
              if (!balances[balanceEntry.userId]) {
                balances[balanceEntry.userId] = {}
              }
              balances[balanceEntry.userId][currency] = balanceEntry.balance || 0
            })
          }
        } catch (err: any) {
          // Silently skip authorization errors (user might not be system)
          const isAuthError = err?.message?.includes('Not authorized') || err?.message?.includes('authorized')
          if (!isAuthError) {
            console.error(`Failed to fetch bulk wallet balances for ${currency}:`, err)
          }
          // Set to 0 for all users if query fails
          userIds.forEach(userId => {
            if (!balances[userId]) {
              balances[userId] = {}
            }
            balances[userId][currency] = 0
          })
        }
      })
      
      // Wait for all currency queries to complete
      await Promise.all(balancePromises)
      
      setProviderWalletBalances(balances)
      
      // Log fetched wallet balances
      console.log('[Wallet] ✅ Fetched balances for', allUsersToFetch.length, 'users in bulk:', {
        providers: providers.length,
        gateway: gateway.length,
        system: system.length,
        regular: regular.length,
        balances: Object.keys(balances).length,
        currencies: supportedCurrencies.length
      })
      
      // System balance is calculated from gateway wallets (see balance calculation below)
    } catch (err) {
      // Silently handle errors - user might not have permission
      const isAuthError = (err as any)?.message?.includes('Not authorized') || (err as any)?.message?.includes('authorized')
      if (!isAuthError) {
        console.error('[Wallet] Failed to fetch provider balances:', err)
      }
    } finally {
      setWalletBalancesLoading(false)
    }
  }
  
  // Load wallets and update state
  const loadWallets = async () => {
    // First fetch users to identify roles
    const users = await fetchUsers() || { system: [], gateway: [], providers: [], regular: [] }
    
    // Then fetch wallets
    const wallets = await fetchWallets()
    console.log('[Wallets] Updating state with', wallets.length, 'wallets')
    
    // Create completely new array to break any references
    const newWallets = wallets.map(w => ({ ...w }))
    setWalletsList(newWallets)
    setWalletsVersion(v => {
      const newVersion = v + 1
      // Version updated (detailed logs in GraphQL utility)
      return newVersion
    })
    
    // Fetch wallet balances (after users are loaded) - pass users directly to avoid race condition
    // Include regular users (end users) so their balances are also fetched
    await fetchProviderWalletBalances({
      providers: users.providers,
      gateway: users.gateway,
      system: users.system,
      regular: users.regular
    })
    
    // Small delay to ensure state is flushed
    await new Promise(resolve => setTimeout(resolve, 100))
    // State update complete
    return wallets
  }
  
  // Initial fetch on mount
  useEffect(() => {
    loadWallets()
  }, [])
  
  // Categorize wallets from state using REAL user IDs
  const allWallets = walletsList
  
  // System wallets: wallets belonging to system users
  const systemUserIds = new Set(systemUsers.map(u => u.id))
  const systemWallets = allWallets.filter((w: any) => systemUserIds.has(w.userId))
  const systemWallet = systemWallets.find((w: any) => w.userId === user?.id) || systemWallets[0]
  
  // Provider wallets: wallets belonging to payment-provider users
  const providerUserIds = new Set(providerUsers.map(u => u.id))
  const providerWallets = allWallets.filter((w: any) => providerUserIds.has(w.userId))
  
  // Gateway wallets: wallets belonging to payment-gateway users
  const gatewayUserIds = new Set(gatewayUsers.map(u => u.id))
  const gatewayWallets = allWallets.filter((w: any) => gatewayUserIds.has(w.userId))
  
  // Regular user wallets: exclude system, provider, and gateway wallets
  const excludedUserIds = new Set([...systemUserIds, ...providerUserIds, ...gatewayUserIds])
  const userWallets = allWallets.filter((w: any) => {
    const isExcluded = excludedUserIds.has(w.userId)
    if (isExcluded && (w.balance || 0) < 0) {
      // Log if we find a negative wallet that should be excluded (system/gateway/provider)
      console.warn(`[Wallet Categorization] ⚠️ Wallet ${w.id} (userId: ${w.userId}) has negative balance €${((w.balance || 0) / 100).toFixed(2)} but is being excluded from userWallets (correct behavior)`)
    }
    return !isExcluded
  })
  
  // Log wallet counts and details
  const walletSummary = {
    total: allWallets.length,
    system: systemWallets.length,
    gateway: gatewayWallets.length,
    providers: providerWallets.length,
    users: userWallets.length,
    systemUserIds: Array.from(systemUserIds),
    gatewayUserIds: Array.from(gatewayUserIds),
    providerUserIds: Array.from(providerUserIds),
    systemWallets: systemWallets.map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency })),
    gatewayWallets: gatewayWallets.map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency })),
    providerWallets: providerWallets.map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency }))
  }
  console.log('[Wallets] Counts:', walletSummary)
  
  // Helper to refetch wallets data
  const refetchWallets = loadWallets

  // Create wallet mutation
  const createWalletMutation = useMutation({
    mutationFn: async (input: { userId: string; currency: string; category?: string; tenantId?: string }) => {
      return graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
        mutation CreateWallet($input: CreateWalletInput!) {
          createWallet(input: $input) {
            success
            wallet {
              id
              userId
              currency
              category
              balance
              status
            }
            errors
          }
        }
      `, { input }, authToken)
    },
    onSuccess: () => {
      // Refetch wallets after creation
      refetchWallets()
    },
  })

  // Fund wallet mutation (wallet transaction) - system only
  const fundWalletMutation = useMutation({
    mutationFn: async (input: { walletId: string; userId: string; type: string; amount: number; currency: string; description?: string }) => {
      // Check if user is system before attempting to create wallet transaction
      const isSystem = checkIsSystem(user)
      if (!isSystem) {
        throw new Error('Only system users can fund wallets')
      }
      
      // Creating wallet transaction (logged by GraphQL utility)
      try {
        const result = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
          mutation FundWallet($input: CreateWalletTransactionInput!) {
            createWalletTransaction(input: $input) {
              success
              walletTransaction {
                id
                walletId
                userId
                type
                amount
                currency
                balance
              }
              errors
            }
          }
        `, { 
          input: { 
            ...input, 
            balanceType: 'real',
            description: input.description || 'Wallet funding'
          } 
        }, authToken)
        console.log('[Fund] Transaction result:', result)
        
        if (result?.createWalletTransaction?.errors && result.createWalletTransaction.errors.length > 0) {
          throw new Error(result.createWalletTransaction.errors.join(', '))
        }
        
        return result
      } catch (err: any) {
        console.error('[Fund] Error:', err)
        // Handle authorization errors gracefully
        const isAuthError = err?.message?.includes('Not authorized') || err?.message?.includes('authorized')
        if (isAuthError) {
          throw new Error('You do not have permission to perform this action. System access required.')
        }
        throw err
      }
    },
  })

  // Create deposit (through payment gateway)
  const createDepositMutation = useMutation({
    mutationFn: async (input: { userId: string; amount: number; currency: string; method?: string; tenantId?: string; fromUserId?: string }) => {
      console.log('[Deposit] Creating deposit:', input)
      try {
        // Use provider user ID as fromUserId if not provided
        const fromUserId = input.fromUserId || providerUsers[0]?.id
        if (!fromUserId) {
          throw new Error('No payment provider available. Please run payment-setup.ts first.')
        }
        
        const result = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
          mutation CreateDeposit($input: CreateDepositInput!) {
            createDeposit(input: $input) {
              success
              deposit {
                id
                userId
                type
                status
                amount
                currency
              }
              transfer {
                id
                status
              }
              errors
            }
          }
        `, { 
          input: {
            ...input,
            fromUserId: fromUserId,
            tenantId: input.tenantId || 'default-tenant'
          }
        }, authToken)
        console.log('[Deposit] Result:', result)
        
        if (result?.createDeposit?.errors && result.createDeposit.errors.length > 0) {
          throw new Error(result.createDeposit.errors.join(', '))
        }
        
        return result
      } catch (error: any) {
        // Check if error is related to wallet/balance
        const errorMsg = error.message || String(error)
        if (errorMsg.includes('Insufficient') || errorMsg.includes('balance') || errorMsg.includes('wallet')) {
          throw new Error(`Wallet Error: ${errorMsg}. Please check provider account balance.`)
        }
        throw error
      }
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      
      // Auto-approve deposit to complete the flow (like in tests)
      const transferId = result?.createDeposit?.transfer?.id
      if (transferId) {
        try {
          // Wait a moment for transfer to be created
          await new Promise(resolve => setTimeout(resolve, 500))
          
          // Approve the transfer to complete the deposit flow
          await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
            mutation ApproveTransfer($transferId: String!) {
              approveTransfer(transferId: $transferId) {
                success
                transfer {
                  id
                  status
                }
              }
            }
          `, { transferId }, authToken)
          
          console.log('[Deposit] Transfer approved successfully')
        } catch (approveError: any) {
          console.warn('[Deposit] Auto-approval failed (may need manual approval):', approveError)
          // Don't fail the deposit creation - user can approve manually
        }
      }
      
      // Wait for sync to complete
      await new Promise(resolve => setTimeout(resolve, 1000))
      refetchWallets()
      fetchProviderWalletBalances() // Refresh wallet balances
    },
    onError: (error: any) => {
      console.error('[Deposit] Error:', error)
      const errorMsg = error.message || 'Unknown error'
      alert(`Deposit failed: ${errorMsg}`)
    },
  })

  // Create withdrawal
  const createWithdrawalMutation = useMutation({
    mutationFn: async (input: { userId: string; amount: number; currency: string; method: string; tenantId?: string; bankAccount?: string; walletAddress?: string }) => {
      console.log('[Withdrawal] Creating withdrawal:', input)
      try {
        const result = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
          mutation CreateWithdrawal($input: CreateWithdrawalInput!) {
            createWithdrawal(input: $input) {
              success
              withdrawal {
                id
                userId
                type
                status
                amount
                currency
              }
              transfer {
                id
                status
              }
              errors
            }
          }
        `, { 
          input: {
            ...input,
            tenantId: input.tenantId || 'default-tenant'
          }
        }, authToken)
        console.log('[Withdrawal] Result:', result)
        
        if (result?.createWithdrawal?.errors && result.createWithdrawal.errors.length > 0) {
          throw new Error(result.createWithdrawal.errors.join(', '))
        }
        
        return result
      } catch (error: any) {
        // Check if error is related to ledger
        const errorMsg = error.message || String(error)
        if (errorMsg.includes('ledger') || errorMsg.includes('Insufficient') || errorMsg.includes('balance')) {
          throw new Error(`Ledger Error: ${errorMsg}. Please check user account balance in ledger.`)
        }
        throw error
      }
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] })
      
      // Auto-approve withdrawal to complete the flow (like in tests)
      const transferId = result?.createWithdrawal?.transfer?.id
      if (transferId) {
        try {
          // Wait a moment for transfer to be created
          await new Promise(resolve => setTimeout(resolve, 500))
          
          // Approve the transfer to complete the withdrawal flow
          await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
            mutation ApproveTransfer($transferId: String!) {
              approveTransfer(transferId: $transferId) {
                success
                transfer {
                  id
                  status
                }
              }
            }
          `, { transferId }, authToken)
          
          console.log('[Withdrawal] Transfer approved successfully')
        } catch (approveError: any) {
          console.warn('[Withdrawal] Auto-approval failed (may need manual approval):', approveError)
          // Don't fail the withdrawal creation - user can approve manually
        }
      }
      
      // Wait for sync to complete
      await new Promise(resolve => setTimeout(resolve, 1000))
      refetchWallets()
      fetchProviderWalletBalances() // Refresh wallet balances
    },
    onError: (error: any) => {
      console.error('[Withdrawal] Error:', error)
      const errorMsg = error.message || 'Unknown error'
      alert(`Withdrawal failed: ${errorMsg}`)
    },
  })

  // Initialize system wallet if needed
  // System wallet is for the logged-in user who has system role
  const initializeSystem = async () => {
    if (!systemWallet) {
      // User object has 'id' field, not 'userId'
      if (!user?.id) {
        alert('User not logged in. Please login first.')
        return
      }
      
      if (!checkIsSystem(user)) {
        alert('You need system role to initialize system wallet.')
        return
      }
      
      try {
        console.log('[InitializeSystem] Creating wallet for user:', user.id)
        // Use USD as default (can be changed if needed)
        const result = await createWalletMutation.mutateAsync({ 
          userId: user.id, // Use actual user ID (user has system role) - user object has 'id' field
          currency: 'USD', // Use USD as default for system wallet
          category: 'main',
          tenantId: 'default-tenant'
        })
        
        console.log('[InitializeSystem] Result:', result)
        
        if (result?.createWallet?.success) {
          // Wait a moment for wallet to be created
          await new Promise(resolve => setTimeout(resolve, 500))
          await refetchWallets()
          alert('System wallet initialized successfully!')
        } else {
          const errors = result?.createWallet?.errors || ['Unknown error']
          alert(`Failed to initialize system wallet: ${errors.join(', ')}`)
        }
      } catch (error: any) {
        console.error('[initializeSystem] Error:', error)
        alert(`Failed to initialize system wallet: ${error?.message || 'Unknown error'}`)
      }
    } else {
      alert('System wallet already exists!')
    }
  }

  // Initialize provider wallet and return the wallet id
  const initializeProvider = async (providerId: string): Promise<string | null> => {
    const exists = providerWallets.find((w: any) => w.userId === providerId)
    if (exists) {
      return exists.id
    }

    try {
      const result = await createWalletMutation.mutateAsync({ 
        userId: providerId, 
        currency: 'EUR', 
        category: 'main',
        tenantId: 'default-tenant'
      })
      // The result contains the created wallet
      const walletData = result?.createWallet?.wallet

      // Always refetch to update UI
      const refreshedWallets = await refetchWallets() // Now returns array directly

      if (walletData?.id) {
        return walletData.id
      }

      // Find the wallet from refetch result
      const newWallet = refreshedWallets.find((w: any) => w.userId === providerId)
      return newWallet?.id || null
    } catch (err) {
      console.error('Failed to create provider wallet:', err)
      return null
    }
  }

  // System funds provider - uses payment-gateway user as source
  const handleSystemFundProvider = async () => {
    console.log('[FundProvider] Starting...')
    setIsFundingProvider(true)

    try {
      // Get gateway user ID (payment-gateway@system.com) - this is the system funding source
      const gatewayUser = gatewayUsers[0]
      if (!gatewayUser) {
        alert('Payment gateway user not found. Please run payment-setup.ts first.')
        setIsFundingProvider(false)
        return
      }
      
      if (!systemFundForm.provider) {
        alert('Please select a provider to fund.')
        setIsFundingProvider(false)
        return
      }

      let walletId: string | null = null

      // Check if provider wallet exists (must match both userId and currency)
      console.log('[FundProvider] Looking for provider wallet:', systemFundForm.provider, systemFundForm.currency)
      console.log('[FundProvider] Current provider wallets:', providerWallets)
      const existingWallet = providerWallets.find(
        (w: any) => w.userId === systemFundForm.provider && w.currency === systemFundForm.currency
      )

      if (existingWallet) {
        console.log('[FundProvider] Found existing wallet:', existingWallet)
        walletId = existingWallet.id
      } else {
        console.log('[FundProvider] Creating new provider wallet...')
        // Create the provider wallet first and get the ID from response
        const createResult = await createWalletMutation.mutateAsync({
          userId: systemFundForm.provider,
          currency: systemFundForm.currency, // Use selected currency, not hardcoded EUR
          category: 'main',
          tenantId: 'default-tenant'
        })
        console.log('[FundProvider] Create result:', createResult)

        // Try to get wallet ID from response
        const created = createResult?.createWallet?.wallet
        if (created?.id) {
          walletId = created.id
        } else {
          // Refetch to find the new wallet
          console.log('[FundProvider] Refetching to find new wallet...')
          const refreshedWallets = await refetchWallets() // Now returns array directly
          const newWallet = refreshedWallets.find(
            (w: any) => w.userId === systemFundForm.provider && w.currency === systemFundForm.currency
          )
          walletId = newWallet?.id
          console.log('[FundProvider] Found wallet after refetch:', newWallet)
        }
      }

      if (!walletId) {
        alert('Could not create or find provider wallet. Please try again.')
        return
      }

      console.log('[FundProvider] Funding wallet:', walletId)
      
      // Get gateway user wallet (source)
      const gatewayWallet = gatewayWallets.find((w: any) => w.currency === systemFundForm.currency)
      if (!gatewayWallet) {
        alert(`Gateway wallet not found for currency ${systemFundForm.currency}. Please create it first.`)
        setIsFundingProvider(false)
        return
      }
      
      // Use createWalletTransaction with transfer_out/transfer_in for user-to-user transfer
      // This matches the real flow: payment-gateway → payment-provider
      const amount = parseFloat(systemFundForm.amount) * 100
      const providerUser = providerUsers.find(u => u.id === systemFundForm.provider)
      const providerName = providerUser?.email?.split('@')[0] || systemFundForm.provider.substring(0, 8)
      
      // Create transfer_out from gateway
      const transferOutResult = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
        mutation CreateTransferOut($input: CreateWalletTransactionInput!) {
          createWalletTransaction(input: $input) {
            success
            walletTransaction {
              id
              walletId
              userId
              type
              amount
              currency
              balance
            }
            errors
          }
        }
      `, {
        input: {
          walletId: gatewayWallet.id,
          userId: gatewayUser.id,
          type: 'transfer_out',
          balanceType: 'real',
          amount: amount,
          currency: systemFundForm.currency,
          description: `Transfer to ${providerName}`,
          refId: systemFundForm.provider,
          refType: 'user_transfer',
        }
      }, authToken)
      
      if (!transferOutResult?.createWalletTransaction?.success) {
        throw new Error(transferOutResult?.createWalletTransaction?.errors?.join(', ') || 'Failed to create transfer_out')
      }
      
      // Create transfer_in to provider
      const transferInResult = await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
        mutation CreateTransferIn($input: CreateWalletTransactionInput!) {
          createWalletTransaction(input: $input) {
            success
            walletTransaction {
              id
              walletId
              userId
              type
              amount
              currency
              balance
            }
            errors
          }
        }
      `, {
        input: {
          walletId: walletId,
          userId: systemFundForm.provider,
          type: 'transfer_in',
          balanceType: 'real',
          amount: amount,
          currency: systemFundForm.currency,
          description: `Transfer from ${gatewayUser.email?.split('@')[0] || 'gateway'}`,
          refId: gatewayUser.id,
          refType: 'user_transfer',
        }
      }, authToken)
      
      if (!transferInResult?.createWalletTransaction?.success) {
        throw new Error(transferInResult?.createWalletTransaction?.errors?.join(', ') || 'Failed to create transfer_in')
      }
      
      const fundResult = { createWalletTransaction: { success: true } }
      console.log('[FundProvider] Fund result:', fundResult)
      
      if (!fundResult?.createWalletTransaction?.success) {
        const errors = (fundResult?.createWalletTransaction as any)?.errors
        throw new Error(Array.isArray(errors) ? errors.join(', ') : 'Failed to fund provider')
      }

      // Wait for wallet update to complete (provider funding updates wallets atomically)
      console.log('[FundProvider] Waiting for wallet update...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Refetch to update UI with new balance
      console.log('[FundProvider] Refetching wallets to update UI...')
      const updatedWallets = await refetchWallets() // Now returns array directly
      console.log('[FundProvider] Updated wallets:', updatedWallets)
      const updatedProvider = updatedWallets.find((w: any) => w.userId === systemFundForm.provider && w.currency === systemFundForm.currency)
      console.log('[FundProvider] Updated provider balance:', updatedProvider?.balance)
      
      // Refresh ledger balances
      await fetchProviderWalletBalances()
      
      console.log('[FundProvider] Done!')
      const balanceDisplay = updatedProvider?.balance !== undefined 
        ? formatCurrency(updatedProvider.balance, systemFundForm.currency)
        : 'checking...'
      alert(`Provider funded successfully! New balance: ${balanceDisplay}`)
    } catch (err: any) {
      console.error('[FundProvider] Error:', err)
      const errorMessage = err?.message || 'Failed to fund provider'
      alert(errorMessage)
    } finally {
      setIsFundingProvider(false)
    }
  }

  // Provider funds user (deposit completion)
  const handleProviderFundUser = async () => {
    setIsFundingUser(true)
    
    try {
      const userWallet = userWallets.find((w: any) => w.userId === providerToUserForm.userId && w.currency === providerToUserForm.currency)
      if (!userWallet) {
        alert('User wallet not found. Create user wallet first.')
        return
      }
      
      const result = await fundWalletMutation.mutateAsync({
        walletId: userWallet.id,
        userId: providerToUserForm.provider, // Provider ID
        type: 'deposit',
        amount: parseFloat(providerToUserForm.amount) * 100,
        currency: providerToUserForm.currency,
        description: `Deposit via ${providerUsers.find(p => p.id === providerToUserForm.provider)?.email?.split('@')[0] || 'provider'}`,
      })
      
      if (!result?.createWalletTransaction?.success) {
        throw new Error(result?.createWalletTransaction?.errors?.join(', ') || 'Failed to fund user')
      }
      
      // Wait for wallet update
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // Refetch to update UI with new balance
      await refetchWallets()
      // Refresh ledger balances
      await fetchProviderWalletBalances()
      
      alert('User wallet credited successfully!')
    } catch (err: any) {
      console.error('Error funding user:', err)
      const errorMsg = err.message || 'Unknown error'
      if (errorMsg.includes('Insufficient') || errorMsg.includes('balance') || errorMsg.includes('wallet')) {
        alert(`Wallet Error: ${errorMsg}. Please check provider account balance.`)
      } else {
        alert(`Failed to credit user: ${errorMsg}`)
      }
    } finally {
      setIsFundingUser(false)
    }
  }

  // User deposit request
  const handleUserDeposit = async () => {
    try {
      const result = await createDepositMutation.mutateAsync({
        userId: userDepositForm.userId,
        amount: parseFloat(userDepositForm.amount) * 100,
        currency: userDepositForm.currency,
        method: 'card',
      })
      
      if (result?.createDeposit?.success) {
        alert('Deposit created and approved successfully! Balance will update shortly.')
        // Wait for sync and refresh
        setTimeout(() => {
          refetchWallets()
        }, 1500)
      } else {
        alert('Deposit created but may need approval. Check transactions tab.')
      }
    } catch (error: any) {
      console.error('[handleUserDeposit] Error:', error)
      alert(`Deposit failed: ${error?.message || 'Unknown error'}`)
    }
  }

  // User withdrawal request
  const handleUserWithdraw = async () => {
    try {
      const result = await createWithdrawalMutation.mutateAsync({
        userId: userWithdrawForm.userId,
        amount: parseFloat(userWithdrawForm.amount) * 100,
        currency: userWithdrawForm.currency,
        method: 'bank_transfer',
        bankAccount: userWithdrawForm.bankAccount,
      })
      
      if (result?.createWithdrawal?.success) {
        alert('Withdrawal created and approved successfully! Balance will update shortly.')
        // Wait for sync and refresh
        setTimeout(() => {
          refetchWallets()
        }, 1500)
      } else {
        alert('Withdrawal created but may need approval. Check transactions tab.')
      }
    } catch (error: any) {
      console.error('[handleUserWithdraw] Error:', error)
      alert(`Withdrawal failed: ${error?.message || 'Unknown error'}`)
    }
  }

  // Create user wallet
  const handleCreateUserWallet = async () => {
    try {
      const result = await createWalletMutation.mutateAsync({
        userId: newUserForm.userId,
        currency: newUserForm.currency,
        category: newUserForm.category || 'main',
        tenantId: 'default-tenant',
      })
      
      if (result?.createWallet?.success) {
        setNewUserForm({ userId: '', currency: baseCurrency || 'EUR', category: 'main' })
        // Refetch to show new wallet
        await refetchWallets()
        alert('Wallet created successfully!')
      } else {
        alert(`Wallet creation failed: ${result?.createWallet?.errors?.join(', ') || 'Unknown error'}`)
      }
    } catch (error: any) {
      console.error('[handleCreateUserWallet] Error:', error)
      alert(`Failed to create wallet: ${error?.message || 'Unknown error'}`)
    }
  }

  // Calculate totals using REAL data
  // System Reserve = Gateway user balance + System user balances
  // The gateway user funds providers, and system users represent the platform reserve
  const gatewayWalletsInBaseCurrency = gatewayWallets.filter((w: any) => w.currency === baseCurrency)
  const systemWalletsInBaseCurrency = systemWallets.filter((w: any) => w.currency === baseCurrency)
  
  // Calculate wallet balances
  const gatewayBalanceFromWallets = gatewayWalletsInBaseCurrency.reduce((sum: number, w: any) => sum + (w.balance || 0), 0)
  const systemUsersBalanceFromWallets = systemWalletsInBaseCurrency.reduce((sum: number, w: any) => sum + (w.balance || 0), 0)
  
  // Try to get wallet balances for gateway and system users (source of truth)
  const gatewayUser = gatewayUsers[0]
  const gatewayWalletBalance = gatewayUser ? (providerWalletBalances[gatewayUser.id]?.[baseCurrency] || null) : null
  
  // Calculate system user wallet balances (excluding gateway user)
  // System users are users with 'system' role (not payment-gateway role)
  const systemUsersWalletBalance = systemUsers.reduce((sum: number, user: any) => {
    const walletBalances = providerWalletBalances[user.id] || {}
    const balance = walletBalances[baseCurrency] || 0
    return sum + balance
  }, 0)
  
  // ✅ ALWAYS use wallet balances (source of truth)
  // Wallets are updated atomically via createTransferWithTransactions - no sync needed
  // System user (system@demo.com with system role) can go negative, representing platform net position
  const gatewayBalance = gatewayWalletBalance !== null && gatewayWalletBalance !== undefined
    ? gatewayWalletBalance
    : gatewayBalanceFromWallets
  
  const systemUsersBalance = systemUsersWalletBalance !== null && systemUsersWalletBalance !== undefined && systemUsersWalletBalance !== 0
    ? systemUsersWalletBalance
    : systemUsersBalanceFromWallets
  
  // System balance = system@demo.com balance (system role, can be negative, represents platform net position)
  const systemBalance = gatewayBalance + systemUsersBalance
  
  // Log balance source for debugging
  console.log('[Balances] Balance sources:', {
    gateway: {
      wallet: gatewayBalanceFromWallets,
      walletBalance: gatewayWalletBalance,
      final: gatewayBalance
    },
    system: {
      wallet: systemUsersBalanceFromWallets,
      walletBalance: systemUsersWalletBalance,
      final: systemUsersBalance
    },
    systemTotal: systemBalance
  })
  
  // Calculate provider total balance from wallets (real balances)
  // Providers receive funds from gateway, so their balance should be positive
  const providerTotalBalance = providerWallets
    .filter((w: any) => w.currency === baseCurrency)
    .reduce((sum: number, w: any) => sum + (w.balance || 0), 0)
  
  // Calculate provider balance from bulk query - ONLY include provider users (not system/gateway/regular)
  // Note: providerUserIds is already declared above in wallet categorization section
  const providerTotalBalanceFromWallet = providerUsers.reduce((total: number, providerUser: any) => {
    const providerBalances = providerWalletBalances[providerUser.id] || {}
    const baseCurrencyBalance = providerBalances[baseCurrency] || 0
    return total + baseCurrencyBalance
  }, 0)
  
  // ✅ ALWAYS use wallet balances for providers (source of truth)
  // Provider users cannot go negative, so their balances should be positive or zero
  const finalProviderBalance = providerTotalBalanceFromWallet !== 0
    ? providerTotalBalanceFromWallet
    : providerTotalBalance
  
  // ✅ Calculate end user balances from wallets (source of truth)
  // Note: End users should not go negative (only system can), but we display actual balances
  const userWalletBalances = regularUsers.reduce((sum: number, user: any) => {
    const walletBalances = providerWalletBalances[user.id] || {}
    const balance = walletBalances[baseCurrency] || 0
    // Log warning if we find negative balances for end users (shouldn't happen)
    if (balance < 0) {
      console.warn(`[Balance Check] ⚠️ End user ${user.id} (email: ${user.email || 'N/A'}, roles: ${JSON.stringify(user.roles || [])}) has negative balance: €${(balance / 100).toFixed(2)} - this should not happen!`)
      console.warn(`[Balance Check] ⚠️ This user is categorized as regular. Check if they should be system/gateway instead.`)
    }
    return sum + balance
  }, 0)
  
  // Debug: Log all users and their balances to identify mismatches
  console.log('[Balance Check] 🔍 User categorization breakdown:', {
    systemUsers: systemUsers.map(u => ({ id: u.id, email: u.email, roles: u.roles })),
    gatewayUsers: gatewayUsers.map(u => ({ id: u.id, email: u.email, roles: u.roles })),
    providerUsers: providerUsers.map(u => ({ id: u.id, email: u.email, roles: u.roles })),
    regularUsers: regularUsers.map(u => ({ id: u.id, email: u.email, roles: u.roles })),
    allBalances: Object.keys(providerWalletBalances).map(userId => {
      const balances = providerWalletBalances[userId]
      const baseBalance = balances[baseCurrency] || 0
      const user = [...systemUsers, ...gatewayUsers, ...providerUsers, ...regularUsers].find(u => u.id === userId)
      return {
        userId,
        email: user?.email || 'UNKNOWN',
        roles: user?.roles || [],
        category: user 
          ? (systemUsers.includes(user) ? 'system' : gatewayUsers.includes(user) ? 'gateway' : providerUsers.includes(user) ? 'provider' : 'regular')
          : 'UNCATEGORIZED',
        balance: baseBalance
      }
    })
  })
  
  // Use wallet balance if available, otherwise fall back to wallet collection
  const userWalletsBalance = userWallets
    .filter((w: any) => w.currency === baseCurrency)
    .reduce((sum: number, w: any) => {
      const balance = w.balance || 0
      // Log warning for negative end user wallet balances (shouldn't happen)
      if (balance < 0) {
        console.warn(`[Balance Check] ⚠️ End user wallet ${w.id} (userId: ${w.userId}) has negative balance: €${(balance / 100).toFixed(2)}, allowNegative: ${w.allowNegative} - this should not happen!`)
      }
      return sum + balance
    }, 0)
  
  const userTotalBalance = userWalletBalances !== 0
    ? userWalletBalances
    : userWalletsBalance
  
  // Check for negative end user wallets (should never happen - only system can go negative)
  const negativeEndUserWallets = userWallets
    .filter((w: any) => w.currency === baseCurrency && (w.balance || 0) < 0)
    .map((w: any) => {
      // Find the user this wallet belongs to
      const walletUser = [...systemUsers, ...gatewayUsers, ...providerUsers, ...regularUsers].find(u => u.id === w.userId)
      return {
        id: w.id, 
        userId: w.userId,
        userEmail: walletUser?.email || 'UNKNOWN',
        userRoles: walletUser?.roles || [],
        userCategory: walletUser 
          ? (systemUsers.includes(walletUser) ? 'system' : gatewayUsers.includes(walletUser) ? 'gateway' : providerUsers.includes(walletUser) ? 'provider' : 'regular')
          : 'UNCATEGORIZED',
        balance: w.balance, 
        allowNegative: w.allowNegative,
        currency: w.currency 
      }
    })
  
  if (negativeEndUserWallets.length > 0) {
    console.error('[Balance Check] ❌ Found negative balances for end users (should not happen - only system can go negative):', negativeEndUserWallets)
    console.error('[Balance Check] ⚠️ If any of these wallets belong to system users, they are being incorrectly categorized as regular users!')
    console.error('[Balance Check] These wallets should have allowNegative=false for regular users. Check wallet creation and transfer validation.')
    
    // Check if any negative wallets actually belong to system users
    const misCategorizedWallets = negativeEndUserWallets.filter(w => 
      w.userCategory === 'system' || w.userCategory === 'gateway' || w.userCategory === 'UNCATEGORIZED'
    )
    if (misCategorizedWallets.length > 0) {
      console.error('[Balance Check] 🚨 MISMATCH DETECTED: Some negative wallets belong to system/gateway users but are in userWallets:', misCategorizedWallets)
      console.error('[Balance Check] This explains why end users show negative balance - these should be in system balance!')
    }
  }
  
  // Log balances summary with detailed breakdown
  const balanceSummary = {
    system: systemBalance,
    gateway: gatewayBalance,
    systemUsers: systemUsersBalance,
    provider: finalProviderBalance,
    users: userTotalBalance, // Actual balance (may be negative if validation failed)
    baseCurrency,
    total: systemBalance + finalProviderBalance + userTotalBalance,
    gatewayWallets: gatewayWalletsInBaseCurrency.map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency, id: w.id })),
    systemWallets: systemWalletsInBaseCurrency.map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency, id: w.id })),
    providerWallets: providerWallets.filter((w: any) => w.currency === baseCurrency).map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency, id: w.id })),
    userWallets: userWallets.filter((w: any) => w.currency === baseCurrency).slice(0, 5).map(w => ({ userId: w.userId, balance: w.balance, currency: w.currency, id: w.id })),
    negativeEndUserWalletsCount: negativeEndUserWallets.length,
    regularUsersCount: regularUsers.length
  }
  console.log('[Balances] Summary:', balanceSummary)
  if (negativeEndUserWallets.length > 0) {
    console.log('[Balances] ⚠️ Negative end user wallets (investigation needed):', negativeEndUserWallets)
  }
  console.log('[Balances] Gateway wallet details:', JSON.stringify(gatewayWalletsInBaseCurrency, null, 2))
  console.log('[Balances] System wallet details:', JSON.stringify(systemWalletsInBaseCurrency, null, 2))
  
  // Force re-render key
  const renderKey = `wallets-${walletsVersion}-${allWallets.length}-${providerWallets.reduce((sum, w) => sum + (w.balance || 0), 0)}`
  
  // Show warning if no users found
  const noUsersFound = gatewayUsers.length === 0 && providerUsers.length === 0 && regularUsers.length === 0
  
  return (
    <div key={renderKey}>
      {/* Header with refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {noUsersFound && (
          <div style={{ 
            padding: '8px 12px', 
            background: 'var(--accent-yellow)', 
            color: 'var(--text-primary)', 
            borderRadius: 6,
            fontSize: 12
          }}>
            ⚠️ No users found. Run payment-setup.ts to create users.
          </div>
        )}
        <button 
          className="btn btn-secondary btn-sm"
          onClick={() => refetchWallets()}
          disabled={walletsLoading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
        >
          <RefreshCw 
            size={14} 
            style={walletsLoading ? { animation: 'spin 1s linear infinite' } : undefined} 
          />
          {walletsLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      
      {/* Flow Diagram */}
      <div className="card" style={{ marginBottom: 24, background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)' }}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>Payment Flow Architecture</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            {/* System */}
            <div 
              style={{ 
                padding: '16px 24px', 
                background: activeSection === 'system' ? 'var(--accent-cyan)' : 'var(--bg-card)', 
                borderRadius: 12,
                cursor: 'pointer',
                border: '2px solid var(--accent-cyan)',
                minWidth: 140,
              }}
              onClick={() => setActiveSection('system')}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>🏛️</div>
              <div style={{ fontWeight: 600, color: activeSection === 'system' ? 'white' : 'var(--text-primary)' }}>System</div>
              <div style={{ fontSize: 12, color: activeSection === 'system' ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>Platform Reserve</div>
              <div style={{ 
                fontSize: 16, 
                fontWeight: 700, 
                marginTop: 8, 
                fontFamily: 'var(--font-mono)', 
                color: systemBalance < 0 
                  ? (activeSection === 'system' ? '#ff6b6b' : '#ff6b6b')
                  : (activeSection === 'system' ? 'white' : 'var(--accent-cyan)')
              }}>
                {formatCurrency(systemBalance, baseCurrency)}
              </div>
              {/* Show gateway user info */}
              {gatewayUsers.length > 0 && (
                <div style={{ 
                  fontSize: 10, 
                  marginTop: 4, 
                  color: activeSection === 'system' ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
                  lineHeight: 1.4
                }}>
                  {gatewayUsers.map(gatewayUser => {
                    const gatewayWallet = gatewayWallets.find((w: any) => w.userId === gatewayUser.id && w.currency === baseCurrency)
                    const balance = gatewayWallet?.balance || 0
                    return (
                      <div key={gatewayUser.id} style={{ 
                        opacity: balance === 0 ? 0.5 : 1,
                        fontWeight: 400
                      }}>
                        {gatewayUser.email?.split('@')[0] || gatewayUser.id.substring(0, 8)}: {formatCurrency(balance, baseCurrency)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 24 }}>→</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>funds</div>
            </div>

            {/* Providers */}
            <div 
              style={{ 
                padding: '16px 24px', 
                background: activeSection === 'provider' ? 'var(--accent-purple)' : 'var(--bg-card)', 
                borderRadius: 12,
                cursor: 'pointer',
                border: '2px solid var(--accent-purple)',
                minWidth: 140,
              }}
              onClick={() => setActiveSection('provider')}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>💳</div>
              <div style={{ fontWeight: 600, color: activeSection === 'provider' ? 'white' : 'var(--text-primary)' }}>Providers</div>
              <div style={{ fontSize: 12, color: activeSection === 'provider' ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>
                {providerUsers.length > 0 ? providerUsers.map(u => u.email?.split('@')[0] || u.id.substring(0, 8)).join(', ') : 'No providers'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, fontFamily: 'var(--font-mono)', color: activeSection === 'provider' ? 'white' : 'var(--accent-purple)' }}>
                {formatCurrency(finalProviderBalance, baseCurrency)}
              </div>
            </div>

            {/* Arrow */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 24 }}>↔</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>process</div>
            </div>

            {/* Users */}
            <div 
              style={{ 
                padding: '16px 24px', 
                background: activeSection === 'user' ? 'var(--accent-green)' : 'var(--bg-card)', 
                borderRadius: 12,
                cursor: 'pointer',
                border: '2px solid var(--accent-green)',
                minWidth: 140,
              }}
              onClick={() => setActiveSection('user')}
            >
              <div style={{ fontSize: 24, marginBottom: 4 }}>👥</div>
              <div style={{ fontWeight: 600, color: activeSection === 'user' ? 'white' : 'var(--text-primary)' }}>End Users</div>
              <div style={{ fontSize: 12, color: activeSection === 'user' ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>{userWallets.length} wallets</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, fontFamily: 'var(--font-mono)', color: activeSection === 'user' ? 'white' : 'var(--accent-green)' }}>
                {formatCurrency(userTotalBalance, baseCurrency)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SYSTEM SECTION */}
      {activeSection === 'system' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 className="card-title">
                <span style={{ marginRight: 8 }}>🏛️</span>
                Step 1: System Funds Payment Providers
              </h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
              The platform system account funds payment providers with liquidity. This is the first step in the payment flow.
            </p>
            
            {/* Base Currency Selector */}
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>BASE CURRENCY</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Primary currency for system operations and reporting
                  </div>
                </div>
                <select 
                  className="input" 
                  value={baseCurrency} 
                  onChange={e => {
                    setBaseCurrency(e.target.value)
                    setSystemFundForm({ ...systemFundForm, currency: e.target.value })
                    // Refetch system balance when base currency changes
                    fetchProviderLedgerBalances()
                  }}
                  style={{ width: 120 }}
                >
                  {supportedCurrencies.map(currency => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </div>
            </div>

            {!systemWallet && (
              <div style={{ marginBottom: 16 }}>
                <button className="btn btn-primary" onClick={initializeSystem} disabled={createWalletMutation.isPending}>
                  Initialize System Wallet
                </button>
              </div>
            )}

            <div className="grid-2">
              <div>
                <div className="form-group">
                  <label className="form-label">Select Provider to Fund</label>
                  <select 
                    className="input" 
                    value={systemFundForm.provider}
                    onChange={e => setSystemFundForm({ ...systemFundForm, provider: e.target.value })}
                  >
                    <option value="">-- Select Provider --</option>
                    {providerUsers.map(p => {
                      const iconInfo = PROVIDER_ICONS[p.email || ''] || PROVIDER_ICONS.default
                      return (
                        <option key={p.id} value={p.id}>
                          {iconInfo.icon} {p.email?.split('@')[0] || p.id.substring(0, 8)}
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Amount</label>
                    <input 
                      type="number" 
                      className="input"
                      value={systemFundForm.amount}
                      onChange={e => setSystemFundForm({ ...systemFundForm, amount: e.target.value })}
                      placeholder="10000"
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Currency</label>
                    <select className="input" value={systemFundForm.currency} onChange={e => {
                      setSystemFundForm({ ...systemFundForm, currency: e.target.value })
                      // Refetch balances when currency changes
                      fetchProviderLedgerBalances()
                    }}>
                      {supportedCurrencies.map(currency => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleSystemFundProvider}
                  disabled={isFundingProvider || fundWalletMutation.isPending || createWalletMutation.isPending}
                  style={{ width: '100%' }}
                >
                  <Send size={16} />
                  {isFundingProvider || fundWalletMutation.isPending ? 'Processing...' : `Fund ${providerUsers.find(p => p.id === systemFundForm.provider)?.email?.split('@')[0] || 'Provider'}`}
                </button>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' }}>
                  PROVIDER BALANCES {walletBalancesLoading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(Loading wallets...)</span>}
                </div>
                {providerUsers.map(providerUser => {
                  // Find wallet matching the selected currency for system funding
                  const wallet = providerWallets.find((w: any) => w.userId === providerUser.id && w.currency === systemFundForm.currency)
                  const providerBalances = providerWalletBalances[providerUser.id] || {}
                  const walletBalanceFromQuery = providerBalances[systemFundForm.currency] || 0
                  const walletBalanceFromWallet = wallet?.balance || 0
                  const balanceKey = `${providerUser.id}-${systemFundForm.currency}-${walletBalanceFromWallet}-${walletBalanceFromQuery}-${wallet?.updatedAt || 'none'}`
                  const hasWalletBalance = walletBalanceFromQuery !== undefined && walletBalanceFromQuery !== null && walletBalanceFromQuery !== 0
                  const walletCurrency = wallet?.currency || systemFundForm.currency
                  const balanceMismatch = hasWalletBalance && wallet && Math.abs(walletBalanceFromWallet - walletBalanceFromQuery) > 0.01
                  const iconInfo = PROVIDER_ICONS[providerUser.email || ''] || PROVIDER_ICONS.default
                  
                  return (
                    <div
                      key={balanceKey}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '12px',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 8,
                        marginBottom: 8,
                        borderLeft: `4px solid ${iconInfo.color}`,
                        border: balanceMismatch ? `2px solid var(--accent-orange)` : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 20 }}>{iconInfo.icon}</span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{providerUser.email?.split('@')[0] || providerUser.id.substring(0, 8)}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {providerUser.email || providerUser.id} • {systemFundForm.currency}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {hasWalletBalance ? (
                          <>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-green)', fontSize: 14 }}>
                              {formatCurrency(walletBalanceFromQuery, systemFundForm.currency)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                              Wallet ({systemFundForm.currency})
                            </div>
                            {balanceMismatch && wallet && (
                              <div style={{ fontSize: 10, color: 'var(--accent-orange)', marginTop: 2 }}>
                                Wallet: {formatCurrency(walletBalanceFromWallet, walletCurrency)} ⚠️
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: wallet?.balance ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                              {wallet ? formatCurrency(walletBalanceFromWallet, walletCurrency) : `— ${systemFundForm.currency}`}
                            </div>
                            {wallet && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                Wallet ({walletCurrency})
                              </div>
                            )}
                          </>
                        )}
                        {!wallet && (
                          <button 
                            className="btn btn-sm btn-secondary"
                            onClick={() => initializeProvider(providerUser.id)}
                            style={{ marginTop: 4 }}
                          >
                            Create {systemFundForm.currency}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {providerUsers.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No payment providers found. Run payment-setup.ts to create providers.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PROVIDER SECTION */}
      {activeSection === 'provider' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 className="card-title">
                <span style={{ marginRight: 8 }}>💳</span>
                Step 2: Provider Processes User Transactions
              </h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
              Payment providers receive funds from system and process user deposits/withdrawals. When a user deposit is completed, the provider credits the user's wallet.
            </p>

            <div className="grid-2">
              <div>
                <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--accent-green)' }}>
                    <ArrowDownCircle size={14} style={{ marginRight: 6 }} />
                    Credit User (Complete Deposit)
                  </div>
                  
                  <div className="form-group">
                    <label className="form-label">From Provider</label>
                    <select 
                      className="input" 
                      value={providerToUserForm.provider}
                      onChange={e => setProviderToUserForm({ ...providerToUserForm, provider: e.target.value })}
                    >
                      <option value="">-- Select Provider --</option>
                      {providerUsers.map(p => {
                        const iconInfo = PROVIDER_ICONS[p.email || ''] || PROVIDER_ICONS.default
                        return (
                          <option key={p.id} value={p.id}>
                            {iconInfo.icon} {p.email?.split('@')[0] || p.id.substring(0, 8)}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">To User ID</label>
                    <select 
                      className="input"
                      value={providerToUserForm.userId}
                      onChange={e => setProviderToUserForm({ ...providerToUserForm, userId: e.target.value })}
                    >
                      <option value="">Select user...</option>
                      {userWallets
                        .filter((w: any) => w.currency === providerToUserForm.currency) // Filter by selected currency
                        .map((w: any) => (
                          <option key={w.id} value={w.userId}>
                            {w.userId} ({formatCurrency(w.balance, w.currency)} {w.currency})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Amount</label>
                      <input 
                        type="number" 
                        className="input"
                        value={providerToUserForm.amount}
                        onChange={e => setProviderToUserForm({ ...providerToUserForm, amount: e.target.value })}
                      />
                    </div>
                      <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Currency</label>
                      <select className="input" value={providerToUserForm.currency} onChange={e => setProviderToUserForm({ ...providerToUserForm, currency: e.target.value })}>
                        {supportedCurrencies.map(currency => (
                          <option key={currency} value={currency}>{currency}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    className="btn btn-primary"
                    onClick={handleProviderFundUser}
                    disabled={isFundingUser || fundWalletMutation.isPending || !providerToUserForm.userId}
                    style={{ width: '100%' }}
                  >
                    <ArrowDownCircle size={16} />
                    {isFundingUser ? 'Processing...' : 'Credit User Wallet'}
                  </button>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' }}>PROVIDER WALLETS</div>
                {providerWallets.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No provider wallets. Go to System section to fund providers first.
                  </div>
                ) : (
                  providerWallets.map((wallet: any) => {
                    const providerUser = providerUsers.find(p => p.id === wallet.userId)
                    const walletCurrency = wallet.currency || 'EUR'
                    const iconInfo = providerUser ? (PROVIDER_ICONS[providerUser.email || ''] || PROVIDER_ICONS.default) : PROVIDER_ICONS.default
                    return (
                      <div 
                        key={wallet.id}
                        style={{ 
                          padding: '12px',
                          background: 'var(--bg-tertiary)',
                          borderRadius: 8,
                          marginBottom: 8,
                          borderLeft: `4px solid ${iconInfo.color}`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>{iconInfo.icon}</span>
                            <div>
                              <div style={{ fontWeight: 500 }}>{providerUser?.email?.split('@')[0] || wallet.userId.substring(0, 8)}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{walletCurrency}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-green)' }}>
                              {formatCurrency(wallet.balance, walletCurrency)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Wallet</div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* USER SECTION */}
      {activeSection === 'user' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 className="card-title">
                <span style={{ marginRight: 8 }}>👥</span>
                Step 3: End User Operations
              </h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
              End users deposit funds through payment providers and can request withdrawals. Create user wallets and manage their transactions.
            </p>

            <div className="grid-2">
              {/* Create User Wallet */}
              <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                  <Plus size={14} style={{ marginRight: 6 }} />
                  Create User Wallet
                </div>
                
                <div className="form-group">
                  <label className="form-label">User ID</label>
                  <input 
                    type="text" 
                    className="input"
                    value={newUserForm.userId}
                    onChange={e => setNewUserForm({ ...newUserForm, userId: e.target.value })}
                    placeholder="user-john-123"
                  />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Currency</label>
                    <select className="input" value={newUserForm.currency} onChange={e => setNewUserForm({ ...newUserForm, currency: e.target.value })}>
                      {supportedCurrencies.map(currency => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Category</label>
                    <select className="input" value={newUserForm.category} onChange={e => setNewUserForm({ ...newUserForm, category: e.target.value })}>
                      {walletCategories.map(cat => (
                        <option key={cat.value} value={cat.value} title={cat.description}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button 
                  className="btn btn-primary"
                  onClick={handleCreateUserWallet}
                  disabled={createWalletMutation.isPending || !newUserForm.userId}
                  style={{ width: '100%' }}
                >
                  <Plus size={16} />
                  Create Wallet
                </button>
              </div>

              {/* User Deposit Request */}
              <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--accent-green)' }}>
                  <ArrowDownCircle size={14} style={{ marginRight: 6 }} />
                  User Deposit Request
                </div>
                
                <div className="form-group">
                  <label className="form-label">User</label>
                  <select 
                    className="input"
                    value={userDepositForm.userId}
                    onChange={e => setUserDepositForm({ ...userDepositForm, userId: e.target.value })}
                  >
                    <option value="">Select user...</option>
                    {userWallets
                      .filter((w: any) => w.currency === userDepositForm.currency) // Filter by selected currency
                      .map((w: any) => (
                        <option key={w.id} value={w.userId}>
                          {w.userId} ({formatCurrency(w.balance, w.currency)} {w.currency})
                        </option>
                      ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Amount</label>
                    <input 
                      type="number" 
                      className="input"
                      value={userDepositForm.amount}
                      onChange={e => setUserDepositForm({ ...userDepositForm, amount: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Currency</label>
                    <select className="input" value={userDepositForm.currency} onChange={e => setUserDepositForm({ ...userDepositForm, currency: e.target.value, userId: '' })}>
                      {supportedCurrencies.map(currency => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Via Provider</label>
                  <select className="input" value={userDepositForm.provider} onChange={e => setUserDepositForm({ ...userDepositForm, provider: e.target.value, fromUserId: e.target.value })}>
                    <option value="">-- Select Provider --</option>
                    {providerUsers.map(p => (
                      <option key={p.id} value={p.id}>{p.email?.split('@')[0] || p.id.substring(0, 8)}</option>
                    ))}
                  </select>
                </div>

                <button 
                  className="btn btn-primary"
                  onClick={handleUserDeposit}
                  disabled={createDepositMutation.isPending || !userDepositForm.userId}
                  style={{ width: '100%' }}
                >
                  <ArrowDownCircle size={16} />
                  Request Deposit
                </button>
              </div>

              {/* User Withdrawal Request */}
              <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--accent-red)' }}>
                  <ArrowUpCircle size={14} style={{ marginRight: 6 }} />
                  User Withdrawal Request
                </div>
                
                <div className="form-group">
                  <label className="form-label">User</label>
                  <select 
                    className="input"
                    value={userWithdrawForm.userId}
                    onChange={e => setUserWithdrawForm({ ...userWithdrawForm, userId: e.target.value })}
                  >
                    <option value="">Select user...</option>
                    {userWallets
                      .filter((w: any) => w.currency === userWithdrawForm.currency) // Filter by selected currency
                      .map((w: any) => (
                        <option key={w.id} value={w.userId}>
                          {w.userId} ({formatCurrency(w.balance, w.currency)} {w.currency})
                        </option>
                      ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Amount</label>
                    <input 
                      type="number" 
                      className="input"
                      value={userWithdrawForm.amount}
                      onChange={e => setUserWithdrawForm({ ...userWithdrawForm, amount: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Currency</label>
                    <select className="input" value={userWithdrawForm.currency} onChange={e => setUserWithdrawForm({ ...userWithdrawForm, currency: e.target.value, userId: '' })}>
                      {supportedCurrencies.map(currency => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Via Provider</label>
                  <select className="input" value={userWithdrawForm.provider} onChange={e => setUserWithdrawForm({ ...userWithdrawForm, provider: e.target.value })}>
                    <option value="">-- Select Provider --</option>
                    {providerUsers.map(p => (
                      <option key={p.id} value={p.id}>{p.email?.split('@')[0] || p.id.substring(0, 8)}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Bank Account (optional)</label>
                  <input 
                    type="text" 
                    className="input"
                    value={userWithdrawForm.bankAccount}
                    onChange={e => setUserWithdrawForm({ ...userWithdrawForm, bankAccount: e.target.value })}
                    placeholder="IBAN or account number"
                  />
                </div>

                <button 
                  className="btn btn-danger"
                  onClick={handleUserWithdraw}
                  disabled={createWithdrawalMutation.isPending || !userWithdrawForm.userId}
                  style={{ width: '100%' }}
                >
                  <ArrowUpCircle size={16} />
                  Request Withdrawal
                </button>
              </div>
            </div>
          </div>

          {/* User Wallets Table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">User Wallets ({userWallets.length})</h3>
              <button className="btn btn-sm btn-secondary" onClick={() => refetchWallets()}>
                <RefreshCw size={14} />
              </button>
            </div>

            {userWallets.length === 0 ? (
              <div className="empty-state">
                <Users />
                <p>No user wallets yet</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Create a user wallet above to get started</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)' }}>USER</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)' }}>CURRENCY</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)' }}>BALANCE</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)' }}>BONUS</th>
                    <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {userWallets.map((w: any) => (
                    <tr key={w.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 8px', fontSize: 14, fontWeight: 500 }}>{w.userId}</td>
                      <td style={{ padding: '12px 8px', fontSize: 14 }}>
                        <div>{w.currency}</div>
                        {w.category && w.category !== 'main' && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {w.category}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: 14, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-green)' }}>
                        {formatCurrency(w.balance, w.currency)}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: 14, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-orange)' }}>
                        {formatCurrency(w.bonusBalance || 0, w.currency)}
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <span className={`status-badge ${w.status === 'active' ? 'healthy' : 'unhealthy'}`}>
                          <span className="status-badge-dot" />
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRANSFERS TAB - User-to-User Transfer View (replaces Ledger Tab)
// ═══════════════════════════════════════════════════════════════════

interface TransferFilter {
  type: string
  userId: string
  currency: string
  status: string
  externalRef: string
  dateFrom: string
  dateTo: string
}

function LedgerTab() {
  const queryClient = useQueryClient()
  const { tokens } = useAuth()
  const authToken = tokens?.accessToken
  
  // Filters
  const [filters, setFilters] = useState<TransferFilter>({
    type: '',
    userId: '',
    currency: '',
    status: '',
    externalRef: '',
    dateFrom: '',
    dateTo: '',
  })
  
  // Pagination
  const [pagination, setPagination] = useState({
    page: 0,
    pageSize: 25,
  })
  
  // Build filter object for API
  // Note: The repository.findMany accepts MongoDB filter format directly
  const buildApiFilter = () => {
    const filter: Record<string, any> = {}
    
    // Filter by type (if specified)
    if (filters.type) {
      // For transfers, type might be deposit/withdrawal/transfer, but transfers don't have a type field
      // We can filter by status or other fields instead
      // Skip type filter for transfers as they don't have a type field
    }
    
    // Filter by userId - use $or to match either fromUserId or toUserId
    if (filters.userId) {
      filter.$or = [
        { fromUserId: filters.userId },
        { toUserId: filters.userId }
      ]
    }
    
    // Filter by currency (in meta object)
    if (filters.currency) {
      filter['meta.currency'] = filters.currency
    }
    
    // Filter by status
    if (filters.status) {
      filter.status = filters.status
    }
    
    // Filter by externalRef (in meta object)
    if (filters.externalRef) {
      filter['meta.externalRef'] = { $regex: filters.externalRef, $options: 'i' }
    }
    
    // Filter by date range
    if (filters.dateFrom || filters.dateTo) {
      const dateFilter: Record<string, any> = {}
      if (filters.dateFrom) {
        dateFilter.$gte = new Date(filters.dateFrom)
      }
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo)
        toDate.setHours(23, 59, 59, 999)
        dateFilter.$lte = toDate
      }
      filter.createdAt = dateFilter
    }
    
    return Object.keys(filter).length > 0 ? filter : undefined
  }
  
  // Fetch transfers (replaces ledgerTransactions)
  const transfersQuery = useQuery({
    queryKey: ['transfers', pagination, filters],
    queryFn: async () => {
      try {
        const filter = buildApiFilter()
        const result = await graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
          query ListTransfers($first: Int, $skip: Int, $filter: JSON) {
            transfers(first: $first, skip: $skip, filter: $filter) {
              nodes {
                id
                fromUserId
                toUserId
                amount
                status
                charge
                meta
                createdAt
                updatedAt
              }
              totalCount
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { 
          first: pagination.pageSize,
          skip: pagination.page * pagination.pageSize,
          filter: filter
        }, authToken)
        return result
      } catch (error: any) {
        console.error('Transfers query error:', error)
        // Return empty result on error instead of throwing
        return {
          transfers: {
            nodes: [],
            totalCount: 0,
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false
            }
          }
        }
      }
    },
    retry: 1, // Retry once on failure
  })
  
  const transfers = transfersQuery.data?.transfers?.nodes || []
  const totalCount = transfersQuery.data?.transfers?.totalCount || 0
  const isLoading = transfersQuery.isLoading
  
  // Pagination helpers
  const totalPages = Math.ceil(totalCount / pagination.pageSize)
  
  const formatCurrency = (amount: number, currency: string = 'EUR') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: 2,
    }).format(amount / 100)
  }
  
  return (
    <div>
      {/* Filters */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {/* Type Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label className="form-label">Type</label>
            <select 
              className="input" 
              value={filters.type}
              onChange={e => { setFilters({ ...filters, type: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            >
              <option value="">All Types</option>
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="transfer">Transfer</option>
              <option value="fee">Fee</option>
            </select>
          </div>
          
          {/* User ID Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
            <label className="form-label">User ID</label>
            <input 
              type="text" 
              className="input"
              placeholder="User ID (from or to)"
              value={filters.userId}
              onChange={e => { setFilters({ ...filters, userId: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>
          
          {/* Currency Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 120 }}>
            <label className="form-label">Currency</label>
            <select 
              className="input" 
              value={filters.currency}
              onChange={e => { setFilters({ ...filters, currency: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            >
              <option value="">All</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          
          {/* Status Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label className="form-label">Status</label>
            <select 
              className="input" 
              value={filters.status}
              onChange={e => { setFilters({ ...filters, status: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="failed">Failed</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          
          {/* External Ref Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label">External Ref</label>
            <input 
              type="text" 
              className="input"
              placeholder="Search..."
              value={filters.externalRef}
              onChange={e => { setFilters({ ...filters, externalRef: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>
          
          {/* Date From */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="form-label">From Date</label>
            <input 
              type="date" 
              className="input"
              value={filters.dateFrom}
              onChange={e => { setFilters({ ...filters, dateFrom: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>
          
          {/* Date To */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="form-label">To Date</label>
            <input 
              type="date" 
              className="input"
              value={filters.dateTo}
              onChange={e => { setFilters({ ...filters, dateTo: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>
          
          {/* Page Size */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 100 }}>
            <label className="form-label">Page Size</label>
            <select 
              className="input" 
              value={pagination.pageSize}
              onChange={e => setPagination({ page: 0, pageSize: parseInt(e.target.value) })}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
          
          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button 
              className="btn btn-secondary"
              onClick={() => {
                setFilters({ type: '', userId: '', currency: '', status: '', externalRef: '', dateFrom: '', dateTo: '' })
                setPagination({ page: 0, pageSize: 25 })
              }}
            >
              Clear
            </button>
            <button className="btn btn-secondary" onClick={() => transfersQuery.refetch()}>
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>
      </div>
      
      {/* Transfers Table */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Transfers</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Page {pagination.page + 1} of {totalPages || 1} • Total: {totalCount}
          </div>
        </div>
        
        {isLoading ? (
          <div className="empty-state">Loading transfers...</div>
        ) : transfers.length === 0 ? (
          <div className="empty-state">
            <FileText />
            <p>No transfers found</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>DATE</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>FROM USER</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>TO USER</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>AMOUNT</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>CURRENCY</th>
                    <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>STATUS</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>EXTERNAL REF</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>METHOD</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((transfer: any) => (
                    <tr key={transfer.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {(() => {
                          const dateValue = transfer.createdAt;
                          if (!dateValue) return 'N/A';
                          try {
                            // Handle number (timestamp in milliseconds)
                            if (typeof dateValue === 'number') {
                              return new Date(dateValue).toLocaleString();
                            }
                            // Handle string (ISO or timestamp string)
                            if (typeof dateValue === 'string') {
                              // Try ISO string first
                              const isoDate = new Date(dateValue);
                              if (!isNaN(isoDate.getTime())) {
                                return isoDate.toLocaleString();
                              }
                              // Try timestamp string
                              const timestamp = parseInt(dateValue, 10);
                              if (!isNaN(timestamp)) {
                                return new Date(timestamp).toLocaleString();
                              }
                            }
                            // Handle Date object
                            if (dateValue instanceof Date) {
                              return dateValue.toLocaleString();
                            }
                            return 'Invalid Date';
                          } catch {
                            return 'Invalid Date';
                          }
                        })()}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {transfer.fromUserId}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {transfer.toUserId}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 14, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                        {formatCurrency(transfer.amount, transfer.meta?.currency || 'EUR')}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 12 }}>
                        {transfer.meta?.currency || 'EUR'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <span className={`status-badge ${transfer.status === 'approved' ? 'healthy' : transfer.status === 'failed' ? 'unhealthy' : 'pending'}`}>
                          <span className="status-badge-dot" />
                          {transfer.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {transfer.meta?.externalRef || '-'}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                        {transfer.meta?.method || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Pagination Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 8px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Showing {pagination.page * pagination.pageSize + 1} - {Math.min((pagination.page + 1) * pagination.pageSize, totalCount)} of {totalCount}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page === 0}
                  onClick={() => setPagination({ ...pagination, page: 0 })}
                >
                  First
                </button>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page === 0}
                  onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                >
                  Previous
                </button>
                <span style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13 }}>
                  Page {pagination.page + 1} of {totalPages || 1}
                </span>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page >= totalPages - 1}
                  onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                >
                  Next
                </button>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page >= totalPages - 1}
                  onClick={() => setPagination({ ...pagination, page: totalPages - 1 })}
                >
                  Last
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// TRANSACTIONS TAB - Unified Statement View
// ═══════════════════════════════════════════════════════════════════

interface TransactionFilter {
  type: string
  userId: string
  status: string
  dateFrom: string
  dateTo: string
}

interface PaginationState {
  page: number
  pageSize: number
}

function TransactionsTab() {
  const queryClient = useQueryClient()
  const { tokens } = useAuth()
  const authToken = tokens?.accessToken
  
  // Supported currencies
  const supportedCurrencies = ['EUR', 'USD', 'GBP', 'BTC', 'ETH']
  
  // Provider users state (for deposit form)
  const [providerUsers, setProviderUsers] = useState<any[]>([])
  
  // Filters
  const [filters, setFilters] = useState<TransactionFilter>({
    type: '',
    userId: '',
    status: '',
    dateFrom: '',
    dateTo: '',
  })
  
  // Pagination
  const [pagination, setPagination] = useState<PaginationState>({
    page: 0,
    pageSize: 25,
  })

  // Forms for creating transactions
  const [showCreateForm, setShowCreateForm] = useState<'deposit' | 'withdrawal' | null>(null)
  const [depositForm, setDepositForm] = useState({ userId: '', amount: '100', currency: 'EUR', method: 'card' })
  const [withdrawalForm, setWithdrawalForm] = useState({ userId: '', amount: '50', currency: 'EUR', method: 'bank_transfer', bankAccount: '' })

  // Build filter object for API
  const buildApiFilter = () => {
    const filter: Record<string, any> = {}
    if (filters.userId) filter.userId = filters.userId
    if (filters.status) filter.status = filters.status
    return Object.keys(filter).length > 0 ? filter : undefined
  }

  // ✅ Fetch all transactions - use separate queries to get complete data
  // Unified query is available but we use separate queries for better control
  const depositsQuery = useQuery({
    queryKey: ['deposits', pagination, filters],
    queryFn: () => graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
      query ListDeposits($first: Int, $skip: Int, $filter: JSON) {
        deposits(first: $first, skip: $skip, filter: $filter) {
          nodes {
            id
            userId
            type
            status
            amount
            currency
            feeAmount
            netAmount
            fromUserId
            createdAt
            description
            metadata
          }
          totalCount
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `, { 
      first: 1000, // Fetch all deposits (system should see all)
      skip: 0,
      filter: buildApiFilter()
    }, authToken),
  })

  const withdrawalsQuery = useQuery({
    queryKey: ['withdrawals', pagination, filters],
    queryFn: () => graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
      query ListWithdrawals($first: Int, $skip: Int, $filter: JSON) {
        withdrawals(first: $first, skip: $skip, filter: $filter) {
          nodes {
            id
            userId
            type
            status
            amount
            currency
            feeAmount
            netAmount
            toUserId
            createdAt
            description
            metadata
          }
          totalCount
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `, { 
      first: 1000, // Fetch all withdrawals (system should see all)
      skip: 0,
      filter: buildApiFilter()
    }, authToken),
  })

  // Also fetch unified transactions for completeness (but use separate queries as primary)
  const transactionsQuery = useQuery({
    queryKey: ['transactions', pagination, filters],
    queryFn: () => graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
      query ListTransactions($first: Int, $skip: Int, $filter: JSON) {
        transactions(first: $first, skip: $skip, filter: $filter) {
          nodes {
            id
            userId
            type
            charge
            status
            amount
            balance
            currency
            feeAmount
            netAmount
            createdAt
            description
            metadata
            objectId
            objectModel
          }
          totalCount
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `, { 
      first: 1000, // Fetch all transactions (system should see all)
      skip: 0,
      filter: buildApiFilter()
    }, authToken),
  })

  // walletTxQuery removed - using transactions query instead

  // Create mutations
  const createDepositMutation = useMutation({
    mutationFn: (variables?: any) => graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
      mutation CreateDeposit($input: CreateDepositInput!) {
        createDeposit(input: $input) {
          success
          deposit {
            id
            userId
            type
            status
            amount
            currency
          }
          transfer {
            id
            status
          }
          errors
        }
      }
    `, { input: { ...(variables || depositForm), amount: parseFloat((variables || depositForm).amount) * 100, tenantId: 'default-tenant' } }, authToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['statement'] })
      setShowCreateForm(null)
      setDepositForm({ userId: '', amount: '100', currency: 'EUR', method: 'card' })
    },
  })

  const createWithdrawalMutation = useMutation({
    mutationFn: () => graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
      mutation CreateWithdrawal($input: CreateWithdrawalInput!) {
        createWithdrawal(input: $input) {
          success
          withdrawal {
            id
            userId
            type
            status
            amount
            currency
          }
          transfer {
            id
            status
          }
          errors
        }
      }
    `, { input: { ...withdrawalForm, amount: parseFloat(withdrawalForm.amount) * 100, tenantId: 'default-tenant' } }, authToken),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] })
      
      // Auto-approve withdrawal to complete the flow
      const transferId = result?.createWithdrawal?.transfer?.id
      if (transferId) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500))
          await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
            mutation ApproveTransfer($transferId: String!) {
              approveTransfer(transferId: $transferId) {
                success
                transfer {
                  id
                  status
                }
              }
            }
          `, { transferId }, authToken)
        } catch (approveError: any) {
          console.warn('[Withdrawal] Auto-approval failed:', approveError)
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
      queryClient.invalidateQueries({ queryKey: ['statement'] })
      setShowCreateForm(null)
      setWithdrawalForm({ userId: '', amount: '50', currency: 'EUR', method: 'bank_transfer', bankAccount: '' })
    },
  })

  // Extract data from responses - use deposits and withdrawals as primary source
  const deposits = depositsQuery.data?.deposits?.nodes || []
  const withdrawals = withdrawalsQuery.data?.withdrawals?.nodes || []
  // walletTx removed - using transactions query instead
  const allTransactionsData = transactionsQuery.data?.transactions?.nodes || [] // Fallback
  
  const depositsTotalCount = depositsQuery.data?.deposits?.totalCount || 0
  const withdrawalsTotalCount = withdrawalsQuery.data?.withdrawals?.totalCount || 0
  const transactionsTotalCount = transactionsQuery.data?.transactions?.totalCount || depositsTotalCount + withdrawalsTotalCount

  // Helper function to parse date safely
  const parseDate = (dateValue: any): number => {
    if (!dateValue) return 0
    // If it's already a number (timestamp), return it
    if (typeof dateValue === 'number') return dateValue
    // If it's a string, try to parse it
    if (typeof dateValue === 'string') {
      // Try ISO string first
      const parsed = new Date(dateValue).getTime()
      if (!isNaN(parsed)) return parsed
      // Try timestamp string
      const timestamp = parseInt(dateValue, 10)
      if (!isNaN(timestamp)) return timestamp
    }
    return 0
  }

  // ✅ DEDUPLICATION: Combine deposits and withdrawals, deduplicate by ID only
  // Note: Backend prevents duplicates via unique index on externalRef
  // Frontend only needs to deduplicate by transaction ID (in case same transaction appears in multiple queries)
  const transactionMap = new Map<string, any>()
  
  // Process deposits (primary source)
  deposits.forEach((tx: any) => {
    const txId = tx.id
    if (!transactionMap.has(txId)) {
      const txCurrency = tx.currency || tx.meta?.currency || 'EUR'
      transactionMap.set(txId, {
        ...tx,
        currency: txCurrency, // Ensure currency is always set
        _source: 'deposit' as const,
        _isCredit: true,
        _displayType: 'Deposit',
        _displayAmount: tx.amount,
        _displayStatus: tx.status,
        _sortDate: parseDate(tx.createdAt),
        _createdAt: tx.createdAt,
        _description: tx.description || `${tx.type} ${tx.userId?.substring(0, 8)}...`,
      })
    }
  })
  
  // Process withdrawals (primary source)
  withdrawals.filter((tx: any) => tx.type === 'withdrawal').forEach((tx: any) => {
    const txId = tx.id
    if (!transactionMap.has(txId)) {
      const txCurrency = tx.currency || tx.meta?.currency || 'EUR'
      transactionMap.set(txId, {
        ...tx,
        currency: txCurrency, // Ensure currency is always set
        _source: 'withdrawal' as const,
        _isCredit: false,
        _displayType: 'Withdrawal',
        _displayAmount: tx.amount,
        _displayStatus: tx.status,
        _sortDate: parseDate(tx.createdAt),
        _createdAt: tx.createdAt,
        _description: tx.description || `${tx.type} ${tx.userId?.substring(0, 8)}...`,
      })
    }
  })
  
  // Process unified transactions as fallback (in case deposits/withdrawals queries miss some)
  allTransactionsData.forEach((tx: any) => {
    const txId = tx.id
    if (!transactionMap.has(txId)) {
      // Use objectModel to determine transaction type (deposit, withdrawal, transfer, etc.)
      // Fallback to charge (credit/debit) if objectModel is not available
      const txType = tx.objectModel || tx.type || tx.charge || 'transaction'
      const isCredit = tx.charge === 'credit' || tx.type === 'credit' || tx.objectModel === 'deposit'
      
      // Extract currency from transaction (can be in currency field or metadata.currency)
      const txCurrency = tx.currency || tx.metadata?.currency || 'EUR'
      
      transactionMap.set(txId, {
        ...tx,
        currency: txCurrency, // Ensure currency is always set
        _source: tx.objectModel === 'deposit' ? 'deposit' : tx.objectModel === 'withdrawal' ? 'withdrawal' : 'transaction',
        _isCredit: isCredit,
        _displayType: tx.objectModel === 'deposit' ? 'Deposit' : 
                     tx.objectModel === 'withdrawal' ? 'Withdrawal' : 
                     tx.objectModel === 'transfer' ? (isCredit ? 'Transfer In' : 'Transfer Out') :
                     tx.charge === 'credit' ? 'Credit' : 
                     tx.charge === 'debit' ? 'Debit' : 
                     txType,
        _displayAmount: tx.amount,
        _displayStatus: tx.status || 'completed',
        _sortDate: parseDate(tx.createdAt),
        _createdAt: tx.createdAt,
        _description: tx.description || tx.metadata?.description || `${txType} ${tx.userId?.substring(0, 8)}...`,
      })
    }
  })
  
  // Note: walletTransactions removed - transactions query includes all transaction entries
  // All transaction entries are now in the transactions collection (created by transfers)
  
  const allTransactions = Array.from(transactionMap.values()).sort((a, b) => b._sortDate - a._sortDate)

  // Apply client-side filters
  const filteredTransactions = allTransactions.filter(tx => {
    if (filters.type && filters.type !== 'all') {
      if (filters.type === 'deposit' && tx._source !== 'deposit' && tx.type !== 'deposit') return false
      if (filters.type === 'withdrawal' && tx._source !== 'withdrawal' && tx.type !== 'withdrawal') return false
      if (filters.type === 'bet' && tx.type !== 'bet') return false
      if (filters.type === 'win' && tx.type !== 'win') return false
      if (filters.type === 'bonus' && tx.type !== 'bonus_credit') return false
    }
    if (filters.userId && !tx.userId?.toLowerCase().includes(filters.userId.toLowerCase())) return false
    if (filters.status && tx._displayStatus !== filters.status) return false
    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom).getTime()
      if (tx._sortDate < fromDate) return false
    }
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo).getTime() + 86400000 // Include full day
      if (tx._sortDate > toDate) return false
    }
    return true
  })

  // Calculate summary stats
  const stats = {
    totalDeposits: deposits.reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0),
    totalWithdrawals: withdrawals.filter((tx: any) => tx.type === 'withdrawal').reduce((sum: number, tx: any) => sum + (tx.amount || 0), 0),
    depositsCount: depositsTotalCount,
    withdrawalsCount: withdrawalsTotalCount,
    transactionsCount: transactionsTotalCount,
  }

  const isLoading = depositsQuery.isLoading || withdrawalsQuery.isLoading || transactionsQuery.isLoading

  const refetchAll = () => {
    depositsQuery.refetch()
    withdrawalsQuery.refetch()
    transactionsQuery.refetch()
  }

  // Pagination helpers
  const totalItems = filteredTransactions.length
  const totalPages = Math.ceil(totalItems / pagination.pageSize)
  const paginatedTransactions = filteredTransactions.slice(
    pagination.page * pagination.pageSize,
    (pagination.page + 1) * pagination.pageSize
  )

  return (
    <div>
      {/* Stats Summary */}
      <div className="card-grid" style={{ marginBottom: 24 }}>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <ArrowDownCircle size={18} style={{ color: 'var(--accent-green)' }} />
              Total Deposits
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 28, color: 'var(--accent-green)' }}>
            {formatCurrency(stats.totalDeposits)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats.depositsCount} transactions</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <ArrowUpCircle size={18} style={{ color: 'var(--accent-red)' }} />
              Total Withdrawals
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 28, color: 'var(--accent-red)' }}>
            {formatCurrency(stats.totalWithdrawals)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats.withdrawalsCount} transactions</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <DollarSign size={18} style={{ color: 'var(--accent-cyan)' }} />
              Net Flow
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 28, color: 'var(--accent-cyan)' }}>
            {formatCurrency(stats.totalDeposits - stats.totalWithdrawals)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats.transactionsCount} transactions</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <FileText size={18} />
              Total Records
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 28 }}>
            {transactionsTotalCount || totalItems}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>showing {paginatedTransactions.length} of {totalItems}</div>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          {/* Type Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label className="form-label">Type</label>
            <select 
              className="input" 
              value={filters.type}
              onChange={e => { setFilters({ ...filters, type: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            >
              <option value="">All Types</option>
              <option value="deposit">Deposits</option>
              <option value="withdrawal">Withdrawals</option>
              <option value="bet">Bets</option>
              <option value="win">Wins</option>
              <option value="bonus">Bonuses</option>
            </select>
          </div>

          {/* User ID Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 180 }}>
            <label className="form-label">User ID</label>
            <input 
              type="text" 
              className="input"
              placeholder="Search user..."
              value={filters.userId}
              onChange={e => { setFilters({ ...filters, userId: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>

          {/* Status Filter */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 140 }}>
            <label className="form-label">Status</label>
            <select 
              className="input" 
              value={filters.status}
              onChange={e => { setFilters({ ...filters, status: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {/* Date From */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="form-label">From Date</label>
            <input 
              type="date" 
              className="input"
              value={filters.dateFrom}
              onChange={e => { setFilters({ ...filters, dateFrom: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>

          {/* Date To */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 150 }}>
            <label className="form-label">To Date</label>
            <input 
              type="date" 
              className="input"
              value={filters.dateTo}
              onChange={e => { setFilters({ ...filters, dateTo: e.target.value }); setPagination({ ...pagination, page: 0 }) }}
            />
          </div>

          {/* Page Size */}
          <div className="form-group" style={{ marginBottom: 0, minWidth: 100 }}>
            <label className="form-label">Page Size</label>
            <select 
              className="input" 
              value={pagination.pageSize}
              onChange={e => setPagination({ page: 0, pageSize: parseInt(e.target.value) })}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button 
              className="btn btn-secondary"
              onClick={() => {
                setFilters({ type: '', userId: '', status: '', dateFrom: '', dateTo: '' })
                setPagination({ page: 0, pageSize: 25 })
              }}
            >
              Clear
            </button>
            <button className="btn btn-secondary" onClick={refetchAll}>
              <RefreshCw size={14} />
              Refresh
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreateForm('deposit')}>
              <Plus size={14} />
              New Deposit
            </button>
            <button className="btn btn-secondary" onClick={() => setShowCreateForm('withdrawal')}>
              <Plus size={14} />
              New Withdrawal
            </button>
          </div>
        </div>
      </div>

      {/* Transaction Statement Table */}
        <div className="card">
          <div className="card-header">
          <h3 className="card-title">Transaction Statement</h3>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Page {pagination.page + 1} of {totalPages || 1}
          </div>
        </div>

        {isLoading ? (
          <div className="empty-state">Loading transactions...</div>
        ) : filteredTransactions.length === 0 ? (
          <div className="empty-state">
            <FileText />
            <p>No transactions found</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>DATE</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>TYPE</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>USER</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>DESCRIPTION</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>DEBIT</th>
                    <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>CREDIT</th>
                    <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>STATUS</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTransactions.map((tx: any, idx: number) => (
                    <tr key={`${tx._source}-${tx.id}-${idx}`} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {(() => {
                              const dateValue = tx._createdAt || tx.createdAt;
                              if (!dateValue) return 'N/A';
                              
                              try {
                                // Handle number (timestamp in milliseconds)
                                if (typeof dateValue === 'number') {
                                  return new Date(dateValue).toLocaleString();
                                }
                                // Handle string (ISO or timestamp string)
                                if (typeof dateValue === 'string') {
                                  // Try ISO string first
                                  const isoDate = new Date(dateValue);
                                  if (!isNaN(isoDate.getTime())) {
                                    return isoDate.toLocaleString();
                                  }
                                  // Try timestamp string
                                  const timestamp = parseInt(dateValue, 10);
                                  if (!isNaN(timestamp)) {
                                    return new Date(timestamp).toLocaleString();
                                  }
                                }
                                return 'Invalid Date';
                              } catch {
                                return 'Invalid Date';
                              }
                            })()}
                          </td>
                          <td style={{ padding: '10px 8px' }}>
                            <span style={{ 
                              display: 'inline-flex',
                              alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500,
                          background: tx._isCredit ? 'var(--accent-green-glow)' : 'var(--accent-red-glow)',
                          color: tx._isCredit ? 'var(--accent-green)' : 'var(--accent-red)',
                          whiteSpace: 'nowrap',
                        }}>
                          {tx._isCredit ? <ArrowDownCircle size={12} /> : <ArrowUpCircle size={12} />}
                          {tx._displayType}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{tx.userId?.substring(0, 8)}...</td>
                      <td style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx._description || tx.description || (tx.fromUserId ? `Transfer from ${tx.fromUserId.substring(0, 8)}...` : tx.toUserId ? `Transfer to ${tx.toUserId.substring(0, 8)}...` : tx.method || tx._displayType || '-')}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 14, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-red)' }}>
                        {!tx._isCredit ? formatCurrency(tx._displayAmount, tx.currency) : '-'}
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 14, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent-green)' }}>
                        {tx._isCredit ? formatCurrency(tx._displayAmount, tx.currency) : '-'}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <span className={`status-badge ${tx._displayStatus === 'completed' ? 'healthy' : tx._displayStatus === 'failed' ? 'unhealthy' : 'pending'}`}>
                            <span className="status-badge-dot" />
                            {tx._displayStatus}
                          </span>
                          {tx._displayStatus === 'processing' && tx._source !== 'wallet' && (() => {
                            // Get transferId from transaction metadata or objectId
                            const transferId = (tx.metadata as any)?.transferId || (tx.objectModel === 'transfer' ? tx.objectId : null)
                            if (!transferId) return null
                            
                            return (
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={async () => {
                                  try {
                                    await graphqlWithAuth(GRAPHQL_SERVICE_URLS.payment, `
                                      mutation ApproveTransfer($transferId: String!) {
                                        approveTransfer(transferId: $transferId) {
                                          success
                                          transfer {
                                            id
                                            status
                                          }
                                        }
                                      }
                                    `, { transferId }, authToken)
                                    refetchAll()
                                    setTimeout(() => refetchAll(), 1000) // Refresh after sync
                                  } catch (err: any) {
                                    alert(`Failed to approve: ${err.message}`)
                                  }
                                }}
                                style={{ fontSize: 10, padding: '2px 8px' }}
                              >
                                Approve
                              </button>
                            )
                          })()}
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx.id?.substring(0, 8)}...
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 8px', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Showing {pagination.page * pagination.pageSize + 1} - {Math.min((pagination.page + 1) * pagination.pageSize, totalItems)} of {totalItems}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page === 0}
                  onClick={() => setPagination({ ...pagination, page: 0 })}
                >
                  First
                </button>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page === 0}
                  onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                >
                  Previous
                </button>
                <span style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13 }}>
                  Page {pagination.page + 1} of {totalPages || 1}
                </span>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page >= totalPages - 1}
                  onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                >
                  Next
                </button>
                <button 
                  className="btn btn-sm btn-secondary"
                  disabled={pagination.page >= totalPages - 1}
                  onClick={() => setPagination({ ...pagination, page: totalPages - 1 })}
                >
                  Last
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create Deposit Modal */}
      {showCreateForm === 'deposit' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 400 }}>
            <div className="card-header">
              <h3 className="card-title">
                <ArrowDownCircle size={18} style={{ marginRight: 8, color: 'var(--accent-green)' }} />
                New Deposit
              </h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowCreateForm(null)}>✕</button>
          </div>
          
          <div className="form-group">
              <label className="form-label">User ID *</label>
            <input 
              type="text" 
              className="input"
                value={depositForm.userId}
                onChange={e => setDepositForm({ ...depositForm, userId: e.target.value })}
              placeholder="user-123"
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Amount</label>
              <input 
                type="number" 
                className="input"
                  value={depositForm.amount}
                  onChange={e => setDepositForm({ ...depositForm, amount: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Currency</label>
                <select className="input" value={depositForm.currency} onChange={e => setDepositForm({ ...depositForm, currency: e.target.value })}>
                {supportedCurrencies.map(currency => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </div>
          </div>

            <div className="form-group">
              <label className="form-label">Method</label>
              <select className="input" value={depositForm.method} onChange={e => setDepositForm({ ...depositForm, method: e.target.value })}>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="e_wallet">E-Wallet</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>

            <button 
              className="btn btn-primary"
              onClick={() => {
                // Use first provider user as fromUserId if not set
                const fromUserId = providerUsers[0]?.id
                if (!fromUserId) {
                  alert('No payment provider available. Please run payment-setup.ts first.')
                  return
                }
                createDepositMutation.mutate({
                  ...depositForm,
                  fromUserId: fromUserId,
                })
              }}
              disabled={createDepositMutation.isPending || !depositForm.userId}
              style={{ width: '100%' }}
            >
              {createDepositMutation.isPending ? 'Creating...' : 'Create Deposit'}
            </button>
          </div>
        </div>
      )}

      {/* Create Withdrawal Modal */}
      {showCreateForm === 'withdrawal' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 400 }}>
            <div className="card-header">
              <h3 className="card-title">
                <ArrowUpCircle size={18} style={{ marginRight: 8, color: 'var(--accent-orange)' }} />
                New Withdrawal
              </h3>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowCreateForm(null)}>✕</button>
            </div>
            
            <div className="form-group">
              <label className="form-label">User ID *</label>
              <input 
                type="text" 
                className="input"
                value={withdrawalForm.userId}
                onChange={e => setWithdrawalForm({ ...withdrawalForm, userId: e.target.value })}
                placeholder="user-123"
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Amount</label>
                <input 
                  type="number" 
                  className="input"
                  value={withdrawalForm.amount}
                  onChange={e => setWithdrawalForm({ ...withdrawalForm, amount: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Currency</label>
                <select className="input" value={withdrawalForm.currency} onChange={e => setWithdrawalForm({ ...withdrawalForm, currency: e.target.value })}>
                  {supportedCurrencies.map(currency => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Method</label>
              <select className="input" value={withdrawalForm.method} onChange={e => setWithdrawalForm({ ...withdrawalForm, method: e.target.value })}>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="e_wallet">E-Wallet</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Bank Account / Wallet</label>
              <input 
                type="text" 
                className="input"
                value={withdrawalForm.bankAccount}
                onChange={e => setWithdrawalForm({ ...withdrawalForm, bankAccount: e.target.value })}
                placeholder="DE89370400440532013000"
              />
            </div>

            <button 
              className="btn btn-secondary"
              onClick={() => createWithdrawalMutation.mutate()}
              disabled={createWithdrawalMutation.isPending || !withdrawalForm.userId}
              style={{ width: '100%' }}
            >
              {createWithdrawalMutation.isPending ? 'Creating...' : 'Request Withdrawal'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// RECONCILIATION TAB
// ═══════════════════════════════════════════════════════════════════

function ReconciliationTab() {
  const [dateRange, setDateRange] = useState('today')

  // Fetch all transactions for reconciliation
  const { tokens } = useAuth()
  const authToken = tokens?.accessToken
  
  const txQuery = useQuery({
    queryKey: ['reconciliation', dateRange],
    queryFn: () => graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
      query GetReconciliationData($txFirst: Int, $walletFirst: Int) {
        transactions(first: $txFirst) {
          nodes {
            id
            userId
            amount
            balance
            charge
            objectId
            objectModel
            meta
            createdAt
          }
          totalCount
        }
        wallets(first: $walletFirst) {
          nodes {
            id
            userId
            currency
            category
            balance
            bonusBalance
            lockedBalance
            status
          }
          totalCount
        }
      }
    `, { 
      txFirst: 500,
      walletFirst: 100
    }, authToken),
  })

  const transactions = txQuery.data?.transactions?.nodes || []
  const wallets = txQuery.data?.wallets?.nodes || []

  // Calculate summary - track fees separately
  const summary = transactions.reduce((acc: any, tx: any) => {
    const type = tx.type
    if (!acc[type]) acc[type] = { count: 0, total: 0 }
    acc[type].count++
    acc[type].total += tx.amount || 0
    
    // Track fees from fee transactions
    if (type === 'fee' || tx.description?.toLowerCase().includes('fee')) {
      if (!acc.fees) acc.fees = { count: 0, total: 0 }
      acc.fees.count++
      acc.fees.total += tx.amount || 0
    }
    
    return acc
  }, {})

  const totalDeposits = summary.deposit?.total || 0
  const totalWithdrawals = summary.withdrawal?.total || 0
  const totalBets = summary.bet?.total || 0
  const totalWins = summary.win?.total || 0
  const totalBonuses = summary.bonus_credit?.total || 0
  const totalFees = summary.fees?.total || 0

  const platformBalance = wallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0)
  const platformBonus = wallets.reduce((sum: number, w: any) => sum + (w.bonusBalance || 0), 0)

  return (
    <div>
      {/* Date Filter */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Period:</span>
          <select className="input" style={{ width: 200 }} value={dateRange} onChange={e => setDateRange(e.target.value)}>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
          <button className="btn btn-secondary">
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Reconciliation Report */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <TrendingUp size={18} style={{ marginRight: 8 }} />
              Inflows
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Deposits ({summary.deposit?.count || 0})</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-green)', fontWeight: 600 }}>
                +{formatCurrency(totalDeposits)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Wins ({summary.win?.count || 0})</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-green)', fontWeight: 600 }}>
                +{formatCurrency(totalWins)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Bonuses ({summary.bonus_credit?.count || 0})</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-orange)', fontWeight: 600 }}>
                +{formatCurrency(totalBonuses)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', background: 'var(--bg-tertiary)', borderRadius: 8, paddingLeft: 12, paddingRight: 12 }}>
              <span style={{ fontWeight: 600 }}>Total Inflows</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-green)', fontWeight: 700, fontSize: 18 }}>
                {formatCurrency(totalDeposits + totalWins + totalBonuses)}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <TrendingDown size={18} style={{ marginRight: 8 }} />
              Outflows
            </h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Withdrawals ({summary.withdrawal?.count || 0})</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-red)', fontWeight: 600 }}>
                -{formatCurrency(totalWithdrawals)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Bets ({summary.bet?.count || 0})</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-red)', fontWeight: 600 }}>
                -{formatCurrency(totalBets)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Fees ({summary.fees?.count || 0})</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-red)', fontWeight: 600 }}>
                -{formatCurrency(totalFees)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', background: 'var(--bg-tertiary)', borderRadius: 8, paddingLeft: 12, paddingRight: 12 }}>
              <span style={{ fontWeight: 600 }}>Total Outflows</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-red)', fontWeight: 700, fontSize: 18 }}>
                {formatCurrency(totalWithdrawals + totalBets + totalFees)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Net Position */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3 className="card-title">Platform Position</h3>
        </div>
        
        <div className="card-grid">
          <div style={{ textAlign: 'center', padding: 24, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>NET FLOW</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
              {formatCurrency((totalDeposits + totalWins + totalBonuses) - (totalWithdrawals + totalBets + totalFees))}
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: 24, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>TOTAL REAL BALANCE</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-green)' }}>
              {formatCurrency(platformBalance)}
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: 24, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>TOTAL BONUS BALANCE</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-orange)' }}>
              {formatCurrency(platformBonus)}
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: 24, background: 'var(--bg-tertiary)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>TOTAL WALLETS</div>
            <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              {wallets.length}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════

function SettingsTab() {
  const queryClient = useQueryClient()
  const [newProvider, setNewProvider] = useState({
    provider: 'stripe',
    name: '',
    supportedMethods: ['card'],
    supportedCurrencies: ['EUR'],
    feePercentage: '2.9',
  })

  // Fetch providers - API uses JSON input/output
  const { tokens } = useAuth()
  const authToken = tokens?.accessToken
  
  const providersQuery = useQuery({
    queryKey: ['providerConfigs'],
    queryFn: () => graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
      query ListProviders($input: JSON) {
        providerConfigs(input: $input)
      }
    `, { input: { first: 50 } }),
  })

  // Create provider mutation - API uses JSON input/output
  const createProviderMutation = useMutation({
    mutationFn: () => graphqlQuery(GRAPHQL_SERVICE_URLS.payment, `
      mutation CreateProvider($input: JSON) {
        createProviderConfig(input: $input)
      }
    `, {
      input: {
        ...newProvider,
        feePercentage: parseFloat(newProvider.feePercentage),
      }
    }, authToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerConfigs'] })
      setNewProvider({ ...newProvider, name: '' })
    },
  })

  const providers = providersQuery.data?.providerConfigs?.nodes || []

  return (
    <div>
      <div className="grid-2">
        {/* Add Provider */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Building size={18} style={{ marginRight: 8 }} />
              Add Payment Provider
            </h3>
          </div>
          
          <div className="form-group">
            <label className="form-label">Provider Type</label>
            <select className="input" value={newProvider.provider} onChange={e => setNewProvider({ ...newProvider, provider: e.target.value })}>
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
              <option value="adyen">Adyen</option>
              <option value="worldpay">Worldpay</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="crypto_btc">Bitcoin</option>
              <option value="crypto_eth">Ethereum</option>
              <option value="skrill">Skrill</option>
              <option value="neteller">Neteller</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input 
              type="text" 
              className="input"
              value={newProvider.name}
              onChange={e => setNewProvider({ ...newProvider, name: e.target.value })}
              placeholder="Stripe (Card Payments)"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Fee Percentage</label>
            <input 
              type="number" 
              className="input"
              value={newProvider.feePercentage}
              onChange={e => setNewProvider({ ...newProvider, feePercentage: e.target.value })}
              placeholder="2.9"
              step="0.1"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Supported Methods</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['card', 'bank_transfer', 'e_wallet', 'crypto', 'apple_pay', 'google_pay'].map(method => (
                <label key={method} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newProvider.supportedMethods.includes(method)}
                    onChange={e => {
                      if (e.target.checked) {
                        setNewProvider({ ...newProvider, supportedMethods: [...newProvider.supportedMethods, method] })
                      } else {
                        setNewProvider({ ...newProvider, supportedMethods: newProvider.supportedMethods.filter(m => m !== method) })
                      }
                    }}
                  />
                  {method}
                </label>
              ))}
            </div>
          </div>

            <button 
            className="btn btn-primary"
            onClick={() => createProviderMutation.mutate()}
            disabled={createProviderMutation.isPending || !newProvider.name}
            style={{ width: '100%' }}
          >
            <Plus size={16} />
            Add Provider
            </button>
        </div>

        {/* Active Providers */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Active Providers</h3>
            <button className="btn btn-sm btn-secondary" onClick={() => providersQuery.refetch()}>
              <RefreshCw size={14} />
            </button>
          </div>
          
          {providers.length === 0 ? (
            <div className="empty-state">
              <Building />
              <p>No providers configured</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {providers.map((p: any) => (
                <div 
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 16,
                    background: 'var(--bg-tertiary)',
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {p.supportedMethods.join(', ')} • {p.supportedCurrencies.join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>{p.feePercentage}%</span>
                    <span className={`status-badge ${p.isActive ? 'healthy' : 'unhealthy'}`}>
                      <span className="status-badge-dot" />
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Service Configuration */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3 className="card-title">Service Configuration</h3>
        </div>
        
        <div className="card-grid">
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>SERVICE URL</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{PAYMENT_URL}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>DEFAULT CURRENCY</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>EUR</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>WALLET STRATEGY</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>multi_category</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>ENABLED CATEGORIES</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>main, casino, sports, bonus</div>
          </div>
        </div>
      </div>
    </div>
  )
}
