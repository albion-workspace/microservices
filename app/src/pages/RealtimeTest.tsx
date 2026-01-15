import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { Radio, Wifi, WifiOff, Play, Square, Trash2, Activity, RefreshCw, FileText, Filter } from 'lucide-react'

interface LogEntry {
  timestamp: string
  type: 'info' | 'success' | 'error' | 'data'
  source: 'sse' | 'socketio'
  message: string
}

interface ServerLogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  service: string
  message: string
  data?: Record<string, unknown>
}

export default function RealtimeTest() {
  const [activeTab, setActiveTab] = useState<'sse' | 'socketio' | 'logs'>('sse')
  const [logs, setLogs] = useState<LogEntry[]>([])
  
  // SSE State
  const [sseConnected, setSseConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  
  // Socket.IO State
  const [socketConnected, setSocketConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  
  // Server Logs State
  const [logsConnected, setLogsConnected] = useState(false)
  const logsEventSourceRef = useRef<EventSource | null>(null)
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([])
  const [logFilter, setLogFilter] = useState<{ level: string; service: string }>({ level: 'all', service: 'all' })
  const [availableServices, setAvailableServices] = useState<string[]>([])

  const addLog = (type: LogEntry['type'], source: LogEntry['source'], message: string) => {
    setLogs(prev => [{
      timestamp: new Date().toISOString(),
      type,
      source,
      message,
    }, ...prev].slice(0, 100))
  }

  // SSE Functions - Subscribe to health subscription
  const connectSSE = () => {
    if (eventSourceRef.current) return
    
    addLog('info', 'sse', 'Connecting to SSE health subscription...')
    
    // GraphQL subscription query for health updates
    const query = encodeURIComponent('subscription { health { timestamp service status uptime database { latencyMs } } }')
    const url = `http://localhost:3004/graphql/stream?query=${query}`
    
    const eventSource = new EventSource(url)
    
    eventSource.onopen = () => {
      setSseConnected(true)
      addLog('success', 'sse', 'Connected! Receiving health updates every second...')
    }
    
    eventSource.addEventListener('next', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.data?.health) {
          const h = data.data.health
          addLog('data', 'sse', `🏥 ${h.service} | ${h.status} | uptime: ${Math.floor(h.uptime)}s | db: ${h.database?.latencyMs ?? '-'}ms`)
        } else {
          addLog('data', 'sse', JSON.stringify(data))
        }
      } catch {
        addLog('data', 'sse', event.data)
      }
    })
    
    eventSource.addEventListener('complete', () => {
      addLog('info', 'sse', 'Subscription completed')
      setSseConnected(false)
    })
    
    eventSource.onerror = () => {
      addLog('error', 'sse', 'SSE connection error')
      setSseConnected(false)
    }
    
    eventSourceRef.current = eventSource
  }

  const disconnectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setSseConnected(false)
      addLog('info', 'sse', 'Disconnected from SSE')
    }
  }

  // Socket.IO Functions
  const connectSocketIO = () => {
    if (socketRef.current?.connected) return
    
    addLog('info', 'socketio', 'Connecting to Socket.IO...')
    
    const socket = io('http://localhost:3004', {
      transports: ['websocket', 'polling'],
      auth: {
        token: 'Bearer dev-token',
      },
    })
    
    socket.on('connect', () => {
      setSocketConnected(true)
      addLog('success', 'socketio', `Connected! Socket ID: ${socket.id}`)
      addLog('info', 'socketio', 'Use buttons below to subscribe or query')
    })
    
    socket.on('disconnect', (reason) => {
      setSocketConnected(false)
      addLog('info', 'socketio', `Disconnected: ${reason}`)
    })
    
    socket.on('connect_error', (err) => {
      addLog('error', 'socketio', `Connection error: ${err.message}`)
    })
    
    // Listen for subscription data
    socket.on('subscription:data', (data) => {
      if (data.data?.health) {
        const h = data.data.health
        addLog('data', 'socketio', `🏥 ${h.service} | ${h.status} | uptime: ${Math.floor(h.uptime)}s | db: ${h.database?.latencyMs ?? '-'}ms`)
      } else {
        addLog('data', 'socketio', `📨 ${JSON.stringify(data)}`)
      }
    })
    
    // Listen for any broadcast messages
    socket.on('broadcast', (data) => {
      addLog('data', 'socketio', `📢 Broadcast: ${JSON.stringify(data)}`)
    })
    
    socket.on('health', (data) => {
      addLog('data', 'socketio', `🏥 Health: ${JSON.stringify(data)}`)
    })
    
    socketRef.current = socket
  }

  const disconnectSocketIO = () => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setSocketConnected(false)
      addLog('info', 'socketio', 'Disconnected from Socket.IO')
    }
  }

  // Subscribe to health via GraphQL subscription
  const subscribeHealth = () => {
    if (!socketRef.current?.connected) {
      addLog('error', 'socketio', 'Not connected')
      return
    }
    
    const subscriptionQuery = `subscription { health { timestamp service status uptime database { latencyMs } } }`
    socketRef.current.emit('graphql:subscribe', { 
      id: 'health-sub',
      query: subscriptionQuery 
    })
    addLog('info', 'socketio', '📡 Subscribed to health updates')
  }

  // Query health once
  const queryHealth = () => {
    if (!socketRef.current?.connected) {
      addLog('error', 'socketio', 'Not connected')
      return
    }
    
    const query = `query { health { status service uptime } }`
    socketRef.current.emit('graphql', { query }, (response: unknown) => {
      const r = response as { data?: { health?: { status: string; service: string; uptime: number } } }
      if (r.data?.health) {
        const h = r.data.health
        addLog('data', 'socketio', `✅ ${h.service} | ${h.status} | uptime: ${Math.floor(h.uptime)}s`)
      } else {
        addLog('data', 'socketio', `Response: ${JSON.stringify(response)}`)
      }
    })
    addLog('info', 'socketio', '🔍 Querying health...')
  }

  // Server Logs Functions - Subscribe to logs subscription
  const connectLogs = () => {
    if (logsEventSourceRef.current) return
    
    // Add immediate feedback
    setServerLogs(prev => [{
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'app',
      message: 'Connecting to log stream...',
    }, ...prev])
    
    const query = encodeURIComponent('subscription { logs { timestamp level service message data } }')
    const url = `http://localhost:3004/graphql/stream?query=${query}`
    
    console.log('[Logs] Connecting to:', url)
    
    try {
      const eventSource = new EventSource(url)
      logsEventSourceRef.current = eventSource
      
      eventSource.onopen = () => {
        console.log('[Logs] SSE connection opened, waiting for data...')
        // Don't set connected yet - wait for first valid data
      }
      
      eventSource.onmessage = (event) => {
        console.log('[Logs] Raw message:', event.data)
      }
      
      let hasReceivedData = false
      eventSource.addEventListener('next', (event) => {
        console.log('[Logs] Next event:', event.data)
        try {
          const data = JSON.parse(event.data)
          if (data.data?.logs) {
            // Got valid data - now we're truly connected
            if (!hasReceivedData) {
              hasReceivedData = true
              setLogsConnected(true)
            }
            
            const log = data.data.logs as ServerLogEntry
            setServerLogs(prev => [log, ...prev].slice(0, 500))
            
            // Track available services
            setAvailableServices(prev => {
              if (!prev.includes(log.service)) {
                return [...prev, log.service].sort()
              }
              return prev
            })
          } else if (data.errors) {
            console.error('[Logs] GraphQL error:', data.errors)
            setServerLogs(prev => [{
              timestamp: new Date().toISOString(),
              level: 'error',
              service: 'app',
              message: `GraphQL error: ${data.errors[0]?.message || 'Unknown error'}`,
            }, ...prev])
            // Close connection on GraphQL error
            if (logsEventSourceRef.current) {
              logsEventSourceRef.current.close()
              logsEventSourceRef.current = null
            }
          }
        } catch (e) {
          console.error('[Logs] Parse error:', e)
        }
      })
      
      eventSource.addEventListener('complete', () => {
        console.log('[Logs] Subscription completed')
        setLogsConnected(false)
        logsEventSourceRef.current = null
      })
      
      eventSource.onerror = (e) => {
        console.error('[Logs] SSE error:', e)
        setLogsConnected(false)
        setServerLogs(prev => [{
          timestamp: new Date().toISOString(),
          level: 'error',
          service: 'app',
          message: '❌ Connection failed - check if server is running on port 3002',
        }, ...prev])
        // Clean up on error
        if (logsEventSourceRef.current) {
          logsEventSourceRef.current.close()
          logsEventSourceRef.current = null
        }
      }
    } catch (e) {
      console.error('[Logs] Failed to create EventSource:', e)
      setServerLogs(prev => [{
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'app',
        message: `❌ Failed to connect: ${e}`,
      }, ...prev])
    }
  }

  const disconnectLogs = () => {
    if (logsEventSourceRef.current) {
      logsEventSourceRef.current.close()
      logsEventSourceRef.current = null
      setLogsConnected(false)
    }
  }

  const clearServerLogs = () => setServerLogs([])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectSSE()
      disconnectSocketIO()
      disconnectLogs()
    }
  }, [])

  const clearLogs = () => setLogs([])
  
  // Filter server logs
  const filteredServerLogs = serverLogs.filter(log => {
    if (logFilter.level !== 'all' && log.level !== logFilter.level) return false
    if (logFilter.service !== 'all' && log.service !== logFilter.service) return false
    return true
  })
  
  const filteredLogs = logs.filter(log => 
    activeTab === 'sse' ? log.source === 'sse' : 
    activeTab === 'socketio' ? log.source === 'socketio' : 
    false
  )

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Realtime Testing</h1>
        <p className="page-subtitle">Test SSE (Server-Sent Events) and Socket.IO connections</p>
      </div>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'sse' ? 'active' : ''}`}
          onClick={() => setActiveTab('sse')}
        >
          SSE (Server-Sent Events)
        </button>
        <button 
          className={`tab ${activeTab === 'socketio' ? 'active' : ''}`}
          onClick={() => setActiveTab('socketio')}
        >
          Socket.IO
        </button>
        <button 
          className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          📋 Server Logs
        </button>
      </div>

      {activeTab === 'sse' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 className="card-title">SSE Connection</h3>
              <span className={`status-badge ${sseConnected ? 'healthy' : 'unhealthy'}`}>
                <span className="status-badge-dot" />
                {sseConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
            SSE provides unidirectional server-to-client streaming using the <code style={{ color: 'var(--accent-cyan)' }}>graphql-sse</code> protocol.
            Click Connect to subscribe to health updates (every 1 second).
          </p>
          
          <div style={{ display: 'flex', gap: 12 }}>
            {!sseConnected ? (
              <button className="btn btn-primary" onClick={connectSSE}>
                <Play size={16} />
                Connect & Subscribe to Health
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={disconnectSSE}>
                <Square size={16} />
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'socketio' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 className="card-title">Socket.IO Connection</h3>
              <span className={`status-badge ${socketConnected ? 'healthy' : 'unhealthy'}`}>
                <span className="status-badge-dot" />
                {socketConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
            Socket.IO provides bidirectional communication with automatic fallback to HTTP polling.
            Supports ES5 browsers and provides reconnection, rooms, and acknowledgements.
          </p>
          
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {!socketConnected ? (
              <button className="btn btn-primary" onClick={connectSocketIO}>
                <Wifi size={16} />
                Connect
              </button>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={disconnectSocketIO}>
                  <WifiOff size={16} />
                  Disconnect
                </button>
                <button className="btn btn-primary" onClick={subscribeHealth}>
                  <Activity size={16} />
                  Subscribe to Health
                </button>
                <button className="btn btn-secondary" onClick={queryHealth}>
                  <RefreshCw size={16} />
                  Query Health Once
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h3 className="card-title">Server Logs Stream</h3>
                <span className={`status-badge ${logsConnected ? 'healthy' : 'unhealthy'}`}>
                  <span className="status-badge-dot" />
                  {logsConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
              Stream real-time logs from all microservices. Logs are tagged with the service name and level.
              Use filters to narrow down specific services or log levels.
            </p>
            
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {!logsConnected ? (
                <button className="btn btn-primary" onClick={connectLogs}>
                  <Play size={16} />
                  Start Streaming Logs
                </button>
              ) : (
                <button className="btn btn-secondary" onClick={disconnectLogs}>
                  <Square size={16} />
                  Stop Streaming
                </button>
              )}
              
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                <Filter size={16} style={{ color: 'var(--text-secondary)' }} />
                <select 
                  value={logFilter.level} 
                  onChange={(e) => setLogFilter(f => ({ ...f, level: e.target.value }))}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                  }}
                >
                  <option value="all">All Levels</option>
                  <option value="debug">Debug</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
                
                <select 
                  value={logFilter.service} 
                  onChange={(e) => setLogFilter(f => ({ ...f, service: e.target.value }))}
                  style={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                  }}
                >
                  <option value="all">All Services</option>
                  {availableServices.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h3 className="card-title">Log Output</h3>
                {logsConnected && (
                  <div className="realtime-indicator">
                    <span className="realtime-dot" />
                    <span>Live</span>
                  </div>
                )}
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  {filteredServerLogs.length} / {serverLogs.length} logs
                </span>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={clearServerLogs}>
                <Trash2 size={14} />
                Clear
              </button>
            </div>
            
            <div className="console" style={{ maxHeight: 500 }}>
              {filteredServerLogs.length === 0 ? (
                <div className="empty-state">
                  <FileText />
                  <p>{serverLogs.length === 0 ? 'No logs yet. Start streaming to see logs.' : 'No logs match the current filters.'}</p>
                </div>
              ) : (
                filteredServerLogs.map((log, i) => (
                  <div key={i} className="console-line" style={{ alignItems: 'flex-start' }}>
                    <span className="console-time">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span 
                      style={{ 
                        padding: '1px 6px', 
                        borderRadius: 4, 
                        fontSize: 10, 
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        marginRight: 8,
                        background: log.level === 'error' ? 'var(--status-error)' 
                          : log.level === 'warn' ? 'var(--status-warning)'
                          : log.level === 'debug' ? 'var(--accent-purple)'
                          : 'var(--accent-cyan)',
                        color: '#fff',
                      }}
                    >
                      {log.level}
                    </span>
                    <span 
                      style={{ 
                        color: 'var(--accent-yellow)', 
                        fontWeight: 500,
                        marginRight: 8,
                        fontSize: 12,
                      }}
                    >
                      [{log.service}]
                    </span>
                    <span className="console-message" style={{ flex: 1 }}>
                      {log.message}
                      {log.data && Object.keys(log.data).length > 0 && (
                        <span style={{ color: 'var(--text-secondary)', marginLeft: 8, fontSize: 11 }}>
                          {JSON.stringify(log.data)}
                        </span>
                      )}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {activeTab !== 'logs' && (
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 className="card-title">Event Log</h3>
              {((activeTab === 'sse' && sseConnected) || (activeTab === 'socketio' && socketConnected)) && (
                <div className="realtime-indicator">
                  <span className="realtime-dot" />
                  <span>Live</span>
                </div>
              )}
            </div>
            <button className="btn btn-sm btn-secondary" onClick={clearLogs}>
              <Trash2 size={14} />
              Clear
            </button>
          </div>
          
          <div className="console" style={{ maxHeight: 400 }}>
            {filteredLogs.length === 0 ? (
              <div className="empty-state">
                <Radio />
                <p>No events yet. Connect to start receiving data.</p>
              </div>
            ) : (
              filteredLogs.map((log, i) => (
                <div key={i} className="console-line">
                  <span className="console-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`console-message ${log.type}`}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
