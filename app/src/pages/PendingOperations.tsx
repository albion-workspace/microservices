import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { 
  Clock, 
  RefreshCw, 
  Search,
  Filter,
  Mail,
  Phone,
  Key,
  AlertCircle,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../lib/auth-context'
import { graphql, SERVICE_URLS } from '../lib/graphql-utils'

interface PendingOperation {
  token: string
  operationType: string
  recipient?: string
  channel?: string
  purpose?: string
  createdAt: string
  expiresAt?: string | null
  expiresIn?: number | null
  metadata?: Record<string, unknown>
}

interface PendingOperationsData {
  pendingOperations: {
    nodes: PendingOperation[]
    totalCount: number
    pageInfo: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }
}

export default function PendingOperations() {
  const { tokens } = useAuth()
  const authToken = tokens?.accessToken
  const [operationTypeFilter, setOperationTypeFilter] = useState<string>('')
  const [recipientFilter, setRecipientFilter] = useState<string>('')

  const { data, isLoading, error, refetch } = useQuery<PendingOperationsData>({
    queryKey: ['pendingOperations', operationTypeFilter, recipientFilter],
    queryFn: async () => {
      const variables: Record<string, unknown> = {
        first: 100,
      }
      
      if (operationTypeFilter) {
        variables.operationType = operationTypeFilter
      }
      
      if (recipientFilter) {
        variables.recipient = recipientFilter
      }

      return graphql<PendingOperationsData>(
        SERVICE_URLS.auth,
        `
          query ListPendingOperations(
            $operationType: String
            $recipient: String
            $first: Int
          ) {
            pendingOperations(
              operationType: $operationType
              recipient: $recipient
              first: $first
            ) {
              nodes {
                token
                operationType
                recipient
                channel
                purpose
                createdAt
                expiresAt
                expiresIn
                metadata
              }
              totalCount
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }
        `,
        variables,
        authToken
      )
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  const operations = data?.pendingOperations?.nodes || []
  const totalCount = data?.pendingOperations?.totalCount || 0

  const formatTimeRemaining = (expiresIn: number | null | undefined): string => {
    if (!expiresIn || expiresIn <= 0) return 'Expired'
    
    const minutes = Math.floor(expiresIn / 60)
    const seconds = expiresIn % 60
    
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60)
      const remainingMinutes = minutes % 60
      return `${hours}h ${remainingMinutes}m`
    }
    
    return `${minutes}m ${seconds}s`
  }

  const getOperationTypeColor = (type: string): string => {
    switch (type) {
      case 'registration':
        return 'bg-blue-100 text-blue-800'
      case 'password_reset':
        return 'bg-orange-100 text-orange-800'
      case 'otp_verification':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getChannelIcon = (channel?: string) => {
    switch (channel?.toLowerCase()) {
      case 'email':
        return <Mail className="w-4 h-4" />
      case 'sms':
      case 'whatsapp':
        return <Phone className="w-4 h-4" />
      default:
        return <Key className="w-4 h-4" />
    }
  }

  const getExpiryStatus = (expiresIn: number | null | undefined) => {
    if (!expiresIn || expiresIn <= 0) {
      return { icon: XCircle, color: 'text-red-500', label: 'Expired' }
    }
    if (expiresIn < 300) { // Less than 5 minutes
      return { icon: AlertCircle, color: 'text-orange-500', label: 'Expiring Soon' }
    }
    return { icon: CheckCircle, color: 'text-green-500', label: 'Active' }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Pending Operations
          </h1>
          <p className="text-gray-600">
            View temporary operations stored in Redis (registration, password reset, OTP verification)
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Operation Type
              </label>
              <select
                value={operationTypeFilter}
                onChange={(e) => setOperationTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <option value="registration">Registration</option>
                <option value="password_reset">Password Reset</option>
                <option value="otp_verification">OTP Verification</option>
              </select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipient (Email/Phone)
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  value={recipientFilter}
                  onChange={(e) => setRecipientFilter(e.target.value)}
                  placeholder="Filter by recipient..."
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-sm text-gray-600 mb-1">Total Operations</div>
            <div className="text-2xl font-bold text-gray-900">{totalCount}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-sm text-gray-600 mb-1">Active Operations</div>
            <div className="text-2xl font-bold text-green-600">
              {operations.filter(op => (op.expiresIn || 0) > 0).length}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <div className="text-sm text-gray-600 mb-1">Expired Operations</div>
            <div className="text-2xl font-bold text-red-600">
              {operations.filter(op => !op.expiresIn || op.expiresIn <= 0).length}
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Error loading pending operations</span>
            </div>
            <p className="text-red-600 mt-1 text-sm">
              {error instanceof Error ? error.message : 'Unknown error occurred'}
            </p>
          </div>
        )}

        {/* Operations Table */}
        {isLoading ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <RefreshCw className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Loading pending operations...</p>
          </div>
        ) : operations.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 text-lg mb-2">No pending operations found</p>
            <p className="text-gray-500 text-sm">
              {operationTypeFilter || recipientFilter
                ? 'Try adjusting your filters'
                : 'Pending operations will appear here when created'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Operation
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Recipient
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Channel
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Expires
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Token
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {operations.map((op, index) => {
                    const expiryStatus = getExpiryStatus(op.expiresIn)
                    const StatusIcon = expiryStatus.icon
                    
                    return (
                      <tr key={`${op.token}-${index}`} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getOperationTypeColor(op.operationType)}`}>
                            {op.operationType}
                          </span>
                          {op.purpose && (
                            <div className="text-xs text-gray-500 mt-1">{op.purpose}</div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {getChannelIcon(op.channel)}
                            <span className="text-sm text-gray-900">{op.recipient || 'N/A'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-600 capitalize">
                            {op.channel || 'N/A'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {new Date(op.createdAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {op.expiresIn !== null && op.expiresIn !== undefined ? (
                            <div className="text-sm">
                              <div className="text-gray-900">
                                {formatTimeRemaining(op.expiresIn)}
                              </div>
                              {op.expiresAt && (
                                <div className="text-xs text-gray-500">
                                  {new Date(op.expiresAt).toLocaleString()}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-400">N/A</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <StatusIcon className={`w-4 h-4 ${expiryStatus.color}`} />
                            <span className={`text-sm ${expiryStatus.color}`}>
                              {expiryStatus.label}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono text-gray-700 max-w-xs truncate">
                              {op.token.substring(0, 20)}...
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(op.token)
                                // You could add a toast notification here
                              }}
                              className="text-gray-400 hover:text-gray-600"
                              title="Copy token"
                            >
                              <Key className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Info Box */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">About Pending Operations</p>
              <ul className="list-disc list-inside space-y-1 text-blue-700">
                <li>Only Redis-based operations are displayed (JWT-based operations cannot be listed)</li>
                <li>Operations automatically expire based on their TTL</li>
                <li>Sensitive data (OTP codes, passwords) is not exposed for security</li>
                <li>Users can only see their own operations; admins can see all</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
