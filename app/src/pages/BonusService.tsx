import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Gift, Plus, Award, Search, TrendingUp, AlertCircle } from 'lucide-react'
import { graphql as gql } from '../lib/auth'
import { useAuth } from '../lib/auth-context'

// Wrapper for bonus service GraphQL
async function graphql(query: string, variables?: Record<string, unknown>) {
  return gql('bonus', query, variables)
}

export default function BonusService() {
  const { tokens } = useAuth()
  const authToken = tokens?.accessToken
  const [userId, setUserId] = useState(`user-${Date.now().toString(36)}`)
  const [amount, setAmount] = useState('100')
  const [bonusType, setBonusType] = useState('deposit')
  const [result, setResult] = useState<unknown>(null)
  
  // Fetch bonus pool balance
  const bonusPoolQuery = useQuery({
    queryKey: ['bonusPoolBalance'],
    queryFn: async () => {
      if (!authToken) return null
      try {
        const { graphql: gqlWithAuth } = await import('../lib/auth')
        const SERVICE_URLS = (await import('../lib/auth')).SERVICE_URLS
        const res = await fetch(SERVICE_URLS.payment, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            query: `
              query GetBonusPoolBalance($currency: String) {
                bonusPoolBalance(currency: $currency) {
                  accountId
                  currency
                  balance
                  availableBalance
                }
              }
            `,
            variables: { currency: 'USD' }
          }),
        })
        const data = await res.json()
        return data.data?.bonusPoolBalance
      } catch (err) {
        console.error('Failed to fetch bonus pool balance:', err)
        return null
      }
    },
    enabled: !!authToken,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const createBonusMutation = useMutation({
    mutationFn: async () => {
      try {
        const result = await graphql(`
          mutation CreateBonus($input: JSON) {
            createBonus(input: $input)
          }
        `, {
          input: {
            userId,
            type: bonusType,
            amount: parseFloat(amount),
            currency: 'EUR',
            wageringRequirement: 35,
            validDays: 30,
            metadata: {
              source: 'dashboard-test',
              createdAt: new Date().toISOString(),
            }
          }
        })
        
        // Check for errors
        if (result?.createBonus?.errors && result.createBonus.errors.length > 0) {
          throw new Error(result.createBonus.errors.join(', '))
        }
        
        return result
      } catch (error: any) {
        const errorMsg = error.message || String(error)
        if (errorMsg.includes('ledger') || errorMsg.includes('Insufficient') || errorMsg.includes('bonus pool')) {
          throw new Error(`Ledger Error: ${errorMsg}. Please check bonus pool balance.`)
        }
        throw error
      }
    },
    onSuccess: (data) => {
      setResult(data)
      bonusPoolQuery.refetch() // Refresh bonus pool balance
    },
    onError: (err: any) => {
      setResult({ error: err.message || 'Unknown error' })
    },
  })

  const getUserBonusesMutation = useMutation({
    mutationFn: async () => {
      return graphql(`
        query GetUserBonuses($input: JSON) {
          userBonuses(input: $input)
        }
      `, {
        input: { userId }
      })
    },
    onSuccess: (data) => setResult(data),
    onError: (err) => setResult({ error: err.message }),
  })

  const getActiveBonusesMutation = useMutation({
    mutationFn: async () => {
      return graphql(`
        query GetActiveBonuses($input: JSON) {
          activeBonuses(input: $input)
        }
      `, {
        input: { userId }
      })
    },
    onSuccess: (data) => setResult(data),
    onError: (err) => setResult({ error: err.message }),
  })

  const checkEligibilityMutation = useMutation({
    mutationFn: async () => {
      return graphql(`
        query CheckEligibility($input: JSON) {
          checkBonusEligibility(input: $input)
        }
      `, {
        input: { 
          userId,
          bonusType,
          depositAmount: parseFloat(amount),
        }
      })
    },
    onSuccess: (data) => setResult(data),
    onError: (err) => setResult({ error: err.message }),
  })

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bonus Service</h1>
        <p className="page-subtitle">Manage bonuses, eligibility, and wagering</p>
      </div>

      {/* Bonus Pool Balance Card */}
      {bonusPoolQuery.data && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h3 className="card-title">
              <TrendingUp size={18} style={{ marginRight: 8 }} />
              Bonus Pool Balance (Ledger)
            </h3>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Available Balance</div>
                <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-green)' }}>
                  ${((bonusPoolQuery.data.balance || 0) / 100).toFixed(2)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Currency</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{bonusPoolQuery.data.currency || 'USD'}</div>
              </div>
            </div>
            {bonusPoolQuery.data.balance < parseFloat(amount) * 100 && (
              <div style={{ 
                marginTop: 12, 
                padding: 12, 
                background: 'var(--accent-orange-glow)', 
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <AlertCircle size={16} style={{ color: 'var(--accent-orange)' }} />
                <span style={{ fontSize: 12, color: 'var(--accent-orange)' }}>
                  Warning: Bonus pool balance ({((bonusPoolQuery.data.balance || 0) / 100).toFixed(2)}) is less than requested amount ({amount}). Bonus may fail.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Bonus Operations</h3>
          </div>
          
          <div className="form-group">
            <label className="form-label">User ID</label>
            <input 
              type="text" 
              className="input"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="user-123"
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Amount</label>
              <input 
                type="number" 
                className="input"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Bonus Type</label>
              <select 
                className="input"
                value={bonusType}
                onChange={e => setBonusType(e.target.value)}
              >
                <option value="deposit">Deposit Bonus</option>
                <option value="welcome">Welcome Bonus</option>
                <option value="freespin">Free Spins</option>
                <option value="cashback">Cashback</option>
                <option value="loyalty">Loyalty Bonus</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            <button 
              className="btn btn-primary"
              onClick={() => createBonusMutation.mutate()}
              disabled={createBonusMutation.isPending}
            >
              <Plus size={16} />
              Create Bonus
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => checkEligibilityMutation.mutate()}
              disabled={checkEligibilityMutation.isPending}
            >
              <Award size={16} />
              Check Eligibility
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => getUserBonusesMutation.mutate()}
              disabled={getUserBonusesMutation.isPending}
            >
              <Search size={16} />
              Get User Bonuses
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => getActiveBonusesMutation.mutate()}
              disabled={getActiveBonusesMutation.isPending}
            >
              <Gift size={16} />
              Get Active Bonuses
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Response</h3>
          </div>
          
          {result ? (
            <div className="json-display">
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          ) : (
            <div className="empty-state">
              <Gift />
              <p>Run an operation to see results</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
