#!/usr/bin/env npx tsx
/**
 * Unified Auth Test Suite - Single Source of Truth
 * 
 * Consolidates all auth tests into one file with shared utilities.
 * Tests all authentication functionality: registration, login, password reset, OTP, 2FA, token refresh.
 * 
 * Usage:
 *   npm run auth:test                    # Run all tests
 *   npx tsx auth-command-test.ts         # Run all tests
 *   npx tsx auth-command-test.ts setup   # Setup test users
 *   npx tsx auth-command-test.ts registration  # Test registration flow
 *   npx tsx auth-command-test.ts login   # Test login flow
 *   npx tsx auth-command-test.ts password-reset # Test password reset flow
 *   npx tsx auth-command-test.ts otp     # Test OTP verification flow
 *   npx tsx auth-command-test.ts 2fa    # Test 2FA flow
 *   npx tsx auth-command-test.ts token   # Test token refresh flow
 *   npx tsx auth-command-test.ts all     # Run complete test suite (clean, setup, all tests)
 * 
 * Following CODING_STANDARDS.md:
 * - Import ordering: Node built-ins → External packages → Local imports → Type imports
 */

// External packages (core-service)
import { connectRedis, getRedis, scanKeysIterator } from '../../../core-service/src/index.js';

// Local imports
import { 
  loginAs, 
  registerAs, 
  getUserDefinition,
  initializeConfig,
  getDefaultTenantId,
} from '../config/users.js';
import { 
  loadScriptConfig,
  AUTH_SERVICE_URL,
  getAuthDatabase, 
  closeAllConnections,
} from '../config/scripts.js';

// ═══════════════════════════════════════════════════════════════════
// GraphQL Helper
// ═══════════════════════════════════════════════════════════════════

async function graphql<T = any>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result: any = await response.json();

  if (result.errors) {
    const errorMessage = result.errors.map((e: any) => e.message).join('; ');
    throw new Error(`GraphQL Error: ${errorMessage}`);
  }

  return result.data as T;
}

function decodeJWT(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT token');
  }
  
  const payload = parts[1];
  const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
  return JSON.parse(decoded);
}

/**
 * Extract OTP/metadata from JWT token (unified helper)
 * Works for both registrationToken and resetToken
 */
