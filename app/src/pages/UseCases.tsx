import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { 
  CreditCard, 
  Gift, 
  TrendingUp,
  PlayCircle,
  Users,
} from 'lucide-react'
import { graphql as gql } from '../lib/graphql-utils'
import { SERVICE_URLS } from '../lib/graphql-utils'
import { useAuth } from '../lib/auth-context'
import { hasRole } from '../lib/access'

/**
 * Real-World Use Cases Page
 * 
 * Demonstrates actual scenarios from payment and bonus tests:
 * 1. Complete Payment Flow: Fund provider → User deposit → Balance verification
 * 2. User-to-User Funding: System → Provider transfer
 * 3. Bonus Eligibility: Check and claim bonuses
 * 4. Bonus Turnover Tracking: Track wagering requirements
 */

type UseCaseId = 'payment-flow' | 'user-funding' | 'bonus-eligibility' | 'bonus-tracking'

interface UseCase {
  id: UseCaseId
  title: string
  description: string
  icon: React.ElementType
  steps: string[]
}

const useCases: UseCase[] = [
  {
    id: 'payment-flow',
    title: 'Complete Payment Flow',
    description: 'Fund provider → User deposit → Balance verification (from payment-test-flow.ts)',
    icon: CreditCard,
    steps: [
      'Fund payment-provider from system (€10,000)',
      'End-user deposits from payment-provider (€500)',
      'Verify balances: System (-€10,000), Provider (€9,500), User (€485.50)',
    ],
  },
  {
    id: 'user-funding',
    title: 'User-to-User Funding',
    description: 'Transfer funds between system users (from payment-test-funding.ts)',
    icon: Users,
    steps: [
      'Select source user (system)',
      'Select destination user (payment-provider)',
      'Enter amount and currency',
      'Execute transfer and verify ledger entries',
    ],
  },
  {
    id: 'bonus-eligibility',
    title: 'Bonus Eligibility Check',
    description: 'Check and claim eligible bonuses (from bonus-test-all.ts)',
    icon: Gift,
    steps: [
      'Fetch available bonus templates',
      'Check eligibility based on user context',
      'Display eligible bonuses with calculated values',
      'Claim bonus and track ledger entry',
    ],
  },
  {
    id: 'bonus-tracking',
    title: 'Bonus Turnover Tracking',
    description: 'Track wagering requirements and bonus progress',
    icon: TrendingUp,
    steps: [
      'View active bonuses with turnover requirements',
      'Record activity/turnover transactions',
      'Track progress toward wagering completion',
      'Convert bonus to real balance when complete',
    ],
  },
]

