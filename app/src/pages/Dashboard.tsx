import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CreditCard, Gift, Database, Wifi, Shield, Bell, Zap } from 'lucide-react'

interface ServiceHealth {
  status: string
  service: string
  uptime: number
  database?: { healthy: boolean; latencyMs: number }
  redis?: { connected: boolean }
}

async function fetchHealth(url: string): Promise<ServiceHealth> {
  try {
    const res = await fetch(url, { 
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })
    
    // Unified health endpoint returns 200 for healthy, 503 for degraded
    // Both are valid responses - parse JSON for both
    if (res.status === 200 || res.status === 503) {
      const text = await res.text()
      if (!text) {
        throw new Error('Empty response from health endpoint')
      }
      try {
        const data = JSON.parse(text)
        return data
      } catch (parseError) {
        console.error(`[Dashboard] Failed to parse health response for ${url}:`, text)
        throw new Error('Invalid JSON response')
      }
    }
    
    // Other status codes are errors
    throw new Error(`Service returned status ${res.status}`)
  } catch (error: any) {
    // Network errors, timeouts, or other fetch failures
    if (error.name === 'AbortError' || error.name === 'TypeError' || error.message?.includes('Failed to fetch')) {
      throw new Error('Service unavailable')
    }
    throw error
  }
}

