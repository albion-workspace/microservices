import { useState, useEffect } from 'react'
import { Activity, RefreshCw } from 'lucide-react'

interface HealthLog {
  timestamp: string
  service: string
  status: 'healthy' | 'unhealthy'
  latency: number
}

const services = [
  { name: 'auth-service', url: 'http://localhost:3003/health' },
  { name: 'payment-service', url: 'http://localhost:3004/health' },
  { name: 'bonus-service', url: 'http://localhost:3005/health' },
  { name: 'notification-service', url: 'http://localhost:3006/health' },
]

export default function HealthMonitor() {
  const [logs, setLogs] = useState<HealthLog[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)

  const checkHealth = async () => {
    const newLogs: HealthLog[] = []
    
    for (const service of services) {
      const start = Date.now()
      try {
        const res = await fetch(service.url)
        const data = await res.json()
        newLogs.push({
          timestamp: new Date().toISOString(),
          service: service.name,
          status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
          latency: Date.now() - start,
        })
      } catch {
        newLogs.push({
          timestamp: new Date().toISOString(),
          service: service.name,
          status: 'unhealthy',
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
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
