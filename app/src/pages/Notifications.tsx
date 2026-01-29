import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../lib/auth-context'
import { io, Socket } from 'socket.io-client'
import { 
  Bell, Send, Mail, MessageSquare, Smartphone, Radio, 
  Activity, RefreshCw, Trash2, CheckCircle, XCircle, 
  Clock, BarChart3, Wifi, WifiOff, Play, Square, X,
  Hash, MessageCircle, LogIn, Zap
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
  const [activeTab, setActiveTab] = useState<'send' | 'history' | 'stats' | 'realtime' | 'received'>('send')
  
  // Send notification state
  const [broadcastType, setBroadcastType] = useState<'user' | 'tenant' | 'all' | 'room'>('user')
  const [channel, setChannel] = useState<'EMAIL' | 'SMS' | 'WHATSAPP' | 'SSE' | 'SOCKET'>('EMAIL')
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL')
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null)
  
  // Socket.IO room management state
  const [roomName, setRoomName] = useState('')
  const [joinedRooms, setJoinedRooms] = useState<string[]>([])
  const [ackRequestId, setAckRequestId] = useState<string>('')
  const [ackResponse, setAckResponse] = useState<string>('')
  
  // History state
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  
  // Stats state
  const [stats, setStats] = useState<NotificationStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [availableChannels, setAvailableChannels] = useState<Array<{ channel: string; configured: boolean }>>([])
  
  // Real-time state
  const [socketConnected, setSocketConnected] = useState(false)
  const [sseConnected, setSseConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [realtimeLogs, setRealtimeLogs] = useState<Array<{ timestamp: string; message: string; type: 'info' | 'success' | 'error' | 'data' }>>([])
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info'; channel?: string; body?: string }>>([])
  
  // Broadcast tracking
  const [receivedNotifications, setReceivedNotifications] = useState<Array<{
    id: string
    timestamp: string
    channel: string
    broadcastType?: string
    subject?: string
    body: string
    fromRoom?: string
  }>>([])
  const [connectionCount, setConnectionCount] = useState<{ socket: number; sse: number }>({ socket: 0, sse: 0 })
  const [broadcastStats, setBroadcastStats] = useState<{
    sent: number
    received: number
    byType: Record<string, number>
  }>({ sent: 0, received: 0, byType: {} })

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
      const error = result.errors[0]
      const errorMessage = error?.message || 'GraphQL error'
      const errorCode = error?.extensions?.code || errorMessage
      const errorObj = new Error(errorMessage)
      ;(errorObj as any).code = errorCode
      ;(errorObj as any).extensions = error?.extensions || {}
      throw errorObj
    }
    return result.data
  }

  // Load available channels
  useEffect(() => {
    const loadChannels = async () => {
      try {
        const data = await graphqlRequest(`
          query {
            availableChannels {
              channel
              configured
            }
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
    if (!tokens?.accessToken) {
      console.warn('Cannot load notifications: no access token')
      return
    }
    setLoadingHistory(true)
    try {
      const data = await graphqlRequest(`
        query MyNotifications($first: Int) {
          myNotifications(first: $first) {
            nodes {
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
            totalCount
          }
        }
      `, { first: 50 })
      
      setNotifications(data.myNotifications?.nodes || [])
    } catch (error: any) {
      console.error('Failed to load notifications:', error)
      setSendResult({ success: false, message: error.message })
    } finally {
      setLoadingHistory(false)
    }
  }

  // Load stats (system role required)
  const loadStats = async () => {
    if (!tokens?.accessToken) {
      console.warn('Cannot load stats: no access token')
      return
    }
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
      if (error.message?.includes('Not authorized') || error.message?.includes('System access')) {
        console.warn('Stats require system role, skipping')
      } else {
        console.error('Failed to load stats:', error)
      }
    } finally {
      setLoadingStats(false)
    }
  }

  // Send notification
  const sendNotification = async () => {
    // Validate based on broadcast type
    if (broadcastType === 'user' && !to) {
      setSendResult({ success: false, message: 'Please enter a user ID/email/phone' })
      return
    }
    if (broadcastType === 'room' && !to) {
      setSendResult({ success: false, message: 'Please enter a room name' })
      return
    }
    if (!body) {
      setSendResult({ success: false, message: 'Please fill in the message body' })
      return
    }
    
    // For Socket.IO/SSE broadcasts, use direct socket/SSE if connected
    if ((channel === 'SOCKET' || channel === 'SSE') && broadcastType !== 'user') {
      if (channel === 'SOCKET' && socketRef.current?.connected) {
        // Use Socket.IO directly for broadcasts
        const notificationData = {
          subject: subject || undefined,
          body,
          channel: 'SOCKET',
          priority,
          broadcastType,
          ...(broadcastType === 'tenant' && { tenantId: user?.tenantId || 'default-tenant' }),
          ...(broadcastType === 'room' && { room: to }),
        }
        
        try {
          if (broadcastType === 'all') {
            socketRef.current.emit('broadcast:all', notificationData)
            addRealtimeLog('success', `📢 Broadcasted to all users via Socket.IO (${connectionCount.socket} connected)`)
          } else if (broadcastType === 'tenant') {
            socketRef.current.emit('broadcast:tenant', {
              tenantId: user?.tenantId || 'default-tenant',
              ...notificationData
            })
            addRealtimeLog('success', `📢 Broadcasted to tenant via Socket.IO (${connectionCount.socket} connected)`)
          } else if (broadcastType === 'room') {
            socketRef.current.emit('broadcast:room', {
              room: to,
              ...notificationData
            })
            addRealtimeLog('success', `📢 Broadcasted to room "${to}" via Socket.IO`)
          }
          
          // Update broadcast stats
          setBroadcastStats(prev => ({
            ...prev,
            sent: prev.sent + 1,
            byType: {
              ...prev.byType,
              [broadcastType]: (prev.byType[broadcastType] || 0) + 1
            }
          }))
          
          setSendResult({ 
            success: true, 
            message: `Broadcast sent via ${channel} (${broadcastType}). Check "Received Notifications" tab to see if it was received.`
          })
          setSubject('')
          setBody('')
          if (broadcastType !== 'room') setTo('')
          return
        } catch (error: any) {
          setSendResult({ success: false, message: error.message })
          return
        }
      } else {
        setSendResult({ 
          success: false, 
          message: `Please connect ${channel} first to use ${broadcastType} broadcasts` 
        })
        return
      }
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
          to: broadcastType === 'user' ? to : (user?.id || ''),
          subject: subject || undefined,
          body,
          ...(broadcastType === 'room' && channel === 'SOCKET' && { 
            event: 'notification',
            data: { room: to, broadcastType: 'room' }
          }),
        },
      })
      
      const result = data.sendNotification
      setSendResult({ 
        success: result.success, 
        message: result.message || (result.success ? 'Notification sent successfully!' : 'Failed to send notification')
      })
      
      if (result.success) {
        // Don't show toast here - toast will appear when notification is received via SSE/Socket
        // Clear form
        setTo('')
        setSubject('')
        setBody('')
        // Reload history
        if (activeTab === 'history') {
          loadHistory()
        }
      } else {
        // Show error toast only for failures
        showToast('error', result.message || 'Failed to send notification', channel)
      }
    } catch (error: any) {
      setSendResult({ success: false, message: error.message })
    } finally {
      setSending(false)
    }
  }

  // Update connection count helper
  const updateConnectionCount = () => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('getConnectionCount', (count: number) => {
        setConnectionCount(prev => ({ ...prev, socket: count || 0 }))
      })
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
      // Get initial rooms if available
      socket.emit('getRooms', (rooms: string[]) => {
        if (rooms && Array.isArray(rooms)) {
          setJoinedRooms(rooms)
        }
      })
      // Request connection count
      updateConnectionCount()
    })
    
    // Listen for connection count updates
    socket.on('connectionCount', (data: { count: number }) => {
      setConnectionCount(prev => ({ ...prev, socket: data.count || 0 }))
    })
    
    socketRef.current = socket
    
    // Periodically update connection count
    const countInterval = setInterval(() => {
      if (socket.connected) {
        updateConnectionCount()
      }
    }, 5000) // Update every 5 seconds
    
    // Cleanup interval on disconnect
    socket.on('disconnect', () => {
      clearInterval(countInterval)
      setSocketConnected(false)
      setJoinedRooms([])
      addRealtimeLog('info', 'Socket.IO disconnected')
    })
    
    socket.on('connect_error', (err) => {
      addRealtimeLog('error', `Connection error: ${err.message}`)
    })
    
    // Listen for notification events - this is when notifications are RECEIVED
    socket.on('notification', (data: any, ack?: (response: any) => void) => {
      addRealtimeLog('data', `📨 Notification received: ${JSON.stringify(data)}`)
      // Extract notification data - could be nested in data.data or data directly
      const notif = data.data || data
      const subject = notif.subject || data.subject
      const body = notif.body || data.body || notif.message || data.message
      const channel = notif.channel || data.channel || 'SOCKET'
      const broadcastType = notif.broadcastType || data.broadcastType
      const room = notif.room || data.room
      
      // Track received notification
      const receivedNotif = {
        id: `recv-${Date.now()}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        channel,
        broadcastType,
        subject,
        body: body || 'No body',
        fromRoom: room,
      }
      setReceivedNotifications(prev => [receivedNotif, ...prev].slice(0, 50))
      setBroadcastStats(prev => ({
        ...prev,
        received: prev.received + 1,
        byType: {
          ...prev.byType,
          [broadcastType || 'user']: (prev.byType[broadcastType || 'user'] || 0) + 1
        }
      }))
      
      // If acknowledgment callback provided, respond
      if (ack && typeof ack === 'function') {
        ack({ received: true, timestamp: Date.now() })
        addRealtimeLog('success', '✅ Acknowledgment sent')
      }
      
      // Show toast ONLY when notification is received (not when sent)
      // Display subject and body from the received message
      if (subject || body) {
        showToast('info', subject || body, channel, subject && body ? body : undefined)
      } else {
        showToast('info', 'New notification received', channel)
      }
    })
    
    // Listen for acknowledgment requests
    socket.on('request:status', (data: any, ack: (response: any) => void) => {
      addRealtimeLog('data', `🔔 Acknowledgment request received: ${JSON.stringify(data)}`)
      if (ack && typeof ack === 'function') {
        const response = { status: 'online', userId: user?.id, timestamp: Date.now() }
        ack(response)
        setAckResponse(JSON.stringify(response, null, 2))
        addRealtimeLog('success', `✅ Acknowledgment sent: ${JSON.stringify(response)}`)
      }
    })
    
    // Listen for room events
    socket.on('room:joined', (data: { room: string }) => {
      addRealtimeLog('success', `✅ Joined room: ${data.room}`)
      if (data.room && !joinedRooms.includes(data.room)) {
        setJoinedRooms(prev => [...prev, data.room])
      }
    })
    
    socket.on('room:left', (data: { room: string }) => {
      addRealtimeLog('info', `👋 Left room: ${data.room}`)
      setJoinedRooms(prev => prev.filter(r => r !== data.room))
    })
    
    // Listen for any custom event names that might contain notifications
    socket.onAny((eventName: string, data: any) => {
      // Only handle if it looks like a notification (has subject/body)
      // Skip internal events
      if (eventName !== 'notification' && 
          eventName !== 'notification:sent' && 
          eventName !== 'notification:delivered' &&
          eventName !== 'connect' &&
          eventName !== 'disconnect' &&
          eventName !== 'room:joined' &&
          eventName !== 'room:left' &&
          eventName !== 'request:status' &&
          data && (data.subject || data.body || (data.data && (data.data.subject || data.data.body)))) {
        const notif = data.data || data
        const subject = notif.subject || data.subject
        const body = notif.body || data.body || notif.message || data.message
        const channel = notif.channel || data.channel || 'SOCKET'
        
        // Show toast for received notifications only
        if (subject || body) {
          showToast('info', subject || body, channel, subject && body ? body : undefined)
        }
      }
    })
    
    socket.on('notification:sent', (data: any) => {
      addRealtimeLog('success', `✅ Notification sent: ${data.id}`)
      // Don't show toast - only show toast when notification is received
    })
    
    socket.on('notification:delivered', (data: any) => {
      addRealtimeLog('success', `📬 Notification delivered: ${data.id}`)
      // Don't show toast - only show toast when notification is received
    })
  }
  
  // Socket.IO room management
  const joinRoom = () => {
    if (!socketRef.current?.connected || !roomName.trim()) {
      addRealtimeLog('error', 'Please connect Socket.IO and enter a room name')
      return
    }
    
    socketRef.current.emit('joinRoom', { room: roomName.trim() }, (response: any) => {
      if (response?.success) {
        if (!joinedRooms.includes(roomName.trim())) {
          setJoinedRooms(prev => [...prev, roomName.trim()])
        }
        addRealtimeLog('success', `✅ Joined room: ${roomName.trim()}`)
        setRoomName('')
      } else {
        addRealtimeLog('error', `Failed to join room: ${response?.error || 'Unknown error'}`)
      }
    })
  }
  
  const leaveRoom = (room: string) => {
    if (!socketRef.current?.connected) return
    
    socketRef.current.emit('leaveRoom', { room }, (response: any) => {
      if (response?.success) {
        setJoinedRooms(prev => prev.filter(r => r !== room))
        addRealtimeLog('info', `👋 Left room: ${room}`)
      } else {
        addRealtimeLog('error', `Failed to leave room: ${response?.error || 'Unknown error'}`)
      }
    })
  }
  
  // Test acknowledgment request
  const testAcknowledgment = () => {
    if (!socketRef.current?.connected || !ackRequestId.trim()) {
      addRealtimeLog('error', 'Please connect Socket.IO and enter a user ID')
      return
    }
    
    const requestId = `ack-${Date.now()}`
    addRealtimeLog('info', `📤 Sending acknowledgment request to user: ${ackRequestId}`)
    
    socketRef.current.emit('request:status', { 
      userId: ackRequestId.trim(),
      requestId 
    }, (response: any) => {
      if (response) {
        setAckResponse(JSON.stringify(response, null, 2))
        addRealtimeLog('success', `✅ Received acknowledgment: ${JSON.stringify(response)}`)
      } else {
        addRealtimeLog('error', 'No acknowledgment received (timeout or user not connected)')
        setAckResponse('No response received')
      }
    })
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
        // Request connection count
        // Note: SSE connection count would need to be requested via a separate endpoint
        // For now, we'll track it when we receive events
        
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
              
              let currentEvent: string | null = null
              
              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  currentEvent = line.slice(7).trim()
                } else if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6))
                    
                    // Handle health updates
                    if (data.data?.health) {
                      const h = data.data.health
                      addRealtimeLog('data', `🏥 ${h.service} | ${h.status} | uptime: ${Math.floor(h.uptime)}s | db: ${h.database?.latencyMs ?? '-'}ms`)
                    }
                    // Handle notification events
                    else if (currentEvent === 'notification' || data.event === 'notification' || data.subject || data.body) {
                      const notif = data.data || data
                      const subject = notif.subject || data.subject
                      const body = notif.body || data.body || notif.message || data.message
                      const channel = notif.channel || data.channel || 'SSE'
                      const broadcastType = notif.broadcastType || data.broadcastType
                      
                      addRealtimeLog('data', `📨 SSE Notification: ${JSON.stringify(notif)}`)
                      
                      // Track received notification
                      const receivedNotif = {
                        id: `recv-${Date.now()}-${Math.random()}`,
                        timestamp: new Date().toISOString(),
                        channel,
                        broadcastType,
                        subject,
                        body: body || 'No body',
                      }
                      setReceivedNotifications(prev => [receivedNotif, ...prev].slice(0, 50))
                      setBroadcastStats(prev => ({
                        ...prev,
                        received: prev.received + 1,
                        byType: {
                          ...prev.byType,
                          [broadcastType || 'user']: (prev.byType[broadcastType || 'user'] || 0) + 1
                        }
                      }))
                      
                      // Show toast with actual notification content
                      if (subject || body) {
                        showToast('info', subject || body, channel, subject && body ? body : undefined)
                      } else {
                        showToast('info', 'New notification received', channel)
                      }
                    } else {
                      addRealtimeLog('data', `📡 SSE Event: ${JSON.stringify(data)}`)
                    }
                  } catch {
                    // Not JSON, try as plain text
                    const textData = line.slice(6).trim()
                    if (textData && currentEvent === 'notification') {
                      addRealtimeLog('data', `📨 SSE Notification: ${textData}`)
                      showToast('info', textData, 'SSE')
                    } else if (textData) {
                      addRealtimeLog('data', `📡 SSE: ${textData}`)
                    }
                  }
                  currentEvent = null // Reset after processing data
                } else if (line.trim() === '') {
                  // Empty line separates events
                  currentEvent = null
                } else if (line.startsWith('id: ')) {
                  // SSE event ID, ignore
                } else if (line.startsWith('retry: ')) {
                  // SSE retry, ignore
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

  // Toast notification helper
  const showToast = (type: 'success' | 'error' | 'info', message: string, channel?: string, body?: string) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, message, type, channel, body }])
    
    // Auto-remove after 5 seconds (longer for notifications with body)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, body ? 8000 : 5000)
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // Load data when switching tabs
  useEffect(() => {
    if (!tokens?.accessToken) return
    
    if (activeTab === 'history') {
      loadHistory()
    } else if (activeTab === 'stats') {
      loadStats()
    }
  }, [activeTab, tokens?.accessToken])

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
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" style={{ maxWidth: '400px' }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`p-4 rounded-lg shadow-lg border-l-4 flex items-start gap-3 animate-slideDown ${
              toast.type === 'success' 
                ? 'bg-green-50 border-green-500 text-green-800' 
                : toast.type === 'error'
                ? 'bg-red-50 border-red-500 text-red-800'
                : 'bg-blue-50 border-blue-500 text-blue-800'
            }`}
          >
            {toast.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            {toast.type === 'error' && <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            {toast.type === 'info' && <Bell className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm break-words">{toast.message}</p>
              {toast.body && (
                <p className="text-xs mt-1 opacity-75 break-words line-clamp-2">{toast.body}</p>
              )}
              {toast.channel && (
                <p className="text-xs mt-1 opacity-60">Via {toast.channel}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-current opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

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
        <button 
          className={`tab ${activeTab === 'received' ? 'active' : ''}`}
          onClick={() => setActiveTab('received')}
        >
          <Bell size={16} />
          Received {receivedNotifications.length > 0 ? `(${receivedNotifications.length})` : ''}
        </button>
      </div>

      {activeTab === 'send' && (
        <div>
          {/* Connection Status Banner */}
          {(broadcastType === 'tenant' || broadcastType === 'all' || broadcastType === 'room' || channel === 'SSE' || channel === 'SOCKET') && (
            <div className={`card mb-4 border-l-4 ${
              (channel === 'SOCKET' && socketConnected) || (channel === 'SSE' && sseConnected)
                ? 'border-status-success'
                : 'border-status-warning'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm mb-1">
                    {channel === 'SOCKET' && socketConnected && '✅ Socket.IO Connected'}
                    {channel === 'SOCKET' && !socketConnected && '⚠️ Socket.IO Not Connected'}
                    {channel === 'SSE' && sseConnected && '✅ SSE Connected'}
                    {channel === 'SSE' && !sseConnected && '⚠️ SSE Not Connected'}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {channel === 'SOCKET' && socketConnected && `Ready to receive broadcasts (${connectionCount.socket} connections)`}
                    {channel === 'SOCKET' && !socketConnected && 'Connect Socket.IO in the Real-time tab to receive broadcasts'}
                    {channel === 'SSE' && sseConnected && `Ready to receive broadcasts (${connectionCount.sse} connections)`}
                    {channel === 'SSE' && !sseConnected && 'Connect SSE in the Real-time tab to receive broadcasts'}
                  </p>
                </div>
                {(channel === 'SOCKET' && !socketConnected) || (channel === 'SSE' && !sseConnected) ? (
                  <button 
                    className="btn btn-sm btn-primary"
                    onClick={() => setActiveTab('realtime')}
                  >
                    Go to Real-time
                  </button>
                ) : null}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Send Notification</h3>
            </div>
          
            <div className="flex flex-col gap-4">
            <div>
              <label className="form-label">Broadcast Type *</label>
              <select 
                className="form-input"
                value={broadcastType}
                onChange={(e) => {
                  const newType = e.target.value as any
                  setBroadcastType(newType)
                  if (newType === 'all' || newType === 'tenant') {
                    setTo('')
                    // Auto-switch to SSE or SOCKET if not already
                    if (channel !== 'SSE' && channel !== 'SOCKET') {
                      setChannel('SOCKET')
                    }
                  } else if (newType === 'room') {
                    // Auto-switch to SOCKET for room broadcasts
                    setChannel('SOCKET')
                  }
                }}
              >
                <option value="user">To User</option>
                <option value="tenant">To Tenant</option>
                <option value="all">To All Users</option>
                <option value="room">To Room (Socket.IO only)</option>
              </select>
              <p className="text-xs text-text-secondary mt-1">
                {broadcastType === 'user' && 'Send to a specific user'}
                {broadcastType === 'tenant' && 'Broadcast to all users in your tenant'}
                {broadcastType === 'all' && 'Broadcast to all connected users'}
                {broadcastType === 'room' && 'Broadcast to a Socket.IO room (requires Socket.IO connection)'}
              </p>
            </div>

            <div>
              <label className="form-label">Channel *</label>
              <select 
                className="form-input"
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
              >
                {availableChannels.length > 0 ? (
                  availableChannels.map(chInfo => {
                    const supportsBroadcast = ['SSE', 'SOCKET'].includes(chInfo.channel)
                    const isDisabled = !chInfo.configured || 
                      ((broadcastType === 'tenant' || broadcastType === 'all' || broadcastType === 'room') && !supportsBroadcast)
                    return (
                      <option 
                        key={chInfo.channel} 
                        value={chInfo.channel}
                        disabled={isDisabled}
                      >
                        {chInfo.channel} {chInfo.configured ? '✓' : '(Not Configured)'}
                        {!supportsBroadcast && (broadcastType === 'tenant' || broadcastType === 'all' || broadcastType === 'room') && ' (Not supported)'}
                      </option>
                    )
                  })
                ) : (
                  <>
                    <option value="EMAIL" disabled={broadcastType !== 'user'}>Email</option>
                    <option value="SMS" disabled={broadcastType !== 'user'}>SMS</option>
                    <option value="WHATSAPP" disabled={broadcastType !== 'user'}>WhatsApp</option>
                    <option value="SSE">SSE (Server-Sent Events)</option>
                    <option value="SOCKET">Socket.IO</option>
                  </>
                )}
              </select>
              {(broadcastType === 'tenant' || broadcastType === 'all' || broadcastType === 'room') && (
                <p className="text-xs text-status-warning mt-1">
                  ⚠️ Tenant/All/Room broadcasts only work with SSE or Socket.IO channels. Other channels will be disabled.
                </p>
              )}
              {broadcastType === 'room' && channel !== 'SOCKET' && (
                <p className="text-xs text-status-error mt-1">
                  ⚠️ Room broadcasts require Socket.IO channel
                </p>
              )}
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

            {broadcastType === 'user' && (
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
            )}

            {broadcastType === 'room' && (
              <div>
                <label className="form-label">Room Name *</label>
                <input
                  className="form-input"
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="support-chat"
                />
                <p className="text-xs text-text-secondary mt-1">
                  Make sure you've joined this room in the Real-time tab first
                </p>
              </div>
            )}

            {(broadcastType === 'tenant' || broadcastType === 'all') && (
              <div className="p-3 bg-bg-tertiary rounded">
                <p className="text-sm text-text-secondary">
                  {broadcastType === 'tenant' && `Will broadcast to all users in tenant: ${user?.tenantId || 'default-tenant'}`}
                  {broadcastType === 'all' && 'Will broadcast to all connected users'}
                </p>
              </div>
            )}

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
                {sendResult.success && (channel === 'SSE' || channel === 'SOCKET') && (
                  <div className="mt-2 pt-2 border-t border-current border-opacity-20">
                    <button
                      onClick={() => setActiveTab('received')}
                      className="text-xs underline hover:no-underline"
                    >
                      Check "Received Notifications" tab to verify delivery
                    </button>
                  </div>
                )}
              </div>
            )}

            <button 
              className="btn btn-primary"
              onClick={sendNotification}
              disabled={sending || !body || (broadcastType === 'user' && !to) || (broadcastType === 'room' && !to)}
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

      {activeTab === 'received' && (
        <div>
          <div className="card mb-6">
            <div className="card-header">
              <h3 className="card-title">Received Notifications</h3>
              <div className="flex items-center gap-4">
                <div className="text-sm text-text-secondary">
                  <span className="font-semibold text-text-primary">{receivedNotifications.length}</span> received
                </div>
                <button className="btn btn-sm btn-secondary" onClick={() => setReceivedNotifications([])}>
                  <Trash2 size={14} />
                  Clear
                </button>
              </div>
            </div>
            <p className="text-text-secondary mb-4 text-sm px-6">
              Notifications you've received via SSE or Socket.IO. This helps verify that broadcasts are working.
            </p>
            
            {receivedNotifications.length === 0 ? (
              <div className="empty-state">
                <Bell className="w-8 h-8" />
                <p>No notifications received yet. Send a broadcast and connect to SSE/Socket.IO to see them here.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {receivedNotifications.map((notif) => (
                  <div 
                    key={notif.id}
                    className="card p-4 mb-0 border-l-4 border-accent-cyan"
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
                          {notif.broadcastType && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-cyan-glow text-accent-cyan">
                              {notif.broadcastType}
                            </span>
                          )}
                          {notif.fromRoom && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-purple-glow text-accent-purple flex items-center gap-1">
                              <Hash className="w-3 h-3" />
                              {notif.fromRoom}
                            </span>
                          )}
                          <span className="text-xs text-text-secondary ml-auto">
                            {new Date(notif.timestamp).toLocaleString()}
                          </span>
                        </div>
                        {notif.subject && (
                          <div className="font-semibold mb-1">{notif.subject}</div>
                        )}
                        <div className="text-text-secondary">{notif.body}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Broadcast Statistics</h3>
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div className="stat-card">
                <div className="stat-value">{broadcastStats.sent}</div>
                <div className="stat-label">Sent</div>
              </div>
              <div className="stat-card border-status-success">
                <div className="stat-value text-status-success">{broadcastStats.received}</div>
                <div className="stat-label">Received</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">
                  {broadcastStats.sent > 0 
                    ? Math.round((broadcastStats.received / broadcastStats.sent) * 100) 
                    : 0}%
                </div>
                <div className="stat-label">Delivery Rate</div>
              </div>
            </div>
            
            {Object.keys(broadcastStats.byType).length > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold mb-3">By Broadcast Type</h4>
                <div className="flex flex-col gap-2">
                  {Object.entries(broadcastStats.byType).map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm capitalize">{type}</span>
                      <span className="text-sm font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
              Connect to Socket.IO to receive real-time notification events and use bidirectional features.
            </p>
            <div className="flex items-center gap-4 mb-4">
              {!socketConnected ? (
                <button className="btn btn-primary" onClick={connectSocket}>
                  <Wifi size={16} />
                  Connect
                </button>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={disconnectSocket}>
                    <WifiOff size={16} />
                    Disconnect
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={updateConnectionCount} title="Refresh connection count">
                    <RefreshCw size={14} />
                  </button>
                  <div className="text-sm text-text-secondary">
                    <span className="font-semibold text-text-primary">{connectionCount.socket}</span> connections
                  </div>
                </>
              )}
            </div>
            {socketConnected && socketRef.current?.id && (
              <div className="p-3 bg-bg-tertiary rounded text-xs">
                <span className="text-text-secondary">Socket ID: </span>
                <span className="font-mono text-text-primary">{socketRef.current.id}</span>
              </div>
            )}
          </div>

          {socketConnected && (
            <>
              {/* Room Management */}
              <div className="card mb-6">
                <div className="card-header">
                  <h3 className="card-title">Room Management</h3>
                  <Hash className="w-5 h-5" />
                </div>
                <p className="text-text-secondary mb-4 text-sm">
                  Join rooms to receive room-specific broadcasts. Socket.IO only feature.
                </p>
                
                <div className="flex gap-3 mb-4">
                  <input
                    className="form-input flex-1"
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Enter room name (e.g., support-chat)"
                    onKeyPress={(e) => e.key === 'Enter' && joinRoom()}
                  />
                  <button className="btn btn-primary" onClick={joinRoom} disabled={!roomName.trim()}>
                    <LogIn size={16} />
                    Join Room
                  </button>
                </div>

                {joinedRooms.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {joinedRooms.map(room => (
                      <div 
                        key={room}
                        className="flex items-center gap-2 px-3 py-1.5 bg-bg-tertiary rounded border border-border"
                      >
                        <Hash className="w-4 h-4 text-text-secondary" />
                        <span className="text-sm">{room}</span>
                        <button
                          onClick={() => leaveRoom(room)}
                          className="text-text-secondary hover:text-text-primary transition-colors"
                          title="Leave room"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Acknowledgment Testing */}
              <div className="card mb-6">
                <div className="card-header">
                  <h3 className="card-title">Acknowledgment Testing</h3>
                  <Zap className="w-5 h-5" />
                </div>
                <p className="text-text-secondary mb-4 text-sm">
                  Test bidirectional communication by sending acknowledgment requests to users.
                </p>
                
                <div className="flex gap-3 mb-4">
                  <input
                    className="form-input flex-1"
                    type="text"
                    value={ackRequestId}
                    onChange={(e) => setAckRequestId(e.target.value)}
                    placeholder="Enter user ID to request acknowledgment from"
                  />
                  <button 
                    className="btn btn-primary" 
                    onClick={testAcknowledgment}
                    disabled={!ackRequestId.trim()}
                  >
                    <MessageCircle size={16} />
                    Send Request
                  </button>
                </div>

                {ackResponse && (
                  <div className="p-3 bg-bg-tertiary rounded">
                    <p className="text-xs text-text-secondary mb-2">Response:</p>
                    <pre className="text-xs font-mono text-text-primary overflow-auto">
                      {ackResponse}
                    </pre>
                    <button
                      className="mt-2 text-xs text-text-secondary hover:text-text-primary"
                      onClick={() => setAckResponse('')}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="card mb-6">
            <div className="card-header">
              <h3 className="card-title">SSE Connection</h3>
              <span className={`status-badge ${sseConnected ? 'healthy' : 'unhealthy'}`}>
                <span className="status-badge-dot" />
                {sseConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <p className="text-text-secondary mb-4 text-sm">
              Connect to Server-Sent Events stream for real-time notifications (unidirectional).
            </p>
            <div className="flex items-center gap-4">
              {!sseConnected ? (
                <button className="btn btn-primary" onClick={connectSSE}>
                  <Play size={16} />
                  Connect
                </button>
              ) : (
                <>
                  <button className="btn btn-secondary" onClick={disconnectSSE}>
                    <Square size={16} />
                    Disconnect
                  </button>
                  <div className="text-sm text-text-secondary">
                    <span className="font-semibold text-text-primary">{connectionCount.sse}</span> connections
                  </div>
                </>
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