function ServiceCard({ 
  name, 
  icon: Icon, 
  url, 
  color 
}: { 
  name: string
  icon: React.ElementType
  url: string
  color: string 
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health', url],
    queryFn: () => fetchHealth(url),
    refetchInterval: 5000,
    retry: 1,
    retryDelay: 1000,
  })

  // Unified health endpoint: 'healthy' = 200 OK, 'degraded' = 503 Service Unavailable
  // Handle both the unified format and potential legacy formats
  const status = data?.status
  const isHealthy = status === 'healthy' || status === 'alive' || status === 'ready'
  const isDegraded = status === 'degraded' || status === 'not ready'
  const uptime = data?.uptime ? Math.floor(data.uptime) : 0
  const dbLatency = data?.database?.latencyMs ?? 0
  const dbHealthy = data?.database?.healthy ?? false

  return (
    <div className="status-card">
      <div className="status-card-header">
        <div className="status-card-title">
          <Icon className="w-5 h-5" style={{ color }} />
          <span>{name}</span>
        </div>
        {isLoading ? (
          <span className="status-badge pending">
            <span className="status-badge-dot" />
            Loading...
          </span>
        ) : error ? (
          <span className="status-badge unhealthy">
            <span className="status-badge-dot" />
            Offline
          </span>
        ) : !data ? (
          <span className="status-badge pending">
            <span className="status-badge-dot" />
            No Data
          </span>
        ) : (
          <span className={`status-badge ${isHealthy ? 'healthy' : isDegraded ? 'pending' : 'unhealthy'}`}>
            <span className="status-badge-dot" />
            {isHealthy ? 'Healthy' : isDegraded ? 'Degraded' : data.status || 'Unknown'}
          </span>
        )}
      </div>
      
      <div className="status-card-stats">
        <div className="stat">
          <div className="stat-value">{uptime}s</div>
          <div className="stat-label">Uptime</div>
        </div>
        <div className="stat">
          <div className={`stat-value ${dbHealthy ? 'text-status-success' : 'text-text-muted'}`}>
            {dbLatency}ms
          </div>
          <div className="stat-label">DB Latency</div>
        </div>
        <div className="stat">
          <div className={`stat-value ${data?.redis?.connected ? 'text-status-success' : 'text-text-muted'}`}>
            {data?.redis?.connected ? 'Yes' : 'No'}
          </div>
          <div className="stat-label">Redis</div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Monitor all microservices in real-time</p>
      </div>
      
      <div className="card-grid">
        <ServiceCard 
          name="Auth Service" 
          icon={Shield}
          url="http://localhost:3003/health"
          color="var(--accent-purple)"
        />
        <ServiceCard 
          name="Payment Service" 
          icon={CreditCard}
          url="http://localhost:3004/health"
          color="var(--accent-cyan)"
        />
        <ServiceCard 
          name="Bonus Service" 
          icon={Gift}
          url="http://localhost:3005/health"
          color="var(--accent-orange)"
        />
        <ServiceCard 
          name="Notification Service" 
          icon={Bell}
          url="http://localhost:3006/health"
          color="var(--accent-yellow)"
        />
      </div>

      <div className="mt-8">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Quick Actions</h3>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Link to="/use-cases" className="btn btn-primary">
              <Zap size={16} />
              Use Cases
            </Link>
            <Link to="/payment" className="btn btn-secondary">
              <CreditCard size={16} />
              Payment Gateway
            </Link>
            <Link to="/bonus" className="btn btn-secondary">
              <Gift size={16} />
              Bonus Service
            </Link>
            <Link to="/notifications" className="btn btn-secondary">
              <Bell size={16} />
              Notifications
            </Link>
            <Link to="/realtime" className="btn btn-secondary">
              <Wifi size={16} />
              Realtime (SSE/WS)
            </Link>
            <Link to="/playground" className="btn btn-secondary">
              <Database size={16} />
              GraphQL Playground
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Architecture Overview</h3>
          </div>
          <div className="console bg-bg-tertiary">
            <pre className="text-text-secondary m-0" style={{ fontSize: '0.75rem', lineHeight: '1.5' }}>{`
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Microservices Platform                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        React Dashboard (Port 5173)                    │  │
│  │  • Use Cases (Real-world scenarios)  • Payment Gateway               │  │
│  │  • Bonus Service  • Notifications  • Health Monitor                  │  │
│  │  • GraphQL Playground  • Webhooks  • User Management                 │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Microservices (GraphQL APIs)                       │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │                                                                      │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │  │
│  │  │  Auth Service    │  │ Payment Service  │  │  Bonus Service   │   │  │
│  │  │  Port: 3003     │  │  Port: 3004      │  │  Port: 3005      │   │  │
│  │  │                  │  │                  │  │                  │   │  │
│  │  │ • Authentication │  │ • Wallets        │  │ • Templates      │   │  │
│  │  │ • Authorization │  │ • Deposits       │  │ • User Bonuses   │   │  │
│  │  │ • OAuth         │  │ • Withdrawals    │  │ • Wagering       │   │  │
│  │  │ • Sessions      │  │ • User Transfers │  │ • Eligibility    │   │  │
│  │  │ • Permissions   │  │ • Generic Ledger │  │ • Generic Ledger │   │  │
│  │  │ • Webhooks      │  │                  │  │                  │   │  │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘   │  │
│  │                                                                      │  │
│  │  ┌──────────────────┐  ┌──────────────────────────────────────────┐ │  │
│  │  │Notification      │  │         Core Service (Shared)            │ │  │
│  │  │Service           │  │                                          │ │  │
│  │  │Port: 3006        │  │  • GraphQL Gateway & Schema Merging     │ │  │
│  │  │                  │  │  • Saga Pattern (Distributed Txns)       │ │  │
│  │  │ • Email          │  │  • Access Engine (URN Permissions)      │ │  │
│  │  │ • SMS            │  │  • Generic Ledger System                 │ │  │
│  │  │ • Push           │  │  • Webhook Management                   │ │  │
│  │  │ • SSE/WebSocket  │  │  • Common Types & Utilities             │ │  │
│  │  │ • Socket.IO      │  │                                          │ │  │
│  │  └──────────────────┘  └──────────────────────────────────────────┘ │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                        │
│                    ▼               ▼               ▼                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Data Layer                                   │  │
│  │  ┌──────────────────┐              ┌──────────────────┐             │  │
│  │  │    MongoDB        │              │   Redis (Opt)    │             │  │
│  │  │  • auth_service   │              │  • Caching       │             │  │
│  │  │  • payment_service│              │  • Sessions     │             │  │
│  │  │  • bonus_service  │              │  • Pub/Sub      │             │  │
│  │  │  • notification_  │              │                 │             │  │
│  │  │    service        │              │                 │             │  │
│  │  └──────────────────┘              └──────────────────┘             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Authentication: JWT (Shared Secret)  |  Realtime: SSE + Socket.IO        │
│  Communication: GraphQL (HTTP)       |  Storage: MongoDB (Per Service)    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
`}</pre>
          </div>
        </div>
      </div>
    </div>
  )
}
