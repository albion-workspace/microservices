/**
 * Global GraphQL Utility with Logging
 * Single function to execute GraphQL queries/mutations with comprehensive logging
 */

const LOG_PREFIX = '[GraphQL]'

interface GraphQLLogOptions {
  operation?: string
  showResponse?: boolean
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
  const { operation = 'query', showResponse = true } = options
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
  
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-ID': correlationId,
      'X-Request-ID': correlationId, // Also set X-Request-ID for compatibility
    }
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
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
      console.groupEnd()
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    
    if (data.errors) {
      console.error('GraphQL Errors:', data.errors)
      console.groupEnd()
      
      throw new Error(data.errors[0]?.message || 'GraphQL error')
    }
    
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
