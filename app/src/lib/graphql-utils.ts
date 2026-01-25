/**
 * Global GraphQL Utility with Logging
 * Single function to execute GraphQL queries/mutations with comprehensive logging
 * Includes automatic token refresh on 401 errors
 */

const LOG_PREFIX = '[GraphQL]'

interface GraphQLLogOptions {
  operation?: string
  showResponse?: boolean
  retryOn401?: boolean // Whether to retry after token refresh (default: true)
}

// Token refresh callback - will be set by auth context
let tokenRefreshCallback: (() => Promise<string | null>) | null = null
// Track retry count per request to prevent infinite loops
const retryCountMap = new Map<string, number>()

/**
 * Set the token refresh callback (called by auth context)
 */
export function setTokenRefreshCallback(callback: () => Promise<string | null>) {
  tokenRefreshCallback = callback
}

/**
 * Execute GraphQL query/mutation with logging
 * @param url - GraphQL endpoint URL
 * @param query - GraphQL query/mutation string
 * @param variables - Optional variables object
 * @param token - Optional auth token
 * @param options - Optional logging options
 */
// Generate correlation ID for request tracking
function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

export async function graphql<T = any>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
  options: GraphQLLogOptions = {}
): Promise<T> {
  const { operation = 'query', showResponse = true, retryOn401 = true } = options
  const startTime = Date.now()
  const correlationId = generateCorrelationId()
  
  // Extract service name from URL for logging
  const serviceMatch = url.match(/\/\/([^:]+):(\d+)/)
  const service = serviceMatch ? `${serviceMatch[1]}:${serviceMatch[2]}` : 'unknown'
  
  // Log request
  console.group(`${LOG_PREFIX} ${operation.toUpperCase()} → ${service} [${correlationId}]`)
  console.log('URL:', url)
  console.log('Query:', query.trim().substring(0, 200) + (query.length > 200 ? '...' : ''))
  if (variables && Object.keys(variables).length > 0) {
    console.log('Variables:', variables)
  }
  console.log('Token:', token ? `${token.substring(0, 20)}...` : 'none')
  console.log('Correlation ID:', correlationId)
  
  const executeRequest = async (currentToken?: string, isRetry = false): Promise<T> => {
    // Track retry count to prevent infinite loops
    const retryKey = `${correlationId}-${url}`;
    if (isRetry) {
      const retryCount = (retryCountMap.get(retryKey) || 0) + 1;
      retryCountMap.set(retryKey, retryCount);
      
      if (retryCount > 1) {
        console.error('[GraphQL] ❌ Max retry limit reached, aborting');
        retryCountMap.delete(retryKey);
        console.groupEnd();
        throw new Error('Authentication failed: Max retry limit reached');
      }
    } else {
      retryCountMap.delete(retryKey); // Reset on new request
    }
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
      'X-Request-ID': correlationId, // Also set X-Request-ID for compatibility
    }
    
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    })
    
    const duration = Date.now() - startTime
    console.log(`Status: ${response.status} ${response.statusText} (${duration}ms)`)
    
    if (!response.ok) {
      const text = await response.text()
      console.error('HTTP Error:', text.substring(0, 500))
      
      // Handle 401 Unauthorized - try to refresh token and retry (only once)
      if (response.status === 401 && retryOn401 && !isRetry && currentToken && tokenRefreshCallback) {
        console.log('[GraphQL] 🔄 401 error detected, attempting token refresh...')
        console.groupEnd()
        
        try {
          const newToken = await tokenRefreshCallback()
          if (newToken) {
            console.log('[GraphQL] ✅ Token refreshed, retrying request...')
            // Retry the request with new token (mark as retry)
            return executeRequest(newToken, true)
          } else {
            console.warn('[GraphQL] ⚠️ Token refresh failed, throwing error')
            retryCountMap.delete(retryKey);
            throw new Error('Authentication failed: Token refresh unsuccessful')
          }
        } catch (refreshError: any) {
          console.error('[GraphQL] ❌ Token refresh error:', refreshError.message)
          retryCountMap.delete(retryKey);
          throw new Error(`Authentication failed: ${refreshError.message}`)
        }
      }
      
      console.groupEnd()
      retryCountMap.delete(retryKey);
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.errors) {
      const errorMessage = data.errors[0]?.message || 'GraphQL error'
      const errorLower = errorMessage.toLowerCase()
      
      // Distinguish between authentication errors and permission errors
      // Authentication errors: token invalid/expired/missing - should refresh
      // Permission errors: user authenticated but lacks permission - should NOT refresh
      const isAuthError = errorLower.includes('authentication required') ||
                         errorLower.includes('invalid token') ||
                         errorLower.includes('token expired') ||
                         errorLower.includes('token invalid') ||
                         errorLower.includes('malformed token') ||
                         (errorLower.includes('expired') && errorLower.includes('token'))
      
      // Permission errors - user IS authenticated but lacks permission
      // "Not authorized" means user is authenticated but lacks permission - DO NOT refresh!
      const isPermissionError = errorLower.includes('not authorized') ||
                                (errorLower.includes('unauthorized') && !errorLower.includes('authentication'))
      
      console.error('GraphQL Errors:', data.errors)
      
      // Only refresh on authentication errors, NOT permission errors, and only once
      if (isAuthError && !isPermissionError && retryOn401 && !isRetry && currentToken && tokenRefreshCallback) {
        console.log('[GraphQL] 🔄 Auth error detected in GraphQL response, attempting token refresh...')
        console.groupEnd()
        
        try {
          const newToken = await tokenRefreshCallback()
          if (newToken) {
            console.log('[GraphQL] ✅ Token refreshed, retrying request...')
            // Retry the request with new token (mark as retry)
            return executeRequest(newToken, true)
          } else {
            console.warn('[GraphQL] ⚠️ Token refresh failed, throwing error')
            retryCountMap.delete(retryKey);
            throw new Error(errorMessage)
          }
        } catch (refreshError: any) {
          console.error('[GraphQL] ❌ Token refresh error:', refreshError.message)
          retryCountMap.delete(retryKey);
          throw new Error(errorMessage)
        }
      }
      
      console.groupEnd()
      retryCountMap.delete(retryKey);
      throw new Error(errorMessage)
    }
    
    // Success - clear retry count
    retryCountMap.delete(retryKey);
    
    if (showResponse && data.data) {
      const responseStr = JSON.stringify(data.data).substring(0, 500)
      console.log('Response:', responseStr + (JSON.stringify(data.data).length > 500 ? '...' : ''))
    }
    
    console.log(`✅ Success (${duration}ms)`)
    console.groupEnd()
    
    if (!data.data) {
      throw new Error('No data in GraphQL response')
    }
    
    return data.data
  }
  
  try {
    return await executeRequest(token)
  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error(`❌ Failed (${duration}ms):`, error.message)
    console.groupEnd()
    
    throw error
  }
}

// Service URL helpers (optional - you can pass URLs directly)
export const SERVICE_URLS = {
  auth: (import.meta.env as any).VITE_AUTH_SERVICE_URL || 'http://localhost:3003/graphql',
  payment: (import.meta.env as any).VITE_PAYMENT_SERVICE_URL || 'http://localhost:3004/graphql',
  bonus: (import.meta.env as any).VITE_BONUS_SERVICE_URL || 'http://localhost:3005/graphql',
  notification: (import.meta.env as any).VITE_NOTIFICATION_SERVICE_URL || 'http://localhost:3006/graphql',
}

// Convenience wrappers (optional - you can use graphql() directly)
export const graphqlAuth = <T = any>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
  options?: GraphQLLogOptions
) => graphql<T>(SERVICE_URLS.auth, query, variables, token, options)

export const graphqlPayment = <T = any>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
  options?: GraphQLLogOptions
) => graphql<T>(SERVICE_URLS.payment, query, variables, token, options)

export const graphqlBonus = <T = any>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
  options?: GraphQLLogOptions
) => graphql<T>(SERVICE_URLS.bonus, query, variables, token, options)
