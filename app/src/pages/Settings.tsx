import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  Server,
  Database,
  Globe,
  Key,
  CheckCircle,
  RefreshCw,
  Copy,
  Eye,
  EyeOff,
} from 'lucide-react'
import { getToken, SERVICE_URLS } from '../lib/auth'

// Service configurations
const SERVICES = {
  auth: {
    name: 'Auth Service',
    url: 'http://localhost:9001',
    graphqlUrl: 'http://localhost:9001/graphql',
    color: 'var(--accent-purple)',
    description: 'Authentication, authorization, OAuth, and user management',
  },
  payment: {
    name: 'Payment Service',
    url: 'http://localhost:9002',
    graphqlUrl: SERVICE_URLS.payment,
    color: 'var(--accent-cyan)',
    description: 'Handles wallets, deposits, withdrawals, and payment providers',
  },
  bonus: {
    name: 'Bonus Service',
    url: 'http://localhost:9003',
    graphqlUrl: SERVICE_URLS.bonus,
    color: 'var(--accent-orange)',
    description: 'Manages bonuses, eligibility, wagering, and promotions',
  },
  notification: {
    name: 'Notification Service',
    url: 'http://localhost:9004',
    graphqlUrl: 'http://localhost:9004/graphql',
    color: 'var(--accent-yellow)',
    description: 'Multi-channel notifications (Email, SMS, WhatsApp, SSE, Socket.IO)',
  },
  kyc: {
    name: 'KYC Service',
    url: 'http://localhost:9005',
    graphqlUrl: 'http://localhost:9005/graphql',
    color: 'var(--accent-green, #22c55e)',
    description: 'Know Your Customer verification, profiles, documents, and tier limits',
  },
}

type ServiceId = keyof typeof SERVICES

