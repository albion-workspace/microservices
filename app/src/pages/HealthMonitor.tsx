import { useState, useEffect } from 'react'
import { Activity, RefreshCw } from 'lucide-react'

interface HealthLog {
  timestamp: string
  service: string
  status: 'healthy' | 'degraded' | 'dead'
  latency: number
  details?: HealthResponse
}

const services = [
  { name: 'auth-service', baseUrl: 'http://localhost:9001' },
  { name: 'payment-service', baseUrl: 'http://localhost:9002' },
  { name: 'bonus-service', baseUrl: 'http://localhost:9003' },
  { name: 'notification-service', baseUrl: 'http://localhost:9004' },
  { name: 'kyc-service', baseUrl: 'http://localhost:9005' },
]

interface HealthResponse {
  status: 'healthy' | 'degraded'
  service: string
  uptime: number
  timestamp: string
  database: {
    healthy: boolean
    latencyMs: number
    connections?: number
  }
  redis: {
    connected: boolean
  }
  cache?: any
}

export default function HealthMonitor() {
  const [logs, setLogs] = useState<HealthLog[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)

  const checkHealth = async () => {
    const newLogs: HealthLog[] = []
    
    for (const service of services) {
      const start = Date.now()
      try {
        // Unified health endpoint - combines liveness, readiness, and metrics
        const res = await fetch(`${service.baseUrl}/health`)
        const data: HealthResponse = await res.json()
        
        // Determine status: healthy if HTTP 200 and status is 'healthy', degraded if 200 but status is 'degraded', dead if not 200
        const status = res.ok 
          ? (data.status === 'healthy' ? 'healthy' : 'degraded')
          : 'dead'
        
        newLogs.push({
          timestamp: new Date().toISOString(),
          service: service.name,
          status,
          latency: Date.now() - start,
          details: data,
        })
      } catch (error) {
        newLogs.push({
          timestamp: new Date().toISOString(),
          service: service.name,
          status: 'dead',
          latency: Date.now() - start,
        })
      }
    }
    
    setLogs(prev => [...newLogs, ...prev].slice(0, 100))
  }

  useEffect(() => {
    checkHealth()
    if (autoRefresh) {
      const interval = setInterval(checkHealth, 5000)
      return () => clearInterval(interval)
    }
  }, [autoRefresh])

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Health Monitor</h1>
        <p className="page-subtitle">Real-time health checks for all services</p>
      </div>

      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              className={`btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <Activity size={16} />
              Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
            </button>
            <button className="btn btn-secondary" onClick={checkHealth}>
              <RefreshCw size={16} />
              Check Now
            </button>
          </div>
          {autoRefresh && (
            <div className="realtime-indicator">
              <span className="realtime-dot" />
              <span>Live updates every 5s</span>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Health Check Log</h3>
          <span className="text-text-muted text-sm">
            {logs.length} entries
          </span>
        </div>
        
        <div className="console max-h-[500px]">
          {logs.length === 0 ? (
            <div className="empty-state">
              <Activity />
              <p>No health checks yet</p>
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="console-line">
                <span className="console-time">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span 
                  className={`console-message ${log.status === 'healthy' ? 'success' : 'error'}`}
                >
                  [{log.service}] {log.status.toUpperCase()} ({log.latency}ms)
                </span>
                {log.details && (
                  <div className="console-line ml-8 text-xs text-text-muted">
                    Uptime: {Math.floor(log.details.uptime)}s | 
                    DB: {log.details.database?.healthy ? '✓' : '✗'} ({log.details.database?.latencyMs}ms) | 
                    Redis: {log.details.redis?.connected ? '✓' : '✗'}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