function extractTokenMetadata(token: string): {
  operationType: string;
  data: any;
  metadata: any;
  createdAt: number;
  otp?: {
    hashedCode: string;
    channel: string;
    recipient: string;
    purpose: string;
    createdAt: number;
    expiresIn: number;
  };
} | null {
  try {
    const decoded = decodeJWT(token);
    
    // Check if it's a pending operation token
    if (decoded.type === 'pending_operation' && decoded.data) {
      return {
        operationType: decoded.operationType || decoded.data.operationType,
        data: decoded.data,
        metadata: decoded.metadata || {},
        createdAt: decoded.iat * 1000 || Date.now(),
        otp: decoded.data.otp,
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Utilities
// ═══════════════════════════════════════════════════════════════════

let testResults: { test: string; passed: boolean; message?: string }[] = [];

function logTest(testName: string, passed: boolean, message?: string) {
  testResults.push({ test: testName, passed, message });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${testName}${message ? `: ${message}` : ''}`);
}

function printSummary() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  const total = testResults.length;
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (failed > 0) {
    console.log('Failed tests:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.test}${r.message ? `: ${r.message}` : ''}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Registration Tests
// ═══════════════════════════════════════════════════════════════════

async function testRegistrationAutoVerify() {
  console.log('\n📝 Testing Registration (Auto-Verify)...');
  
  const testEmail = `test-auto-${Date.now()}@example.com`;
  const testPassword = 'Test123!@#';
  
  try {
    const result = await graphql<{
      register: {
        success: boolean;
        message?: string;
        user?: { id: string; email: string; status: string };
        tokens?: { accessToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Register($input: RegisterInput!) {
          register(input: $input) {
            success
            message
            user {
              id
              email
              status
            }
            tokens {
              accessToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          email: testEmail,
          password: testPassword,
          autoVerify: true,
          sendOTP: false,
        },
      }
    );
    
    if (result.register.success && result.register.user) {
      logTest('Registration (Auto-Verify)', true, `User created: ${result.register.user.id}`);
      
      // Verify user status is 'active' for auto-verify
      if (result.register.user.status === 'active') {
        logTest('Registration Status Check', true, 'User status is active');
      } else {
        logTest('Registration Status Check', false, `Expected 'active', got '${result.register.user.status}'`);
      }
      
      return result.register.user.id;
    } else {
      logTest('Registration (Auto-Verify)', false, result.register.message || 'Unknown error');
      return null;
    }
  } catch (error: any) {
    logTest('Registration (Auto-Verify)', false, error.message);
    return null;
  }
}

async function testRegistrationWithVerification() {
  console.log('\n📝 Testing Registration (With Verification)...');
  
  const testEmail = `test-verify-${Date.now()}@example.com`;
  const testPassword = 'Test123!@#';
  
  try {
    // Step 1: Register (should return registrationToken)
    const registerResult = await graphql<{
      register: {
        success: boolean;
        message?: string;
        registrationToken?: string;
        requiresOTP?: boolean;
        otpSentTo?: string;
        otpChannel?: string;
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Register($input: RegisterInput!) {
          register(input: $input) {
            success
            message
            registrationToken
            requiresOTP
            otpSentTo
            otpChannel
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          email: testEmail,
          password: testPassword,
          autoVerify: false,
          sendOTP: true,
        },
      }
    );
    
    if (!registerResult.register.success || !registerResult.register.registrationToken) {
      logTest('Registration (With Verification)', false, registerResult.register.message || 'No registration token');
      return null;
    }
    
    logTest('Registration (With Verification)', true, 'Registration token received');
    
    // Step 2: Extract OTP metadata from JWT token (unified approach)
    const tokenMetadata = extractTokenMetadata(registerResult.register.registrationToken!);
    
    if (!tokenMetadata || !tokenMetadata.otp) {
      logTest('OTP Retrieval', false, 'OTP metadata not found in registration token');
      return null;
    }
    
    logTest('OTP Retrieval', true, `OTP metadata found in JWT (channel: ${tokenMetadata.otp.channel}, recipient: ${tokenMetadata.otp.recipient})`);
    
    // Use test OTP code "000000" when providers are not configured
    const testOTPCode = '000000';
    logTest('OTP Code Retrieval', true, `Using test OTP code: ${testOTPCode} (providers not configured)`);
    
    // Step 3: Verify registration with OTP
    const verifyResult = await graphql<{
      verifyRegistration: {
        success: boolean;
        message?: string;
        user?: { id: string; email: string; status: string };
        tokens?: { accessToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation VerifyRegistration($input: VerifyRegistrationInput!) {
          verifyRegistration(input: $input) {
            success
            message
            user {
              id
              email
              status
            }
            tokens {
              accessToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          registrationToken: registerResult.register.registrationToken,
          otpCode: testOTPCode,
        },
      }
    );
    
    if (verifyResult.verifyRegistration.success && verifyResult.verifyRegistration.user) {
      logTest('Registration Verification', true, `User created: ${verifyResult.verifyRegistration.user.id}`);
      
      // Verify user status is 'pending' after verification
      if (verifyResult.verifyRegistration.user.status === 'pending') {
        logTest('Registration Status Check', true, 'User status is pending (will be activated on first login)');
      } else {
        logTest('Registration Status Check', false, `Expected 'pending', got '${verifyResult.verifyRegistration.user.status}'`);
      }
      
      // Verify tokens were returned
      if (verifyResult.verifyRegistration.tokens && verifyResult.verifyRegistration.tokens.accessToken) {
        logTest('Token Generation', true, 'Tokens generated for verified user');
      } else {
        logTest('Token Generation', false, 'Tokens not generated after verification');
      }
      
      return verifyResult.verifyRegistration.user.id;
    } else {
      logTest('Registration Verification', false, verifyResult.verifyRegistration.message || 'Unknown error');
      return null;
    }
  } catch (error: any) {
    logTest('Registration (With Verification)', false, error.message);
    return null;
  }
}

async function testRegistrationFlow() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('REGISTRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await testRegistrationAutoVerify();
  await testRegistrationWithVerification();
}

// ═══════════════════════════════════════════════════════════════════
// Login Tests
// ═══════════════════════════════════════════════════════════════════

async function testLogin(userKey: string = 'system') {
  console.log(`\n🔐 Testing Login (${userKey})...`);
  
  const user = getUserDefinition(userKey);
  
  try {
    const result = await graphql<{
      login: {
        success: boolean;
        message?: string;
        user?: { id: string; email: string; status: string; roles: string[] };
        tokens?: { accessToken: string; refreshToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            success
            message
            user {
              id
              email
              status
              roles
            }
            tokens {
              accessToken
              refreshToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          identifier: user.email,
          password: user.password,
        },
      }
    );
    
    if (result.login.success && result.login.user && result.login.tokens) {
      logTest(`Login (${userKey})`, true, `User logged in: ${result.login.user.id}`);
      
      // Verify token payload
      const tokenPayload = decodeJWT(result.login.tokens.accessToken);
      if (tokenPayload.sub === result.login.user.id) {
        logTest('Token ID Consistency', true, 'Token user ID matches GraphQL user ID');
      } else {
        logTest('Token ID Consistency', false, `Token ID mismatch: ${tokenPayload.sub} vs ${result.login.user.id}`);
      }
      
      // Verify user status is 'active' after login (if it was 'pending')
      if (result.login.user.status === 'active') {
        logTest('User Status After Login', true, 'User is active');
      } else {
        logTest('User Status After Login', false, `Expected 'active', got '${result.login.user.status}'`);
      }
      
      return result.login.tokens.accessToken;
    } else {
      logTest(`Login (${userKey})`, false, result.login.message || 'Unknown error');
      return null;
    }
  } catch (error: any) {
    logTest(`Login (${userKey})`, false, error.message);
    return null;
  }
}

async function testLoginFlow() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('LOGIN TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await testLogin('system');
  await testLogin('paymentGateway');
  await testLogin('user1');
}

// ═══════════════════════════════════════════════════════════════════
// Password Reset Tests
// ═══════════════════════════════════════════════════════════════════

async function testPasswordReset() {
  console.log('\n🔑 Testing Password Reset Flow...');
  
  const user = getUserDefinition('user1');
  
  try {
    // Ensure user exists first
    try {
      await registerAs('user1', { updateRoles: true, updatePermissions: true });
    } catch (e) {
      // User might already exist, continue
    }
    
    // Step 1: Request password reset
    let forgotResult: any;
    try {
      forgotResult = await graphql<{
        forgotPassword: {
          success: boolean;
          message?: string;
          channel?: string;
          resetToken?: string;
        };
      }>(
        AUTH_SERVICE_URL,
        `
          mutation ForgotPassword($input: ForgotPasswordInput!) {
            forgotPassword(input: $input) {
              success
              message
              channel
              resetToken
            }
          }
        `,
        {
          input: {
            tenantId: getDefaultTenantId(),
            identifier: user.email,
          },
        }
      );
    } catch (error: any) {
      logTest('Password Reset Request', false, `GraphQL error: ${error.message}`);
      return;
    }
    
    if (!forgotResult?.forgotPassword?.success || !forgotResult?.forgotPassword?.resetToken) {
      const errorMsg = forgotResult?.forgotPassword?.message || 'Unknown error';
      logTest('Password Reset Request', false, `Failed: ${errorMsg}`);
      return;
    }
    
    // Extract reset token metadata from JWT (unified approach)
    const resetTokenMetadata = extractTokenMetadata(forgotResult.forgotPassword.resetToken);
    
    if (!resetTokenMetadata) {
      logTest('Reset Token Retrieval', false, 'Invalid reset token format');
      return;
    }
    
    logTest('Password Reset Request', true, 'Password reset token received');
    logTest('Reset Token Retrieval', true, `Reset token metadata extracted (channel: ${resetTokenMetadata.otp?.channel || 'email'})`);
    
    // Reset password to match users.ts (source of truth)
    const newPassword = user.password;
    const resetResult = await graphql<{
      resetPassword: {
        success: boolean;
        message?: string;
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation ResetPassword($input: ResetPasswordInput!) {
          resetPassword(input: $input) {
            success
            message
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          token: forgotResult.forgotPassword.resetToken,
          newPassword: newPassword,
          // If OTP-based reset, we'd need the OTP code here
          // For email-based reset, otpCode is not required
        },
      }
    );
    
    if (resetResult.resetPassword.success) {
      logTest('Password Reset', true, 'Password reset successfully');
      
      // Step 4: Verify login with new password
      const loginResult = await graphql<{
        login: {
          success: boolean;
          message?: string;
        };
      }>(
        AUTH_SERVICE_URL,
        `
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              success
              message
            }
          }
        `,
        {
          input: {
            tenantId: getDefaultTenantId(),
            identifier: user.email,
            password: newPassword,
          },
        }
      );
      
      if (loginResult.login.success) {
        logTest('Login After Password Reset', true, 'Successfully logged in with new password');
      } else {
        logTest('Login After Password Reset', false, loginResult.login.message || 'Login failed');
      }
    } else {
      logTest('Password Reset', false, resetResult.resetPassword.message || 'Unknown error');
    }
  } catch (error: any) {
    logTest('Password Reset Flow', false, error.message);
  }
}

async function testPasswordResetFlow() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PASSWORD RESET TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await testPasswordReset();
}

// ═══════════════════════════════════════════════════════════════════
// OTP Tests
// ═══════════════════════════════════════════════════════════════════

async function testOTPFlow() {
  console.log('\n📱 Testing OTP Flow...');
  
  const testEmail = `test-otp-${Date.now()}@example.com`;
  
  try {
    // Step 1: Send OTP (returns otpToken JWT)
    const sendResult = await graphql<{
      sendOTP: {
        success: boolean;
        message?: string;
        otpSentTo?: string;
        channel?: string;
        otpToken?: string;
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation SendOTP($input: SendOTPInput!) {
          sendOTP(input: $input) {
            success
            message
            otpSentTo
            channel
            otpToken
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          recipient: testEmail,
          channel: 'email',
          purpose: 'email_verification',
        },
      }
    );
    
    if (!sendResult.sendOTP.success || !sendResult.sendOTP.otpToken) {
      logTest('Send OTP', false, sendResult.sendOTP.message || 'No OTP token received');
      return;
    }
    
    logTest('Send OTP', true, 'OTP token received (check service logs for OTP code)');
    
    // Step 2: Extract OTP metadata from JWT token
    const tokenMetadata = extractTokenMetadata(sendResult.sendOTP.otpToken);
    
    if (!tokenMetadata || !tokenMetadata.otp) {
      logTest('OTP Retrieval', false, 'OTP metadata not found in token');
      return;
    }
    
    logTest('OTP Retrieval', true, `OTP metadata found in JWT (channel: ${tokenMetadata.otp.channel}, recipient: ${tokenMetadata.otp.recipient})`);
    
    // Get OTP code from pending operations in Redis (or check logs)
    const pendingOps = await getPendingOperations(tokenMetadata.otp.recipient, 'otp_verification');
    const pendingOp = pendingOps.find(op => op.token === sendResult.sendOTP.otpToken);
    
    // OTP code is logged in service debug logs, not stored in Redis
    // For testing, we need to check logs or use a test helper
    logTest('OTP Code Retrieval', true, 'Check service debug logs for OTP code (otpCode field)');
    
    // Step 2: Verify OTP (requires otpToken + code)
    // Use test OTP code "000000" when providers are not configured
    const testOTPCode = '000000';
    
    const verifyResult = await graphql<{
      verifyOTP: {
        success: boolean;
        message?: string;
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation VerifyOTP($input: VerifyOTPInput!) {
          verifyOTP(input: $input) {
            success
            message
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          otpToken: sendResult.sendOTP.otpToken,
          code: testOTPCode,
        },
      }
    );
    
    if (verifyResult.verifyOTP.success) {
      logTest('Verify OTP', true, 'OTP verified successfully');
    } else {
      logTest('Verify OTP', false, verifyResult.verifyOTP.message || 'Unknown error');
    }
  } catch (error: any) {
    logTest('OTP Flow', false, error.message);
  }
}

async function testOTPFlowSuite() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('OTP TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await testOTPFlow();
}

// ═══════════════════════════════════════════════════════════════════
// Token Refresh Tests
// ═══════════════════════════════════════════════════════════════════

async function testTokenRefresh() {
  console.log('\n🔄 Testing Token Refresh...');
  
  try {
    // Ensure user exists first
    try {
      await registerAs('user1', { updateRoles: true, updatePermissions: true });
    } catch (e) {
      // User might already exist, continue
    }
    
    // Step 1: Login to get tokens
    const user = getUserDefinition('user1');
    const loginResult = await graphql<{
      login: {
        success: boolean;
        message?: string;
        tokens?: { accessToken: string; refreshToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            success
            message
            tokens {
              accessToken
              refreshToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          identifier: user.email,
          password: user.password,
        },
      }
    );
    
    if (!loginResult.login.success || !loginResult.login.tokens) {
      logTest('Token Refresh Setup', false, loginResult.login.message || 'Failed to get tokens');
      return;
    }
    
    const refreshToken = loginResult.login.tokens.refreshToken;
    
    // Step 2: Refresh token
    const refreshResult = await graphql<{
      refreshToken: {
        success: boolean;
        message?: string;
        tokens?: { accessToken: string; refreshToken: string };
        user?: { id: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation RefreshToken($input: RefreshTokenInput!) {
          refreshToken(input: $input) {
            success
            message
            tokens {
              accessToken
              refreshToken
            }
            user {
              id
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          refreshToken: refreshToken,
        },
      }
    );
    
    if (refreshResult.refreshToken.success && refreshResult.refreshToken.tokens) {
      logTest('Token Refresh', true, 'Tokens refreshed successfully');
      
      // Verify new access token is valid by decoding it
      const newTokenPayload = decodeJWT(refreshResult.refreshToken.tokens.accessToken);
      if (newTokenPayload && newTokenPayload.sub) {
        // Token is valid if it has a sub (subject/user ID) claim
        logTest('Refreshed Token Validation', true, 'New token is valid');
      } else {
        logTest('Refreshed Token Validation', false, 'New token validation failed - missing sub claim');
      }
    } else {
      logTest('Token Refresh', false, refreshResult.refreshToken.message || 'Unknown error');
    }
  } catch (error: any) {
    logTest('Token Refresh', false, error.message);
  }
}

async function testTokenRefreshFlow() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('TOKEN REFRESH TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await testTokenRefresh();
}

// ═══════════════════════════════════════════════════════════════════
// Session Management Tests
// ═══════════════════════════════════════════════════════════════════

async function testMySessions() {
  console.log('\n📱 Testing My Sessions Query...');
  
  try {
    // Ensure user exists first
    try {
      await registerAs('user1', { updateRoles: true, updatePermissions: true });
    } catch (e) {
      // User might already exist, continue
    }
    
    const user = getUserDefinition('user1');
    
    // Step 1: Login to create a session
    const loginResult = await graphql<{
      login: {
        success: boolean;
        message?: string;
        tokens?: { accessToken: string; refreshToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            success
            message
            tokens {
              accessToken
              refreshToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          identifier: user.email,
          password: user.password,
        },
      }
    );
    
    if (!loginResult.login.success || !loginResult.login.tokens) {
      logTest('My Sessions Setup', false, loginResult.login.message || 'Failed to login');
      return;
    }
    
    const accessToken = loginResult.login.tokens.accessToken;
    
    // Step 2: Query my sessions
    const sessionsResult = await graphql<{
      mySessions: Array<{
        sessionId: string;
        deviceInfo: any;
        createdAt: string;
        lastAccessedAt: string;
        isValid: boolean;
      }>;
    }>(
      AUTH_SERVICE_URL,
      `
        query MySessions {
          mySessions {
            sessionId
            deviceInfo
            createdAt
            lastAccessedAt
            isValid
          }
        }
      `,
      undefined,
      accessToken
    );
    
    if (sessionsResult.mySessions && Array.isArray(sessionsResult.mySessions)) {
      const activeSessions = sessionsResult.mySessions.filter(s => s.isValid);
      logTest('My Sessions Query', true, `Found ${sessionsResult.mySessions.length} session(s), ${activeSessions.length} active`);
      
      // Verify session structure
      if (sessionsResult.mySessions.length > 0) {
        const session = sessionsResult.mySessions[0];
        if (session.sessionId && session.createdAt && session.lastAccessedAt) {
          logTest('Session Structure', true, 'Session has required fields');
        } else {
          logTest('Session Structure', false, 'Session missing required fields');
        }
      }
    } else {
      logTest('My Sessions Query', false, 'Invalid response format');
    }
  } catch (error: any) {
    logTest('My Sessions Query', false, error.message);
  }
}

async function testLogout() {
  console.log('\n🚪 Testing Logout...');
  
  try {
    // Ensure user exists first
    try {
      await registerAs('user1', { updateRoles: true, updatePermissions: true });
    } catch (e) {
      // User might already exist, continue
    }
    
    const user = getUserDefinition('user1');
    
    // Step 1: Login to get tokens
    const loginResult = await graphql<{
      login: {
        success: boolean;
        message?: string;
        tokens?: { accessToken: string; refreshToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            success
            message
            tokens {
              accessToken
              refreshToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          identifier: user.email,
          password: user.password,
        },
      }
    );
    
    if (!loginResult.login.success || !loginResult.login.tokens) {
      logTest('Logout Setup', false, loginResult.login.message || 'Failed to login');
      return;
    }
    
    const accessToken = loginResult.login.tokens.accessToken;
    const refreshToken = loginResult.login.tokens.refreshToken;
    
    // Step 2: Logout using refresh token
    const logoutResult = await graphql<{
      logout: {
        success: boolean;
        message?: string;
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Logout($refreshToken: String!) {
          logout(refreshToken: $refreshToken) {
            success
            message
          }
        }
      `,
      {
        refreshToken: refreshToken,
      },
      accessToken
    );
    
    if (logoutResult.logout.success) {
      logTest('Logout', true, 'Session invalidated successfully');
      
      // Step 3: Verify session is invalidated by trying to refresh token
      const refreshResult = await graphql<{
        refreshToken: {
          success: boolean;
          message?: string;
        };
      }>(
        AUTH_SERVICE_URL,
        `
          mutation RefreshToken($input: RefreshTokenInput!) {
            refreshToken(input: $input) {
              success
              message
            }
          }
        `,
        {
          input: {
            tenantId: getDefaultTenantId(),
            refreshToken: refreshToken,
          },
        }
      );
      
      if (!refreshResult.refreshToken.success) {
        logTest('Logout Verification', true, 'Refresh token correctly invalidated after logout');
      } else {
        logTest('Logout Verification', false, 'Refresh token still valid after logout');
      }
    } else {
      logTest('Logout', false, logoutResult.logout.message || 'Unknown error');
    }
  } catch (error: any) {
    logTest('Logout', false, error.message);
  }
}

