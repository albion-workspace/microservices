import { useState } from 'react'
import { Play, Copy, Check, Server } from 'lucide-react'

const SERVICES = [
  { name: 'Auth Service', url: 'http://localhost:9001/graphql' },
  { name: 'Payment Service', url: 'http://localhost:9002/graphql' },
  { name: 'Bonus Service', url: 'http://localhost:9003/graphql' },
  { name: 'Notification Service', url: 'http://localhost:9004/graphql' },
  { name: 'KYC Service', url: 'http://localhost:9005/graphql' },
]

const EXAMPLE_QUERIES = {
  health: `query {
  health {
    status
    service
    uptime
  }
}`,
  createWallet: `mutation CreateWallet($input: JSON) {
  createWallet(input: $input)
}

# Variables:
# {
#   "input": {
#     "userId": "test-user",
#     "currency": "EUR",
#     "category": "main"
#   }
# }`,
  deposit: `mutation Deposit($input: JSON) {
  deposit(input: $input)
}

# Variables:
# {
#   "input": {
#     "userId": "test-user",
#     "amount": 100,
#     "currency": "EUR",
#     "provider": "stripe",
#     "method": "card"
#   }
# }`,
  userWallets: `query GetUserWallets($input: JSON) {
  userWallets(input: $input)
}

# Variables:
# {
#   "input": {
#     "userId": "test-user",
#     "currency": "EUR"
#   }
# }`,
  createBonus: `mutation CreateBonus($input: JSON) {
  createBonus(input: $input)
}

# Variables:
# {
#   "input": {
#     "userId": "test-user",
#     "type": "deposit",
#     "amount": 50,
#     "currency": "EUR",
#     "wageringRequirement": 35
#   }
# }`,
}

export default function GraphQLPlayground() {
  const [selectedService, setSelectedService] = useState(SERVICES[0].url)
  const [query, setQuery] = useState(EXAMPLE_QUERIES.health)
  const [variables, setVariables] = useState('{}')
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const executeQuery = async () => {
    setLoading(true)
    setResult('')
    
    try {
      let parsedVariables = {}
      try {
        parsedVariables = JSON.parse(variables)
      } catch {
        // If variables is invalid JSON, try to extract from query comments
      }

      const token = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXYiLCJ0aWQiOiJkZXYiLCJyb2xlcyI6WyJhZG1pbiJdLCJwZXJtaXNzaW9ucyI6WyIqOio6KiJdLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzY4MDYxODA0LCJleHAiOjE3NjgwOTA2MDR9.XjigHeUiTXhrW1VrrKcgmlNvEsvvH5umUOUAuPsGcNo'
      
      const response = await fetch(selectedService, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
        },
        body: JSON.stringify({
          query: query.split('\n').filter(line => !line.trim().startsWith('#')).join('\n'),
          variables: parsedVariables,
        }),
      })
      
      const data = await response.json()
      setResult(JSON.stringify(data, null, 2))
    } catch (err) {
      setResult(JSON.stringify({ error: String(err) }, null, 2))
    } finally {
      setLoading(false)
    }
  }

  const copyResult = () => {
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const loadExample = (key: keyof typeof EXAMPLE_QUERIES) => {
    setQuery(EXAMPLE_QUERIES[key])
    setResult('')
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">GraphQL Playground</h1>
        <p className="page-subtitle">Execute GraphQL queries against your services</p>
      </div>

      <div className="card mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-text-muted" />
            <select 
              className="input w-auto" 
              value={selectedService}
              onChange={e => setSelectedService(e.target.value)}
            >
              {SERVICES.map(s => (
                <option key={s.url} value={s.url}>{s.name}</option>
              ))}
            </select>
          </div>
          
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-sm btn-secondary" onClick={() => loadExample('health')}>
              Health
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => loadExample('createWallet')}>
              Create Wallet
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => loadExample('deposit')}>
              Deposit
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => loadExample('userWallets')}>
              User Wallets
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => loadExample('createBonus')}>
              Create Bonus
            </button>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Query</h3>
            <button 
              className="btn btn-primary btn-sm" 
              onClick={executeQuery}
              disabled={loading}
            >
              <Play size={14} />
              {loading ? 'Running...' : 'Execute'}
            </button>
          </div>
          
          <div className="form-group">
            <textarea
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ 
                minHeight: 300,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}
              placeholder="Enter your GraphQL query..."
            />
          </div>
          
          <div className="form-group">
            <label className="form-label">Variables (JSON)</label>
            <textarea
              className="input"
              value={variables}
              onChange={e => setVariables(e.target.value)}
              style={{ 
                minHeight: 100,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}
              placeholder="{}"
            />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Response</h3>
            {result && (
              <button className="btn btn-sm btn-secondary" onClick={copyResult}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
          
          <div 
            className="json-display" 
            style={{ 
              minHeight: 400,
              maxHeight: 500,
              overflow: 'auto',
            }}
          >
            {result ? (
              <pre style={{ margin: 0 }}>{result}</pre>
            ) : (
              <div className="empty-state">
                <Play />
                <p>Execute a query to see results</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
