/**
 * Register Page - Enhanced with Social Authentication
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { UserPlus, Mail, Lock, User, Phone, AlertCircle, Loader2, CheckCircle, Chrome, Facebook as FacebookIcon, Linkedin, Instagram } from 'lucide-react';

const AUTH_SERVICE_URL = (import.meta.env as any).VITE_AUTH_SERVICE_URL?.replace('/graphql', '') || 'http://localhost:3003';
const TENANT_ID = 'default-tenant';

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [requiresOTP, setRequiresOTP] = useState(false);
  const [otpInfo, setOtpInfo] = useState<{ sentTo: string; channel: string } | null>(null);

  const [passwordStrength, setPasswordStrength] = useState({
    length: false,
    uppercase: false,
    number: false,
    special: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Update password strength indicator
    if (name === 'password') {
      setPasswordStrength({
        length: value.length >= 8,
        uppercase: /[A-Z]/.test(value),
        number: /\d/.test(value),
        special: /[!@#$%^&*(),.?":{}|<>]/.test(value),
      });
    }
  };

  const validateForm = () => {
    if (!formData.email && !formData.username && !formData.phone) {
      setError('Please provide at least email, username, or phone');
      return false;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }

    if (!Object.values(passwordStrength).every(Boolean)) {
      setError('Password must meet all requirements');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const result = await register({
        username: formData.username || undefined,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        password: formData.password,
        metadata: {
          firstName: formData.firstName,
          lastName: formData.lastName,
        },
      });

      if (result.success) {
        if (result.requiresOTP) {
          setRequiresOTP(true);
          setOtpInfo({
            sentTo: result.otpSentTo,
            channel: result.otpChannel,
          });
        } else if (result.tokens) {
          navigate('/dashboard');
        } else {
          navigate('/verify-email', { state: { email: formData.email } });
        }
      } else {
        setError(result.message || 'Registration failed');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialRegister = (provider: string) => {
    window.location.href = `${AUTH_SERVICE_URL}/auth/${provider}?tenantId=${TENANT_ID}`;
  };

  if (requiresOTP && otpInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 flex items-center justify-center p-4">
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-md p-10">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl mb-6 shadow-lg">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Check Your {otpInfo.channel}</h1>
            <p className="text-gray-600 mb-6">
              We've sent a verification code to <strong className="text-gray-900">{otpInfo.sentTo}</strong>
            </p>
            <button
              onClick={() => navigate('/verify-otp', { state: { recipient: otpInfo.sentTo, purpose: 'email_verification' } })}
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg"
            >
              Enter Verification Code
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-500 via-emerald-500 to-teal-500 flex items-center justify-center p-4 py-12">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-emerald-400/20 to-transparent rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-teal-400/20 to-transparent rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl w-full max-w-2xl p-10 border border-white/20">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl mb-6 shadow-lg transform hover:scale-110 transition-transform">
            <UserPlus className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent mb-2">
            Create Account
          </h1>
          <p className="text-gray-600">Join us and start your journey</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start gap-3 animate-shake">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Social Registration */}
        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={() => handleSocialRegister('google')}
            className="w-full flex items-center justify-center gap-3 px-6 py-3.5 bg-white border-2 border-gray-200 rounded-xl hover:border-green-300 hover:shadow-md transition-all duration-200 group"
          >
            <Chrome className="w-5 h-5 text-red-500 group-hover:scale-110 transition-transform" />
            <span className="font-medium text-gray-700">Sign up with Google</span>
          </button>

          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleSocialRegister('facebook')}
              className="flex items-center justify-center p-3.5 bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-md hover:shadow-lg"
            >
              <FacebookIcon className="w-5 h-5 text-white" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => handleSocialRegister('linkedin')}
              className="flex items-center justify-center p-3.5 bg-blue-700 rounded-xl hover:bg-blue-800 transition-colors shadow-md hover:shadow-lg"
            >
              <Linkedin className="w-5 h-5 text-white" fill="currentColor" />
            </button>
            <button
              type="button"
              onClick={() => handleSocialRegister('instagram')}
              className="flex items-center justify-center p-3.5 bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-xl hover:shadow-lg transition-all"
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
            <span className="px-4 bg-white text-gray-500 font-medium">Or register with email</span>
          </div>
        </div>

        {/* Register Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">First Name</label>
              <input
                name="firstName"
                type="text"
                value={formData.firstName}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                placeholder="John"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Last Name</label>
              <input
                name="lastName"
                type="text"
                value={formData.lastName}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                placeholder="Doe"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Email <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                placeholder="user@example.com"
                required
              />
            </div>
          </div>

          {/* Username & Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Username (optional)</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  name="username"
                  type="text"
                  value={formData.username}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                  placeholder="johndoe"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Phone (optional)</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  name="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                  placeholder="+1234567890"
                />
              </div>
            </div>
          </div>

          {/* Passwords */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  name="password"
                  type="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Confirm <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  name="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>
          </div>

          {/* Password Strength */}
          {formData.password && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl p-4 animate-slideDown">
              <p className="text-sm font-semibold text-gray-700 mb-3">Password strength:</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'length', label: '8+ characters', met: passwordStrength.length },
                  { key: 'uppercase', label: 'Uppercase letter', met: passwordStrength.uppercase },
                  { key: 'number', label: 'Number', met: passwordStrength.number },
                  { key: 'special', label: 'Special character', met: passwordStrength.special },
                ].map(req => (
                  <div key={req.key} className="flex items-center gap-2">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${req.met ? 'bg-green-500' : 'bg-gray-300'}`}>
                      {req.met && <CheckCircle className="w-3 h-3 text-white" />}
                    </div>
                    <span className={`text-xs ${req.met ? 'text-green-700 font-medium' : 'text-gray-600'}`}>{req.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-700 focus:outline-none focus:ring-4 focus:ring-green-300 transition-all transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-lg hover:shadow-xl flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Login Link */}
        <p className="mt-8 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-green-600 hover:text-green-500 transition">
            Sign in
          </Link>
        </p>
      </div>

    </div>
  );
}