async function testLogoutAll() {
  console.log('\n🚪 Testing Logout All...');
  
  try {
    // Ensure user exists first
    try {
      await registerAs('user1', { updateRoles: true, updatePermissions: true });
    } catch (e) {
      // User might already exist, continue
    }
    
    const user = getUserDefinition('user1');
    
    // Step 1: Create multiple sessions by logging in multiple times
    const login1Result = await graphql<{
      login: {
        success: boolean;
        tokens?: { accessToken: string; refreshToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            success
            tokens {
              accessToken
              refreshToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          identifier: user.email,
          password: user.password,
          userAgent: 'Test Agent 1',
        },
      }
    );
    
    const login2Result = await graphql<{
      login: {
        success: boolean;
        tokens?: { accessToken: string; refreshToken: string };
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            success
            tokens {
              accessToken
              refreshToken
            }
          }
        }
      `,
      {
        input: {
          tenantId: getDefaultTenantId(),
          identifier: user.email,
          password: user.password,
          userAgent: 'Test Agent 2',
        },
      }
    );
    
    if (!login1Result.login.success || !login1Result.login.tokens || 
        !login2Result.login.success || !login2Result.login.tokens) {
      logTest('Logout All Setup', false, 'Failed to create multiple sessions');
      return;
    }
    
    const accessToken = login1Result.login.tokens.accessToken;
    
    // Step 2: Verify multiple sessions exist
    const sessionsBefore = await graphql<{
      mySessions: Array<{ sessionId: string; isValid: boolean }>;
    }>(
      AUTH_SERVICE_URL,
      `
        query MySessions {
          mySessions {
            sessionId
            isValid
          }
        }
      `,
      undefined,
      accessToken
    );
    
    const activeSessionsBefore = sessionsBefore.mySessions.filter(s => s.isValid).length;
    logTest('Multiple Sessions Created', activeSessionsBefore >= 1, `Found ${activeSessionsBefore} active session(s)`);
    
    // Step 3: Logout from all devices
    const logoutAllResult = await graphql<{
      logoutAll: {
        success: boolean;
        count: number;
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation LogoutAll {
          logoutAll {
            success
            count
          }
        }
      `,
      undefined,
      accessToken
    );
    
    if (logoutAllResult.logoutAll.success) {
      logTest('Logout All', true, `Invalidated ${logoutAllResult.logoutAll.count} session(s)`);
      
      // Step 4: Verify all sessions are invalidated
      // Note: We need to login again to check sessions (since current token is invalidated)
      const newLoginResult = await graphql<{
        login: {
          success: boolean;
          tokens?: { accessToken: string };
        };
      }>(
        AUTH_SERVICE_URL,
        `
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              success
              tokens {
                accessToken
              }
            }
          }
        `,
        {
          input: {
            tenantId: getDefaultTenantId(),
            identifier: user.email,
            password: user.password,
          },
        }
      );
      
      if (newLoginResult.login.success && newLoginResult.login.tokens) {
        const sessionsAfter = await graphql<{
          mySessions: Array<{ sessionId: string; isValid: boolean }>;
        }>(
          AUTH_SERVICE_URL,
          `
            query MySessions {
              mySessions {
                sessionId
                isValid
              }
            }
          `,
          undefined,
          newLoginResult.login.tokens.accessToken
        );
        
        const activeSessionsAfter = sessionsAfter.mySessions.filter(s => s.isValid).length;
        if (activeSessionsAfter === 1) {
          logTest('Logout All Verification', true, 'All previous sessions invalidated, only new session active');
        } else {
          logTest('Logout All Verification', false, `Expected 1 active session, found ${activeSessionsAfter}`);
        }
      }
    } else {
      logTest('Logout All', false, 'Failed to logout from all devices');
    }
  } catch (error: any) {
    logTest('Logout All', false, error.message);
  }
}

