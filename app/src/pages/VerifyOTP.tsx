/**
 * Verify OTP Page
 * Used for registration verification, email/phone verification, etc.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth, useAuthRequest } from '../lib/auth-context';
import { Shield, AlertCircle, Loader2, ArrowLeft, CheckCircle, Mail, Phone } from 'lucide-react';

const TENANT_ID = 'default-tenant';

export default function VerifyOTP() {
  const navigate = useNavigate();
  const location = useLocation();
  const { register } = useAuth();
  const authRequest = useAuthRequest();

  // Get state from navigation (recipient, purpose, registrationToken, otpToken, etc.)
  const state = location.state as any;
  const recipient = state?.recipient || state?.email || state?.phone || '';
  const purpose = state?.purpose || 'email_verification';
  const registrationToken = state?.registrationToken || '';
  const otpToken = state?.otpToken || ''; // JWT token from sendOTP response

  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);

  // Auto-request OTP if token is missing (for non-registration flows)
  useEffect(() => {
    if (!recipient) {
      setError('Missing recipient information. Please start over.');
      return;
    }

    // For registration, we need registrationToken
    if (purpose === 'registration' && !registrationToken) {
      setError('Missing registration token. Please start over.');
      return;
    }

    // For general OTP verification, auto-request OTP if token is missing (only once)
    if (purpose !== 'registration' && !otpToken && recipient && !otpRequested) {
      setOtpRequested(true);
      const requestOTP = async () => {
        try {
          const channel = recipient.includes('@') ? 'email' : 'sms';
          const data = await authRequest(
            `mutation SendOTP($input: SendOTPInput!) {
              sendOTP(input: $input) {
                success
                message
                otpToken
                otpSentTo
                channel
              }
            }`,
            {
              input: {
                tenantId: TENANT_ID,
                recipient: recipient,
                channel: channel,
                purpose: purpose,
              },
            }
          );

          if (data.sendOTP.success && data.sendOTP.otpToken) {
            // Update location state with otpToken
            navigate('/verify-otp', {
              state: {
                recipient: recipient,
                purpose: purpose,
                otpToken: data.sendOTP.otpToken,
              },
              replace: true,
            });
          } else {
            setError(data.sendOTP.message || 'Failed to request OTP code');
          }
        } catch (err: any) {
          setError(err.message || 'Failed to request OTP code');
        }
      };

      requestOTP();
    }
  }, [recipient, purpose, registrationToken, otpToken, otpRequested, authRequest, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (otpCode.length !== 6) {
      setError('Please enter a 6-digit code');
      return;
    }

    setIsLoading(true);

    try {
      // If this is registration verification, use verifyRegistration mutation
      if (purpose === 'registration' && registrationToken) {
        const data = await authRequest(
          `mutation VerifyRegistration($input: VerifyRegistrationInput!) {
            verifyRegistration(input: $input) {
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
              }
            }
          }`,
          {
            input: {
              tenantId: TENANT_ID,
              registrationToken: registrationToken,
              otpCode: otpCode,
            },
          }
        );

        if (data.verifyRegistration.success && data.verifyRegistration.tokens) {
          setSuccess(true);
          // Auth context will handle saving tokens via the register method
          // But since we already have tokens, we need to save them manually
          if (data.verifyRegistration.user && data.verifyRegistration.tokens) {
            // Save auth state manually
            localStorage.setItem('auth_access_token', data.verifyRegistration.tokens.accessToken);
            localStorage.setItem('auth_refresh_token', data.verifyRegistration.tokens.refreshToken);
            localStorage.setItem('auth_user', JSON.stringify(data.verifyRegistration.user));
            
            // Redirect to dashboard after a short delay
            setTimeout(() => {
              navigate('/dashboard', { replace: true });
            }, 2000);
          }
        } else {
          setError(data.verifyRegistration.message || 'Verification failed');
        }
      } else {
        // Regular OTP verification - requires otpToken
        if (!otpToken) {
          setError('OTP token is required. Please request a new OTP code.');
          setIsLoading(false);
          return;
        }

        const data = await authRequest(
          `mutation VerifyOTP($input: VerifyOTPInput!) {
            verifyOTP(input: $input) {
              success
              message
            }
          }`,
          {
            input: {
              tenantId: TENANT_ID,
              otpToken: otpToken,
              code: otpCode,
            },
          }
        );

        if (data.verifyOTP.success) {
          setSuccess(true);
          // Redirect based on purpose
          setTimeout(() => {
            if (purpose === 'email_verification' || purpose === 'phone_verification') {
              navigate('/profile', { replace: true });
            } else {
              navigate('/dashboard', { replace: true });
            }
          }, 2000);
        } else {
          setError(data.verifyOTP.message || 'Verification failed');
        }
      }
    } catch (err: any) {
      console.error('OTP verification error:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setIsResending(true);
    setError('');

    try {
      if (purpose === 'registration' && registrationToken) {
        // For registration, we need to resend OTP
        // This would typically be handled by the backend
        setError('Please use the registration link again to receive a new code.');
      } else if (otpToken) {
        // If we have otpToken, use resendOTP with it
        const data = await authRequest(
          `mutation ResendOTP($recipient: String!, $purpose: String!, $tenantId: String!, $otpToken: String) {
            resendOTP(recipient: $recipient, purpose: $purpose, tenantId: $tenantId, otpToken: $otpToken) {
              success
              message
              otpToken
              otpSentTo
              channel
            }
          }`,
          {
            recipient: recipient,
            purpose: purpose,
            tenantId: TENANT_ID,
            otpToken: otpToken,
          }
        );

        if (data.resendOTP.success && data.resendOTP.otpToken) {
          // Update state with new otpToken
          navigate('/verify-otp', {
            state: {
              recipient: recipient,
              purpose: purpose,
              otpToken: data.resendOTP.otpToken,
            },
            replace: true,
          });
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        } else {
          setError(data.resendOTP.message || 'Failed to resend code');
        }
      } else {
        // No otpToken - need to call sendOTP first
        const channel = recipient.includes('@') ? 'email' : 'sms';
        
        const sendData = await authRequest(
          `mutation SendOTP($input: SendOTPInput!) {
            sendOTP(input: $input) {
              success
              message
              otpToken
              otpSentTo
              channel
            }
          }`,
          {
            input: {
              tenantId: TENANT_ID,
              recipient: recipient,
              channel: channel,
              purpose: purpose,
            },
          }
        );

        if (sendData.sendOTP.success && sendData.sendOTP.otpToken) {
          // Update state with new otpToken
          navigate('/verify-otp', {
            state: {
              recipient: recipient,
              purpose: purpose,
              otpToken: sendData.sendOTP.otpToken,
            },
            replace: true,
          });
          setSuccess(true);
          setTimeout(() => setSuccess(false), 3000);
        } else {
          setError(sendData.sendOTP.message || 'Failed to resend code');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to resend code');
    } finally {
      setIsResending(false);
    }
  };

  const getPurposeLabel = () => {
    switch (purpose) {
      case 'registration':
        return 'Complete Registration';
      case 'email_verification':
        return 'Verify Email';
      case 'phone_verification':
        return 'Verify Phone';
      case 'password_reset':
        return 'Reset Password';
      default:
        return 'Verify Code';
    }
  };

  const getChannelIcon = () => {
    if (recipient.includes('@')) {
      return <Mail className="w-5 h-5" />;
    }
    return <Phone className="w-5 h-5" />;
  };

  if (!recipient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
        <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-md p-10 border border-white/20 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Missing Information</h2>
          <p className="text-gray-600 mb-6">Please start the verification process again.</p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Registration
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-blue-400/20 to-transparent rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-purple-400/20 to-transparent rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-md p-10 border border-white/20">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mb-6 shadow-lg">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-2">
            {getPurposeLabel()}
          </h1>
          <p className="text-gray-600 mb-4">
            We've sent a verification code to
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-lg">
            {getChannelIcon()}
            <span className="font-semibold text-gray-900">{recipient}</span>
          </div>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-500 rounded-lg flex items-start gap-3 animate-slideDown">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-800">
              {purpose === 'registration' 
                ? 'Registration verified! Redirecting...' 
                : 'Code verified successfully! Redirecting...'}
            </p>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start gap-3 animate-shake">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Form */}
        {!success && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="otpCode" className="block text-sm font-semibold text-gray-700 mb-2">
                Enter 6-digit code
              </label>
              <input
                id="otpCode"
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all font-mono text-2xl tracking-widest text-center"
                placeholder="123456"
                maxLength={6}
                required
                disabled={isLoading}
                autoFocus
              />
              <p className="mt-2 text-xs text-gray-600 text-center">
                Enter the code sent to {recipient}
              </p>
            </div>

            {/* Resend OTP */}
            <div className="text-center">
              <button
                type="button"
                onClick={handleResendOTP}
                disabled={isResending}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition disabled:opacity-50"
              >
                {isResending ? 'Sending...' : "Didn't receive code? Resend"}
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || otpCode.length !== 6}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 px-6 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Verify Code'
              )}
            </button>
          </form>
        )}

        {/* Back Link */}
        {!success && (
          <div className="mt-8 text-center">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Registration
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