export default function UseCases() {
  const { tokens } = useAuth()
  const [activeUseCase, setActiveUseCase] = useState<UseCaseId>('payment-flow')
  const [executionLog, setExecutionLog] = useState<string[]>([])
  const [isRunning, setIsRunning] = useState(false)

  const selectedUseCase = useCases.find(uc => uc.id === activeUseCase)!

  // Payment Flow State
  const [paymentFlowState, setPaymentFlowState] = useState({
    providerUserId: '',
    endUserId: '',
    fundingAmount: '10000',
    depositAmount: '500',
    currency: 'EUR',
  })

  // User Funding State
  const [fundingState, setFundingState] = useState({
    fromUserId: '',
    toUserId: '',
    amount: '10000',
    currency: 'EUR',
  })

  // Bonus Eligibility State
  const [bonusState, setBonusState] = useState({
    userId: '',
    currency: 'USD',
    depositAmount: '100',
  })

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'
    setExecutionLog(prev => [...prev, `[${timestamp}] ${icon} ${message}`])
  }

  const clearLog = () => setExecutionLog([])

  // Fetch users for dropdowns
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      if (!tokens?.accessToken) return []
      const data = await gql<{ users: { nodes: Array<{ id: string; email: string; roles: string[] }> } }>(
        SERVICE_URLS.auth,
        `
          query GetUsers($first: Int) {
            users(first: $first) {
              nodes {
                id
                email
                roles
              }
            }
          }
        `,
        { first: 100 }
      )
      return data.users.nodes
    },
    enabled: !!tokens?.accessToken,
  })

  // Complete Payment Flow Use Case
  const paymentFlowMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Not authenticated')
      
      setIsRunning(true)
      clearLog()
      addLog('Starting Complete Payment Flow...')

      try {
        // Step 1: Find wallets
        addLog('Finding wallets...')
        const wallets = await gql<{ wallets: { nodes: Array<{ id: string; userId: string; currency: string }> } }>(
          'payment',
          `
            query GetWallets($first: Int) {
              wallets(first: $first) {
                nodes {
                  id
                  userId
                  currency
                  balance
                }
              }
            }
          `,
          { first: 100 }
        )

        // Get system user
        const systemUser = usersQuery.data?.find(u => hasRole(u.roles, 'system'))
        if (!systemUser) {
          throw new Error('System user not found')
        }

        const systemWallet = wallets.wallets.nodes.find(
          w => w.userId === systemUser.id && w.currency === paymentFlowState.currency
        )
        const providerWallet = wallets.wallets.nodes.find(
          w => w.userId === paymentFlowState.providerUserId && w.currency === paymentFlowState.currency
        )

        if (!systemWallet || !providerWallet) {
          throw new Error('Wallets not found. Please ensure wallets exist for these users.')
        }

        // Step 2: Fund provider from system
        addLog(`Step 1: Funding provider with €${(parseFloat(paymentFlowState.fundingAmount) / 100).toFixed(2)}`)
        
        // Use createTransfer mutation
        const transferResult = await gql<{ createTransfer: { success: boolean; transfer?: { id: string } } }>(
          'payment',
          `
            mutation CreateTransfer($input: CreateTransferInput!) {
              createTransfer(input: $input) {
                success
                transfer {
                  id
                }
                errors
              }
            }
          `,
          {
            input: {
              fromUserId: systemUser.id,
              toUserId: paymentFlowState.providerUserId,
              amount: parseFloat(paymentFlowState.fundingAmount),
              currency: paymentFlowState.currency,
              description: `Fund provider: ${paymentFlowState.providerUserId}`,
            },
          }
        )

        const fundResult = transferResult.createTransfer.success

        if (!fundResult) {
          throw new Error('Funding failed')
        }
        addLog('✅ Provider funded successfully', 'success')

        // Step 2: User deposit
        addLog(`Step 2: User deposits €${(parseFloat(paymentFlowState.depositAmount) / 100).toFixed(2)}`)
        
        const depositResult = await gql<{ createDeposit: { success: boolean; deposit?: { id: string; amount: number; feeAmount: number; netAmount: number }; errors?: string[] } }>(
          'payment',
          `
            mutation CreateDeposit($input: CreateDepositInput!) {
              createDeposit(input: $input) {
                success
                deposit {
                  id
                  amount
                  feeAmount
                  netAmount
                }
                errors
              }
            }
          `,
          {
            input: {
              userId: paymentFlowState.endUserId,
              amount: parseFloat(paymentFlowState.depositAmount),
              currency: paymentFlowState.currency,
              method: 'card',
              fromUserId: paymentFlowState.providerUserId,
              tenantId: 'default-tenant',
            },
          }
        )

        if (!depositResult.createDeposit.success || !depositResult.createDeposit.deposit) {
          const errors = depositResult.createDeposit.errors || ['Deposit failed']
          throw new Error(errors.join(', '))
        }
        
        const deposit = depositResult.createDeposit.deposit
        addLog(`✅ Deposit completed successfully`, 'success')
        addLog(`   Amount: €${(deposit.amount / 100).toFixed(2)}`, 'info')
        addLog(`   Fee: €${(deposit.feeAmount / 100).toFixed(2)}`, 'info')
        addLog(`   Net: €${(deposit.netAmount / 100).toFixed(2)}`, 'info')

        // Step 3: Verify balances
        addLog('Step 3: Verifying balances...')
        
        // Reuse systemUser from earlier in the function
        if (!systemUser) {
          throw new Error('System user not found')
        }

        const systemBalance = await gql<{ walletBalance: { balance: number } }>(
          'payment',
          `
            query GetBalance($userId: String!, $category: String, $currency: String!) {
              walletBalance(userId: $userId, category: $category, currency: $currency) {
                balance
              }
            }
          `,
          {
            userId: systemUser.id,
            category: 'main',
            currency: paymentFlowState.currency,
          }
        )

        const providerBalance = await gql<{ walletBalance: { balance: number } }>(
          'payment',
          `
            query GetBalance($userId: String!, $category: String, $currency: String!) {
              walletBalance(userId: $userId, category: $category, currency: $currency) {
                balance
              }
            }
          `,
          {
            userId: paymentFlowState.providerUserId,
            category: 'main',
            currency: paymentFlowState.currency,
          }
        )

        const userBalance = await gql<{ walletBalance: { balance: number } }>(
          'payment',
          `
            query GetBalance($userId: String!, $category: String, $currency: String!) {
              walletBalance(userId: $userId, category: $category, currency: $currency) {
                balance
              }
            }
          `,
          {
            userId: paymentFlowState.endUserId,
            category: 'main',
            currency: paymentFlowState.currency,
          }
        )

        addLog(`System Balance: €${(systemBalance.walletBalance.balance / 100).toFixed(2)}`, 'success')
        addLog(`Provider Balance: €${(providerBalance.walletBalance.balance / 100).toFixed(2)}`, 'success')
        addLog(`User Balance: €${(userBalance.walletBalance.balance / 100).toFixed(2)}`, 'success')
        addLog('✅ Payment flow completed successfully!', 'success')

        return { success: true }
      } catch (error: any) {
        addLog(`Error: ${error.message}`, 'error')
        throw error
      } finally {
        setIsRunning(false)
      }
    },
  })

  // User Funding Use Case
  const userFundingMutation = useMutation({
    mutationFn: async () => {
      if (!tokens?.accessToken) throw new Error('Not authenticated')
      
      setIsRunning(true)
      clearLog()
      addLog(`Transferring €${(parseFloat(fundingState.amount) / 100).toFixed(2)} from ${fundingState.fromUserId} to ${fundingState.toUserId}...`)

      try {
        // Find wallets
        const wallets = await gql<{ wallets: { nodes: Array<{ id: string; userId: string; currency: string }> } }>(
          'payment',
          `
            query GetWallets($first: Int) {
              wallets(first: $first) {
                nodes {
                  id
                  userId
                  currency
                  balance
                }
              }
            }
          `,
          { first: 100 }
        )

        const fromWallet = wallets.wallets.nodes.find(
          w => w.userId === fundingState.fromUserId && w.currency === fundingState.currency
        )
        const toWallet = wallets.wallets.nodes.find(
          w => w.userId === fundingState.toUserId && w.currency === fundingState.currency
        )

        if (!fromWallet || !toWallet) {
          throw new Error('Wallets not found')
        }

        // Create transfer_out
        const transferOut = await gql<{ createWalletTransaction: { success: boolean; walletTransaction?: { id: string } } }>(
          'payment',
          `
            mutation TransferOut($input: CreateWalletTransactionInput!) {
              createWalletTransaction(input: $input) {
                success
                walletTransaction {
                  id
                  balance
                }
              }
            }
          `,
          {
            input: {
              walletId: fromWallet.id,
              userId: fundingState.fromUserId,
              type: 'transfer_out',
              amount: parseFloat(fundingState.amount),
              currency: fundingState.currency,
              balanceType: 'real',
              description: `Transfer to ${fundingState.toUserId}`,
            },
          }
        )

        // Create transfer_in
        const transferIn = await gql<{ createWalletTransaction: { success: boolean; walletTransaction?: { id: string } } }>(
          'payment',
          `
            mutation TransferIn($input: CreateWalletTransactionInput!) {
              createWalletTransaction(input: $input) {
                success
                walletTransaction {
                  id
                  balance
                }
              }
            }
          `,
          {
            input: {
              walletId: toWallet.id,
              userId: fundingState.toUserId,
              type: 'transfer_in',
              amount: parseFloat(fundingState.amount),
              currency: fundingState.currency,
              balanceType: 'real',
              description: `Transfer from ${fundingState.fromUserId}`,
            },
          }
        )

        if (transferOut.createWalletTransaction.success && transferIn.createWalletTransaction.success) {
          addLog('✅ Transfer completed successfully!', 'success')
          addLog(`From Transaction: ${transferOut.createWalletTransaction.walletTransaction?.id}`, 'success')
          addLog(`To Transaction: ${transferIn.createWalletTransaction.walletTransaction?.id}`, 'success')
        } else {
          throw new Error('Transfer failed')
        }

        return { success: true }
      } catch (error: any) {
        addLog(`Error: ${error.message}`, 'error')
        throw error
      } finally {
        setIsRunning(false)
      }
    },
  })

  // Bonus Eligibility Use Case
  const bonusEligibilityQuery = useQuery({
    queryKey: ['bonusEligibility', bonusState.userId, bonusState.currency],
    queryFn: async () => {
      if (!tokens?.accessToken || !bonusState.userId) return null

      // Fetch available bonuses
      const templates = await gql<{ availableBonuses: Array<{
        id: string
        name: string
        code: string
        type: string
        value: number
        valueType: string
        currency: string
        maxValue?: number
        minDeposit?: number
        turnoverMultiplier: number
        validFrom: string
        validUntil: string
        isActive: boolean
      }> }>(
        'bonus',
        `
          query GetAvailableBonuses($currency: String) {
            availableBonuses(currency: $currency) {
              id
              name
              code
              type
              value
              valueType
              currency
              maxValue
              minDeposit
              turnoverMultiplier
              validFrom
              validUntil
              isActive
            }
          }
        `,
        { currency: bonusState.currency }
      )

      return templates.availableBonuses
    },
    enabled: !!tokens?.accessToken && !!bonusState.userId,
  })

  const claimBonusMutation = useMutation({
    mutationFn: async (templateCode: string) => {
      if (!tokens?.accessToken) throw new Error('Not authenticated')
      
      setIsRunning(true)
      addLog(`Claiming bonus: ${templateCode}...`)

      try {
        const result = await gql<{ createUserBonus: { success: boolean; userBonus?: { id: string } } }>(
          'bonus',
          `
            mutation CreateUserBonus($input: CreateUserBonusInput!) {
              createUserBonus(input: $input) {
                success
                userBonus {
                  id
                  type
                  status
                  originalValue
                }
                errors
              }
            }
          `,
          {
            input: {
              userId: bonusState.userId,
              templateCode,
              currency: bonusState.currency,
              tenantId: 'default-tenant',
            },
          }
        )

        if (!result.createUserBonus.success) {
          const errorMsg = (result.createUserBonus as any)?.errors?.join(', ') || 'Failed to claim bonus'
          throw new Error(errorMsg)
        }

        addLog(`✅ Bonus claimed successfully! ID: ${result.createUserBonus.userBonus?.id}`, 'success')
        return result
      } catch (error: any) {
        addLog(`Error: ${error.message}`, 'error')
        throw error
      } finally {
        setIsRunning(false)
      }
    },
  })

  // Auto-populate user IDs from common test users
  const populateTestUsers = () => {
    const users = usersQuery.data || []
    const systemUser = users.find(u => hasRole(u.roles, 'system'))
    const providerUser = users.find(u => u.email === 'payment-provider@system.com')
    const endUser = users.find(u => u.email === 'test-end-user@demo.com') || users.find(u => hasRole(u.roles, 'user'))

    if (systemUser) {
      setFundingState(prev => ({ ...prev, fromUserId: systemUser.id }))
    }
    if (providerUser) {
      setPaymentFlowState(prev => ({ ...prev, providerUserId: providerUser.id }))
      setFundingState(prev => ({ ...prev, toUserId: providerUser.id }))
    }
    if (endUser) {
      setPaymentFlowState(prev => ({ ...prev, endUserId: endUser.id }))
      setBonusState(prev => ({ ...prev, userId: endUser.id }))
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Real-World Use Cases</h1>
        <p className="page-subtitle">Demonstrate actual scenarios from payment and bonus tests</p>
      </div>

      {/* Use Case Selector */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h3 className="card-title">Select Use Case</h3>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, padding: 16 }}>
          {useCases.map(uc => {
            const Icon = uc.icon
            return (
              <button
                key={uc.id}
                onClick={() => {
                  setActiveUseCase(uc.id)
                  clearLog()
                }}
                className={`card ${activeUseCase === uc.id ? 'border-accent-cyan' : ''}`}
                style={{
                  textAlign: 'left',
                  padding: 16,
                  cursor: 'pointer',
                  border: activeUseCase === uc.id ? '2px solid var(--accent-cyan)' : '1px solid var(--border)',
                  background: activeUseCase === uc.id ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <Icon size={24} style={{ color: 'var(--accent-cyan)' }} />
                  <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{uc.title}</h4>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {uc.description}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid-2">
        {/* Use Case Form */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">{selectedUseCase.title}</h3>
          </div>

          <div style={{ padding: 16 }}>
            {/* Steps */}
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Steps:</h4>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {selectedUseCase.steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Payment Flow Form */}
            {activeUseCase === 'payment-flow' && (
              <div>
                <button
                  onClick={populateTestUsers}
                  className="btn btn-secondary"
                  style={{ marginBottom: 16 }}
                  disabled={usersQuery.isLoading}
                >
                  Auto-fill Test Users
                </button>

                <div className="form-group">
                  <label className="form-label">Payment Provider User ID</label>
                  <input
                    type="text"
                    className="input"
                    value={paymentFlowState.providerUserId}
                    onChange={e => setPaymentFlowState(prev => ({ ...prev, providerUserId: e.target.value }))}
                    placeholder="payment-provider@system.com user ID"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">End User ID</label>
                  <input
                    type="text"
                    className="input"
                    value={paymentFlowState.endUserId}
                    onChange={e => setPaymentFlowState(prev => ({ ...prev, endUserId: e.target.value }))}
                    placeholder="test-end-user@demo.com user ID"
                  />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Funding Amount (cents)</label>
                    <input
                      type="number"
                      className="input"
                      value={paymentFlowState.fundingAmount}
                      onChange={e => setPaymentFlowState(prev => ({ ...prev, fundingAmount: e.target.value }))}
                      placeholder="1000000"
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Deposit Amount (cents)</label>
                    <input
                      type="number"
                      className="input"
                      value={paymentFlowState.depositAmount}
                      onChange={e => setPaymentFlowState(prev => ({ ...prev, depositAmount: e.target.value }))}
                      placeholder="50000"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select
                    className="input"
                    value={paymentFlowState.currency}
                    onChange={e => setPaymentFlowState(prev => ({ ...prev, currency: e.target.value }))}
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={() => paymentFlowMutation.mutate()}
                  disabled={isRunning || paymentFlowMutation.isPending}
                  style={{ width: '100%', marginTop: 16 }}
                >
                  <PlayCircle size={16} style={{ marginRight: 8 }} />
                  Run Payment Flow
                </button>
              </div>
            )}

            {/* User Funding Form */}
            {activeUseCase === 'user-funding' && (
              <div>
                <button
                  onClick={populateTestUsers}
                  className="btn btn-secondary"
                  style={{ marginBottom: 16 }}
                  disabled={usersQuery.isLoading}
                >
                  Auto-fill Test Users
                </button>

                <div className="form-group">
                  <label className="form-label">From User ID</label>
                  <input
                    type="text"
                    className="input"
                    value={fundingState.fromUserId}
                    onChange={e => setFundingState(prev => ({ ...prev, fromUserId: e.target.value }))}
                    placeholder="system user ID"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">To User ID</label>
                  <input
                    type="text"
                    className="input"
                    value={fundingState.toUserId}
                    onChange={e => setFundingState(prev => ({ ...prev, toUserId: e.target.value }))}
                    placeholder="payment-provider@system.com user ID"
                  />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Amount (cents)</label>
                    <input
                      type="number"
                      className="input"
                      value={fundingState.amount}
                      onChange={e => setFundingState(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="1000000"
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Currency</label>
                    <select
                      className="input"
                      value={fundingState.currency}
                      onChange={e => setFundingState(prev => ({ ...prev, currency: e.target.value }))}
                    >
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={() => userFundingMutation.mutate()}
                  disabled={isRunning || userFundingMutation.isPending}
                  style={{ width: '100%', marginTop: 16 }}
                >
                  <PlayCircle size={16} style={{ marginRight: 8 }} />
                  Execute Transfer
                </button>
              </div>
            )}

            {/* Bonus Eligibility Form */}
            {activeUseCase === 'bonus-eligibility' && (
              <div>
                <button
                  onClick={populateTestUsers}
                  className="btn btn-secondary"
                  style={{ marginBottom: 16 }}
                  disabled={usersQuery.isLoading}
                >
                  Auto-fill Test User
                </button>

                <div className="form-group">
                  <label className="form-label">User ID</label>
                  <input
                    type="text"
                    className="input"
                    value={bonusState.userId}
                    onChange={e => setBonusState(prev => ({ ...prev, userId: e.target.value }))}
                    placeholder="test-end-user@demo.com user ID"
                  />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Currency</label>
                    <select
                      className="input"
                      value={bonusState.currency}
                      onChange={e => setBonusState(prev => ({ ...prev, currency: e.target.value }))}
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Deposit Amount (cents)</label>
                    <input
                      type="number"
                      className="input"
                      value={bonusState.depositAmount}
                      onChange={e => setBonusState(prev => ({ ...prev, depositAmount: e.target.value }))}
                      placeholder="10000"
                    />
                  </div>
                </div>

                {bonusEligibilityQuery.data && bonusEligibilityQuery.data.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Available Bonuses:</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {bonusEligibilityQuery.data.map(template => (
                        <div
                          key={template.id}
                          className="card"
                          style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{template.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {template.type} • {template.valueType === 'percentage' ? `${template.value}%` : `$${template.value}`}
                              {template.maxValue && ` (max $${template.maxValue})`}
                            </div>
                          </div>
                          <button
                            className="btn btn-primary"
                            onClick={() => claimBonusMutation.mutate(template.code)}
                            disabled={isRunning || claimBonusMutation.isPending}
                            style={{ fontSize: 12, padding: '6px 12px' }}
                          >
                            Claim
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bonus Tracking Form */}
            {activeUseCase === 'bonus-tracking' && (
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Bonus tracking functionality will be implemented here. This would show:
                </p>
                <ul style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  <li>Active bonuses with turnover requirements</li>
                  <li>Progress tracking toward wagering completion</li>
                  <li>Record activity/turnover transactions</li>
                  <li>Convert bonus to real balance when complete</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Execution Log */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">Execution Log</h3>
            {executionLog.length > 0 && (
              <button onClick={clearLog} className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }}>
                Clear
              </button>
            )}
          </div>
          <div style={{ padding: 16 }}>
            {executionLog.length > 0 ? (
              <div className="console bg-bg-tertiary" style={{ maxHeight: 500, overflowY: 'auto' }}>
                <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>
                  {executionLog.join('\n')}
                </pre>
              </div>
            ) : (
              <div className="empty-state">
                <PlayCircle size={48} style={{ opacity: 0.3 }} />
                <p style={{ color: 'var(--text-muted)' }}>Run a use case to see execution logs</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
