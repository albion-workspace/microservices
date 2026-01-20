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
  const res = await fetch(url)
  if (!res.ok) throw new Error('Service unavailable')
  return res.json()
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
  })

  const isHealthy = data?.status === 'healthy'
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
        ) : (
          <span className={`status-badge ${isHealthy ? 'healthy' : 'unhealthy'}`}>
            <span className="status-badge-dot" />
            {isHealthy ? 'Healthy' : 'Unhealthy'}
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