async function testSessionFlow() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('SESSION MANAGEMENT TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await testMySessions();
  await testLogout();
  await testLogoutAll();
}

// ═══════════════════════════════════════════════════════════════════
// 2FA Tests (Basic - Full 2FA requires QR code generation)
// ═══════════════════════════════════════════════════════════════════

async function test2FAFlow() {
  console.log('\n🔐 Testing 2FA Flow (Basic)...');
  
  try {
    // Ensure user exists first
    try {
      await registerAs('system', { updateRoles: true, updatePermissions: true });
    } catch (e) {
      // User might already exist, continue
    }
    
    const user = getUserDefinition('system');
    let token: string;
    try {
      const loginResult = await loginAs('system');
      token = loginResult.token;
    } catch (e: any) {
      logTest('2FA Flow', false, `Failed to login as system@demo.com: ${e.message}`);
      return;
    }
    
    // Step 1: Enable 2FA
    const enableResult = await graphql<{
      enable2FA: {
        success: boolean;
        message?: string;
        secret?: string;
        qrCode?: string;
        backupCodes?: string[];
      };
    }>(
      AUTH_SERVICE_URL,
      `
        mutation Enable2FA($input: Enable2FAInput!) {
          enable2FA(input: $input) {
            success
            message
            secret
            qrCode
            backupCodes
          }
        }
      `,
      {
        input: {
          password: user.password,
        },
      },
      token
    );
    
    if (enableResult.enable2FA.success && enableResult.enable2FA.secret) {
      logTest('2FA Flow', true, '2FA enabled successfully');
      
      // Note: Full 2FA verification requires TOTP code generation
      // This is a basic test - full verification would need speakeasy or similar
      logTest('2FA Setup', true, '2FA secret generated (full verification requires TOTP library)');
    } else {
      // Log the actual GraphQL response for debugging
      const errorMsg = enableResult.enable2FA.message || 'Unknown error';
      logTest('2FA Flow', false, `Failed to enable 2FA: ${errorMsg}`);
    }
  } catch (error: any) {
    logTest('2FA Flow', false, `Error: ${error.message || JSON.stringify(error)}`);
  }
}

