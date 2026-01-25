/**
 * Authentication Context & Hooks
 * Provides authentication state and methods throughout the app
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface User {
  id: string;
  tenantId: string;
  username?: string;
  email?: string;
  phone?: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
  roles: string[] | Array<{ role: string; active?: boolean; expiresAt?: string; assignedAt?: string }>;
  permissions: string[];
  metadata?: Record<string, any>;
  createdAt: string;
  lastLoginAt?: string;
}

// Re-export access utilities from access.ts (uses access-engine)
export { getRoleNames, hasRole, hasAnyRole, can, canAny, canAll, isSystem, isAuthenticated as isUserAuthenticated, parsePermissionUrn, matchPermission } from './access.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (identifier: string, password: string, twoFactorCode?: string) => Promise<any>;
  register: (data: RegisterData) => Promise<any>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  updateUser: (user: User) => void;
}

export interface RegisterData {
  username?: string;
  email?: string;
  phone?: string;
  password: string;
  metadata?: Record<string, any>;
  tenantId?: string;
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

const TENANT_ID = 'default-tenant'; // Change this per your app
const AUTH_SERVICE_URL = (import.meta.env as any).VITE_AUTH_SERVICE_URL || 'http://localhost:3003/graphql';
const STORAGE_KEYS = {
  ACCESS_TOKEN: 'auth_access_token',
  REFRESH_TOKEN: 'auth_refresh_token',
  USER: 'auth_user',
};

// ═══════════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════════

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ═══════════════════════════════════════════════════════════════════
// JWT Utilities
// ═══════════════════════════════════════════════════════════════════

/**
 * Decode JWT token without verification (client-side only, for reading claims)
 */
function decodeJWT(token: string): { exp?: number; [key: string]: any } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded;
  } catch (error) {
    console.warn('[Auth] Failed to decode JWT:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// GraphQL Helpers
// ═══════════════════════════════════════════════════════════════════

async function graphqlRequest(query: string, variables?: any, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(AUTH_SERVICE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ 
      query: query.trim(),
      variables: variables || {},
    }),
  });

  if (!response.ok) {
    const error = new Error(`HTTP error! status: ${response.status}`);
    (error as any).status = response.status;
    throw error;
  }

  const result = await response.json();

  if (result.errors) {
    const errorMessage = result.errors[0]?.message || 'GraphQL error';
    const errorDetails = result.errors[0]?.extensions || {};
    const errorCode = errorDetails?.code || errorDetails?.statusCode;
    console.error('[Auth] GraphQL Error:', errorMessage, errorDetails);
    const error = new Error(errorMessage);
    // Set status from error extensions if available, otherwise infer from message
    (error as any).status = errorCode || (errorMessage.toLowerCase().includes('authentication required') ? 401 : response.status);
    (error as any).errors = result.errors;
    throw error;
  }

  // Log the full response for debugging
  if (!result.data) {
    console.warn('[Auth] No data in GraphQL response:', JSON.stringify(result, null, 2));
  }

  return result.data;
}

