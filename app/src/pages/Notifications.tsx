import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../lib/auth-context'
import { io, Socket } from 'socket.io-client'
import { 
  Bell, Send, Mail, MessageSquare, Smartphone, Radio, 
  Activity, RefreshCw, Trash2, CheckCircle, XCircle, 
  Clock, BarChart3, Wifi, WifiOff, Play, Square
} from 'lucide-react'

const NOTIFICATION_SERVICE_URL = 'http://localhost:3006/graphql'
const NOTIFICATION_SOCKET_URL = 'http://localhost:3006'

interface Notification {
  id: string
  userId?: string
  tenantId: string
  channel: string
  priority: string
  to: string
  subject?: string
  body: string
  status: string
  sentAt?: string
  deliveredAt?: string
  error?: string
  createdAt: string
}

interface NotificationStats {
  total: number
  sent: number
  failed: number
  byChannel: Record<string, number>
  byStatus: Record<string, number>
}

export default function Notifications() {
  const { tokens, user } = useAuth()
  const [activeTab, setActiveTab] = useState<'send' | 'history' | 'stats' | 'realtime'>('send')
  
  // Send notification state
  const [channel, setChannel] = useState<'EMAIL' | 'SMS' | 'WHATSAPP' | 'SSE' | 'SOCKET'>('EMAIL')
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null)
  
  // History state
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Stats state
  const [stats, setStats] = useState<NotificationStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  
  // Real-time state
  const [socketConnected, setSocketConnected] = useState(false)
  const [sseConnected, setSseConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [realtimeLogs, setRealtimeLogs] = useState<Array<{ timestamp: string; message: string; type: 'info' | 'success' | 'error' | 'data' }>>([])

  // GraphQL helper
  const graphqlRequest = async (query: string, variables?: any) => {
    const response = await fetch(NOTIFICATION_SERVICE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokens?.accessToken ? `Bearer ${tokens.accessToken}` : '',
      },
      body: JSON.stringify({ query, variables }),
    })
    
    const result = await response.json()
    if (result.errors) {
      throw new Error(result.errors[0]?.message || 'GraphQL error')
    }
    return result.data
  }

  // Load available channels
  useEffect(() => {
    const loadChannels = async () => {
      try {
        const data = await graphqlRequest(`
          query {
            availableChannels
          }
        `)
        setAvailableChannels(data.availableChannels || [])
      } catch (error) {
        console.error('Failed to load channels:', error)
      }
    }
    loadChannels()
  }, [])

  // Load notification history
  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      const data = await graphqlRequest(`
        query MyNotifications($limit: Int, $offset: Int) {
          myNotifications(limit: $limit, offset: $offset) {
            id
            userId
            tenantId
            channel
            priority
            to
            subject
            body
            status
            sentAt
            deliveredAt
            error
            createdAt
          }
        }
      `, { limit: 50, offset: 0 })
      
      setNotifications(data.myNotifications || [])
    } catch (error: any) {
      console.error('Failed to load notifications:', error)
      setSendResult({ success: false, message: error.message })
    } finally {
      setLoadingHistory(false)
    }
  }

  // Load stats
  const loadStats = async () => {
    setLoadingStats(true)
    try {
      const data = await graphqlRequest(`
        query {
          notificationStats {
            total
            sent
            failed
            byChannel
            byStatus
          }
        }
      `)
      
      setStats(data.notificationStats)
    } catch (error: any) {
      console.error('Failed to load stats:', error)
    } finally {
      setLoadingStats(false)
    }
  }

  // Send notification
  const sendNotification = async () => {
    if (!to || !body) {
      setSendResult({ success: false, message: 'Please fill in required fields' })
      return
    }

    setSending(true)
    setSendResult(null)
    
    try {
      const data = await graphqlRequest(`
        mutation SendNotification($input: SendNotificationInput!) {
          sendNotification(input: $input) {
            success
            message
            notificationId
            status
          }
        }
      `, {
        input: {
          tenantId: user?.tenantId || 'default-tenant',
          channel,
          priority,
          to,
          subject: subject || undefined,
          body,
        },
      })
      
      const result = data.sendNotification
      setSendResult({ 
        success: result.success, 
        message: result.message || (result.success ? 'Notification sent successfully!' : 'Failed to send notification')
      })
      
      if (result.success) {
        // Clear form
        setTo('')
        setSubject('')
        setBody('')
        // Reload history
        if (activeTab === 'history') {
          loadHistory()
        }
      }
    } catch (error: any) {
      setSendResult({ success: false, message: error.message })
    } finally {
      setSending(false)
    }
  }

  // Socket.IO connection
  const connectSocket = () => {
    if (socketRef.current?.connected) return
    
    const socket = io(NOTIFICATION_SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: {
        token: tokens?.accessToken || '',
      },
      path: '/socket.io',
    })
    
    socket.on('connect', () => {
      setSocketConnected(true)
      addRealtimeLog('success', `Socket.IO connected! ID: ${socket.id}`)
    })
    
    socket.on('disconnect', () => {
      setSocketConnected(false)
      addRealtimeLog('info', 'Socket.IO disconnected')
    })
    
    socket.on('connect_error', (err) => {
      addRealtimeLog('error', `Connection error: ${err.message}`)
    })
    
    // Listen for notification events
    socket.on('notification', (data) => {
      addRealtimeLog('data', `📨 Notification: ${JSON.stringify(data)}`)
    })
    
    socket.on('notification:sent', (data) => {
      addRealtimeLog('success', `✅ Notification sent: ${data.id}`)
    })
    
    socket.on('notification:delivered', (data) => {
      addRealtimeLog('success', `📬 Notification delivered: ${data.id}`)
    })
    
    socketRef.current = socket
  }

  const disconnectSocket = () => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
      setSocketConnected(false)
      addRealtimeLog('info', 'Socket.IO disconnected')
    }
  }

  // SSE connection - using GraphQL health subscription
  const connectSSE = () => {
    if (eventSourceRef.current) return
    
    addRealtimeLog('info', 'Connecting to SSE health subscription...')
    
    // GraphQL subscription query for health updates (health subscription is automatically available)
    const query = `subscription { health { timestamp service status uptime database { latencyMs } } }`
    const url = `${NOTIFICATION_SERVICE_URL.replace('/graphql', '')}/graphql/stream`
    
    // Use fetch with POST for SSE (EventSource doesn't support auth headers)
    const controller = new AbortController()
    
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': tokens?.accessToken ? `Bearer ${tokens.accessToken}` : '',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`)
        }
        
        setSseConnected(true)
        addRealtimeLog('success', 'SSE connected! Receiving health updates...')
        
        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')
        
        const decoder = new TextDecoder()
        
        const readStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              
              const chunk = decoder.decode(value, { stream: true })
              const lines = chunk.split('\n')
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6))
                    if (data.data?.health) {
                      const h = data.data.health
                      addRealtimeLog('data', `🏥 ${h.service} | ${h.status} | uptime: ${Math.floor(h.uptime)}s | db: ${h.database?.latencyMs ?? '-'}ms`)
                    } else {
                      addRealtimeLog('data', `📡 SSE Event: ${JSON.stringify(data)}`)
                    }
                  } catch {
                    addRealtimeLog('data', `📡 SSE: ${line.slice(6)}`)
                  }
                } else if (line.startsWith('event: ')) {
                  const eventType = line.slice(7)
                  if (eventType === 'complete') {
                    addRealtimeLog('info', 'SSE subscription completed')
                    setSseConnected(false)
                    return
                  }
                }
              }
            }
          } catch (err: any) {
            if (err.name !== 'AbortError') {
              addRealtimeLog('error', `SSE read error: ${err.message}`)
              setSseConnected(false)
            }
          }
        }
        
        // Start reading the stream
        readStream().catch((err) => {
          if (err.name !== 'AbortError') {
            addRealtimeLog('error', `SSE stream error: ${err.message}`)
            setSseConnected(false)
          }
        })
        
        // Store controller for cleanup
        ;(eventSourceRef as any).current = { controller, close: () => controller.abort() }
      })
      .catch((err) => {
        addRealtimeLog('error', `SSE connection error: ${err.message}`)
        setSseConnected(false)
      })
  }

  const disconnectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
      setSseConnected(false)
      addRealtimeLog('info', 'SSE disconnected')
    }
  }

  const addRealtimeLog = (type: 'info' | 'success' | 'error' | 'data', message: string) => {
    setRealtimeLogs(prev => [{
      timestamp: new Date().toISOString(),
      type,
      message,
    }, ...prev].slice(0, 100))
  }

  // Load data when switching tabs
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory()
    } else if (activeTab === 'stats') {
      loadStats()
    }
  }, [activeTab])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectSocket()
      disconnectSSE()
    }
  }, [])

  const getStatusIcon = (status: string) => {
    switch (status?.toUpperCase()) {
      case 'SENT':
      case 'DELIVERED':
        return <CheckCircle className="w-4 h-4 text-status-success" />
      case 'FAILED':
      case 'BOUNCED':
        return <XCircle className="w-4 h-4 text-status-error" />
      case 'PENDING':
      case 'QUEUED':
        return <Clock className="w-4 h-4 text-status-warning" />
      default:
        return <Clock className="w-4 h-4" />
    }
  }

  const getChannelIcon = (channel: string) => {
    switch (channel?.toUpperCase()) {
      case 'EMAIL':
        return <Mail className="w-4 h-4" />
      case 'SMS':
        return <MessageSquare className="w-4 h-4" />
      case 'WHATSAPP':
        return <Smartphone className="w-4 h-4" />
      case 'SSE':
        return <Radio className="w-4 h-4" />
      case 'SOCKET':
        return <Activity className="w-4 h-4" />
      default:
        return <Bell className="w-4 h-4" />
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Notification Showcase</h1>
        <p className="page-subtitle">Send and manage notifications across multiple channels</p>
      </div>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'send' ? 'active' : ''}`}
          onClick={() => setActiveTab('send')}
        >
          <Send size={16} />
          Send Notification
        </button>
        <button 
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <Bell size={16} />
          History
        </button>
        <button 
          className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => setActiveTab('stats')}
        >
          <BarChart3 size={16} />
          Statistics
        </button>
        <button 
          className={`tab ${activeTab === 'realtime' ? 'active' : ''}`}
          onClick={() => setActiveTab('realtime')}
        >
          <Radio size={16} />
          Real-time
        </button>
      </div>

      {activeTab === 'send' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Send Notification</h3>
          </div>
          
          <div className="flex flex-col gap-4">
            <div>
              <label className="form-label">Channel *</label>
              <select 
                className="form-input"
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
              >
                {availableChannels.length > 0 ? (
                  availableChannels.map(ch => (
                    <option key={ch} value={ch}>{ch}</option>
                  ))
                ) : (
                  <>
                    <option value="EMAIL">Email</option>
                    <option value="SMS">SMS</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="SSE">SSE (Server-Sent Events)</option>
                    <option value="SOCKET">Socket.IO</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="form-label">Priority</label>
              <select 
                className="form-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>

            <div>
              <label className="form-label">To (Email/Phone/User ID) *</label>
              <input
                className="form-input"
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={channel === 'EMAIL' ? 'user@example.com' : channel === 'SMS' || channel === 'WHATSAPP' ? '+1234567890' : 'user-id'}
              />
            </div>

            {channel === 'EMAIL' && (
              <div>
                <label className="form-label">Subject</label>
                <input
                  className="form-input"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Notification subject"
                />
              </div>
            )}

            <div>
              <label className="form-label">Body *</label>
              <textarea
                className="form-input"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Notification message"
              />
            </div>

            {sendResult && (
              <div 
                className={`p-3 rounded text-sm ${
                  sendResult.success 
                    ? 'bg-status-success-bg text-status-success' 
                    : 'bg-status-error-bg text-status-error'
                }`}
              >
                {sendResult.message}
              </div>
            )}

            <button 
              className="btn btn-primary"
              onClick={sendNotification}
              disabled={sending || !to || !body}
            >
              {sending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Notification
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Notification History</h3>
            <button className="btn btn-sm btn-secondary" onClick={loadHistory} disabled={loadingHistory}>
              <RefreshCw className={`w-4 h-4 ${loadingHistory ? 'spin' : ''}`} />
              Refresh
            </button>
          </div>
          
          {loadingHistory ? (
            <div className="empty-state">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <p>Loading notifications...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="empty-state">
              <Bell className="w-8 h-8" />
              <p>No notifications yet. Send one to get started!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {notifications.map((notif) => (
                <div 
                  key={notif.id}
                  className="card p-4 mb-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {getChannelIcon(notif.channel)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold uppercase text-xs">
                          {notif.channel}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          notif.priority === 'URGENT' 
                            ? 'bg-status-error-bg text-status-error'
                            : notif.priority === 'HIGH'
                            ? 'bg-status-warning-bg text-status-warning'
                            : 'bg-bg-tertiary text-text-secondary'
                        }`}>
                          {notif.priority}
                        </span>
                        {getStatusIcon(notif.status)}
                        <span className="text-xs text-text-secondary">
                          {notif.status}
                        </span>
                      </div>
                      {notif.subject && (
                        <div className="font-semibold mb-1">{notif.subject}</div>
                      )}
                      <div className="text-text-secondary mb-2">{notif.body}</div>
                      <div className="flex gap-4 text-[11px] text-text-secondary">
                        <span>To: {notif.to}</span>
                        {notif.sentAt && <span>Sent: {new Date(notif.sentAt).toLocaleString()}</span>}
                        {notif.deliveredAt && <span>Delivered: {new Date(notif.deliveredAt).toLocaleString()}</span>}
                        {!notif.sentAt && <span>Created: {new Date(notif.createdAt).toLocaleString()}</span>}
                      </div>
                      {notif.error && (
                        <div className="mt-2 p-2 bg-status-error-bg rounded text-xs text-status-error">
                          Error: {notif.error}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'stats' && (
        <div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h3 className="card-title">Statistics</h3>
              <button className="btn btn-sm btn-secondary" onClick={loadStats} disabled={loadingStats}>
                <RefreshCw className={`w-4 h-4 ${loadingStats ? 'spin' : ''}`} />
                Refresh
              </button>
            </div>
            
            {loadingStats ? (
              <div className="empty-state">
                <RefreshCw className="w-8 h-8 animate-spin" />
                <p>Loading statistics...</p>
              </div>
            ) : stats ? (
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <div className="stat-card">
                  <div className="stat-value">{stats.total}</div>
                  <div className="stat-label">Total Notifications</div>
                </div>
                <div className="stat-card border-status-success">
                  <div className="stat-value text-status-success">{stats.sent}</div>
                  <div className="stat-label">Sent</div>
                </div>
                <div className="stat-card border-status-error">
                  <div className="stat-value text-status-error">{stats.failed}</div>
                  <div className="stat-label">Failed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.sent > 0 ? Math.round((stats.sent / stats.total) * 100) : 0}%</div>
                  <div className="stat-label">Success Rate</div>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <BarChart3 className="w-8 h-8" />
                <p>No statistics available</p>
              </div>
            )}
          </div>

          {stats && (
            <>
              <div className="card mb-6">
                <div className="card-header">
                  <h3 className="card-title">By Channel</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {Object.entries(stats.byChannel || {}).map(([channel, count]) => (
                    <div key={channel} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        {getChannelIcon(channel)}
                        <span className="font-medium">{channel}</span>
                      </div>
                      <div className="flex-1 h-2 bg-bg-tertiary rounded overflow-hidden">
                        <div 
                          className="h-full bg-accent-cyan transition-all duration-300"
                          style={{ width: `${stats.total > 0 ? (Number(count) / stats.total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="min-w-[40px] text-right font-semibold">{String(count)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">By Status</h3>
                </div>
                <div className="flex flex-col gap-3">
                  {Object.entries(stats.byStatus || {}).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        {getStatusIcon(status)}
                        <span className="font-medium capitalize">{status.toLowerCase()}</span>
                      </div>
                      <div className="flex-1 h-2 bg-bg-tertiary rounded overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            status === 'SENT' || status === 'DELIVERED' 
                              ? 'bg-status-success'
                              : status === 'FAILED'
                              ? 'bg-status-error'
                              : 'bg-status-warning'
                          }`}
                          style={{ width: `${stats.total > 0 ? (Number(count) / stats.total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="min-w-[40px] text-right font-semibold">{String(count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'realtime' && (
        <div>
          <div className="card mb-6">
            <div className="card-header">
              <h3 className="card-title">Socket.IO Connection</h3>
              <span className={`status-badge ${socketConnected ? 'healthy' : 'unhealthy'}`}>
                <span className="status-badge-dot" />
                {socketConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <p className="text-text-secondary mb-4 text-sm">
              Connect to Socket.IO to receive real-time notification events.
            </p>
            <div className="flex gap-3">
              {!socketConnected ? (
                <button className="btn btn-primary" onClick={connectSocket}>
                  <Wifi size={16} />
                  Connect
                </button>
              ) : (
                <button className="btn btn-secondary" onClick={disconnectSocket}>
                  <WifiOff size={16} />
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div className="card mb-6">
            <div className="card-header">
              <h3 className="card-title">SSE Connection</h3>
              <span className={`status-badge ${sseConnected ? 'healthy' : 'unhealthy'}`}>
                <span className="status-badge-dot" />
                {sseConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <p className="text-text-secondary mb-4 text-sm">
              Connect to Server-Sent Events stream for real-time notifications.
            </p>
            <div className="flex gap-3">
              {!sseConnected ? (
                <button className="btn btn-primary" onClick={connectSSE}>
                  <Play size={16} />
                  Connect
                </button>
              ) : (
                <button className="btn btn-secondary" onClick={disconnectSSE}>
                  <Square size={16} />
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Real-time Events</h3>
              {(socketConnected || sseConnected) && (
                <div className="realtime-indicator">
                  <span className="realtime-dot" />
                  <span>Live</span>
                </div>
              )}
              <button className="btn btn-sm btn-secondary" onClick={() => setRealtimeLogs([])}>
                <Trash2 size={14} />
                Clear
              </button>
            </div>
            
            <div className="console max-h-96">
              {realtimeLogs.length === 0 ? (
                <div className="empty-state">
                  <Radio className="w-8 h-8" />
                  <p>No events yet. Connect to start receiving real-time notifications.</p>
                </div>
              ) : (
                realtimeLogs.map((log, i) => (
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
        </div>
      )}
    </div>
  )
}