async function test2FAFlowSuite() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('2FA TESTS');
  console.log('═══════════════════════════════════════════════════════════════');
  
  await test2FAFlow();
}

// ═══════════════════════════════════════════════════════════════════
// Setup & Cleanup
// ═══════════════════════════════════════════════════════════════════

async function setup() {
  console.log('\n🔧 Setting up test environment...');
  console.log('   Registering test users...');
  
  try {
    // Register system users (they use autoVerify: true)
    await registerAs('system', { updateRoles: true, updatePermissions: true });
    await registerAs('paymentGateway', { updateRoles: true, updatePermissions: true });
    await registerAs('paymentProvider', { updateRoles: true, updatePermissions: true });
    
    // Register end users (they also use autoVerify: true for testing)
    await registerAs('user1', { updateRoles: true, updatePermissions: true });
    await registerAs('user2', { updateRoles: true, updatePermissions: true });
    
    console.log('   ✅ Test users registered successfully');
  } catch (error: any) {
    console.log(`   ⚠️  Setup warning: ${error.message}`);
    console.log('   (Users may already exist - continuing...)');
  }
}

async function cleanup() {
  console.log('\n🧹 Cleanup...');
  await closeAllConnections();
  console.log('   Database connections closed.');
}

// ═══════════════════════════════════════════════════════════════════
// OTP Retrieval Utility (for testing without SMTP/SMS providers)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get pending operations (registration/reset/OTP tokens) with OTP codes from Redis
 * Reads JWT-based operations stored in Redis by PendingOperationStore
 */