// ═══════════════════════════════════════════════════════════════════
// Provider Component
// ═══════════════════════════════════════════════════════════════════

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    tokens: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Initialize auth state from localStorage
  useEffect(() => {
    const initAuth = async () => {
      console.log('[Auth] Initializing auth from localStorage...');
      const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const userStr = localStorage.getItem(STORAGE_KEYS.USER);

      console.log('[Auth] Tokens found:', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        hasUser: !!userStr,
      });

      // Local refresh function (doesn't depend on component state)
      const tryRefreshToken = async (token: string): Promise<boolean> => {
        console.log('[Auth] 🔄 Attempting token refresh...');
        try {
          const data = await graphqlRequest(
            `mutation RefreshToken($input: RefreshTokenInput!) {
              refreshToken(input: $input) {
                success
                message
                user {
                  id
                  email
                  username
                  status
                  roles
                  permissions
                  emailVerified
                  phoneVerified
                  twoFactorEnabled
                }
                tokens {
                  accessToken
                  refreshToken
                  expiresIn
                }
              }
            }`,
            {
              input: {
                tenantId: TENANT_ID,
                refreshToken: token,
              },
            }
          );

          const result = data?.refreshToken;
          console.log('[Auth] Refresh token mutation response:', {
            success: result?.success,
            hasTokens: !!result?.tokens,
            hasUser: !!result?.user,
            message: result?.message,
            resultKeys: result ? Object.keys(result) : [],
            fullResult: JSON.stringify(result, null, 2),
          });
          
          // Log the full data object to see if there are any errors
          console.log('[Auth] Full GraphQL response:', JSON.stringify(data, null, 2));
          
          if (!result) {
            console.error('[Auth] ❌ No refreshToken in response:', data);
            return false;
          }

          if (result.success && result.tokens) {
            console.log('[Auth] ✅ Refresh token mutation succeeded');
            // Use user from refresh response, or fetch it if not provided
            let user = result.user;
            
            // If still no user, fetch it with the new token
            if (!user && result.tokens.accessToken) {
              console.log('[Auth] User not in refresh response, fetching with me query...');
              try {
                const userData = await graphqlRequest(
                  `query { me { id email username status roles permissions emailVerified phoneVerified twoFactorEnabled metadata createdAt lastLoginAt } }`,
                  {},
                  result.tokens.accessToken
                );
                user = userData.me;
                console.log('[Auth] ✅ User fetched after refresh:', { id: user?.id, email: user?.email });
              } catch (fetchError: any) {
                console.warn('[Auth] ⚠️ Failed to fetch user after refresh:', fetchError.message);
                // Use cached user if available
                if (userStr) {
                  try {
                    user = JSON.parse(userStr);
                    console.log('[Auth] Using cached user as fallback');
                  } catch (parseError) {
                    // Ignore parse error
                  }
                }
              }
            }
            
            if (user && result.tokens) {
              console.log('[Auth] ✅ Saving refreshed auth state');
              // Store expiration time
              const expiresIn = result.tokens.expiresIn || 3600;
              const expiresAt = Date.now() + (expiresIn * 1000);
              localStorage.setItem('auth_token_expires_at', expiresAt.toString());
              
              // Save auth state
              localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, result.tokens.accessToken);
              localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, result.tokens.refreshToken);
              localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
              
              setState({
                user,
                tokens: result.tokens,
                isAuthenticated: true,
                isLoading: false,
              });
              return true;
            } else {
              console.warn('[Auth] ⚠️ Refresh succeeded but no user or tokens');
            }
          } else {
            console.warn('[Auth] ⚠️ Refresh mutation returned success=false or no tokens');
          }

          return false;
        } catch (error: any) {
          console.warn('[Auth] ❌ Token refresh failed:', error.message, { status: error.status });
          return false;
        }
      };

      if (accessToken && refreshToken && userStr) {
        console.log('[Auth] All tokens found, validating...');
        // Parse user data once - use cached user temporarily while validating token
        let cachedUser: any;
        try {
          cachedUser = JSON.parse(userStr);
          console.log('[Auth] Cached user parsed:', { id: cachedUser?.id, email: cachedUser?.email });
        } catch (parseError) {
          // Invalid user data in localStorage, clear everything
          console.warn('[Auth] Invalid user data in localStorage, clearing auth');
          setState({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: false,
          });
          localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
          localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
          localStorage.removeItem(STORAGE_KEYS.USER);
          return;
        }
        
        // Check if tokens are expired BEFORE making requests
        // Only check expiration if we can successfully decode the tokens
        const refreshTokenPayload = decodeJWT(refreshToken);
        const refreshTokenExpired = refreshTokenPayload?.exp ? (refreshTokenPayload.exp * 1000 < Date.now()) : false;
        
        if (refreshTokenExpired) {
          console.warn('[Auth] ❌ Refresh token is expired, clearing auth and redirecting to login');
          setState({
            user: null,
            tokens: null,
            isAuthenticated: false,
            isLoading: false,
          });
          localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
          localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
          localStorage.removeItem(STORAGE_KEYS.USER);
          localStorage.removeItem('auth_token_expires_at');
          // Redirect will happen automatically because isAuthenticated is false
          return;
        }
        
        // Check access token expiration - if expired, try refresh before validation
        const accessTokenPayload = decodeJWT(accessToken);
        const accessTokenExpired = accessTokenPayload?.exp ? (accessTokenPayload.exp * 1000 < Date.now()) : false;
        
        if (accessTokenExpired) {
          console.log('[Auth] ⚠️ Access token expired, attempting refresh before validation...');
          const refreshed = await tryRefreshToken(refreshToken);
          if (refreshed) {
            console.log('[Auth] ✅ Token refreshed successfully before validation');
            return; // tryRefreshToken will update state
          } else {
            // Refresh failed - but don't clear auth yet, let the normal validation flow handle it
            // The me query below will fail and trigger the normal error handling
            console.warn('[Auth] ⚠️ Token refresh failed, will validate with server');
          }
        }
        
        try {
          // Try to fetch current user to validate token
          console.log('[Auth] Validating token with me query...');
          const data = await graphqlRequest(
            `query { me { id email username status roles permissions emailVerified phoneVerified twoFactorEnabled metadata createdAt lastLoginAt } }`,
            {},
            accessToken
          );

          if (data.me) {
            console.log('[Auth] ✅ Token valid, user authenticated:', { id: data.me.id, email: data.me.email });
            // Store expiration time (default 1 hour if not provided)
            const expiresAt = Date.now() + (3600 * 1000);
            localStorage.setItem('auth_token_expires_at', expiresAt.toString());
            
            setState({
              user: data.me,
              tokens: { accessToken, refreshToken, expiresIn: 3600 },
              isAuthenticated: true,
              isLoading: false,
            });
            localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.me));
            return;
          } else {
            // me query returned null - token is likely invalid/expired
            console.warn('[Auth] ⚠️ me query returned no user (token likely invalid/expired), attempting refresh...');
            const refreshed = await tryRefreshToken(refreshToken);
            if (refreshed) {
              console.log('[Auth] ✅ Token refreshed successfully after null me response');
              return; // tryRefreshToken will update state
            } else {
              console.warn('[Auth] ❌ Token refresh failed after null me response');
              // Fall through to clear auth
            }
          }
        } catch (error: any) {
          console.warn('[Auth] ❌ Auth validation error:', error.message, { status: error.status });
          
          // Check HTTP status code (from error.status property or parsed from message)
          const httpStatus = error.status || error.message?.match(/status: (\d+)/)?.[1];
          const isHttp401 = httpStatus === 401 || httpStatus === '401';
          const isHttp403 = httpStatus === 403 || httpStatus === '403';
          
          // Network errors (no response) - keep cached user
          if (!httpStatus && (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError'))) {
            console.warn('Network error detected, keeping cached user');
            setState({
              user: cachedUser,
              tokens: { accessToken, refreshToken, expiresIn: 3600 },
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          }
          
          // Distinguish between auth errors and permission errors:
          // - 401 = authentication failed (token invalid/expired) - TRY REFRESH, THEN CLEAR IF FAILS
          // - "Not authorized" = permission error (user is authenticated but lacks permission) - KEEP AUTH
          // - 403 = usually permission error, but could be auth - TREAT AS PERMISSION ERROR
          // - "Authentication required" with 401 = auth error - TRY REFRESH
          // - "Authentication required" without 401 = might be GraphQL error, try refresh first
          const isAuthError = isHttp401 || 
                             (error.message?.toLowerCase().includes('token') && 
                              (error.message?.toLowerCase().includes('expired') || 
                               error.message?.toLowerCase().includes('invalid') ||
                               error.message?.toLowerCase().includes('malformed'))) ||
                             (error.message?.includes('Authentication required') && isHttp401) ||
                             error.message?.includes('Invalid token');
          
          // "Not authorized" means user IS authenticated but lacks permission - don't clear auth!
          const isPermissionError = error.message?.includes('Not authorized') ||
                                   (error.message?.includes('Unauthorized') && !isHttp401) ||
                                   isHttp403;
          
          // Try refresh if it's an auth error (401 or token-related)
          if (isAuthError && !isPermissionError) {
            console.log('[Auth] 🔄 Auth error detected, attempting token refresh...');
            const refreshed = await tryRefreshToken(refreshToken);
            if (refreshed) {
              console.log('[Auth] ✅ Token refreshed successfully, staying logged in');
              return; // tryRefreshToken will update state
            } else {
              console.warn('[Auth] ❌ Token refresh failed, clearing auth and redirecting to login');
              // Clear auth and redirect
              setState({
                user: null,
                tokens: null,
                isAuthenticated: false,
                isLoading: false,
              });
              localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.USER);
              localStorage.removeItem('auth_token_expires_at');
              return;
            }
          } else if (!isPermissionError && error.message?.includes('Authentication required')) {
            // "Authentication required" without 401 - might be expired token, try refresh
            console.log('[Auth] 🔄 "Authentication required" error detected, attempting token refresh...');
            const refreshed = await tryRefreshToken(refreshToken);
            if (refreshed) {
              console.log('[Auth] ✅ Token refreshed successfully, staying logged in');
              return; // tryRefreshToken will update state
            } else {
              console.warn('[Auth] ❌ Token refresh failed, clearing auth and redirecting to login');
              // Clear auth and redirect
              setState({
                user: null,
                tokens: null,
                isAuthenticated: false,
                isLoading: false,
              });
              localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
              localStorage.removeItem(STORAGE_KEYS.USER);
              localStorage.removeItem('auth_token_expires_at');
              return;
            }
          } else if (!isAuthError) {
            // Permission error, network error, GraphQL error, or other non-auth error
            // Use cached user - user is authenticated, just might have permission issues
            console.warn('[Auth] ⚠️ Non-auth error detected, keeping cached user');
            setState({
              user: cachedUser,
              tokens: { accessToken, refreshToken, expiresIn: 3600 },
              isAuthenticated: true,
              isLoading: false,
            });
            return;
          }
          
          // If we get here, auth failed and refresh failed - clear auth
          console.warn('[Auth] ❌ Clearing auth due to failed authentication, redirecting to login');
        }
      } else {
        console.log('[Auth] ⚠️ No tokens found in localStorage');
      }

      // No valid auth
      console.log('[Auth] Setting state to unauthenticated');
      setState({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: false,
      });
    };

    initAuth();
  }, []);

  // Save tokens to localStorage
  const saveAuth = useCallback((user: User, tokens: AuthTokens) => {
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, tokens.accessToken);
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    
    // Store token expiration time for proactive refresh
    // Calculate expiration: current time + expiresIn seconds
    const expiresAt = Date.now() + (tokens.expiresIn * 1000);
    localStorage.setItem('auth_token_expires_at', expiresAt.toString());

    setState({
      user,
      tokens,
      isAuthenticated: true,
      isLoading: false,
    });
  }, []);

  // Clear auth
  const clearAuth = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    localStorage.removeItem('auth_token_expires_at');

    setState({
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  // Login
  const login = useCallback(async (identifier: string, password: string, twoFactorCode?: string) => {
    const mutation = `
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          success
          message
          requiresOTP
          user {
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
            lastLoginAt
          }
          tokens {
            accessToken
            refreshToken
            expiresIn
            refreshExpiresIn
          }
        }
      }
    `;

    const data = await graphqlRequest(mutation, {
      input: {
        tenantId: TENANT_ID,
        identifier,
        password,
        twoFactorCode: twoFactorCode || undefined,
      },
    });

    const result = data.login;

    // Only save tokens if login is successful AND 2FA is not required
    // If requiresOTP is true, we should NOT save tokens - user needs to provide 2FA code first
    if (result.success && result.user && result.tokens && !result.requiresOTP) {
      saveAuth(result.user, result.tokens);
    }

    return result;
  }, [saveAuth]);

  // Register
  const register = useCallback(async (registerData: RegisterData) => {
    const query = `
      mutation Register($input: RegisterInput!) {
        register(input: $input) {
          success
          message
          user {
            id
            email
            username
            status
            emailVerified
            phoneVerified
          }
          tokens {
            accessToken
            refreshToken
            expiresIn
            refreshExpiresIn
          }
          requiresOTP
          otpSentTo
          otpChannel
          registrationToken
        }
      }
    `;

    const data = await graphqlRequest(query, {
      input: {
        tenantId: TENANT_ID,
        ...registerData,
      },
    });

    const result = data.register;

    // If tokens provided (autoVerify: true), save auth
    if (result.success && result.user && result.tokens) {
      saveAuth(result.user, result.tokens);
    }

    return result;
  }, [saveAuth]);

  // Logout
  const logout = useCallback(async () => {
    if (state.tokens?.refreshToken) {
      try {
        await graphqlRequest(
          `mutation Logout($refreshToken: String!) {
            logout(refreshToken: $refreshToken) {
              success
            }
          }`,
          { refreshToken: state.tokens.refreshToken },
          state.tokens.accessToken
        );
      } catch (error) {
        console.error('Logout error:', error);
      }
    }

    clearAuth();
  }, [state.tokens, clearAuth]);

  // Logout from all devices
  const logoutAll = useCallback(async () => {
    if (state.tokens?.accessToken) {
      try {
        await graphqlRequest(
          `mutation LogoutAll {
            logoutAll {
              success
              count
            }
          }`,
          {},
          state.tokens.accessToken
        );
      } catch (error) {
        console.error('Logout all error:', error);
      }
    }

    clearAuth();
  }, [state.tokens, clearAuth]);

  // Refresh token
  const refreshTokenFn = useCallback(async (refreshToken?: string): Promise<boolean> => {
    const token = refreshToken || state.tokens?.refreshToken;

    if (!token) return false;

    try {
      const data = await graphqlRequest(
        `mutation RefreshToken($input: RefreshTokenInput!) {
          refreshToken(input: $input) {
            success
            user {
              id
              email
              username
              status
              roles
              permissions
              emailVerified
              phoneVerified
              twoFactorEnabled
            }
            tokens {
              accessToken
              refreshToken
              expiresIn
            }
          }
        }`,
        {
          input: {
            tenantId: TENANT_ID,
            refreshToken: token,
          },
        }
      );

      const result = data.refreshToken;

      if (result.success && result.tokens) {
        // Use user from refresh response, or fetch it if not provided
        let user = result.user || state.user;
        
        // If still no user, fetch it with the new token
        if (!user && result.tokens.accessToken) {
          try {
            const userData = await graphqlRequest(
              `query { me { id email username status roles permissions emailVerified phoneVerified twoFactorEnabled metadata createdAt lastLoginAt } }`,
              {},
              result.tokens.accessToken
            );
            user = userData.me;
          } catch (fetchError) {
            console.warn('Failed to fetch user after refresh:', fetchError);
            // Use cached user if available
            const cachedUserStr = localStorage.getItem(STORAGE_KEYS.USER);
            if (cachedUserStr) {
              try {
                user = JSON.parse(cachedUserStr);
              } catch (parseError) {
                // Ignore parse error
              }
            }
          }
        }
        
        if (user && result.tokens) {
          saveAuth(user, result.tokens);
          return true;
        }
      }

      return false;
    } catch (error: any) {
      console.warn('Token refresh failed:', error.message);
      // Don't clear auth here - let the caller decide
      return false;
    }
  }, [state.tokens, state.user, saveAuth]);

  // Update user
  const updateUser = useCallback((user: User) => {
    setState(prev => ({
      ...prev,
      user,
    }));
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  }, []);

  // Refresh lock to prevent multiple simultaneous refreshes
  const refreshLockRef = React.useRef<Promise<string | null> | null>(null);

  // Token refresh callback for graphql-utils (returns new access token or null)
  // This is called automatically when graphql-utils encounters a 401 error
  const getRefreshedToken = useCallback(async (): Promise<string | null> => {
    // If refresh is already in progress, wait for it
    if (refreshLockRef.current) {
      console.log('[Auth] ⏳ Token refresh already in progress, waiting...');
      return refreshLockRef.current;
    }
    
    // Read refresh token from localStorage directly to avoid stale state
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      console.warn('[Auth] No refresh token available for automatic refresh');
      return null;
    }
    
    // Check if refresh token is expired before attempting refresh
    // Only check if we can successfully decode the token
    const refreshTokenPayload = decodeJWT(refreshToken);
    const refreshTokenExpired = refreshTokenPayload?.exp ? (refreshTokenPayload.exp * 1000 < Date.now()) : false;
    if (refreshTokenExpired) {
      console.warn('[Auth] ❌ Refresh token is expired, clearing auth and redirecting to login');
      clearAuth();
      return null;
    }
    
    // Create refresh promise and store in lock
    const refreshPromise = (async (): Promise<string | null> => {
      try {
        console.log('[Auth] 🔄 Automatic token refresh triggered by graphql-utils...');
        const data = await graphqlRequest(
        `mutation RefreshToken($input: RefreshTokenInput!) {
          refreshToken(input: $input) {
            success
            message
            user {
              id
              email
              username
              status
              roles
              permissions
              emailVerified
              phoneVerified
              twoFactorEnabled
            }
            tokens {
              accessToken
              refreshToken
              expiresIn
              refreshExpiresIn
            }
          }
        }`,
        {
          input: {
            tenantId: TENANT_ID,
            refreshToken: refreshToken,
          },
        }
      );

      const result = data?.refreshToken;
      if (result?.success && result?.tokens?.accessToken) {
        // Update state and localStorage
        const newTokens = {
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken || refreshToken,
          expiresIn: result.tokens.expiresIn || 3600,
        };
        
        // Store expiration time
        const expiresAt = Date.now() + (newTokens.expiresIn * 1000);
        localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, newTokens.accessToken);
        localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, newTokens.refreshToken);
        localStorage.setItem('auth_token_expires_at', expiresAt.toString());
        
        // Update user if provided, otherwise keep existing
        const user = result.user || state.user;
        if (user) {
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
        }
        
        // Update state
        setState(prev => ({
          ...prev,
          tokens: newTokens,
          user: user || prev.user,
        }));
        
        console.log('[Auth] ✅ Token refreshed successfully via automatic callback');
        return newTokens.accessToken;
      }
      
      console.warn('[Auth] ⚠️ Token refresh failed via callback:', result?.message);
      // If refresh failed, check if refresh token might be expired
      const errorMessage = result?.message?.toLowerCase() || '';
      if (errorMessage.includes('expired') || errorMessage.includes('invalid') || errorMessage.includes('refresh')) {
        console.warn('[Auth] ❌ Refresh token appears to be expired, clearing auth');
        clearAuth();
      }
      return null;
    } catch (error: any) {
      console.error('[Auth] ❌ Token refresh error via callback:', error.message);
      // Check if error indicates refresh token is expired
      const errorMessage = error.message?.toLowerCase() || '';
      if (errorMessage.includes('expired') || errorMessage.includes('invalid') || errorMessage.includes('refresh')) {
        console.warn('[Auth] ❌ Refresh token appears to be expired, clearing auth');
        clearAuth();
      }
      return null;
    } finally {
      // Clear lock when done
      refreshLockRef.current = null;
    }
    })();
    
    // Store promise in lock
    refreshLockRef.current = refreshPromise;
    return refreshPromise;
  }, [state.tokens, state.user, clearAuth]);

  // Proactive token refresh - refresh before expiration
  // Use ref to track scheduled refresh and prevent loops
  const scheduledRefreshRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    if (!state.isAuthenticated || !state.tokens) {
      // Clear any scheduled refresh if not authenticated
      if (scheduledRefreshRef.current) {
        clearTimeout(scheduledRefreshRef.current);
        scheduledRefreshRef.current = null;
      }
      return;
    }

    const expiresAtStr = localStorage.getItem('auth_token_expires_at');
    if (!expiresAtStr) {
      return;
    }

    // Clear any existing scheduled refresh
    if (scheduledRefreshRef.current) {
      clearTimeout(scheduledRefreshRef.current);
      scheduledRefreshRef.current = null;
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    
    // Check if refresh token is expired before attempting proactive refresh
    const currentRefreshToken = state.tokens?.refreshToken || localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (currentRefreshToken) {
      const refreshTokenPayload = decodeJWT(currentRefreshToken);
      const refreshTokenExpired = refreshTokenPayload?.exp ? (refreshTokenPayload.exp * 1000 < Date.now()) : false;
      if (refreshTokenExpired) {
        console.warn('[Auth] ❌ Refresh token is expired, clearing auth');
        clearAuth();
        return;
      }
    }
    
    // Refresh token if it expires in less than 5 minutes (300000ms)
    // or if it's already expired (but not more than 1 minute ago)
    const shouldRefresh = timeUntilExpiry < 5 * 60 * 1000 && timeUntilExpiry > -60 * 1000;
    
    if (shouldRefresh) {
      console.log('[Auth] 🔄 Proactively refreshing token (expires soon)');
      refreshTokenFn().catch((error) => {
        console.warn('[Auth] ⚠️ Proactive token refresh failed:', error.message);
        // If refresh fails, check if refresh token might be expired
        const errorMessage = error.message?.toLowerCase() || '';
        if (errorMessage.includes('expired') || errorMessage.includes('invalid') || errorMessage.includes('refresh')) {
          console.warn('[Auth] ❌ Refresh token appears to be expired during proactive refresh, clearing auth');
          clearAuth();
        }
      });
    } else if (timeUntilExpiry > 5 * 60 * 1000) {
      // Schedule refresh 5 minutes before expiration
      const refreshDelay = timeUntilExpiry - (5 * 60 * 1000);
      console.log(`[Auth] ⏰ Scheduling token refresh in ${Math.round(refreshDelay / 1000 / 60)} minutes`);
      scheduledRefreshRef.current = setTimeout(() => {
        console.log('[Auth] 🔄 Executing scheduled token refresh');
        scheduledRefreshRef.current = null;
        refreshTokenFn().catch((error) => {
          console.warn('[Auth] ⚠️ Scheduled token refresh failed:', error.message);
          // If refresh fails, check if refresh token might be expired
          const errorMessage = error.message?.toLowerCase() || '';
          if (errorMessage.includes('expired') || errorMessage.includes('invalid') || errorMessage.includes('refresh')) {
            console.warn('[Auth] ❌ Refresh token appears to be expired during scheduled refresh, clearing auth');
            clearAuth();
          }
        });
      }, refreshDelay);
    }
    
    // Cleanup function
    return () => {
      if (scheduledRefreshRef.current) {
        clearTimeout(scheduledRefreshRef.current);
        scheduledRefreshRef.current = null;
      }
    };
  }, [state.isAuthenticated, state.tokens?.accessToken]); // Only depend on accessToken, not the whole tokens object or refreshTokenFn
  
  // Separate effect to handle refreshTokenFn calls without causing loops
  // This effect only runs when tokens actually change (new token received)
  const lastTokenRef = React.useRef<string | undefined>(state.tokens?.accessToken);
  React.useEffect(() => {
    // Only schedule refresh if token actually changed (not just state update)
    if (state.tokens?.accessToken && state.tokens.accessToken !== lastTokenRef.current) {
      lastTokenRef.current = state.tokens.accessToken;
      // Token changed, proactive refresh will be handled by the main effect above
    }
  }, [state.tokens?.accessToken]);

  // Register token refresh callback with graphql-utils
  // Use ref to store callback to avoid re-registration on every state change
  const refreshCallbackRef = React.useRef(getRefreshedToken);
  refreshCallbackRef.current = getRefreshedToken;
  
  useEffect(() => {
    // Import dynamically to avoid circular dependency
    import('./graphql-utils.js').then((module) => {
      if (module.setTokenRefreshCallback) {
        // Use wrapper that always calls the latest callback
        module.setTokenRefreshCallback(async () => {
          return refreshCallbackRef.current();
        });
        console.log('[Auth] ✅ Token refresh callback registered with graphql-utils');
      }
    }).catch((error) => {
      console.warn('[Auth] ⚠️ Failed to register token refresh callback:', error);
    });
  }, []); // Only run once on mount

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    logoutAll,
    refreshToken: refreshTokenFn,
    updateUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// ═══════════════════════════════════════════════════════════════════
// Utility Hooks
// ═══════════════════════════════════════════════════════════════════

export function useAuthRequest() {
  const { tokens } = useAuth();

  return useCallback(
    async (query: string, variables?: any) => {
      return graphqlRequest(query, variables, tokens?.accessToken);
    },
    [tokens]
  );
}
