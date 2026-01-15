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

const PAYMENT_URL = SERVICE_URLS.payment

// Wrapper for payment service GraphQL with auth token
async function graphqlWithAuth<T = any>(
  query: string, 
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  if (token) {
    // Use authenticated request
    const res = await fetch(SERVICE_URLS.payment, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    })
    
    const data = await res.json()
    if (data.errors) {
      throw new Error(data.errors[0]?.message || 'GraphQL error')
    }
    return data.data
  }
  // Fallback to generated token
  return gql<T>('payment', query, variables)
}

// Keep the old graphql function for backward compatibility (uses generated token)
async function graphql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  return gql<T>('payment', query, variables)
}

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100)
}

type TabId = 'wallets' | 'transactions' | 'reconciliation' | 'settings'

export default function PaymentGateway() {
  const [activeTab, setActiveTab] = useState<TabId>('wallets')
  
  const tabs = [
    { id: 'wallets' as const, label: 'Wallets', icon: Wallet },
    { id: 'transactions' as const, label: 'Transactions', icon: ArrowDownCircle },
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
      {activeTab === 'reconciliation' && <ReconciliationTab />}
      {activeTab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// WALLETS TAB - Payment Flow: System → Provider → User
// ═══════════════════════════════════════════════════════════════════

// Provider definitions
const PROVIDERS = [
  { id: 'provider-stripe', name: 'Stripe', icon: '💳', color: '#635BFF' },
  { id: 'provider-paypal', name: 'PayPal', icon: '🅿️', color: '#003087' },
  { id: 'provider-bank', name: 'Bank Transfer', icon: '🏦', color: '#2E7D32' },
  { id: 'provider-crypto', name: 'Crypto', icon: '₿', color: '#F7931A' },
]

function WalletsTab() {
  const queryClient = useQueryClient()
  const { tokens, user } = useAuth()
  const authToken = tokens?.accessToken
  
  // Active section
  const [activeSection, setActiveSection] = useState<'system' | 'provider' | 'user'>('system')
  
  // System funding form
  const [systemFundForm, setSystemFundForm] = useState({ provider: 'provider-stripe', amount: '10000', currency: 'EUR' })
  
  // Provider to User form  
  const [providerToUserForm, setProviderToUserForm] = useState({ 
    provider: 'provider-stripe', 
    userId: '', 
    amount: '100', 
    currency: 'EUR' 
  })
  
  // User operations form
  const [userDepositForm, setUserDepositForm] = useState({ userId: '', amount: '100', currency: 'EUR', provider: 'provider-stripe' })
  const [userWithdrawForm, setUserWithdrawForm] = useState({ userId: '', amount: '50', currency: 'EUR', provider: 'provider-stripe', bankAccount: '' })
  
  // New user wallet form
  const [newUserForm, setNewUserForm] = useState({ userId: '', currency: 'EUR' })
  
  // Loading states for complex operations
  const [isFundingProvider, setIsFundingProvider] = useState(false)
  const [isFundingUser, setIsFundingUser] = useState(false)

  // Simple state for wallets - no React Query caching issues
  const [walletsList, setWalletsList] = useState<any[]>([])
  const [walletsLoading, setWalletsLoading] = useState(false)
  const [walletsVersion, setWalletsVersion] = useState(0) // Force re-render trigger
  
  // Ledger balances state
  const [providerLedgerBalances, setProviderLedgerBalances] = useState<Record<string, number>>({})
  const [ledgerBalancesLoading, setLedgerBalancesLoading] = useState(false)
  
  // Fetch wallets function - returns the wallets directly
  const fetchWallets = async (): Promise<any[]> => {
    console.log('[Wallets] Fetching from API...')
    setWalletsLoading(true)
    try {
      const result = await graphqlWithAuth(`
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
      console.log('[Wallets] API Response:', JSON.stringify(result, null, 2))
      const wallets = result?.wallets?.nodes || []
      console.log('[Wallets] Parsed wallets:', wallets.length, 'wallets')
      wallets.forEach((w: any) => console.log(`  - ${w.userId}: balance=${w.balance}`))
      return wallets
    } catch (err) {
      console.error('[Wallets] Fetch error:', err)
      return []
    } finally {
      setWalletsLoading(false)
    }
  }
  
  // Fetch provider ledger balances (admin only)
  const fetchProviderLedgerBalances = async () => {
    if (!authToken || !user) return
    
    // Only fetch ledger balances if user is admin
    const isAdmin = user.roles?.includes('admin')
    if (!isAdmin) {
      setLedgerBalancesLoading(false)
      return
    }
    
    setLedgerBalancesLoading(true)
    try {
      const balances: Record<string, number> = {}
      
      // Fetch ledger balances for each provider
      for (const provider of PROVIDERS) {
        try {
          const result = await graphqlWithAuth(`
            query GetProviderLedgerBalance($providerId: String!, $subtype: String!, $currency: String!) {
              providerLedgerBalance(providerId: $providerId, subtype: $subtype, currency: $currency) {
                accountId
                providerId
                balance
                availableBalance
              }
            }
          `, {
            providerId: provider.id,
            subtype: 'deposit',
            currency: 'EUR'
          }, authToken)
          
          if (result?.providerLedgerBalance) {
            balances[provider.id] = result.providerLedgerBalance.balance || 0
          }
        } catch (err: any) {
          // Silently skip authorization errors (user might not be admin)
          const isAuthError = err?.message?.includes('Not authorized') || err?.message?.includes('authorized')
          if (!isAuthError) {
            console.warn(`Failed to fetch ledger balance for ${provider.id}:`, err)
          }
          // Continue - ledger might not be initialized yet or user doesn't have permission
        }
      }
      
      setProviderLedgerBalances(balances)
    } catch (err) {
      // Silently handle errors - user might not have permission
      const isAuthError = (err as any)?.message?.includes('Not authorized') || (err as any)?.message?.includes('authorized')
      if (!isAuthError) {
        console.error('[Ledger] Failed to fetch provider balances:', err)
      }
    } finally {
      setLedgerBalancesLoading(false)
    }
  }
  
  // Load wallets and update state
  const loadWallets = async () => {
    const wallets = await fetchWallets()
    console.log('[Wallets] Updating state with', wallets.length, 'wallets')
    console.log('[Wallets] Provider balances from API:')
    wallets.filter(w => w.userId?.startsWith('provider-')).forEach(w => {
      console.log(`  ${w.userId}: ${w.balance}`)
    })
    
    // Create completely new array to break any references
    const newWallets = wallets.map(w => ({ ...w }))
    setWalletsList(newWallets)
    setWalletsVersion(v => {
      const newVersion = v + 1
      console.log('[Wallets] Version updated:', v, '->', newVersion)
      return newVersion
    })
    
    // Fetch ledger balances
    await fetchProviderLedgerBalances()
    
    // Small delay to ensure state is flushed
    await new Promise(resolve => setTimeout(resolve, 100))
    console.log('[Wallets] State update complete')
    return wallets
  }
  
  // Initial fetch on mount
  useEffect(() => {
    console.log('[Wallets] Initial load on mount')
    loadWallets()
  }, [])
  
  // Categorize wallets from state
  const allWallets = walletsList
  // System wallets are wallets belonging to users with 'system' role
  const systemWallet = allWallets.find((w: any) => {
    // Check if wallet belongs to current user and user has 'system' role
    return w.userId === user?.userId && user?.roles?.includes('system');
  });
  const providerWallets = allWallets.filter((w: any) => w.userId?.startsWith('provider-'));
  const userWallets = allWallets.filter((w: any) => {
    // Exclude provider wallets and system wallets
    return !w.userId?.startsWith('provider-') && !(w.userId === user?.userId && user?.roles?.includes('system'));
  });
  
  console.log('[Wallets] Current state - version:', walletsVersion, 'total:', allWallets.length, 'providers:', providerWallets.length)

  // Helper to refetch wallets data
  const refetchWallets = loadWallets

  // Create wallet mutation
  const createWalletMutation = useMutation({
    mutationFn: async (input: { userId: string; currency: string; category?: string; tenantId?: string }) => {
      return graphqlWithAuth(`
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

  // Fund wallet mutation (wallet transaction) - admin only
  const fundWalletMutation = useMutation({
    mutationFn: async (input: { walletId: string; userId: string; type: string; amount: number; currency: string; description?: string }) => {
      // Check if user is admin before attempting to create wallet transaction
      const isAdmin = user?.roles?.includes('admin')
      if (!isAdmin) {
        throw new Error('Only administrators can fund wallets')
      }
      
      console.log('[Fund] Creating wallet transaction:', input)
      try {
        const result = await graphqlWithAuth(`
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
        return result
      } catch (err: any) {
        // Handle authorization errors gracefully
        const isAuthError = err?.message?.includes('Not authorized') || err?.message?.includes('authorized')
        if (isAuthError) {
          throw new Error('You do not have permission to perform this action. Administrator access required.')
        }
        throw err
      }
    },
  })

  // Create deposit (through payment gateway)
  const createDepositMutation = useMutation({
    mutationFn: async (input: { userId: string; amount: number; currency: string; method?: string; tenantId?: string }) => {
      console.log('[Deposit] Creating deposit:', input)
      try {
        const result = await graphqlWithAuth(`
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
              errors
            }
          }
        `, { 
          input: {
            ...input,
            tenantId: input.tenantId || 'default-tenant'
          }
        }, authToken)
        console.log('[Deposit] Result:', result)
        
        if (result?.createDeposit?.errors && result.createDeposit.errors.length > 0) {
          throw new Error(result.createDeposit.errors.join(', '))
        }
        
        return result
      } catch (error: any) {
        // Check if error is related to ledger
        const errorMsg = error.message || String(error)
        if (errorMsg.includes('ledger') || errorMsg.includes('Insufficient') || errorMsg.includes('balance')) {
          throw new Error(`Ledger Error: ${errorMsg}. Please check provider account balance.`)
        }
        throw error
      }
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      
      // Auto-approve deposit to complete the flow (like in tests)
      const depositId = result?.createDeposit?.deposit?.id
      if (depositId) {
        try {
          // Wait a moment for transaction to be created
          await new Promise(resolve => setTimeout(resolve, 500))
          
          // Approve the transaction to complete the deposit flow
          await graphqlWithAuth(`
            mutation ApproveTransaction($transactionId: String!) {
              approveTransaction(transactionId: $transactionId) {
                success
                transaction {
                  id
                  status
                }
              }
            }
          `, { transactionId: depositId }, authToken)
          
          console.log('[Deposit] Transaction approved successfully')
        } catch (approveError: any) {
          console.warn('[Deposit] Auto-approval failed (may need manual approval):', approveError)
          // Don't fail the deposit creation - user can approve manually
        }
      }
      
      // Wait for sync to complete
      await new Promise(resolve => setTimeout(resolve, 1000))
      refetchWallets()
      fetchProviderLedgerBalances() // Refresh ledger balances
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
        const result = await graphqlWithAuth(`
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
      const withdrawalId = result?.createWithdrawal?.withdrawal?.id
      if (withdrawalId) {
        try {
          // Wait a moment for transaction to be created
          await new Promise(resolve => setTimeout(resolve, 500))
          
          // Approve the transaction to complete the withdrawal flow
          await graphqlWithAuth(`
            mutation ApproveTransaction($transactionId: String!) {
              approveTransaction(transactionId: $transactionId) {
                success
                transaction {
                  id
                  status
                }
              }
            }
          `, { transactionId: withdrawalId }, authToken)
          
          console.log('[Withdrawal] Transaction approved successfully')
        } catch (approveError: any) {
          console.warn('[Withdrawal] Auto-approval failed (may need manual approval):', approveError)
          // Don't fail the withdrawal creation - user can approve manually
        }
      }
      
      // Wait for sync to complete
      await new Promise(resolve => setTimeout(resolve, 1000))
      refetchWallets()
      fetchProviderLedgerBalances() // Refresh ledger balances
    },
    onError: (error: any) => {
      console.error('[Withdrawal] Error:', error)
      const errorMsg = error.message || 'Unknown error'
      alert(`Withdrawal failed: ${errorMsg}`)
    },
  })

  // Initialize system wallet if needed
  const initializeSystem = async () => {
    if (!systemWallet) {
      await createWalletMutation.mutateAsync({ 
        userId: 'system', 
        currency: 'EUR', 
        category: 'main',
        tenantId: 'default-tenant'
      })
      await refetchWallets()
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

  // System funds provider
  const handleSystemFundProvider = async () => {
    console.log('[FundProvider] Starting...')
    setIsFundingProvider(true)

    try {
      let walletId: string | null = null

      // Check if provider wallet exists
      console.log('[FundProvider] Looking for provider wallet:', systemFundForm.provider)
      console.log('[FundProvider] Current provider wallets:', providerWallets)
      const existingWallet = providerWallets.find((w: any) => w.userId === systemFundForm.provider)

      if (existingWallet) {
        console.log('[FundProvider] Found existing wallet:', existingWallet)
        walletId = existingWallet.id
      } else {
        console.log('[FundProvider] Creating new provider wallet...')
        // Create the provider wallet first and get the ID from response
        const createResult = await createWalletMutation.mutateAsync({
          userId: systemFundForm.provider,
          currency: 'EUR',
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
          const newWallet = refreshedWallets.find((w: any) => w.userId === systemFundForm.provider)
          walletId = newWallet?.id
          console.log('[FundProvider] Found wallet after refetch:', newWallet)
        }
      }

      if (!walletId) {
        alert('Could not create or find provider wallet. Please try again.')
        return
      }

      console.log('[FundProvider] Funding wallet:', walletId)
      // Fund the wallet
      const fundResult = await fundWalletMutation.mutateAsync({
        walletId,
        userId: 'system',
        type: 'deposit',
        amount: parseFloat(systemFundForm.amount) * 100,
        currency: systemFundForm.currency,
        description: `System funding to ${PROVIDERS.find(p => p.id === systemFundForm.provider)?.name}`,
      })
      console.log('[FundProvider] Fund result:', fundResult)

      // Refetch to update UI with new balance
      console.log('[FundProvider] Refetching wallets to update UI...')
      const updatedWallets = await refetchWallets() // Now returns array directly
      console.log('[FundProvider] Updated wallets:', updatedWallets)
      const updatedProvider = updatedWallets.find((w: any) => w.userId === systemFundForm.provider)
      console.log('[FundProvider] Updated provider balance:', updatedProvider?.balance)
      
      // Refresh ledger balances
      await fetchProviderLedgerBalances()
      
      console.log('[FundProvider] Done!')
      alert('Provider funded successfully!')
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
      const userWallet = userWallets.find((w: any) => w.userId === providerToUserForm.userId)
      if (!userWallet) {
        alert('User wallet not found. Create user wallet first.')
        return
      }
      
      await fundWalletMutation.mutateAsync({
        walletId: userWallet.id,
        userId: providerToUserForm.provider,
        type: 'deposit',
        amount: parseFloat(providerToUserForm.amount) * 100,
        currency: providerToUserForm.currency,
        description: `Deposit via ${PROVIDERS.find(p => p.id === providerToUserForm.provider)?.name}`,
      })
      
      // Refetch to update UI with new balance
      await refetchWallets()
      // Refresh ledger balances
      await fetchProviderLedgerBalances()
    } catch (err: any) {
      console.error('Error funding user:', err)
      const errorMsg = err.message || 'Unknown error'
      if (errorMsg.includes('ledger') || errorMsg.includes('Insufficient')) {
        alert(`Ledger Error: ${errorMsg}. Please check provider account balance in ledger.`)
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
      await createDepositMutation.mutateAsync({
        userId: userDepositForm.userId,
        amount: parseFloat(userDepositForm.amount) * 100,
        currency: userDepositForm.currency,
        method: 'card',
      })
      alert('Deposit request created successfully!')
    } catch (error) {
      console.error('[handleUserDeposit] Error:', error)
    }
  }

  // User withdrawal request
  const handleUserWithdraw = async () => {
    try {
      await createWithdrawalMutation.mutateAsync({
        userId: userWithdrawForm.userId,
        amount: parseFloat(userWithdrawForm.amount) * 100,
        currency: userWithdrawForm.currency,
        method: 'bank_transfer',
        bankAccount: userWithdrawForm.bankAccount,
      })
      alert('Withdrawal request created successfully!')
    } catch (error) {
      console.error('[handleUserWithdraw] Error:', error)
    }
  }

  // Create user wallet
  const handleCreateUserWallet = async () => {
    await createWalletMutation.mutateAsync({
      userId: newUserForm.userId,
      currency: newUserForm.currency,
      category: 'main',
      tenantId: 'default-tenant',
    })
    setNewUserForm({ userId: '', currency: 'EUR' })
    // Refetch to show new wallet
    await refetchWallets()
  }

  // Calculate totals
  const systemBalance = systemWallet?.balance || 0
  const providerTotalBalance = providerWallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0)
  const userTotalBalance = userWallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0)

  // Force re-render key
  const renderKey = `wallets-${walletsVersion}-${allWallets.length}-${providerWallets.reduce((sum, w) => sum + (w.balance || 0), 0)}`
  
  return (
    <div key={renderKey}>
      {/* Header with refresh */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button 
          className="btn btn-secondary btn-sm"
          onClick={() => refetchWallets()}
          disabled={walletsLoading}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
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
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, fontFamily: 'var(--font-mono)', color: activeSection === 'system' ? 'white' : 'var(--accent-cyan)' }}>
                {formatCurrency(systemBalance)}
              </div>
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
              <div style={{ fontSize: 12, color: activeSection === 'provider' ? 'rgba(255,255,255,0.8)' : 'var(--text-muted)' }}>Stripe, PayPal, etc.</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8, fontFamily: 'var(--font-mono)', color: activeSection === 'provider' ? 'white' : 'var(--accent-purple)' }}>
                {formatCurrency(providerTotalBalance)}
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
                {formatCurrency(userTotalBalance)}
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
                    {PROVIDERS.map(p => (
                      <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                    ))}
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
                    <select className="input" value={systemFundForm.currency} onChange={e => setSystemFundForm({ ...systemFundForm, currency: e.target.value })}>
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="GBP">GBP</option>
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
                  {isFundingProvider || fundWalletMutation.isPending ? 'Processing...' : `Fund ${PROVIDERS.find(p => p.id === systemFundForm.provider)?.name}`}
                </button>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-muted)' }}>
                  PROVIDER BALANCES {ledgerBalancesLoading && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(Loading ledger...)</span>}
                </div>
                {PROVIDERS.map(provider => {
                  const wallet = providerWallets.find((w: any) => w.userId === provider.id)
                  const ledgerBalance = providerLedgerBalances[provider.id]
                  const balanceKey = `${provider.id}-${wallet?.balance || 0}-${ledgerBalance || 0}-${wallet?.updatedAt || 'none'}`
                  const hasLedgerBalance = ledgerBalance !== undefined && ledgerBalance !== null
                  const walletBalance = wallet?.balance || 0
                  const balanceMismatch = hasLedgerBalance && Math.abs(walletBalance - ledgerBalance) > 0.01
                  
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
                        borderLeft: `4px solid ${provider.color}`,
                        border: balanceMismatch ? `2px solid var(--accent-orange)` : undefined,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 20 }}>{provider.icon}</span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{provider.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{provider.id}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {hasLedgerBalance ? (
                          <>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-green)', fontSize: 14 }}>
                              {formatCurrency(ledgerBalance)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                              Ledger Balance
                            </div>
                            {balanceMismatch && (
                              <div style={{ fontSize: 10, color: 'var(--accent-orange)', marginTop: 2 }}>
                                Wallet: {formatCurrency(walletBalance)} ⚠️
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: wallet?.balance ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                              {wallet ? formatCurrency(wallet.balance) : '—'}
                            </div>
                            {wallet && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                Wallet Balance
                              </div>
                            )}
                          </>
                        )}
                        {!wallet && (
                          <button 
                            className="btn btn-sm btn-secondary"
                            onClick={() => initializeProvider(provider.id)}
                            style={{ marginTop: 4 }}
                          >
                            Create
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
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
                      {PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                      ))}
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
                      {userWallets.map((w: any) => (
                        <option key={w.id} value={w.userId}>{w.userId} ({formatCurrency(w.balance)})</option>
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
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
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
                    const provider = PROVIDERS.find(p => p.id === wallet.userId)
                    return (
                      <div 
                        key={wallet.id}
                        style={{ 
                          padding: '12px',
                          background: 'var(--bg-tertiary)',
                          borderRadius: 8,
                          marginBottom: 8,
                          borderLeft: `4px solid ${provider?.color || 'var(--border)'}`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>{provider?.icon || '💰'}</span>
                            <span style={{ fontWeight: 500 }}>{provider?.name || wallet.userId}</span>
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-green)' }}>
                            {formatCurrency(wallet.balance)}
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

                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="input" value={newUserForm.currency} onChange={e => setNewUserForm({ ...newUserForm, currency: e.target.value })}>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                  </select>
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
                    {userWallets.map((w: any) => (
                      <option key={w.id} value={w.userId}>{w.userId}</option>
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
                    <label className="form-label">Via Provider</label>
                    <select className="input" value={userDepositForm.provider} onChange={e => setUserDepositForm({ ...userDepositForm, provider: e.target.value })}>
                      {PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
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
                    {userWallets.map((w: any) => (
                      <option key={w.id} value={w.userId}>{w.userId}</option>
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
                    <label className="form-label">Via Provider</label>
                    <select className="input" value={userWithdrawForm.provider} onChange={e => setUserWithdrawForm({ ...userWithdrawForm, provider: e.target.value })}>
                      {PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
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
                      <td style={{ padding: '12px 8px', fontSize: 14 }}>{w.currency}</td>
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

  // Fetch all transaction types with pagination
  const depositsQuery = useQuery({
    queryKey: ['deposits', pagination, filters],
    queryFn: () => graphql(`
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
            providerName
            createdAt
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
      filter: buildApiFilter()
    }),
  })

  const withdrawalsQuery = useQuery({
    queryKey: ['withdrawals', pagination, filters],
    queryFn: () => graphql(`
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
            providerName
            createdAt
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
      filter: buildApiFilter()
    }),
  })

  const walletTxQuery = useQuery({
    queryKey: ['walletTransactions', pagination, filters],
    queryFn: () => graphql(`
      query ListWalletTransactions($first: Int, $skip: Int, $filter: JSON) {
        walletTransactions(first: $first, skip: $skip, filter: $filter) {
          nodes {
            id
            walletId
            userId
            type
            balanceType
            currency
            amount
            balance
            refId
            refType
            description
            createdAt
          }
          totalCount
          pageInfo {
            hasNextPage
            hasPreviousPage
          }
        }
      }
    `, { 
      first: pagination.pageSize * 2, 
      skip: pagination.page * pagination.pageSize * 2,
      filter: buildApiFilter()
    }),
  })

  // Create mutations
  const createDepositMutation = useMutation({
    mutationFn: () => graphqlWithAuth(`
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
          errors
        }
      }
    `, { input: { ...depositForm, amount: parseFloat(depositForm.amount) * 100, tenantId: 'default-tenant' } }, authToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits'] })
      queryClient.invalidateQueries({ queryKey: ['walletTransactions'] })
      queryClient.invalidateQueries({ queryKey: ['statement'] })
      setShowCreateForm(null)
      setDepositForm({ userId: '', amount: '100', currency: 'EUR', method: 'card' })
    },
  })

  const createWithdrawalMutation = useMutation({
    mutationFn: () => graphqlWithAuth(`
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
          errors
        }
      }
    `, { input: { ...withdrawalForm, amount: parseFloat(withdrawalForm.amount) * 100, tenantId: 'default-tenant' } }, authToken),
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] })
      
      // Auto-approve withdrawal to complete the flow
      const withdrawalId = result?.createWithdrawal?.withdrawal?.id
      if (withdrawalId) {
        try {
          await new Promise(resolve => setTimeout(resolve, 500))
          await graphqlWithAuth(`
            mutation ApproveTransaction($transactionId: String!) {
              approveTransaction(transactionId: $transactionId) {
                success
                transaction {
                  id
                  status
                }
              }
            }
          `, { transactionId: withdrawalId }, authToken)
        } catch (approveError: any) {
          console.warn('[Withdrawal] Auto-approval failed:', approveError)
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000))
      queryClient.invalidateQueries({ queryKey: ['walletTransactions'] })
      queryClient.invalidateQueries({ queryKey: ['statement'] })
      setShowCreateForm(null)
      setWithdrawalForm({ userId: '', amount: '50', currency: 'EUR', method: 'bank_transfer', bankAccount: '' })
    },
  })

  // Extract data from responses
  const deposits = depositsQuery.data?.deposits?.nodes || []
  const withdrawals = withdrawalsQuery.data?.withdrawals?.nodes || []
  const walletTx = walletTxQuery.data?.walletTransactions?.nodes || []
  
  const depositsTotalCount = depositsQuery.data?.deposits?.totalCount || 0
  const withdrawalsTotalCount = withdrawalsQuery.data?.withdrawals?.totalCount || 0
  const walletTxTotalCount = walletTxQuery.data?.walletTransactions?.totalCount || 0

  // Combine all transactions into unified statement
  const allTransactions = [
    ...deposits.map((tx: any) => ({
      ...tx,
      _source: 'deposit' as const,
      _isCredit: true,
      _displayType: 'Deposit',
      _displayAmount: tx.amount,
      _displayStatus: tx.status,
      _sortDate: new Date(tx.createdAt).getTime(),
    })),
    ...withdrawals.filter((tx: any) => tx.type === 'withdrawal').map((tx: any) => ({
      ...tx,
      _source: 'withdrawal' as const,
      _isCredit: false,
      _displayType: 'Withdrawal',
      _displayAmount: tx.amount,
      _displayStatus: tx.status,
      _sortDate: new Date(tx.createdAt).getTime(),
    })),
    ...walletTx.map((tx: any) => ({
      ...tx,
      _source: 'wallet' as const,
      _isCredit: ['deposit', 'win', 'bonus_credit', 'refund', 'transfer_in'].includes(tx.type),
      _displayType: tx.type,
      _displayAmount: tx.amount,
      _displayStatus: 'completed',
      _sortDate: new Date(tx.createdAt).getTime(),
    })),
  ].sort((a, b) => b._sortDate - a._sortDate)

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
    walletTxCount: walletTxTotalCount,
  }

  const isLoading = depositsQuery.isLoading || withdrawalsQuery.isLoading || walletTxQuery.isLoading

  const refetchAll = () => {
    depositsQuery.refetch()
    withdrawalsQuery.refetch()
    walletTxQuery.refetch()
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
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats.walletTxCount} balance changes</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <FileText size={18} />
              Total Records
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 28 }}>
            {totalItems}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>showing {paginatedTransactions.length}</div>
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
                        {new Date(tx.createdAt).toLocaleString()}
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
                      <td style={{ padding: '10px 8px', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{tx.userId}</td>
                      <td style={{ padding: '10px 8px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx.description || tx.method || tx.providerName || '-'}
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
                          {tx._displayStatus === 'processing' && tx._source !== 'wallet' && (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={async () => {
                                try {
                                  await graphqlWithAuth(`
                                    mutation ApproveTransaction($transactionId: String!) {
                                      approveTransaction(transactionId: $transactionId) {
                                        success
                                        transaction {
                                          id
                                          status
                                        }
                                      }
                                    }
                                  `, { transactionId: tx.id }, authToken)
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
                          )}
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
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
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
              onClick={() => createDepositMutation.mutate()}
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
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
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
  const txQuery = useQuery({
    queryKey: ['reconciliation', dateRange],
    queryFn: () => graphql(`
      query GetReconciliationData($txFirst: Int, $walletFirst: Int) {
        walletTransactions(first: $txFirst) {
          nodes {
            id
            walletId
            userId
            type
            balanceType
            currency
            amount
            balance
            refId
            refType
            description
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
    }),
  })

  const transactions = txQuery.data?.walletTransactions?.nodes || []
  const wallets = txQuery.data?.wallets?.nodes || []

  // Calculate summary
  const summary = transactions.reduce((acc: any, tx: any) => {
    const type = tx.type
    if (!acc[type]) acc[type] = { count: 0, total: 0 }
    acc[type].count++
    acc[type].total += tx.amount
    return acc
  }, {})

  const totalDeposits = summary.deposit?.total || 0
  const totalWithdrawals = summary.withdrawal?.total || 0
  const totalBets = summary.bet?.total || 0
  const totalWins = summary.win?.total || 0
  const totalBonuses = summary.bonus_credit?.total || 0

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
              <span style={{ color: 'var(--text-secondary)' }}>Fees</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 600 }}>
                -€0.00
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', background: 'var(--bg-tertiary)', borderRadius: 8, paddingLeft: 12, paddingRight: 12 }}>
              <span style={{ fontWeight: 600 }}>Total Outflows</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-red)', fontWeight: 700, fontSize: 18 }}>
                {formatCurrency(totalWithdrawals + totalBets)}
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
              {formatCurrency((totalDeposits + totalWins + totalBonuses) - (totalWithdrawals + totalBets))}
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
  const providersQuery = useQuery({
    queryKey: ['providerConfigs'],
    queryFn: () => graphql(`
      query ListProviders($input: JSON) {
        providerConfigs(input: $input)
      }
    `, { input: { first: 50 } }),
  })

  // Create provider mutation - API uses JSON input/output
  const createProviderMutation = useMutation({
    mutationFn: () => graphql(`
      mutation CreateProvider($input: JSON) {
        createProviderConfig(input: $input)
      }
    `, {
      input: {
        ...newProvider,
        feePercentage: parseFloat(newProvider.feePercentage),
      }
    }),
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
