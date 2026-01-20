/**
 * Login Page - Enhanced with Social Authentication
 */

import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { Lock, Mail, AlertCircle, Loader2, Shield, Chrome, Facebook as FacebookIcon, Linkedin, Instagram } from 'lucide-react';

const AUTH_SERVICE_URL = (import.meta.env as any).VITE_AUTH_SERVICE_URL?.replace('/graphql', '') || 'http://localhost:3003';
const TENANT_ID = 'default-tenant';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(identifier, password, twoFactorCode || undefined);

      // Check if 2FA is required (either from requiresOTP field or message)
      if (result.requiresOTP || result.message?.includes('Two-factor') || result.message?.includes('two-factor')) {
        setRequires2FA(true);
        setError(result.message || 'Two-factor authentication code required');
        setIsLoading(false);
        return; // Don't navigate - wait for 2FA code
      }

      if (result.success && result.user && result.tokens) {
        // Navigate to the original route or dashboard
        const from = (location.state as any)?.from?.pathname;
        if (from && from !== '/login' && from !== '/register') {
          navigate(from, { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      } else {
        setError(result.message || 'Login failed');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider: string) => {
    window.location.href = `${AUTH_SERVICE_URL}/auth/${provider}?tenantId=${TENANT_ID}`;
  };

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
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mb-6 shadow-lg transform hover:scale-110 transition-transform">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-2">
            Welcome Back
          </h1>
          <p className="text-gray-600">Sign in to continue to your account</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start gap-3 animate-shake">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Social Login Buttons */}
        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={() => handleSocialLogin('google')}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white border-2 border-gray-200 rounded-xl hover:border-indigo-300 hover:shadow-md transition-all duration-200 group"
          >
            <Chrome className="w-5 h-5 text-red-500 group-hover:scale-110 transition-transform" />
            <span className="font-medium text-gray-700">Continue with Google</span>
          </button>

          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleSocialLogin('facebook')}
              className="flex items-center justify-center p-3.5 bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
              title="Continue with Facebook"
            >
              <FacebookIcon className="w-5 h-5 text-white" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => handleSocialLogin('linkedin')}
              className="flex items-center justify-center p-3.5 bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors shadow-md hover:shadow-lg"
              title="Continue with LinkedIn"
            >
              <Linkedin className="w-5 h-5 text-white" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => handleSocialLogin('instagram')}
              className="flex items-center justify-center p-3.5 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-xl hover:shadow-lg transition-all"
              title="Continue with Instagram"
            >
              <Instagram className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-white text-gray-500 font-medium">Or continue with email</span>
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email/Username */}
          <div>
            <label htmlFor="identifier" className="block text-sm font-semibold text-gray-700 mb-2">
              Email or Username
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="user@example.com"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          {/* 2FA Code */}
          {requires2FA && (
            <div className="animate-slideDown">
              <label htmlFor="twoFactorCode" className="block text-sm font-semibold text-gray-700 mb-2">
                Two-Factor Code
              </label>
              <div className="relative">
                <Shield className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-indigo-500" />
                <input
                  id="twoFactorCode"
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-indigo-50 border-2 border-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                  placeholder="123456"
                  maxLength={6}
                  required
                  autoFocus
                />
              </div>
              <p className="mt-2 text-xs text-gray-600">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>
          )}

          {/* Forgot Password */}
          <div className="flex items-center justify-end">
            <Link
              to="/forgot-password"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 transition"
            >
              Forgot password?
            </Link>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 px-6 rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-4 focus:ring-indigo-300 transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Register Link */}
        <p className="mt-8 text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link
            to="/register"
            className="font-semibold text-indigo-600 hover:text-indigo-500 transition"
          >
            Create account
          </Link>
        </p>
      </div>

    </div>
  );
}
