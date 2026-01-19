/**
 * Bonus Management Page
 * View claimed bonuses, manage bonus templates
 */

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Gift, 
  Plus, 
  Award, 
  Search, 
  Edit, 
  Trash2, 
  Save,
  X,
  Filter,
  TrendingUp,
  Calendar,
  DollarSign,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { graphqlBonus, SERVICE_URLS } from '../lib/graphql-utils'
import { useAuth } from '../lib/auth-context'
import { hasRole, isSystem as checkIsSystem, hasAnyRole } from '../lib/access'

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface BonusTemplate {
  id: string
  name: string
  code: string
  type: string
  domain: string
  description?: string
  valueType: string
  value: number
  currency: string
  supportedCurrencies?: string[]
  maxValue?: number
  minDeposit?: number
  turnoverMultiplier: number
  validFrom: string
  validUntil: string
  eligibleTiers?: string[]
  minSelections?: number
  maxSelections?: number
  priority: number
  isActive: boolean
  maxUsesTotal?: number
  maxUsesPerUser?: number
  currentUsesTotal: number
  stackable: boolean
  createdAt?: string
  updatedAt?: string
}

interface UserBonus {
  id: string
  userId: string
  templateCode: string
  type: string
  status: string
  originalValue: number
  currentValue: number
  currency: string
  turnoverRequired: number
  turnoverProgress: number
  expiresAt: string
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function BonusService() {
  const { user, tokens } = useAuth()
  const authToken = tokens?.accessToken
  const queryClient = useQueryClient()
  const isSystem = checkIsSystem(user)
  // Check if user is system or admin (for template management)
  const canManageTemplates = isSystem || hasAnyRole(user?.roles, ['admin', 'system'])
  
  const [activeTab, setActiveTab] = useState<'claimed' | 'templates' | 'create'>('claimed')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [claimedCategoryFilter, setClaimedCategoryFilter] = useState<string>('all')
  const [editingTemplate, setEditingTemplate] = useState<BonusTemplate | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // ═══════════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════════

  // Fetch claimed bonuses (user bonuses)
  // For non-system users, filter by their own userId
  // For system users, show all bonuses
  const claimedBonusesQuery = useQuery({
    queryKey: ['claimedBonuses', user?.id, isSystem, statusFilter, typeFilter, claimedCategoryFilter, searchTerm],
    queryFn: async () => {
      if (!authToken) return null
      
      // For system/admin users, don't filter (show all bonuses)
      // For non-system users, filter by their userId
      // Note: Backend will enforce this filtering, but we pass undefined for system users
      const filter = canManageTemplates ? undefined : { userId: user?.id }
      
      // Build query variables - only include filter if it's defined
      const variables: Record<string, unknown> = { first: 100, skip: 0 }
      if (filter !== undefined) {
        variables.filter = filter
      }
      
      const query = `
        query GetUserBonuses($first: Int, $skip: Int, $filter: JSON) {
          userBonuss(first: $first, skip: $skip, filter: $filter) {
            nodes {
              id
              userId
              templateCode
              type
              status
              originalValue
              currentValue
              currency
              turnoverRequired
              turnoverProgress
              expiresAt
            }
            totalCount
            pageInfo {
              hasNextPage
              hasPreviousPage
            }
          }
        }
      `
      
      const data = await graphqlBonus<{ userBonuss: { nodes: UserBonus[]; totalCount: number } }>(
        query,
        variables,
        authToken
      )
      
      return data.userBonuss
    },
    enabled: !!authToken && activeTab === 'claimed' && !!user?.id,
  })

  // Fetch bonus templates (system/admin only)
  const templatesQuery = useQuery({
    queryKey: ['bonusTemplates', searchTerm, typeFilter, categoryFilter],
    queryFn: async () => {
      if (!authToken) {
        console.warn('[BonusService] No auth token available')
        return { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, hasPreviousPage: false } }
      }
      
      try {
      const query = `
        query GetBonusTemplates($first: Int, $skip: Int) {
          bonusTemplates(first: $first, skip: $skip) {
              nodes {
                id
                name
                code
                type
                domain
                description
                valueType
                value
                currency
                supportedCurrencies
                maxValue
                minDeposit
                turnoverMultiplier
                validFrom
                validUntil
                eligibleTiers
                minSelections
                maxSelections
                priority
                isActive
                maxUsesTotal
                maxUsesPerUser
                currentUsesTotal
                stackable
                createdAt
                updatedAt
              }
              totalCount
            pageInfo {
              hasNextPage
              hasPreviousPage
            }
            }
          }
        `
        
        const data = await graphqlBonus<{ bonusTemplates: { nodes: BonusTemplate[]; totalCount: number } }>(
          query,
          { first: 100, skip: 0 },
          authToken
        )
        
        console.log('[BonusService] Templates fetched:', data.bonusTemplates?.nodes?.length || 0)
        
        if (!data.bonusTemplates) {
          console.error('[BonusService] No bonusTemplates in response:', data)
          return { nodes: [], totalCount: 0, pageInfo: { hasNextPage: false, hasPreviousPage: false } }
        }
        
        return data.bonusTemplates
      } catch (error: any) {
        console.error('[BonusService] Failed to fetch templates:', error)
        throw error
      }
    },
    // Only enable for system/admin users
    enabled: !!authToken && canManageTemplates && (activeTab === 'templates' || activeTab === 'create'),
    retry: 1,
  })

