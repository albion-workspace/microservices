import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Webhook,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  CheckCircle,
  Search,
  Globe,
  Send,
  Copy,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useAuth } from '../lib/auth-context'

// Helper function to make GraphQL requests with auth token
async function graphqlRequest<T = any>(
  serviceUrl: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  
  const res = await fetch(serviceUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  })
  
  const data = await res.json()
  if (data.errors) {
    throw new Error(data.errors[0]?.message || 'GraphQL error')
  }
  return data.data
}

// Service configurations
const SERVICES = {
  payment: {
    name: 'Payment Gateway',
    color: 'var(--accent-cyan)',
    events: [
      'wallet.created',
      'wallet.updated',
      'wallet.deposit.initiated',
      'wallet.deposit.completed',
      'wallet.deposit.failed',
      'wallet.withdrawal.initiated',
      'wallet.withdrawal.completed',
      'wallet.withdrawal.failed',
      'wallet.transfer.completed',
      'wallet.*',
    ],
  },
  bonus: {
    name: 'Bonus Service',
    color: 'var(--accent-orange)',
    events: [
      'bonus.awarded',
      'bonus.converted',
      'bonus.forfeited',
      'bonus.expired',
      'bonus.claimed',
      'bonus.*',
    ],
  },
}

type ServiceId = keyof typeof SERVICES

// Service URLs
const SERVICE_URLS = {
  payment: 'http://localhost:3004/graphql',
  bonus: 'http://localhost:3005/graphql',
}

