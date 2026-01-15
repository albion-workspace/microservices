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
  roles: string[];
  permissions: string[];
  metadata?: Record<string, any>;
  createdAt: string;
  lastLoginAt?: string;
}

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
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();

  if (result.errors) {
    const errorMessage = result.errors[0]?.message || 'GraphQL error';
    const errorDetails = result.errors[0]?.extensions || {};
    console.error('GraphQL Error:', errorMessage, errorDetails);
    throw new Error(errorMessage);
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
      const accessToken = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
      const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
      const userStr = localStorage.getItem(STORAGE_KEYS.USER);

      if (accessToken && refreshToken && userStr) {
        try {
          // Parse user data but don't store it - we'll fetch fresh from API
          JSON.parse(userStr);
          
          // Try to fetch current user to validate token
          const data = await graphqlRequest(
            `query { me { id email username status roles emailVerified phoneVerified twoFactorEnabled metadata createdAt lastLoginAt } }`,
            {},
            accessToken
          );

          if (data.me) {
            setState({
              user: data.me,
              tokens: { accessToken, refreshToken, expiresIn: 3600 },
              isAuthenticated: true,
              isLoading: false,
            });
            localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.me));
            return;
          }
        } catch (error) {
          // Token invalid, try to refresh
          try {
            const refreshed = await refreshTokenFn(refreshToken);
            if (refreshed) {
              return; // refreshTokenFn will update state
            }
          } catch {
            // Refresh failed, clear auth
          }
        }
      }

      // No valid auth
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

    if (result.success && result.user && result.tokens) {
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
          }
          tokens {
            accessToken
            refreshToken
            expiresIn
          }
          requiresOTP
          otpSentTo
          otpChannel
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

      if (result.success && result.tokens && state.user) {
        saveAuth(state.user, result.tokens);
        return true;
      }

      return false;
    } catch (error) {
      clearAuth();
      return false;
    }
  }, [state.tokens, state.user, saveAuth, clearAuth]);

  // Update user
  const updateUser = useCallback((user: User) => {
    setState(prev => ({
      ...prev,
      user,
    }));
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  }, []);

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
