import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Gift, Plus, Award, Search } from 'lucide-react'
import { graphql as gql } from '../lib/auth'

// Wrapper for bonus service GraphQL
async function graphql(query: string, variables?: Record<string, unknown>) {
  return gql('bonus', query, variables)
}

export default function BonusService() {
  const [userId, setUserId] = useState(`user-${Date.now().toString(36)}`)
  const [amount, setAmount] = useState('100')
  const [bonusType, setBonusType] = useState('deposit')
  const [result, setResult] = useState<unknown>(null)

  const createBonusMutation = useMutation({
    mutationFn: async () => {
      return graphql(`
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
    },
    onSuccess: (data) => setResult(data),
    onError: (err) => setResult({ error: err.message }),
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
