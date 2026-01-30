/**
 * JWT Token Generation for Browser
 * 
 * Uses Web Crypto API to generate valid HS256 JWT tokens
 * that work with the microservices.
 */

// Service JWT secrets (must match service configuration)
// Use shared secret to match all services' default configuration
const sharedSecret = (import.meta.env as any).VITE_JWT_SECRET || (import.meta.env as any).VITE_SHARED_JWT_SECRET || 'shared-jwt-secret-change-in-production';
export const JWT_SECRETS = {
  payment: sharedSecret,
  bonus: sharedSecret,
}

// Service URLs
export const SERVICE_URLS = {
  payment: 'http://localhost:9002/graphql',
  bonus: 'http://localhost:9003/graphql',
}

/**
 * Base64URL encode (no padding, URL-safe)
 */
function base64UrlEncode(data: Uint8Array | string): string {
  const str = typeof data === 'string' 
    ? btoa(data) 
    : btoa(String.fromCharCode(...data))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Create HMAC-SHA256 signature using Web Crypto API
 */
async function createHmacSignature(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(message)
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData)
  return base64UrlEncode(new Uint8Array(signature))
}

/**
 * Generate a valid JWT token for a specific service
 */
export async function createJWT(
  service: 'payment' | 'bonus',
  payload: {
    userId?: string
    tenantId?: string
    roles?: string[]
    permissions?: string[]
  } = {}
): Promise<string> {
  const secret = JWT_SECRETS[service]
  
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }
  
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    sub: payload.userId || 'dev',
    tid: payload.tenantId || 'dev',
    roles: payload.roles || ['admin'],
    permissions: payload.permissions || ['*:*:*'],
    type: 'access',
    iat: now,
    exp: now + 8 * 60 * 60, // 8 hours
  }
  
  const headerB64 = base64UrlEncode(JSON.stringify(header))
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload))
  
  const signature = await createHmacSignature(`${headerB64}.${payloadB64}`, secret)
  
  return `Bearer ${headerB64}.${payloadB64}.${signature}`
}

// Cache tokens per service
const tokenCache: Record<string, { token: string; expires: number }> = {}

/**
 * Get a valid token for a service (with caching)
 */
export async function getToken(service: 'payment' | 'bonus'): Promise<string> {
  const cached = tokenCache[service]
  const now = Date.now()
  
  // Return cached token if still valid (with 5 min buffer)
  if (cached && cached.expires > now + 5 * 60 * 1000) {
    return cached.token
  }
  
  // Generate new token
  const token = await createJWT(service)
  tokenCache[service] = {
    token,
    expires: now + 8 * 60 * 60 * 1000, // 8 hours
  }
  
  return token
}

/**
 * Make a GraphQL request to a service
 */
export async function graphql<T = any>(
  service: 'payment' | 'bonus',
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token = await getToken(service)
  const url = SERVICE_URLS[service]
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token,
    },
    body: JSON.stringify({ query, variables }),
  })
  
  const data = await res.json()
  if (data.errors) {
    const error = data.errors[0]
    const errorMessage = error?.message || 'GraphQL error'
    const errorCode = error?.extensions?.code || errorMessage
    const errorObj = new Error(errorMessage)
    ;(errorObj as any).code = errorCode
    ;(errorObj as any).extensions = error?.extensions || {}
    throw errorObj
  }
  return data.data
}

/**
 * Check if a service is healthy
 */
export async function checkHealth(service: 'payment' | 'bonus'): Promise<boolean> {
  try {
    const url = SERVICE_URLS[service].replace('/graphql', '/health')
    const res = await fetch(url, { 
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