export default function Webhooks() {
  const queryClient = useQueryClient()
  const { tokens } = useAuth()
  const [activeService, setActiveService] = useState<ServiceId | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<any>(null)
  
  const authToken = tokens?.accessToken

  // Fetch webhooks from all services
  const webhooksQuery = useQuery({
    queryKey: ['allWebhooks'],
    queryFn: async () => {
      const results: any[] = []
      
      for (const [serviceId, service] of Object.entries(SERVICES)) {
        try {
          const data = await graphqlRequest(
            SERVICE_URLS[serviceId as ServiceId],
            `
            query ListWebhooks {
              webhooks(includeInactive: true) {
                id
                tenantId
                name
                url
                events
                isActive
                description
                lastDeliveryAt
                lastDeliveryStatus
                consecutiveFailures
                createdAt
                updatedAt
              }
            }
          `,
            undefined,
            authToken
          )
          
          const webhooks = data.webhooks || []
          const webhookList = Array.isArray(webhooks) ? webhooks : []
          
          webhookList.forEach((wh: any) => {
            results.push({
              ...wh,
              service: serviceId,
              serviceName: service.name,
              serviceColor: service.color,
            })
          })
        } catch (err) {
          console.warn(`Failed to fetch webhooks from ${serviceId}:`, err)
        }
      }
      
      return results
    },
    refetchInterval: 30000,
  })

  // Fetch stats from all services
  const statsQuery = useQuery({
    queryKey: ['webhookStats'],
    queryFn: async () => {
      const stats: Record<ServiceId, any> = {} as any
      
      for (const [serviceId] of Object.entries(SERVICES)) {
        try {
          const data = await graphqlRequest(
            SERVICE_URLS[serviceId as ServiceId],
            `
            query GetStats {
              webhookStats {
                total
                active
                disabled
                deliveriesLast24h
                successRate
              }
            }
          `,
            undefined,
            authToken
          )
          stats[serviceId as ServiceId] = data.webhookStats || { total: 0, active: 0, disabled: 0, deliveriesLast24h: 0, successRate: 0 }
        } catch (err) {
          stats[serviceId as ServiceId] = { total: 0, active: 0, disabled: 0, deliveriesLast24h: 0, successRate: 0 }
        }
      }
      
      return stats
    },
    refetchInterval: 30000,
  })

  // Delete webhook mutation
  const deleteWebhookMutation = useMutation({
    mutationFn: async ({ service, id }: { service: ServiceId; id: string }) => {
      return graphqlRequest(
        SERVICE_URLS[service],
        `
        mutation DeleteWebhook($id: ID!) {
          deleteWebhook(id: $id)
        }
      `,
        { id },
        authToken
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allWebhooks'] })
      queryClient.invalidateQueries({ queryKey: ['webhookStats'] })
    },
  })

  // Test webhook mutation
  const testWebhookMutation = useMutation({
    mutationFn: async ({ service, id }: { service: ServiceId; id: string }) => {
      return graphqlRequest(
        SERVICE_URLS[service],
        `
        mutation TestWebhook($id: ID!) {
          testWebhook(id: $id) {
            success
            statusCode
            responseTime
            error
          }
        }
      `,
        { id },
        authToken
      )
    },
  })

  const webhooks = webhooksQuery.data || []
  const stats = statsQuery.data || {}

  // Filter webhooks
  const filteredWebhooks = webhooks.filter((wh: any) => {
    if (activeService !== 'all' && wh.service !== activeService) return false
    if (searchTerm && !wh.url.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !wh.name?.toLowerCase().includes(searchTerm.toLowerCase())) return false
    return true
  })

  // Aggregate stats
  const aggregateStats = {
    total: Object.values(stats).reduce((sum: number, s: any) => sum + (s?.total || 0), 0),
    active: Object.values(stats).reduce((sum: number, s: any) => sum + (s?.active || 0), 0),
    deliveries: Object.values(stats).reduce((sum: number, s: any) => sum + (s?.deliveriesLast24h || 0), 0),
    avgSuccessRate: Object.values(stats).length > 0 
      ? Object.values(stats).reduce((sum: number, s: any) => sum + (s?.successRate || 0), 0) / Object.values(stats).length
      : 0,
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">Webhooks</h1>
            <p className="page-subtitle">Manage webhook endpoints across all microservices</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowRegisterForm(true)}>
            <Plus size={16} />
            Register Webhook
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="card-grid" style={{ marginBottom: 24 }}>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <Webhook size={18} />
              Total Webhooks
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 32 }}>{aggregateStats.total}</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <CheckCircle size={18} style={{ color: 'var(--accent-green)' }} />
              Active
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 32, color: 'var(--accent-green)' }}>{aggregateStats.active}</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <Send size={18} style={{ color: 'var(--accent-cyan)' }} />
              Deliveries (24h)
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 32, color: 'var(--accent-cyan)' }}>{aggregateStats.deliveries}</div>
        </div>
        <div className="status-card">
          <div className="status-card-header">
            <div className="status-card-title">
              <CheckCircle size={18} />
              Success Rate
            </div>
          </div>
          <div className="stat-value" style={{ fontSize: 32 }}>{aggregateStats.avgSuccessRate.toFixed(1)}%</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="input"
              placeholder="Search by URL or name..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ paddingLeft: 40 }}
            />
          </div>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn btn-sm ${activeService === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveService('all')}
            >
              All Services
            </button>
            {Object.entries(SERVICES).map(([id, service]) => (
              <button
                key={id}
                className={`btn btn-sm ${activeService === id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveService(id as ServiceId)}
                style={activeService === id ? { background: service.color } : {}}
              >
                {service.name}
              </button>
            ))}
          </div>

          <button className="btn btn-sm btn-secondary" onClick={() => webhooksQuery.refetch()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Webhooks List */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Registered Webhooks ({filteredWebhooks.length})</h3>
        </div>

        {webhooksQuery.isLoading ? (
          <div className="empty-state">Loading webhooks...</div>
        ) : filteredWebhooks.length === 0 ? (
          <div className="empty-state">
            <Webhook />
            <p>No webhooks registered</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredWebhooks.map((wh: any) => (
              <div
                key={`${wh.service}-${wh.id}`}
                style={{
                  padding: 16,
                  background: 'var(--bg-tertiary)',
                  borderRadius: 8,
                  borderLeft: `3px solid ${wh.serviceColor}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600 }}>{wh.name || 'Unnamed Webhook'}</span>
                      <span 
                        style={{ 
                          fontSize: 11, 
                          padding: '2px 8px', 
                          borderRadius: 4, 
                          background: wh.serviceColor + '20',
                          color: wh.serviceColor,
                        }}
                      >
                        {wh.serviceName}
                      </span>
                      <span className={`status-badge ${wh.isActive ? 'healthy' : 'unhealthy'}`}>
                        <span className="status-badge-dot" />
                        {wh.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Globe size={14} />
                      {wh.url}
                      <button 
                        className="btn btn-sm btn-secondary"
                        style={{ padding: '2px 6px', height: 'auto' }}
                        onClick={() => navigator.clipboard.writeText(wh.url)}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => testWebhookMutation.mutate({ service: wh.service, id: wh.id })}
                      disabled={testWebhookMutation.isPending}
                    >
                      <Play size={14} />
                      Test
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => setSelectedWebhook(wh)}
                    >
                      <Eye size={14} />
                      Details
                    </button>
                    <button
                      className="btn btn-sm btn-secondary"
                      style={{ color: 'var(--accent-red)' }}
                      onClick={() => {
                        if (confirm('Delete this webhook?')) {
                          deleteWebhookMutation.mutate({ service: wh.service, id: wh.id })
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {wh.events.map((event: string) => (
                    <span
                      key={event}
                      style={{
                        fontSize: 11,
                        padding: '4px 8px',
                        borderRadius: 4,
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {event}
                    </span>
                  ))}
                </div>

                {wh.description && (
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    {wh.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Register Modal */}
      {showRegisterForm && (
        <RegisterWebhookModal
          onClose={() => setShowRegisterForm(false)}
          onSuccess={() => {
            setShowRegisterForm(false)
            queryClient.invalidateQueries({ queryKey: ['allWebhooks'] })
          }}
        />
      )}

      {/* Details Modal */}
      {selectedWebhook && (
        <WebhookDetailsModal
          webhook={selectedWebhook}
          onClose={() => setSelectedWebhook(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// REGISTER WEBHOOK MODAL
// ═══════════════════════════════════════════════════════════════════

function RegisterWebhookModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { tokens } = useAuth()
  const [form, setForm] = useState({
    service: 'payment' as ServiceId,
    name: '',
    url: '',
    events: [] as string[],
    secret: '',
    description: '',
  })
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!form.url || form.events.length === 0) {
      setError('URL and at least one event are required')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const authToken = tokens?.accessToken
      
      await graphqlRequest(
        SERVICE_URLS[form.service],
        `
        mutation RegisterWebhook($input: RegisterWebhookInput!) {
          registerWebhook(input: $input) {
            id
            name
            url
            events
            isActive
          }
        }
      `,
        {
          input: {
            name: form.name,
            url: form.url,
            events: form.events,
            secret: form.secret || 'default-secret-change-in-production',
            description: form.description || undefined,
          }
        },
        authToken
      )
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Failed to register webhook')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: 500, maxHeight: '80vh', overflow: 'auto' }}>
        <div className="card-header">
          <h3 className="card-title">Register Webhook</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>

        <div className="form-group">
          <label className="form-label">Service</label>
          <select className="input" value={form.service} onChange={e => setForm({ ...form, service: e.target.value as ServiceId, events: [] })}>
            {Object.entries(SERVICES).map(([id, s]) => (
              <option key={id} value={id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Name</label>
          <input 
            type="text" 
            className="input"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="My Webhook"
          />
        </div>

        <div className="form-group">
          <label className="form-label">URL *</label>
          <input 
            type="url" 
            className="input"
            value={form.url}
            onChange={e => setForm({ ...form, url: e.target.value })}
            placeholder="https://api.example.com/webhooks"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Events *</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
            {SERVICES[form.service].events.map(event => (
              <label key={event} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.events.includes(event)}
                  onChange={e => {
                    if (e.target.checked) {
                      setForm({ ...form, events: [...form.events, event] })
                    } else {
                      setForm({ ...form, events: form.events.filter(ev => ev !== event) })
                    }
                  }}
                />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{event}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Secret (for signature verification)</label>
          <input 
            type="password" 
            className="input"
            value={form.secret}
            onChange={e => setForm({ ...form, secret: e.target.value })}
            placeholder="webhook-secret-123"
          />
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <input 
            type="text" 
            className="input"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Receives payment notifications"
          />
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--accent-red-glow)', borderRadius: 8, color: 'var(--accent-red)', fontSize: 14 }}>
            {error}
          </div>
        )}

        <button 
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={{ width: '100%' }}
        >
          {isSubmitting ? 'Registering...' : 'Register Webhook'}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// WEBHOOK DETAILS MODAL
// ═══════════════════════════════════════════════════════════════════

function WebhookDetailsModal({ webhook, onClose }: { webhook: any; onClose: () => void }) {
  const { tokens } = useAuth()
  const [showSecret, setShowSecret] = useState(false)

  // Fetch deliveries
  const deliveriesQuery = useQuery({
    queryKey: ['webhookDeliveries', webhook.service, webhook.id],
    queryFn: () => graphqlRequest(
      SERVICE_URLS[webhook.service as ServiceId],
      `
      query GetDeliveries($webhookId: ID!, $limit: Int) {
        webhookDeliveries(webhookId: $webhookId, limit: $limit) {
          id
          eventId
          eventType
          statusCode
          status
          attempts
          error
          duration
          createdAt
          deliveredAt
        }
      }
    `,
      { webhookId: webhook.id, limit: 20 },
      tokens?.accessToken
    ),
  })

  const deliveries = deliveriesQuery.data?.webhookDeliveries || []

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: 700, maxHeight: '80vh', overflow: 'auto' }}>
        <div className="card-header">
          <h3 className="card-title">Webhook Details</h3>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>NAME</div>
            <div style={{ fontSize: 14 }}>{webhook.name || 'Unnamed'}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>SERVICE</div>
            <div style={{ fontSize: 14, color: webhook.serviceColor }}>{webhook.serviceName}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, gridColumn: 'span 2' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>URL</div>
            <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>{webhook.url}</div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8, gridColumn: 'span 2' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>EVENTS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {webhook.events.map((event: string) => (
                <span key={event} style={{ fontSize: 12, padding: '4px 8px', background: 'var(--bg-primary)', borderRadius: 4 }}>
                  {event}
                </span>
              ))}
            </div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>SECRET HASH</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>
                {showSecret ? (webhook.secretHash || 'Not set') : '••••••••'}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div style={{ padding: 16, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>CREATED</div>
            <div style={{ fontSize: 14 }}>{new Date(webhook.createdAt).toLocaleString()}</div>
          </div>
        </div>

        <h4 style={{ marginBottom: 16, fontSize: 14, fontWeight: 600 }}>Recent Deliveries</h4>
        
        {deliveriesQuery.isLoading ? (
          <div className="empty-state">Loading deliveries...</div>
        ) : deliveries.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <Send />
            <p>No deliveries yet</p>
          </div>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>EVENT</th>
                  <th style={{ textAlign: 'center', padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>STATUS</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>DURATION</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>ATTEMPTS</th>
                  <th style={{ textAlign: 'right', padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>DATE</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d: any) => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px', fontSize: 13, fontFamily: 'var(--font-mono)' }}>{d.eventType}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span className={`status-badge ${d.status === 'delivered' ? 'healthy' : d.status === 'failed' ? 'unhealthy' : 'pending'}`}>
                        <span className="status-badge-dot" />
                        {d.statusCode || d.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px', fontSize: 13, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {d.duration ? `${d.duration}ms` : '-'}
                    </td>
                    <td style={{ padding: '8px', fontSize: 13, textAlign: 'right' }}>{d.attempts}</td>
                    <td style={{ padding: '8px', fontSize: 12, textAlign: 'right', color: 'var(--text-muted)' }}>
                      {new Date(d.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