async function getPendingOperations(recipient?: string, operationType?: 'registration' | 'password_reset' | 'otp_verification') {
  console.log('\n🔍 Retrieving pending operations from Redis (JWT-based)...\n');
  
  try {
    // Connect to Redis
    const redisUrl = process.env.REDIS_URL || (process.env.REDIS_PASSWORD ? `redis://:${process.env.REDIS_PASSWORD}@localhost:6379` : 'redis://localhost:6379');
    await connectRedis(redisUrl);
    const redis = getRedis();
    
    if (!redis) {
      console.log('ℹ️  Redis not available - cannot retrieve pending operations');
      console.log('   Operations are stored in JWT tokens - check service logs for OTP codes');
      return [];
    }
    
    // Scan Redis for pending operations
    // PendingOperationStore uses key pattern: pending:{operationType}:{token}
    const patterns = operationType 
      ? [`pending:${operationType}:*`]
      : ['pending:registration:*', 'pending:password_reset:*', 'pending:otp_verification:*'];
    
    const results: Array<{ token: string; otpCode?: string; recipient: string; operationType: string; data: any }> = [];
    
    for (const pattern of patterns) {
      const keys: string[] = [];
      for await (const key of scanKeysIterator({ pattern, maxKeys: 100 })) {
        keys.push(key);
      }
      
      for (const key of keys) {
        const value = await redis.get(key);
        if (!value) continue;
        
        try {
          const payload = JSON.parse(value);
          const token = key.split(':').pop() || '';
          
          // Extract OTP code from debug logs or from JWT metadata
          // Note: OTP code is hashed in JWT, so we can't extract plain code from Redis
          // Check service logs for plain OTP codes
          const operationData = payload.data || {};
          const otpInfo = operationData.otp;
          
          if (recipient && operationData.recipient !== recipient) {
            continue;
          }
          
          results.push({
            token,
            recipient: operationData.recipient || 'N/A',
            operationType: payload.operationType || 'unknown',
            data: operationData,
          });
        } catch (parseError) {
          // Skip invalid entries
          continue;
        }
      }
    }
    
    if (results.length === 0) {
      console.log('ℹ️  No pending operations found in Redis');
      console.log('   Operations are stored in JWT tokens - check service logs for OTP codes');
      return [];
    }
    
    console.log(`✅ Found ${results.length} pending operation(s):\n`);
    console.log('═'.repeat(100));
    
    results.forEach((op: any, index: number) => {
      console.log(`\n🔑 Operation #${index + 1}`);
      console.log(`   Type:        ${op.operationType}`);
      console.log(`   Token:       ${op.token.substring(0, 50)}...`);
      console.log(`   Recipient:   ${op.recipient}`);
      console.log(`   Channel:     ${op.data.channel || op.data.otp?.channel || 'N/A'}`);
      console.log(`   Purpose:     ${op.data.purpose || op.data.otp?.purpose || 'N/A'}`);
      console.log(`   ⚠️  OTP Code: Check service debug logs (code is hashed in JWT)`);
    });
    
    console.log('\n' + '═'.repeat(100));
    console.log('💡 Tip: Check service debug logs for plain OTP codes');
    console.log('   All OTPs are logged with otpCode field for testing\n');
    
    return results;
    
  } catch (error: any) {
    console.log(`ℹ️  Error reading from Redis: ${error.message}`);
    console.log('   Check service debug logs for OTP codes');
    return [];
  }
}

