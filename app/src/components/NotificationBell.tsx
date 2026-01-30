import { useState, useEffect, useRef } from 'react'
import { Bell, Check } from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import { useToast } from '../lib/toast-context'
import { io, Socket } from 'socket.io-client'
import { graphql } from '../lib/graphql-utils'

const NOTIFICATION_SOCKET_URL = 'http://localhost:9004'
const NOTIFICATION_SERVICE_URL = 'http://localhost:9004/graphql'

interface Notification {
  id: string
  timestamp: string
  channel: string
  broadcastType?: string
  subject?: string
  body: string
  fromRoom?: string
  read: boolean
}

export default function NotificationBell() {
  const { tokens, user } = useAuth()
  const { showToast } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [, setLoadingNotifications] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load last 9 notifications from database on mount
  useEffect(() => {
    if (!tokens?.accessToken || !user?.id) return

    const loadNotifications = async () => {
      setLoadingNotifications(true)
      try {
        const data = await graphql<{
          myNotifications: {
            nodes: Array<{
              id: string
              subject?: string
              body: string
              channel: string
              createdAt: string
              status: string
            }>
            totalCount: number
          }
        }>(
          NOTIFICATION_SERVICE_URL,
          `
            query MyNotifications($first: Int) {
              myNotifications(first: $first) {
                nodes {
                  id
                  subject
                  body
                  channel
                  createdAt
                  status
                }
                totalCount
              }
            }
          `,
          { first: 9 },
          tokens.accessToken,
          { operation: 'query', showResponse: false }
        )

        const loadedNotifications: Notification[] = data.myNotifications.nodes.map((notif) => ({
          id: notif.id,
          timestamp: notif.createdAt,
          channel: notif.channel,
          subject: notif.subject,
          body: notif.body,
          read: notif.status === 'DELIVERED' || notif.status === 'SENT', // Consider delivered/sent as read
        }))

        console.log('NotificationBell: Loaded notifications from database', { count: loadedNotifications.length })
        setNotifications(loadedNotifications)
        
        // Update unread count based on loaded notifications
        const unread = loadedNotifications.filter(n => !n.read).length
        setUnreadCount(unread)
      } catch (error: any) {
        console.error('NotificationBell: Failed to load notifications', error)
      } finally {
        setLoadingNotifications(false)
      }
    }

    loadNotifications()
  }, [tokens?.accessToken, user?.id])

  // Connect to Socket.IO for real-time notifications
  useEffect(() => {
    if (!tokens?.accessToken) {
      console.log('NotificationBell: No access token, skipping socket connection')
      return
    }

    console.log('NotificationBell: Connecting to Socket.IO...', NOTIFICATION_SOCKET_URL, { hasToken: !!tokens.accessToken, tokenPreview: tokens.accessToken?.substring(0, 20) })
    const socket = io(NOTIFICATION_SOCKET_URL, {
      transports: ['websocket', 'polling'],
      auth: {
        token: tokens.accessToken,
      },
      path: '/socket.io',
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => {
      console.log('NotificationBell: Socket.IO connected', socket.id)
      // Verify we're in the user room (gateway should auto-join, but let's confirm)
      socket.emit('getRooms', (rooms: string[]) => {
        console.log('NotificationBell: Joined rooms', rooms)
        // Check if we're in a user: room
        const userRoom = rooms.find(r => r.startsWith('user:'))
        if (userRoom) {
          console.log('NotificationBell: User room found', userRoom)
        } else {
          console.warn('NotificationBell: No user room found! Notifications may not be received.')
        }
      })
    })

    socket.on('disconnect', () => {
      console.log('NotificationBell: Socket.IO disconnected')
    })

    socket.on('connect_error', (err) => {
      console.error('NotificationBell: Socket.IO connection error', err)
    })

    // Listen for notification events
    socket.on('notification', (data: any, ack?: (response: any) => void) => {
      console.log('NotificationBell: Received notification event', { data, type: typeof data, keys: data ? Object.keys(data) : [] })
      
      // Handle different data formats
      let notif: any = {}
      if (data && typeof data === 'object') {
        // Check if data is nested in a 'data' property
        notif = data.data || data
      } else {
        notif = { body: String(data) }
      }
      
      const subject = notif.subject || data?.subject
      const body = notif.body || data?.body || notif.message || data?.message || String(data || 'No body')
      const channel = notif.channel || data?.channel || 'SOCKET'
      const broadcastType = notif.broadcastType || data?.broadcastType
      const room = notif.room || data?.room

      const newNotification: Notification = {
        id: notif.id || `notif-${Date.now()}-${Math.random()}`,
        timestamp: notif.timestamp || notif.sentAt || new Date().toISOString(),
        channel,
        broadcastType,
        subject,
        body: body || 'No body',
        fromRoom: room,
        read: false,
      }

      console.log('NotificationBell: Adding notification', newNotification)
      setNotifications(prev => {
        // Avoid duplicates by checking if notification with same ID already exists
        const exists = prev.some(n => n.id === newNotification.id)
        if (exists) {
          console.log('NotificationBell: Notification already exists, skipping', newNotification.id)
          return prev
        }
        const updated = [newNotification, ...prev].slice(0, 50)
        console.log('NotificationBell: Updated notifications list', { count: updated.length, first: updated[0] })
        return updated
      })
      setUnreadCount(prev => {
        const newCount = prev + 1
        console.log('NotificationBell: Updated unread count', { from: prev, to: newCount })
        return newCount
      })

      // Show toast notification
      if (subject || body) {
        showToast('info', subject || body, channel, subject && body ? body : undefined)
      } else {
        showToast('info', 'New notification received', channel)
      }

      // Send acknowledgment if callback provided
      if (ack && typeof ack === 'function') {
        ack({ received: true, timestamp: Date.now() })
      }
    })

    // Listen for any custom events that might contain notifications
    socket.onAny((eventName: string, data: any) => {
      console.log('NotificationBell: Received event', eventName, data)
      if (eventName !== 'notification' && 
          eventName !== 'connect' &&
          eventName !== 'disconnect' &&
          eventName !== 'connectionCount' &&
          eventName !== 'room:joined' &&
          eventName !== 'room:left' &&
          eventName !== 'notification:sent' &&
          eventName !== 'notification:delivered' &&
          eventName !== 'request:status' &&
          data && (data.subject || data.body || (data.data && (data.data.subject || data.data.body)))) {
        const notif = data.data || data
        const subject = notif.subject || data.subject
        const body = notif.body || data.body || notif.message || data.message
        const channel = notif.channel || data.channel || 'SOCKET'

        const newNotification: Notification = {
          id: `notif-${Date.now()}-${Math.random()}`,
          timestamp: new Date().toISOString(),
          channel,
          subject,
          body: body || 'No body',
          read: false,
        }

        console.log('NotificationBell: Adding notification from custom event', newNotification)
        setNotifications(prev => {
          // Avoid duplicates
          const exists = prev.some(n => n.id === newNotification.id)
          if (exists) return prev
          return [newNotification, ...prev].slice(0, 50)
        })
        setUnreadCount(prev => prev + 1)
      }
    })

    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [tokens?.accessToken])

  // Connect to SSE for notifications
  useEffect(() => {
    if (!tokens?.accessToken) return

    // Use /events endpoint for custom SSE notifications (not GraphQL stream)
    const url = `${NOTIFICATION_SOCKET_URL}/events`
    
    const controller = new AbortController()

    fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Accept': 'text/event-stream',
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          console.error('NotificationBell: SSE connection failed', response.status, response.statusText)
          return
        }
        
        console.log('NotificationBell: SSE connection established')
        const reader = response.body?.getReader()
        if (!reader) return

        const decoder = new TextDecoder()
        let currentEvent: string | null = null
        let buffer = ''

        const readStream = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              buffer += chunk
              const lines = buffer.split('\n')
              // Keep the last incomplete line in buffer
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (line.startsWith('event: ')) {
                  currentEvent = line.slice(7).trim()
                } else if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6))
                    
                    console.log('NotificationBell: SSE event received', { currentEvent, data })
                    
                    // Handle notification events (sent via ssePushToUser)
                    if (currentEvent === 'notification' || data.event === 'notification' || data.subject || data.body) {
                      const notif = data.data || data
                      const subject = notif.subject || data.subject
                      const body = notif.body || data.body || notif.message || data.message
                      const channel = notif.channel || data.channel || 'SSE'

                      const newNotification: Notification = {
                        id: notif.id || `notif-${Date.now()}-${Math.random()}`,
                        timestamp: notif.timestamp || notif.sentAt || new Date().toISOString(),
                        channel,
                        subject,
                        body: body || 'No body',
                        read: false,
                      }

                      console.log('NotificationBell: Adding SSE notification', newNotification)
                      setNotifications(prev => {
                        // Avoid duplicates
                        const exists = prev.some(n => n.id === newNotification.id)
                        if (exists) return prev
                        return [newNotification, ...prev].slice(0, 50)
                      })
                      setUnreadCount(prev => prev + 1)
                      
                      // Show toast notification
                      if (subject || body) {
                        showToast('info', subject || body, channel, subject && body ? body : undefined)
                      } else {
                        showToast('info', 'New notification received', channel)
                      }
                    }
                  } catch (err) {
                    console.warn('NotificationBell: Failed to parse SSE data', err, line)
                  }
                  currentEvent = null
                } else if (line.trim() === ':ping') {
                  // Keep-alive ping, ignore
                } else if (line.startsWith('event: connected')) {
                  console.log('NotificationBell: SSE connected')
                }
              }
            }
          } catch (err: any) {
            if (err.name !== 'AbortError') {
              console.error('SSE error:', err)
            }
          }
        }

        readStream()
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('SSE connection error:', err)
        }
      })

    return () => {
      controller.abort()
    }
  }, [tokens?.accessToken])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const markAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(notif =>
        notif.id === id ? { ...notif, read: true } : notif
      )
    )
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  const markAllAsRead = () => {
    setNotifications(prev =>
      prev.map(notif => ({ ...notif, read: true }))
    )
    setUnreadCount(0)
  }

  // Sync unread count with actual unread notifications
  useEffect(() => {
    const actualUnreadCount = notifications.filter(n => !n.read).length
    if (actualUnreadCount !== unreadCount) {
      console.log('NotificationBell: Syncing unread count', { actualUnreadCount, currentUnreadCount: unreadCount, totalNotifications: notifications.length })
      setUnreadCount(actualUnreadCount)
    }
  }, [notifications, unreadCount])

  // Removed unused unreadNotifications calculation (using unreadCount instead)

  return (
    <div className="notification-bell-container" ref={dropdownRef}>
      <button
        className="notification-bell-button"
        onClick={() => setIsOpen(!isOpen)}
        title={`${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <h3 className="notification-dropdown-title">Notifications</h3>
            {unreadCount > 0 && (
              <button
                className="notification-mark-all-read"
                onClick={markAllAsRead}
                title="Mark all as read"
              >
                <Check className="w-4 h-4" />
                Mark all read
              </button>
            )}
          </div>

          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">
                <Bell className="w-8 h-8" />
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 10).map((notif) => (
                <div
                  key={notif.id}
                  className={`notification-item ${!notif.read ? 'unread' : ''}`}
                  onClick={() => markAsRead(notif.id)}
                >
                  <div className="notification-item-header">
                    <span className="notification-channel">{notif.channel}</span>
                    {notif.broadcastType && (
                      <span className="notification-broadcast-type">{notif.broadcastType}</span>
                    )}
                    <span className="notification-time">
                      {new Date(notif.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  {notif.subject && (
                    <div className="notification-subject">{notif.subject}</div>
                  )}
                  <div className="notification-body">{notif.body}</div>
                  {!notif.read && <div className="notification-unread-indicator" />}
                </div>
              ))
            )}
          </div>

          {notifications.length > 10 && (
            <div className="notification-dropdown-footer">
              <a href="/notifications" className="notification-view-all">
                View all notifications
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