  // ═══════════════════════════════════════════════════════════════════
  // Mutations
  // ═══════════════════════════════════════════════════════════════════

  const createTemplateMutation = useMutation({
    mutationFn: async (input: any) => {
      if (!authToken) throw new Error('Not authenticated')
      
      const mutation = `
        mutation CreateBonusTemplate($input: CreateBonusTemplateInput!) {
          createBonusTemplate(input: $input) {
            success
            bonusTemplate {
              id
              name
              code
              type
            }
            errors
          }
        }
      `
      
      const data = await graphqlBonus(mutation, { input }, authToken)
      
      if (!data.createBonusTemplate.success) {
        throw new Error(data.createBonusTemplate.errors?.join(', ') || 'Failed to create template')
      }
      
      return data.createBonusTemplate.bonusTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bonusTemplates'] })
      setShowCreateForm(false)
    },
  })

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: any }) => {
      if (!authToken) throw new Error('Not authenticated')
      
      // createService pattern generates: updateBonusTemplate(id: ID!, input: UpdateBonusTemplateInput!)
      const mutation = `
        mutation UpdateBonusTemplate($id: ID!, $input: UpdateBonusTemplateInput!) {
          updateBonusTemplate(id: $id, input: $input) {
            success
            bonusTemplate {
              id
              name
              code
              type
              isActive
            }
            errors
          }
        }
      `
      
      const data = await graphqlBonus(mutation, { id, input }, authToken)
      
      if (!data.updateBonusTemplate.success) {
        throw new Error(data.updateBonusTemplate.errors?.join(', ') || 'Failed to update template')
      }
      
      return data.updateBonusTemplate.bonusTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bonusTemplates'] })
      setEditingTemplate(null)
    },
  })

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!authToken) throw new Error('Not authenticated')
      
      const mutation = `
        mutation DeleteBonusTemplate($id: ID!) {
          deleteBonusTemplate(id: $id) {
            success
            errors
          }
        }
      `
      
      const data = await graphqlBonus(mutation, { id }, authToken)
      
      if (!data.deleteBonusTemplate.success) {
        throw new Error(data.deleteBonusTemplate.errors?.join(', ') || 'Failed to delete template')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bonusTemplates'] })
    },
  })

  // ═══════════════════════════════════════════════════════════════════
  // Filtering
  // ═══════════════════════════════════════════════════════════════════

  const filteredBonuses = claimedBonusesQuery.data?.nodes?.filter(bonus => {
    const matchesSearch = !searchTerm || 
      bonus.templateCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      bonus.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (isSystem && bonus.userId.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesStatus = statusFilter === 'all' || bonus.status === statusFilter
    const matchesType = typeFilter === 'all' || bonus.type === typeFilter
    const matchesCategory = claimedCategoryFilter === 'all' || getTemplateCategory(bonus.type) === claimedCategoryFilter
    // Additional filter: non-system users only see their own bonuses (already filtered in query)
    const matchesUser = isSystem || bonus.userId === user?.id
    return matchesSearch && matchesStatus && matchesType && matchesCategory && matchesUser
  }) || []

  // Map template types to categories (matching bonus-command-test.ts structure)
  const templateCategoryMap: Record<string, string> = {
    // Onboarding
    welcome: 'onboarding',
    first_deposit: 'onboarding',
    first_purchase: 'onboarding',
    first_action: 'onboarding',
    // Recurring
    reload: 'recurring',
    top_up: 'recurring',
    // Referral
    referral: 'referral',
    referee: 'referral',
    commission: 'referral',
    // Activity
    activity: 'activity',
    streak: 'activity',
    milestone: 'activity',
    winback: 'activity',
    // Recovery
    cashback: 'recovery',
    consolation: 'recovery',
    // Credits
    free_credit: 'credits',
    trial: 'credits',
    // Loyalty
    loyalty: 'loyalty',
    loyalty_points: 'loyalty',
    vip: 'loyalty',
    tier_upgrade: 'loyalty',
    // Time-based
    birthday: 'timeBased',
    anniversary: 'timeBased',
    seasonal: 'timeBased',
    daily_login: 'timeBased',
    flash: 'timeBased',
    // Achievement
    achievement: 'achievement',
    task_completion: 'achievement',
    challenge: 'achievement',
    // Competition
    tournament: 'competition',
    leaderboard: 'competition',
    // Selection
    selection: 'selection',
    combo: 'selection',
    bundle: 'selection',
    // Promotional
    promo_code: 'promotional',
    special_event: 'promotional',
    custom: 'promotional',
  }

  const getTemplateCategory = (type: string): string => {
    return templateCategoryMap[type] || 'other'
  }

  const filteredTemplates = templatesQuery.data?.nodes?.filter(template => {
    const matchesSearch = !searchTerm || 
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.type.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = typeFilter === 'all' || template.type === typeFilter
    const matchesCategory = categoryFilter === 'all' || getTemplateCategory(template.type) === categoryFilter
    return matchesSearch && matchesType && matchesCategory
  }) || []

  // ═══════════════════════════════════════════════════════════════════
  // Status Badge Component
  // ═══════════════════════════════════════════════════════════════════

  const StatusBadge = ({ status }: { status: string }) => {
    const statusConfig: Record<string, { color: string; icon: any }> = {
      active: { color: 'bg-green-500', icon: CheckCircle },
      pending: { color: 'bg-yellow-500', icon: Clock },
      converted: { color: 'bg-blue-500', icon: Award },
      expired: { color: 'bg-gray-500', icon: XCircle },
      forfeited: { color: 'bg-red-500', icon: XCircle },
      cancelled: { color: 'bg-gray-500', icon: XCircle },
      in_progress: { color: 'bg-blue-500', icon: TrendingUp },
      requirements_met: { color: 'bg-purple-500', icon: CheckCircle },
    }
    
    const config = statusConfig[status] || { color: 'bg-gray-500', icon: AlertCircle }
    const Icon = config.icon
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${config.color} text-white`}>
        <Icon size={12} />
        {status.replace('_', ' ')}
      </span>
    )
  }

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Bonus Management</h1>
        <p className="page-subtitle">View claimed bonuses and manage bonus templates</p>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'claimed' ? 'active' : ''}`}
          onClick={() => setActiveTab('claimed')}
        >
          <Gift size={16} style={{ marginRight: 8 }} />
          Claimed Bonuses ({claimedBonusesQuery.data?.totalCount || 0})
        </button>
        {isSystem && (
          <>
            <button
              className={`tab ${activeTab === 'templates' ? 'active' : ''}`}
              onClick={() => setActiveTab('templates')}
            >
              <Award size={16} style={{ marginRight: 8 }} />
              Templates ({templatesQuery.data?.totalCount || 0})
            </button>
            <button
              className={`tab ${activeTab === 'create' ? 'active' : ''}`}
              onClick={() => setActiveTab('create')}
            >
              <Plus size={16} style={{ marginRight: 8 }} />
              Create Template
            </button>
          </>
        )}
      </div>

      {/* Claimed Bonuses Tab */}
      {activeTab === 'claimed' && (
        <div>
          {/* Filters */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  type="text"
                  className="input"
                  placeholder="Search by code, type, or user ID..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ paddingLeft: 36 }}
                />
              </div>
              <div className="form-group" style={{ minWidth: 150 }}>
                <select
                  className="input"
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="requirements_met">Requirements Met</option>
                  <option value="converted">Converted</option>
                  <option value="expired">Expired</option>
                  <option value="forfeited">Forfeited</option>
                </select>
              </div>
              <div className="form-group" style={{ minWidth: 150 }}>
                <select
                  className="input"
                  value={claimedCategoryFilter}
                  onChange={e => setClaimedCategoryFilter(e.target.value)}
                >
                  <option value="all">All Categories</option>
                  <option value="onboarding">Onboarding</option>
                  <option value="recurring">Recurring</option>
                  <option value="referral">Referral</option>
                  <option value="activity">Activity</option>
                  <option value="recovery">Recovery</option>
                  <option value="credits">Credits</option>
                  <option value="loyalty">Loyalty</option>
                  <option value="timeBased">Time-based</option>
                  <option value="achievement">Achievement</option>
                  <option value="competition">Competition</option>
                  <option value="selection">Selection</option>
                  <option value="promotional">Promotional</option>
                </select>
              </div>
              <div className="form-group" style={{ minWidth: 150 }}>
                <select
                  className="input"
                  value={typeFilter}
                  onChange={e => setTypeFilter(e.target.value)}
                >
                  <option value="all">All Types</option>
                  <option value="first_deposit">First Deposit</option>
                  <option value="first_purchase">First Purchase</option>
                  <option value="first_action">First Action</option>
                  <option value="welcome">Welcome</option>
                  <option value="reload">Reload</option>
                </select>
              </div>
            </div>
          </div>

          {/* Bonuses List */}
          <div className="card">
            {claimedBonusesQuery.isLoading ? (
              <div className="empty-state">
                <Clock />
                <p>Loading bonuses...</p>
              </div>
            ) : claimedBonusesQuery.isError ? (
              <div className="empty-state">
                <AlertCircle />
                <p>Error loading bonuses</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  {claimedBonusesQuery.error instanceof Error ? claimedBonusesQuery.error.message : 'Unknown error'}
                </p>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => claimedBonusesQuery.refetch()}
                  style={{ marginTop: 12 }}
                >
                  Retry
                </button>
              </div>
            ) : filteredBonuses.length === 0 ? (
              <div className="empty-state">
                <Gift />
                <p>No bonuses found</p>
                {claimedBonusesQuery.data && claimedBonusesQuery.data.totalCount === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    No bonuses have been claimed yet
                  </p>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Code</th>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Type</th>
                      {isSystem && (
                        <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>User ID</th>
                      )}
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>Value</th>
                      <th style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>Turnover</th>
                      <th style={{ padding: 12, textAlign: 'left', fontWeight: 600 }}>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBonuses.map(bonus => (
                      <tr key={bonus.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 12 }}>
                          <code style={{ fontSize: 12, background: 'var(--color-bg-secondary)', padding: '4px 8px', borderRadius: 4 }}>
                            {bonus.templateCode}
                          </code>
                        </td>
                        <td style={{ padding: 12 }}>
                          <span style={{ textTransform: 'capitalize' }}>
                            {bonus.type.replace('_', ' ')}
                          </span>
                        </td>
                        {isSystem && (
                          <td style={{ padding: 12 }}>
                            <code style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                              {bonus.userId.substring(0, 8)}...
                            </code>
                          </td>
                        )}
                        <td style={{ padding: 12 }}>
                          <StatusBadge status={bonus.status} />
                        </td>
                        <td style={{ padding: 12, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          ${(bonus.currentValue / 100).toFixed(2)} {bonus.currency}
                          {bonus.originalValue !== bonus.currentValue && (
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                              (was ${(bonus.originalValue / 100).toFixed(2)})
                            </div>
                          )}
                        </td>
                        <td style={{ padding: 12, textAlign: 'right' }}>
                          {bonus.turnoverRequired > 0 ? (
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {bonus.turnoverProgress} / {bonus.turnoverRequired}
                              </div>
                              <div style={{ 
                                width: 100, 
                                height: 4, 
                                background: 'var(--bg-secondary)', 
                                borderRadius: 2,
                                marginTop: 4,
                                overflow: 'hidden'
                              }}>
                                <div style={{
                                  width: `${Math.min(100, (bonus.turnoverProgress / bonus.turnoverRequired) * 100)}%`,
                                  height: '100%',
                                  background: bonus.turnoverProgress >= bonus.turnoverRequired 
                                    ? 'var(--color-status-success)' 
                                    : 'var(--accent-blue)',
                                }} />
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>N/A</span>
                          )}
                        </td>
                        <td style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(bonus.expiresAt).toLocaleDateString()}
                          {new Date(bonus.expiresAt) < new Date() && (
                            <div style={{ fontSize: 10, color: 'var(--color-status-error)', marginTop: 2 }}>
                              Expired
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && canManageTemplates && (
        <div>
          {/* Filters */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                  <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input
                    type="text"
                    className="input"
                    placeholder="Search templates..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{ paddingLeft: 36 }}
                  />
                </div>
                <div className="form-group" style={{ minWidth: 150 }}>
                  <select
                    className="input"
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                  >
                    <option value="all">All Categories</option>
                    <option value="onboarding">Onboarding</option>
                    <option value="recurring">Recurring</option>
                    <option value="referral">Referral</option>
                    <option value="activity">Activity</option>
                    <option value="recovery">Recovery</option>
                    <option value="credits">Credits</option>
                    <option value="loyalty">Loyalty</option>
                    <option value="timeBased">Time-based</option>
                    <option value="achievement">Achievement</option>
                    <option value="competition">Competition</option>
                    <option value="selection">Selection</option>
                    <option value="promotional">Promotional</option>
                  </select>
                </div>
                <div className="form-group" style={{ minWidth: 150 }}>
                  <select
                    className="input"
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value)}
                  >
                    <option value="all">All Types</option>
                    <option value="first_deposit">First Deposit</option>
                    <option value="first_purchase">First Purchase</option>
                    <option value="first_action">First Action</option>
                    <option value="welcome">Welcome</option>
                    <option value="reload">Reload</option>
                  </select>
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => setShowCreateForm(true)}
              >
                <Plus size={16} />
                Create Template
              </button>
            </div>
          </div>

          {/* Templates List */}
          <div className="card">
            {templatesQuery.isLoading ? (
              <div className="empty-state">
                <Clock />
                <p>Loading templates...</p>
              </div>
            ) : templatesQuery.isError ? (
              <div className="empty-state">
                <AlertCircle />
                <p>Error loading templates</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                  {templatesQuery.error instanceof Error ? templatesQuery.error.message : 'Unknown error'}
                </p>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => templatesQuery.refetch()}
                  style={{ marginTop: 12 }}
                >
                  Retry
                </button>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="empty-state">
                <Award />
                <p>No templates found</p>
                {templatesQuery.data && templatesQuery.data.totalCount === 0 && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Create your first bonus template to get started
                  </p>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {filteredTemplates.map(template => (
                  <div
                    key={template.id}
                    className="card"
                    style={{ 
                      padding: 16,
                      border: editingTemplate?.id === template.id ? '2px solid var(--color-accent-cyan)' : '1px solid var(--color-border)'
                    }}
                  >
                    {editingTemplate?.id === template.id ? (
                      <TemplateEditForm
                        template={editingTemplate}
                        onSave={(input) => updateTemplateMutation.mutate({ id: template.id, input })}
                        onCancel={() => setEditingTemplate(null)}
                        isSaving={updateTemplateMutation.isPending}
                      />
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
                          <div>
                            <h3 style={{ margin: 0, marginBottom: 4 }}>{template.name}</h3>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                              <code style={{ fontSize: 11, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                                {template.code}
                              </code>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 500,
                                background: template.isActive ? 'var(--color-status-success-bg)' : 'var(--color-bg-tertiary)',
                                color: template.isActive ? 'var(--color-status-success)' : 'var(--color-text-muted)',
                              }}>
                                {template.isActive ? 'Active' : 'Inactive'}
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{template.type}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              className="btn btn-sm btn-secondary"
                              onClick={() => setEditingTemplate(template)}
                            >
                              <Edit size={14} />
                              Edit
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => {
                                if (confirm(`Delete template "${template.name}"?`)) {
                                  deleteTemplateMutation.mutate(template.id)
                                }
                              }}
                              disabled={deleteTemplateMutation.isPending}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
                          <div>
                            <span style={{ color: 'var(--color-text-muted)' }}>Value:</span>{' '}
                            <strong>
                              {template.valueType === 'percentage' 
                                ? `${template.value}%` 
                                : `$${(template.value / 100).toFixed(2)}`}
                              {template.maxValue && ` (max $${(template.maxValue / 100).toFixed(2)})`}
                            </strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted)' }}>Turnover:</span>{' '}
                            <strong>{template.turnoverMultiplier}x</strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted)' }}>Uses:</span>{' '}
                            <strong>{template.currentUsesTotal} / {template.maxUsesTotal || '∞'}</strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted)' }}>Priority:</span>{' '}
                            <strong>{template.priority}</strong>
                          </div>
                          <div>
                            <span style={{ color: 'var(--color-text-muted)' }}>Valid:</span>{' '}
                            <strong>{new Date(template.validFrom).toLocaleDateString()} - {new Date(template.validUntil).toLocaleDateString()}</strong>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Template Tab */}
      {activeTab === 'create' && canManageTemplates && (
        <div className="card">
          <TemplateEditForm
            template={null}
            onSave={(input) => createTemplateMutation.mutate(input)}
            onCancel={() => setShowCreateForm(false)}
            isSaving={createTemplateMutation.isPending}
          />
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Template Edit Form Component
// ═══════════════════════════════════════════════════════════════════

function TemplateEditForm({
  template,
  onSave,
  onCancel,
  isSaving,
}: {
  template: BonusTemplate | null
  onSave: (input: any) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    code: template?.code || '',
    type: template?.type || 'first_deposit',
    domain: template?.domain || 'universal',
    description: template?.description || '',
    valueType: template?.valueType || 'fixed',
    value: template?.value ? (template.value / 100).toString() : '100',
    currency: template?.currency || 'USD',
    supportedCurrencies: template?.supportedCurrencies?.join(', ') || '',
    maxValue: template?.maxValue ? (template.maxValue / 100).toString() : '',
    minDeposit: template?.minDeposit ? (template.minDeposit / 100).toString() : '',
    turnoverMultiplier: template?.turnoverMultiplier?.toString() || '30',
    validFrom: template?.validFrom ? new Date(template.validFrom).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    validUntil: template?.validUntil ? new Date(template.validUntil).toISOString().split('T')[0] : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    eligibleTiers: template?.eligibleTiers?.join(', ') || '',
    minSelections: template?.minSelections?.toString() || '',
    maxSelections: template?.maxSelections?.toString() || '',
    maxUsesTotal: template?.maxUsesTotal?.toString() || '',
    maxUsesPerUser: template?.maxUsesPerUser?.toString() || '',
    stackable: template?.stackable ?? true,
    priority: template?.priority?.toString() || '50',
    isActive: template?.isActive ?? true,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // For updates, only send changed fields (createService handles partial updates)
    const input: any = {
      name: formData.name,
      code: formData.code,
      type: formData.type,
      domain: formData.domain,
      valueType: formData.valueType,
      value: parseFloat(formData.value) * 100, // Convert to cents
      currency: formData.currency,
      turnoverMultiplier: parseFloat(formData.turnoverMultiplier),
      validFrom: new Date(formData.validFrom).toISOString(),
      validUntil: new Date(formData.validUntil).toISOString(),
      priority: parseInt(formData.priority),
    }
    
    // Optional fields
    if (formData.description) {
      input.description = formData.description
    }
    if (formData.maxValue) {
      input.maxValue = parseFloat(formData.maxValue) * 100
    }
    if (formData.minDeposit) {
      input.minDeposit = parseFloat(formData.minDeposit) * 100
    }
    if (formData.supportedCurrencies) {
      input.supportedCurrencies = formData.supportedCurrencies.split(',').map(c => c.trim()).filter(Boolean)
    }
    if (formData.eligibleTiers) {
      input.eligibleTiers = formData.eligibleTiers.split(',').map(t => t.trim()).filter(Boolean)
    }
    if (formData.minSelections) {
      input.minSelections = parseInt(formData.minSelections)
    }
    if (formData.maxSelections) {
      input.maxSelections = parseInt(formData.maxSelections)
    }
    if (formData.maxUsesTotal) {
      input.maxUsesTotal = parseInt(formData.maxUsesTotal)
    }
    if (formData.maxUsesPerUser) {
      input.maxUsesPerUser = parseInt(formData.maxUsesPerUser)
    }
    
    // For updates, include isActive and stackable
    if (template) {
      input.isActive = formData.isActive
      input.stackable = formData.stackable
    } else {
      // For new templates, set stackable
      input.stackable = formData.stackable
    }
    
    onSave(input)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input
              type="text"
              className="input"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Code *</label>
            <input
              type="text"
              className="input"
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="input"
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            placeholder="Optional description for this bonus template"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Type *</label>
            <select
              className="input"
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value })}
              required
            >
              <option value="first_deposit">First Deposit</option>
              <option value="first_purchase">First Purchase</option>
              <option value="first_action">First Action</option>
              <option value="welcome">Welcome</option>
              <option value="reload">Reload</option>
              <option value="top_up">Top Up</option>
              <option value="cashback">Cashback</option>
              <option value="loyalty">Loyalty</option>
              <option value="referral">Referral</option>
              <option value="referee">Referee</option>
              <option value="activity">Activity</option>
              <option value="milestone">Milestone</option>
              <option value="streak">Streak</option>
              <option value="winback">Winback</option>
              <option value="consolation">Consolation</option>
              <option value="free_credit">Free Credit</option>
              <option value="trial">Trial</option>
              <option value="loyalty_points">Loyalty Points</option>
              <option value="vip">VIP</option>
              <option value="tier_upgrade">Tier Upgrade</option>
              <option value="birthday">Birthday</option>
              <option value="anniversary">Anniversary</option>
              <option value="seasonal">Seasonal</option>
              <option value="daily_login">Daily Login</option>
              <option value="flash">Flash</option>
              <option value="achievement">Achievement</option>
              <option value="task_completion">Task Completion</option>
              <option value="challenge">Challenge</option>
              <option value="tournament">Tournament</option>
              <option value="leaderboard">Leaderboard</option>
              <option value="selection">Selection</option>
              <option value="combo">Combo</option>
              <option value="bundle">Bundle</option>
              <option value="promo_code">Promo Code</option>
              <option value="special_event">Special Event</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Domain *</label>
            <select
              className="input"
              value={formData.domain}
              onChange={e => setFormData({ ...formData, domain: e.target.value })}
              required
            >
              <option value="universal">Universal</option>
              <option value="casino">Casino</option>
              <option value="sports">Sports</option>
              <option value="ecommerce">E-commerce</option>
              <option value="crypto">Crypto</option>
              <option value="social">Social</option>
              <option value="gaming">Gaming</option>
              <option value="fintech">Fintech</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Value Type *</label>
            <select
              className="input"
              value={formData.valueType}
              onChange={e => setFormData({ ...formData, valueType: e.target.value })}
              required
            >
              <option value="fixed">Fixed</option>
              <option value="percentage">Percentage</option>
              <option value="credit">Credit</option>
              <option value="multiplier">Multiplier</option>
              <option value="points">Points</option>
              <option value="item">Item</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Value *</label>
            <input
              type="number"
              className="input"
              value={formData.value}
              onChange={e => setFormData({ ...formData, value: e.target.value })}
              required
              step="0.01"
              placeholder={formData.valueType === 'percentage' ? 'e.g., 100 for 100%' : 'e.g., 100.00'}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Currency *</label>
            <select
              className="input"
              value={formData.currency}
              onChange={e => setFormData({ ...formData, currency: e.target.value })}
              required
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="BTC">BTC</option>
              <option value="ETH">ETH</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Max Value</label>
            <input
              type="number"
              className="input"
              value={formData.maxValue}
              onChange={e => setFormData({ ...formData, maxValue: e.target.value })}
              step="0.01"
              placeholder="Optional cap"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Min Deposit</label>
            <input
              type="number"
              className="input"
              value={formData.minDeposit}
              onChange={e => setFormData({ ...formData, minDeposit: e.target.value })}
              step="0.01"
              placeholder="Minimum deposit"
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Supported Currencies</label>
          <input
            type="text"
            className="input"
            value={formData.supportedCurrencies}
            onChange={e => setFormData({ ...formData, supportedCurrencies: e.target.value })}
            placeholder="Comma-separated: USD, EUR, GBP (leave empty for all)"
          />
          <small style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
            Optional: Restrict to specific currencies. Leave empty to support all currencies.
          </small>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Turnover Multiplier *</label>
            <input
              type="number"
              className="input"
              value={formData.turnoverMultiplier}
              onChange={e => setFormData({ ...formData, turnoverMultiplier: e.target.value })}
              required
              min="0"
              placeholder="e.g., 30 for 30x"
            />
            <small style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Required activity multiplier (0 = no requirement)
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Priority *</label>
            <input
              type="number"
              className="input"
              value={formData.priority}
              onChange={e => setFormData({ ...formData, priority: e.target.value })}
              required
              min="0"
              max="100"
              placeholder="0-100"
            />
            <small style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Higher = evaluated first
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Valid From *</label>
            <input
              type="date"
              className="input"
              value={formData.validFrom}
              onChange={e => setFormData({ ...formData, validFrom: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Valid Until *</label>
            <input
              type="date"
              className="input"
              value={formData.validUntil}
              onChange={e => setFormData({ ...formData, validUntil: e.target.value })}
              required
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Eligible Tiers</label>
            <input
              type="text"
              className="input"
              value={formData.eligibleTiers}
              onChange={e => setFormData({ ...formData, eligibleTiers: e.target.value })}
              placeholder="bronze, silver, gold"
            />
            <small style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Comma-separated user tiers
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Min Selections</label>
            <input
              type="number"
              className="input"
              value={formData.minSelections}
              onChange={e => setFormData({ ...formData, minSelections: e.target.value })}
              min="0"
              placeholder="For combo/bundle"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Selections</label>
            <input
              type="number"
              className="input"
              value={formData.maxSelections}
              onChange={e => setFormData({ ...formData, maxSelections: e.target.value })}
              min="0"
              placeholder="For combo/bundle"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Max Uses Total</label>
            <input
              type="number"
              className="input"
              value={formData.maxUsesTotal}
              onChange={e => setFormData({ ...formData, maxUsesTotal: e.target.value })}
              min="0"
              placeholder="Global limit"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Max Uses Per User</label>
            <input
              type="number"
              className="input"
              value={formData.maxUsesPerUser}
              onChange={e => setFormData({ ...formData, maxUsesPerUser: e.target.value })}
              min="0"
              placeholder="Per-user limit"
            />
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formData.stackable}
                onChange={e => setFormData({ ...formData, stackable: e.target.checked })}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <span>Stackable (can be combined with other bonuses)</span>
            </label>
          </div>
        </div>

        {template && (
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <span>Active (bonus is available for claiming)</span>
            </label>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isSaving}
          >
            <X size={16} />
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSaving}
          >
            <Save size={16} />
            {isSaving ? 'Saving...' : template ? 'Update Template' : 'Create Template'}
          </button>
        </div>
      </div>
    </form>
  )
}