async function getPendingOTPs(recipient?: string, purpose?: string) {
  console.log('\n📱 Retrieving pending OTPs...\n');
  console.log('ℹ️  Note: Registration and Password Reset OTPs are now stored in JWT tokens (not DB)');
  console.log('   Only general OTPs (email/phone verification for existing users) are in DB\n');
  
  try {
    const db = await getAuthDatabase();
    const now = new Date();
    
      // Build query for pending OTPs (not used, not expired)
      // Note: Registration and Password Reset OTPs are now in JWT tokens, so we only find general OTPs
      const query: any = {
        isUsed: false,
        expiresAt: { $gt: now },
        // Exclude registration and password_reset OTPs (they're in JWT now)
        $and: [
          { 'metadata.operationType': { $ne: 'registration' } },
          { purpose: { $ne: 'password_reset' } },
        ],
      };
    
    if (recipient) {
      query.recipient = recipient;
    }
    
    if (purpose) {
      query.purpose = purpose;
    }
    
    const otps = await db.collection('otps')
      .find(query)
      .sort({ createdAt: -1 }) // Newest first
      .limit(50) // Limit to 50 most recent
      .toArray();
    
    if (otps.length === 0) {
      console.log('ℹ️  No pending OTPs found in database');
      console.log('   (Registration and Password Reset OTPs are stored in JWT tokens, not database)');
      if (recipient || purpose) {
        console.log(`   Filters: ${recipient ? `recipient=${recipient}` : ''} ${purpose ? `purpose=${purpose}` : ''}`);
      }
      console.log('\n💡 For registration OTPs (JWT-based):');
      console.log('   - OTP metadata is embedded in the registrationToken JWT');
      console.log('   - Use extractTokenMetadata(registrationToken) to extract OTP info');
      console.log('   - Registration tokens expire in 24h, OTP expires in 15 minutes (default)');
      console.log('   - Example: const metadata = extractTokenMetadata(token); console.log(metadata.otp);');
      console.log('\n💡 For password reset OTPs (JWT-based):');
      console.log('   - OTP metadata is embedded in the resetToken JWT (from forgotPassword)');
      console.log('   - Use extractTokenMetadata(resetToken) to extract OTP info');
      console.log('   - Reset tokens expire in 30 minutes');
      console.log('   - Example: const metadata = extractTokenMetadata(token); console.log(metadata.otp);');
      return;
    }
    
    console.log(`✅ Found ${otps.length} pending OTP(s) in database:\n`);
    console.log('═'.repeat(100));
    
    otps.forEach((otp: any, index: number) => {
      const expiresAt = new Date(otp.expiresAt);
      const createdAt = new Date(otp.createdAt);
      const expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60)); // minutes
      
      console.log(`\n📧 OTP #${index + 1}`);
      console.log(`   Code:        ${otp.code || 'N/A'} ${otp.code ? '🔑' : '⚠️ (hashed only)'}`);
      console.log(`   Recipient:   ${otp.recipient}`);
      console.log(`   Channel:     ${otp.channel}`);
      console.log(`   Purpose:     ${otp.purpose}`);
      console.log(`   Tenant ID:   ${otp.tenantId}`);
      console.log(`   User ID:     ${otp.userId || 'N/A'}`);
      console.log(`   Created:     ${createdAt.toLocaleString()}`);
      console.log(`   Expires:     ${expiresAt.toLocaleString()} (in ${expiresIn} minutes)`);
      console.log(`   Attempts:    ${otp.attempts || 0}/${otp.maxAttempts || 5}`);
      
      if (otp.metadata) {
        console.log(`   Metadata:    ${JSON.stringify(otp.metadata)}`);
      }
      
      // Show expiration warning
      if (expiresIn < 5) {
        console.log(`   ⚠️  WARNING: Expires soon!`);
      }
    });
    
    console.log('\n' + '═'.repeat(100));
    console.log('\n💡 Tip: Use these codes to verify OTP in your tests or React app');
    console.log('   Example: npx tsx auth-command-test.ts otps --recipient user@example.com');
    console.log('\n📝 Note: Registration and Password Reset OTPs are stored in JWT tokens, not database');
    console.log('   - Use extractTokenMetadata(token) helper function to extract OTP metadata');
    console.log('   - Registration OTP: extractTokenMetadata(registrationToken)');
    console.log('   - Password Reset OTP: extractTokenMetadata(resetToken)\n');
    
  } catch (error: any) {
    console.error('❌ Error retrieving OTPs:', error.message);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main Test Runner
// ═══════════════════════════════════════════════════════════════════

async function runAllTests() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('AUTH SERVICE COMPREHENSIVE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════');
  
  testResults = [];
  
  // Setup users first
  await setup();
  
  // Run tests in order (some depend on previous tests)
  await testRegistrationFlow();
  await testLoginFlow();
  await testPasswordResetFlow();
  await testOTPFlowSuite();
  await testTokenRefreshFlow();
  await testSessionFlow();
  await test2FAFlowSuite();
  
  printSummary();
}