async function checkServiceHealth(service: ServiceId): Promise<{ status: 'healthy' | 'unhealthy'; latency: number }> {
  const start = Date.now()
  try {
    const res = await fetch(`${SERVICES[service].url}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    const latency = Date.now() - start
    const isHealthy = res.ok
    return { status: isHealthy ? 'healthy' : 'unhealthy', latency }
  } catch {
    const latency = Date.now() - start
    return { status: 'unhealthy', latency }
  }
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'services' | 'jwt' | 'database'>('services')

  const tabs = [
    { id: 'services' as const, label: 'Services', icon: Server },
    { id: 'jwt' as const, label: 'JWT & Auth', icon: Key },
    { id: 'database' as const, label: 'Database', icon: Database },
  ]

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure microservices, authentication, and database connections</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={16} className="mr-2" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'services' && <ServicesTab />}
      {activeTab === 'jwt' && <JwtTab />}
      {activeTab === 'database' && <DatabaseTab />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SERVICES TAB
// ═══════════════════════════════════════════════════════════════════

function ServicesTab() {
  // Check health of all services
  const healthQuery = useQuery({
    queryKey: ['servicesHealth'],
    queryFn: async () => {
      const results: Record<ServiceId, { status: 'healthy' | 'unhealthy'; latency: number }> = {} as any
      
      for (const id of Object.keys(SERVICES)) {
        results[id as ServiceId] = await checkServiceHealth(id as ServiceId)
      }
      
      return results
    },
    refetchInterval: 30000,
  })

  const health: Record<ServiceId, { status: 'healthy' | 'unhealthy'; latency: number }> = healthQuery.data || {} as Record<ServiceId, { status: 'healthy' | 'unhealthy'; latency: number }>

  return (
    <div>
      {/* Service Cards */}
      <div className="card-grid">
        {Object.entries(SERVICES).map(([id, service]) => {
          const h = health[id as ServiceId] || { status: 'unhealthy', latency: 0 }
          
          return (
            <div key={id} className="card border-l-[3px]" style={{ borderLeftColor: service.color }}>
              <div className="card-header">
                <h3 className="card-title flex items-center gap-2">
                  <Server size={18} style={{ color: service.color }} />
                  {service.name}
                </h3>
                <span className={`status-badge ${h.status === 'healthy' ? 'healthy' : 'unhealthy'}`}>
                  <span className="status-badge-dot" />
                  {h.status === 'healthy' ? 'Online' : 'Offline'}
                </span>
              </div>

              <p className="text-sm text-text-secondary mb-4">
                {service.description}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-bg-tertiary rounded">
                  <div className="text-[11px] text-text-muted mb-1">BASE URL</div>
                  <div className="text-sm font-mono flex items-center gap-2">
                    {service.url}
                    <button 
                      className="btn btn-sm btn-secondary p-0.5 h-auto"
                      onClick={() => navigator.clipboard.writeText(service.url)}
                    >
                      <Copy size={10} />
                    </button>
                  </div>
                </div>
                <div className="p-3 bg-bg-tertiary rounded">
                  <div className="text-[11px] text-text-muted mb-1">LATENCY</div>
                  <div className={`text-sm font-mono ${
                    h.latency < 100 ? 'text-accent-green' 
                    : h.latency < 500 ? 'text-accent-orange' 
                    : 'text-accent-red'
                  }`}>
                    {h.latency}ms
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <a 
                  href={service.graphqlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm btn-secondary flex-1"
                >
                  <Globe size={14} />
                  GraphQL Playground
                </a>
                <a 
                  href={`${service.url}/health`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm btn-secondary flex-1"
                >
                  <CheckCircle size={14} />
                  Health Check
                </a>
              </div>
            </div>
          )
        })}
      </div>

      {/* Quick Actions */}
      <div className="card mt-6">
        <div className="card-header">
          <h3 className="card-title">Quick Actions</h3>
          <button className="btn btn-sm btn-secondary" onClick={() => healthQuery.refetch()}>
            <RefreshCw size={14} />
            Refresh Status
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <button className="btn btn-secondary" onClick={() => window.open('http://localhost:9002/graphql', '_blank')}>
            Payment Service API
          </button>
          <button className="btn btn-secondary" onClick={() => window.open('http://localhost:9003/graphql', '_blank')}>
            Bonus Service API
          </button>
          <button className="btn btn-secondary" onClick={async () => {
            const token = await getToken('payment')
            navigator.clipboard.writeText(token)
          }}>
            <Copy size={14} />
            Copy Dev Token
          </button>
          <button className="btn btn-secondary">
            <Database size={14} />
            View MongoDB
          </button>
        </div>
      </div>

      {/* Environment */}
      <div className="card mt-6">
        <div className="card-header">
          <h3 className="card-title">Environment Variables</h3>
        </div>

        <div className="console">
          <pre className="m-0 text-text-secondary">
{`# Payment Service
PAYMENT_URL=http://localhost:9002/graphql
PAYMENT_JWT_SECRET=payment-service-secret-change-in-production

# Bonus Service  
BONUS_URL=http://localhost:9003/graphql
BONUS_JWT_SECRET=bonus-service-secret-change-in-production

# MongoDB
MONGO_URI=mongodb://localhost:27017/payment_service
MONGO_URI=mongodb://localhost:27017/bonus_service

# Redis (optional - for cross-service events)
REDIS_URL=redis://localhost:6379`}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// JWT TAB
// ═══════════════════════════════════════════════════════════════════

function JwtTab() {
  const [showToken, setShowToken] = useState(false)
  const [devToken, setDevToken] = useState('')
  const [decodedPayload, setDecodedPayload] = useState<any>(null)

  // Fetch token on mount
  useEffect(() => {
    getToken('payment').then(token => {
      setDevToken(token)
      try {
        const tokenParts = token.split(' ')[1].split('.')
        setDecodedPayload(JSON.parse(atob(tokenParts[1])))
      } catch (e) {
        console.error('Failed to decode token:', e)
      }
    })
  }, [])

  return (
    <div>
      <div className="grid-2">
        {/* Current Token */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Key size={18} className="mr-2" />
              Development Token
            </h3>
          </div>

          <div className="form-group">
            <label className="form-label">JWT Token</label>
            <div style={{ position: 'relative' }}>
              <textarea
                className="input"
                value={showToken ? devToken : '•'.repeat(100)}
                readOnly
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, minHeight: 80 }}
              />
              <button
                className="btn btn-sm btn-secondary"
                style={{ position: 'absolute', top: 8, right: 8 }}
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button 
            className="btn btn-primary"
            onClick={() => navigator.clipboard.writeText(devToken)}
            style={{ width: '100%' }}
          >
            <Copy size={16} />
            Copy Token
          </button>
        </div>

        {/* Token Payload */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Token Payload</h3>
          </div>

          <div className="json-display">
            <pre>{JSON.stringify(decodedPayload, null, 2)}</pre>
          </div>
        </div>
      </div>

      {/* Permission Roles */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3 className="card-title">Available Roles</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--accent-cyan)' }}>admin</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Full access to all operations including provider configuration, webhooks, and manual adjustments.
            </div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--accent-orange)' }}>system</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Internal operations like treasury funding, automated transactions, and cross-service events.
            </div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--accent-green)' }}>user</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Standard user operations: view own wallets, create deposits, request withdrawals.
            </div>
          </div>
        </div>
      </div>

      {/* JWT Configuration */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3 className="card-title">JWT Configuration</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>ALGORITHM</div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>HS256</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>EXPIRATION</div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>8 hours</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>ISSUER</div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>Test Platform</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE TAB
// ═══════════════════════════════════════════════════════════════════

function DatabaseTab() {
  return (
    <div>
      <div className="card-grid">
        {/* Payment Service DB */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={18} style={{ marginRight: 8, color: 'var(--accent-cyan)' }} />
              Payment Service
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CONNECTION STRING</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>mongodb://localhost:27017/payment_service</div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>Collections:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['wallets', 'wallet_transactions', 'transactions', 'provider_configs', 'payment_webhooks'].map(col => (
                <span key={col} style={{ fontSize: 12, padding: '4px 8px', background: 'var(--bg-primary)', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>
                  {col}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Bonus Service DB */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={18} style={{ marginRight: 8, color: 'var(--accent-orange)' }} />
              Bonus Service
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CONNECTION STRING</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>mongodb://localhost:27017/bonus_service</div>
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>Collections:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['bonus_templates', 'user_bonuses', 'bonus_webhooks'].map(col => (
                <span key={col} style={{ fontSize: 12, padding: '4px 8px', background: 'var(--bg-primary)', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>
                  {col}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Redis */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3 className="card-title">
            <Database size={18} style={{ marginRight: 8, color: 'var(--accent-red)' }} />
            Redis (Optional)
          </h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CONNECTION</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>redis://localhost:6379</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>PURPOSE</div>
            <div style={{ fontSize: 14 }}>Cross-service events (pub/sub)</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CHANNELS</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>integration:bonus, integration:payment</div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: 'var(--accent-orange-glow)', borderRadius: 8 }}>
          <div style={{ fontSize: 13, color: 'var(--accent-orange)' }}>
            💡 Redis is optional. Without it, services work independently. With Redis, bonus events automatically update payment wallets.
          </div>
        </div>
      </div>

      {/* Indexes */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h3 className="card-title">Database Indexes</h3>
        </div>

        <div className="console">
          <pre style={{ margin: 0, color: 'var(--text-secondary)' }}>
{`// Wallets - unique constraint per user/currency/category
{ userId: 1, tenantId: 1, currency: 1, category: 1 } (unique)
{ userId: 1, status: 1 }

// Transactions
{ userId: 1, type: 1, createdAt: -1 }
{ walletId: 1, createdAt: -1 }
{ providerTransactionId: 1 }

// Bonus Templates
{ tenantId: 1, type: 1, isActive: 1 }
{ code: 1 } (unique)

// User Bonuses
{ userId: 1, status: 1 }
{ userId: 1, templateId: 1, status: 1 }`}
          </pre>
        </div>
      </div>
    </div>
  )
}
