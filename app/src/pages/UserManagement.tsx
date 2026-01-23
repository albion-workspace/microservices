/**
 * User Management Page
 * Admin-only page for managing users, roles, and permissions
 */

import { useState, useEffect } from 'react'
import { useAuth, useAuthRequest } from '../lib/auth-context'
import { hasRole, isSystem as checkIsSystem } from '../lib/access'
import { Shield, Edit, Check, X, Search, Filter, Users, Key, Lock, Unlock, Database, Crown, UserCheck, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'

interface User {
  id: string
  tenantId: string
  username?: string
  email?: string
  phone?: string
  status: string
  emailVerified: boolean
  phoneVerified: boolean
  twoFactorEnabled: boolean
  roles: string[]
  permissions: string[]
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
}

// Available roles in the system
const AVAILABLE_ROLES = [
  { value: 'admin', label: 'Admin', description: 'Business administrator role', color: 'bg-blue-500' },
  { value: 'system', label: 'System', description: 'Full system access', color: 'bg-red-500' },
  { value: 'moderator', label: 'Moderator', description: 'Content moderation access', color: 'bg-orange-500' },
  { value: 'user', label: 'User', description: 'Standard user access', color: 'bg-blue-500' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access', color: 'bg-gray-500' },
]

// Available permissions (URNs) - Comprehensive list based on all services
const AVAILABLE_PERMISSIONS = [
  // System - Full access
  { value: '*:*:*', label: 'All Permissions (System)', category: 'System', description: 'Full system access' },
  
  // Authentication Service
  { value: 'auth:*:*', label: 'Auth: All Operations', category: 'Authentication', description: 'Full auth service access' },
  { value: 'auth:user:read', label: 'Auth: Read Users', category: 'Authentication', description: 'View user information' },
  { value: 'auth:user:create', label: 'Auth: Create Users', category: 'Authentication', description: 'Register new users' },
  { value: 'auth:user:update', label: 'Auth: Update Users', category: 'Authentication', description: 'Modify user data' },
  { value: 'auth:user:delete', label: 'Auth: Delete Users', category: 'Authentication', description: 'Remove users' },
  { value: 'auth:session:*', label: 'Auth: Session Management', category: 'Authentication', description: 'Manage user sessions' },
  { value: 'auth:role:*', label: 'Auth: Role Management', category: 'Authentication', description: 'Manage roles and permissions' },
  
  // Payment Service
  { value: 'payment:*:*', label: 'Payment: All Operations', category: 'Payment', description: 'Full payment service access' },
  { value: 'payment:wallet:read', label: 'Payment: Read Wallets', category: 'Payment', description: 'View wallet balances' },
  { value: 'payment:wallet:create', label: 'Payment: Create Wallets', category: 'Payment', description: 'Create new wallets' },
  { value: 'payment:wallet:update', label: 'Payment: Update Wallets', category: 'Payment', description: 'Modify wallet settings' },
  { value: 'payment:deposit:read', label: 'Payment: Read Deposits', category: 'Payment', description: 'View deposit history' },
  { value: 'payment:deposit:create', label: 'Payment: Create Deposits', category: 'Payment', description: 'Initiate deposits' },
  { value: 'payment:deposit:approve', label: 'Payment: Approve Deposits', category: 'Payment', description: 'Approve pending deposits' },
  { value: 'payment:withdrawal:read', label: 'Payment: Read Withdrawals', category: 'Payment', description: 'View withdrawal history' },
  { value: 'payment:withdrawal:create', label: 'Payment: Create Withdrawals', category: 'Payment', description: 'Request withdrawals' },
  { value: 'payment:withdrawal:approve', label: 'Payment: Approve Withdrawals', category: 'Payment', description: 'Approve withdrawal requests' },
  { value: 'payment:transaction:*', label: 'Payment: Transaction Management', category: 'Payment', description: 'Manage all transactions' },
  { value: 'payment:provider:*', label: 'Payment: Provider Management', category: 'Payment', description: 'Configure payment providers' },
  
  // Bonus Service
  { value: 'bonus:*:*', label: 'Bonus: All Operations', category: 'Bonus', description: 'Full bonus service access' },
  { value: 'bonus:template:read', label: 'Bonus: Read Templates', category: 'Bonus', description: 'View bonus templates' },
  { value: 'bonus:template:create', label: 'Bonus: Create Templates', category: 'Bonus', description: 'Create bonus templates' },
  { value: 'bonus:template:update', label: 'Bonus: Update Templates', category: 'Bonus', description: 'Modify bonus templates' },
  { value: 'bonus:template:delete', label: 'Bonus: Delete Templates', category: 'Bonus', description: 'Remove bonus templates' },
  { value: 'bonus:claim:*', label: 'Bonus: Claim Bonuses', category: 'Bonus', description: 'Claim and manage bonuses' },
  { value: 'bonus:user:*', label: 'Bonus: User Bonus Management', category: 'Bonus', description: 'Manage user bonuses' },
  { value: 'bonus:transaction:*', label: 'Bonus: Transaction Management', category: 'Bonus', description: 'View bonus transactions' },
  
  // Notification Service
  { value: 'notification:*:*', label: 'Notification: All Operations', category: 'Notification', description: 'Full notification service access' },
  { value: 'notification:send:email', label: 'Notification: Send Email', category: 'Notification', description: 'Send email notifications' },
  { value: 'notification:send:sms', label: 'Notification: Send SMS', category: 'Notification', description: 'Send SMS notifications' },
  { value: 'notification:send:push', label: 'Notification: Send Push', category: 'Notification', description: 'Send push notifications' },
  { value: 'notification:read:*', label: 'Notification: Read', category: 'Notification', description: 'View notification history' },
  { value: 'notification:template:*', label: 'Notification: Template Management', category: 'Notification', description: 'Manage notification templates' },
  
  // Webhook Service
  { value: 'webhook:*:*', label: 'Webhook: All Operations', category: 'Webhook', description: 'Full webhook service access' },
  { value: 'webhook:read:*', label: 'Webhook: Read', category: 'Webhook', description: 'View webhooks' },
  { value: 'webhook:create:*', label: 'Webhook: Create', category: 'Webhook', description: 'Register webhooks' },
  { value: 'webhook:update:*', label: 'Webhook: Update', category: 'Webhook', description: 'Modify webhooks' },
  { value: 'webhook:delete:*', label: 'Webhook: Delete', category: 'Webhook', description: 'Remove webhooks' },
  { value: 'webhook:test:*', label: 'Webhook: Test', category: 'Webhook', description: 'Test webhook delivery' },
]

const USER_STATUSES = [
  { value: 'active', label: 'Active', color: 'bg-green-500' },
  { value: 'pending', label: 'Pending', color: 'bg-yellow-500' },
  { value: 'suspended', label: 'Suspended', color: 'bg-red-500' },
  { value: 'locked', label: 'Locked', color: 'bg-gray-500' },
]

export default function UserManagement() {
  const { user: currentUser } = useAuth()
  const authRequest = useAuthRequest()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [populatingDemo, setPopulatingDemo] = useState(false)
  const [showPermissionsGuide, setShowPermissionsGuide] = useState(false)

  // Check if current user is system
  const isSystem = checkIsSystem(currentUser)

  useEffect(() => {
    if (!isSystem) {
      setError('Unauthorized: System access required')
      setLoading(false)
      return
    }
    loadUsers()
  }, [isSystem])

  const loadUsers = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const query = `
        query GetUsers($tenantId: String, $first: Int, $after: String) {
          users(tenantId: $tenantId, first: $first, after: $after) {
            nodes {
              id
              tenantId
              username
              email
              phone
              status
              emailVerified
              phoneVerified
              twoFactorEnabled
              roles
              permissions
              metadata
              createdAt
              updatedAt
              lastLoginAt
            }
            totalCount
          }
        }
      `
      
      const data = await authRequest(query, {
        tenantId: currentUser?.tenantId || 'default-tenant',
        first: 100,
      })
      
      setUsers(data.users.nodes)
    } catch (err: any) {
      setError(err.message || 'Failed to load users')
      console.error('Error loading users:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEditUser = (user: User) => {
    setEditingUser(user)
    setSelectedRoles([...user.roles])
    setSelectedPermissions([...user.permissions])
  }

  const handleSaveRoles = async () => {
    if (!editingUser) return
    
    try {
      setSaving(true)
      setError(null)
      
      const mutation = `
        mutation UpdateUserRoles($input: UpdateUserRolesInput!) {
          updateUserRoles(input: $input) {
            id
            roles
            permissions
          }
        }
      `
      
      await authRequest(mutation, {
        input: {
          userId: editingUser.id,
          tenantId: editingUser.tenantId,
          roles: selectedRoles,
        },
      })
      
      await loadUsers()
      setEditingUser(null)
    } catch (err: any) {
      setError(err.message || 'Failed to update roles')
    } finally {
      setSaving(false)
    }
  }

  const handleSavePermissions = async () => {
    if (!editingUser) return
    
    try {
      setSaving(true)
      setError(null)
      
      const mutation = `
        mutation UpdateUserPermissions($input: UpdateUserPermissionsInput!) {
          updateUserPermissions(input: $input) {
            id
            roles
            permissions
          }
        }
      `
      
      await authRequest(mutation, {
        input: {
          userId: editingUser.id,
          tenantId: editingUser.tenantId,
          permissions: selectedPermissions,
        },
      })
      
      await loadUsers()
      setEditingUser(null)
    } catch (err: any) {
      setError(err.message || 'Failed to update permissions')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateStatus = async (userId: string, tenantId: string, status: string) => {
    try {
      setError(null)
      
      const mutation = `
        mutation UpdateUserStatus($input: UpdateUserStatusInput!) {
          updateUserStatus(input: $input) {
            id
            status
          }
        }
      `
      
      await authRequest(mutation, {
        input: {
          userId,
          tenantId,
          status,
        },
      })
      
      await loadUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to update status')
    }
  }

  const handlePromoteToSystem = async (user: User) => {
    try {
      setError(null)
      
      const mutation = `
        mutation UpdateUserRoles($input: UpdateUserRolesInput!) {
          updateUserRoles(input: $input) {
            id
            roles
          }
        }
      `
      
      await authRequest(mutation, {
        input: {
          userId: user.id,
          tenantId: user.tenantId,
          roles: [...new Set([...user.roles, 'system'])],
        },
      })
      
      await loadUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to promote user')
    }
  }

  const populateDemoData = async () => {
    try {
      setPopulatingDemo(true)
      setError(null)
      
      const tenantId = currentUser?.tenantId || 'default-tenant'
      const demoUsers = [
        {
          tenantId,
          email: `demo-admin-${Date.now()}@example.com`,
          username: `admin-${Date.now()}`,
          password: 'Demo123!@#',
          metadata: { source: 'demo', createdBy: currentUser?.id },
        },
        {
          tenantId,
          email: `demo-moderator-${Date.now()}@example.com`,
          username: `moderator-${Date.now()}`,
          password: 'Demo123!@#',
          metadata: { source: 'demo', createdBy: currentUser?.id },
        },
        {
          tenantId,
          email: `demo-user-${Date.now()}@example.com`,
          username: `user-${Date.now()}`,
          password: 'Demo123!@#',
          metadata: { source: 'demo', createdBy: currentUser?.id },
        },
      ]
      
      const registerMutation = `
        mutation Register($input: RegisterInput!) {
          register(input: $input) {
            success
            user {
              id
              tenantId
              email
              username
              roles
            }
          }
        }
      `
      
      const createdUsers: User[] = []
      
      // Register demo users
      for (const demoUser of demoUsers) {
        try {
          const result = await authRequest(registerMutation, {
            input: demoUser,
          })
          
          if (result.register.success && result.register.user) {
            createdUsers.push(result.register.user)
          }
        } catch (err) {
          console.error('Failed to create demo user:', err)
        }
      }
      
      // Promote first user to system
      if (createdUsers.length > 0) {
        // Ensure the user object has tenantId before promoting
        const userToPromote = { 
          ...createdUsers[0], 
          tenantId: createdUsers[0].tenantId || tenantId 
        }
        await handlePromoteToSystem(userToPromote)
      }
      
      // Assign roles to other users
      if (createdUsers.length > 1) {
        const moderatorMutation = `
          mutation UpdateUserRoles($input: UpdateUserRolesInput!) {
            updateUserRoles(input: $input) {
              id
              roles
            }
          }
        `
        
        await authRequest(moderatorMutation, {
          input: {
            userId: createdUsers[1].id,
            tenantId: createdUsers[1].tenantId || tenantId, // Use tenantId from user or fallback
            roles: ['moderator'],
          },
        })
      }
      
      await loadUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to populate demo data')
    } finally {
      setPopulatingDemo(false)
    }
  }

  const toggleRole = (role: string) => {
    if (selectedRoles.includes(role)) {
      setSelectedRoles(selectedRoles.filter(r => r !== role))
    } else {
      setSelectedRoles([...selectedRoles, role])
    }
  }

  const togglePermission = (permission: string) => {
    if (selectedPermissions.includes(permission)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== permission))
    } else {
      setSelectedPermissions([...selectedPermissions, permission])
    }
  }

  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      !searchTerm ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.id.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  if (!isSystem) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold">Access Denied</h2>
          <p className="text-red-600 mt-1">You need system privileges to access this page.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading users...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6" />
            User Management
          </h1>
          <p className="text-gray-600 mt-1">Manage user roles, permissions, and account status</p>
        </div>
        <button
          onClick={populateDemoData}
          disabled={populatingDemo}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Database className="w-4 h-4" />
          {populatingDemo ? 'Populating...' : 'Populate Demo Data'}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Permissions Guide */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <button
          onClick={() => setShowPermissionsGuide(!showPermissionsGuide)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <span className="font-semibold text-blue-900">Permissions Reference Guide</span>
          </div>
          {showPermissionsGuide ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
        {showPermissionsGuide && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-gray-700">
              Permissions use URN format: <code className="bg-white px-2 py-1 rounded">resource:target:action</code>
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(
                AVAILABLE_PERMISSIONS.reduce((acc, perm) => {
                  if (!acc[perm.category]) acc[perm.category] = []
                  acc[perm.category].push(perm)
                  return acc
                }, {} as Record<string, typeof AVAILABLE_PERMISSIONS>)
              ).map(([category, perms]) => (
                <div key={category} className="bg-white rounded-lg p-3">
                  <h4 className="font-semibold text-gray-900 mb-2">{category}</h4>
                  <ul className="space-y-1">
                    {perms.map(perm => (
                      <li key={perm.value} className="text-xs text-gray-600">
                        <span className="font-medium">{perm.label}</span>
                        {perm.description && (
                          <span className="text-gray-500 ml-1">- {perm.description}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by email, username, or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="text-gray-400 w-5 h-5" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All Status</option>
            {USER_STATUSES.map(status => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Roles</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Permissions</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Verified</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {user.email || user.username || user.phone || 'N/A'}
                      </div>
                      <div className="text-sm text-gray-500">{user.id}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      USER_STATUSES.find(s => s.value === user.status)?.color || 'bg-gray-500'
                    } text-white`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {getRoleNames(user.roles || []).map(role => {
                        const roleInfo = AVAILABLE_ROLES.find(r => r.value === role)
                        return (
                          <span
                            key={role}
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                              roleInfo?.color || 'bg-gray-500'
                            } text-white`}
                          >
                            {roleInfo?.label || role}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-600 max-w-xs">
                      {user.permissions.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.permissions.slice(0, 3).map(perm => {
                            const permInfo = AVAILABLE_PERMISSIONS.find(p => p.value === perm)
                            return (
                              <span
                                key={perm}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800"
                                title={permInfo?.description || perm}
                              >
                                {permInfo?.label || perm.split(':')[0]}
                              </span>
                            )
                          })}
                          {user.permissions.length > 3 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                              +{user.permissions.length - 3} more
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">No permissions</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      {user.emailVerified && (
                        <span className="text-green-600" title="Email verified">✓</span>
                      )}
                      {user.phoneVerified && (
                        <span className="text-green-600" title="Phone verified">📱</span>
                      )}
                      {user.twoFactorEnabled && (
                        <span className="text-blue-600" title="2FA enabled">🔐</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="text-blue-600 hover:text-blue-900"
                        title="Edit user"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      {!hasRole(user.roles, 'system') && (
                        <button
                          onClick={() => handlePromoteToSystem(user)}
                          className="text-purple-600 hover:text-purple-900"
                          title="Promote to System"
                        >
                          <Crown className="w-4 h-4" />
                        </button>
                      )}
                      {user.status === 'active' ? (
                        <button
                          onClick={() => handleUpdateStatus(user.id, user.tenantId, 'suspended')}
                          className="text-red-600 hover:text-red-900"
                          title="Suspend user"
                        >
                          <Lock className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUpdateStatus(user.id, user.tenantId, 'active')}
                          className="text-green-600 hover:text-green-900"
                          title="Activate user"
                        >
                          <Unlock className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Edit User: {editingUser.email || editingUser.username}</h2>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Roles Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Roles
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {AVAILABLE_ROLES.map(role => (
                    <label
                      key={role.value}
                      className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition ${
                        selectedRoles.includes(role.value)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles.includes(role.value)}
                        onChange={() => toggleRole(role.value)}
                        className="mr-3 w-4 h-4 text-blue-600"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{role.label}</div>
                        <div className="text-sm text-gray-500">{role.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <button
                  onClick={handleSaveRoles}
                  disabled={saving}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? 'Saving...' : 'Save Roles'}
                  <Check className="w-4 h-4" />
                </button>
              </div>

              {/* Permissions Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  Permissions
                </h3>
                <div className="space-y-4">
                  {Object.entries(
                    AVAILABLE_PERMISSIONS.reduce((acc, perm) => {
                      if (!acc[perm.category]) acc[perm.category] = []
                      acc[perm.category].push(perm)
                      return acc
                    }, {} as Record<string, typeof AVAILABLE_PERMISSIONS>)
                  ).map(([category, perms]) => (
                    <div key={category}>
                      <h4 className="text-sm font-semibold text-gray-700 mb-2">{category}</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {perms.map(perm => (
                          <label
                            key={perm.value}
                            className={`flex items-start p-3 border-2 rounded-lg cursor-pointer transition ${
                              selectedPermissions.includes(perm.value)
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPermissions.includes(perm.value)}
                              onChange={() => togglePermission(perm.value)}
                              className="mt-0.5 mr-3 w-4 h-4 text-blue-600"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900">{perm.label}</div>
                              {perm.description && (
                                <div className="text-xs text-gray-500 mt-0.5">{perm.description}</div>
                              )}
                              <div className="text-xs text-gray-400 mt-1 font-mono">{perm.value}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleSavePermissions}
                  disabled={saving}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? 'Saving...' : 'Save Permissions'}
                  <Check className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <Users className="w-4 h-4" />
            Total Users
          </div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{users.length}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <UserCheck className="w-4 h-4" />
            Active
          </div>
          <div className="text-2xl font-bold text-green-600 mt-1">
            {users.filter(u => u.status === 'active').length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <Crown className="w-4 h-4" />
            System Users
          </div>
          <div className="text-2xl font-bold text-red-600 mt-1">
            {users.filter(u => hasRole(u.roles, 'system')).length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            With 2FA
          </div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {users.filter(u => u.twoFactorEnabled).length}
          </div>
        </div>
      </div>
    </div>
  )
}