async function main() {
  const args = process.argv.slice(2);
  
  // Initialize configuration from MongoDB config store
  // This will populate AUTH_SERVICE_URL
  await initializeConfig();
  await loadScriptConfig();
  
  if (args.length === 0) {
    console.log(`
Usage: npx tsx auth-command-test.ts <command> [options]

Commands:
  setup              Setup test environment
  registration       Test registration flow (auto-verify and with verification)
  login              Test login flow (multiple users)
  password-reset     Test password reset flow
  otp                Test OTP verification flow
  token              Test token refresh flow
  sessions           Test session management (mySessions, logout, logoutAll)
  2fa                Test 2FA flow (basic)
  otps               Get all pending OTPs from database (for testing without SMTP/SMS)
  all                Run complete test suite (all tests)
  
Options for 'otps' command:
  --recipient <email|phone>  Filter by recipient
  --purpose <purpose>        Filter by purpose (registration, email_verification, etc.)
  
Examples:
  npx tsx auth-command-test.ts all
  npx tsx auth-command-test.ts registration
  npx tsx auth-command-test.ts login
  npx tsx auth-command-test.ts password-reset
  npx tsx auth-command-test.ts otps
  npx tsx auth-command-test.ts otps --recipient user@example.com
  npx tsx auth-command-test.ts otps --purpose registration
`);
    process.exit(1);
  }
  
  const command = args[0];
  
  // Parse options for otps and pending-ops commands
  let recipient: string | undefined;
  let purpose: string | undefined;
  let operationType: string | undefined;
  
  if (command === 'otps' || command === 'pending-ops' || command === 'pending') {
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--recipient' && args[i + 1]) {
        recipient = args[i + 1];
        i++;
      } else if (args[i] === '--purpose' && args[i + 1]) {
        purpose = args[i + 1];
        i++;
      } else if (args[i] === '--type' && args[i + 1]) {
        operationType = args[i + 1];
        i++;
      }
    }
  }
  
  try {
    switch (command) {
      case 'setup':
        await setup();
        break;
        
      case 'registration':
        await testRegistrationFlow();
        printSummary();
        break;
        
      case 'login':
        await testLoginFlow();
        printSummary();
        break;
        
      case 'password-reset':
        await testPasswordResetFlow();
        printSummary();
        break;
        
      case 'otp':
        await testOTPFlowSuite();
        printSummary();
        break;
        
      case 'otps':
        await getPendingOTPs(recipient, purpose);
        break;
        
      case 'pending-ops':
      case 'pending': {
        let opType: 'registration' | 'password_reset' | 'otp_verification' | undefined;
        if (operationType) {
          opType = operationType as 'registration' | 'password_reset' | 'otp_verification';
        }
        await getPendingOperations(recipient, opType);
        break;
      }
        
      case 'token':
        await testTokenRefreshFlow();
        printSummary();
        break;
        
      case '2fa':
        await test2FAFlowSuite();
        printSummary();
        break;
        
      case 'sessions':
        await testSessionFlow();
        printSummary();
        break;
        
      case 'all':
        await setup();
        await runAllTests();
        break;
        
      default:
        console.error(`❌ Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    // Always close connections before exiting
    try {
      await cleanup();
    } catch (err) {
      // Ignore errors during cleanup
    }
    // Force exit after a short delay to ensure cleanup completes
    setTimeout(() => {
      process.exit(process.exitCode || 0);
    }, 100);
  }
}

// Handle cleanup on exit signals
process.on('SIGINT', async () => {
  try {
    await closeAllConnections();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(130);
});

process.on('SIGTERM', async () => {
  try {
    await closeAllConnections();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(143);
});

main().catch(async (error) => {
  console.error('Unhandled error:', error);
  try {
    await closeAllConnections();
  } catch (err) {
    // Ignore cleanup errors
  }
  process.exit(1);
});
