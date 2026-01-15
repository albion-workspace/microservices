/**
 * User Profile & Session Management Page
 */

import React, { useState } from 'react';
import { useAuth, useAuthRequest } from '../lib/auth-context';
import { User, Shield, Monitor, LogOut, AlertCircle, CheckCircle } from 'lucide-react';

export default function Profile() {
  const { user, logout, logoutAll, updateUser } = useAuth();
  const authRequest = useAuthRequest();

  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<any>(null);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load sessions
  const loadSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const data = await authRequest(`
        query {
          mySessions {
            id
            deviceInfo
            createdAt
            lastAccessedAt
            isValid
          }
        }
      `);
      setSessions(data.mySessions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  // Enable 2FA
  const handleEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const data = await authRequest(
        `mutation Enable2FA($input: Enable2FAInput!) {
          enable2FA(input: $input) {
            success
            secret
            qrCode
            backupCodes
          }
        }`,
        {
          input: {
            userId: user?.id,
            tenantId: user?.tenantId,
            password,
          },
        }
      );

      if (data.enable2FA.success) {
        setTwoFactorSetup(data.enable2FA);
        setSuccess('2FA setup initiated! Scan the QR code with your authenticator app.');
        setPassword(''); // Clear password
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Verify 2FA
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsVerifying(true);

    try {
      const data = await authRequest(
        `mutation Verify2FA($input: Verify2FAInput!) {
          verify2FA(input: $input) {
            success
            message
          }
        }`,
        {
          input: {
            userId: user?.id,
            tenantId: user?.tenantId,
            token: twoFactorCode,
          },
        }
      );

      if (data.verify2FA.success) {
        setSuccess('2FA enabled successfully!');
        setTwoFactorSetup(null);
        setTwoFactorCode('');
        
        // Refresh user data to get updated twoFactorEnabled status
        const userData = await authRequest(`
          query {
            me {
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
          }
        `);
        
        if (userData.me) {
          updateUser(userData.me);
        }
      } else {
        setError(data.verify2FA.message || 'Failed to verify 2FA');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to verify 2FA');
    } finally {
      setIsVerifying(false);
    }
  };

  // Disable 2FA
  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!confirm('Are you sure you want to disable two-factor authentication? This will make your account less secure.')) {
      return;
    }

    try {
      const data = await authRequest(
        `mutation Disable2FA($password: String!) {
          disable2FA(password: $password) {
            success
            message
          }
        }`,
        {
          password,
        }
      );

      if (data.disable2FA.success) {
        setSuccess('2FA disabled successfully!');
        setPassword('');
        
        // Refresh user data to get updated twoFactorEnabled status
        const userData = await authRequest(`
          query {
            me {
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
          }
        `);
        
        if (userData.me) {
          updateUser(userData.me);
        }
      } else {
        setError(data.disable2FA.message || 'Failed to disable 2FA');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to disable 2FA');
    }
  };

  // Handle logout all devices
  const handleLogoutAll = async () => {
    if (confirm('Are you sure you want to log out from all devices?')) {
      await logoutAll();
    }
  };

  React.useEffect(() => {
    loadSessions();
  }, []);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Profile & Security</h1>

        {/* User Info Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center">
              <User className="w-8 h-8 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900">
                {user.metadata?.firstName} {user.metadata?.lastName}
              </h2>
              <p className="text-gray-600">{user.email || user.username || user.phone}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                  Status: {user.status}
                </span>
                {user.emailVerified && (
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Email Verified
                  </span>
                )}
                {user.twoFactorEnabled && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    2FA Enabled
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 2FA Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Two-Factor Authentication
          </h3>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          {!user.twoFactorEnabled && !twoFactorSetup && (
            <form onSubmit={handleEnable2FA} className="space-y-4">
              <p className="text-gray-600">
                Add an extra layer of security to your account by enabling two-factor authentication.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm your password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  placeholder="Enter your password"
                  required
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                Enable 2FA
              </button>
            </form>
          )}

          {twoFactorSetup && !user.twoFactorEnabled && (
            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-700 mb-2">1. Scan this QR code:</p>
                {twoFactorSetup.qrCode && (
                  <img src={twoFactorSetup.qrCode} alt="2FA QR Code" className="mx-auto" />
                )}
              </div>
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium text-gray-700 mb-2">2. Save these backup codes:</p>
                <div className="grid grid-cols-2 gap-2">
                  {twoFactorSetup.backupCodes?.map((code: string, i: number) => (
                    <code key={i} className="bg-white px-2 py-1 rounded text-sm font-mono">
                      {code}
                    </code>
                  ))}
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Store these backup codes in a safe place. You can use them to access your account if you lose your authenticator device.
              </p>
              
              {/* Verify 2FA Form */}
              <form onSubmit={handleVerify2FA} className="space-y-4 border-t pt-4">
                <p className="text-sm font-medium text-gray-700">3. Enter the code from your authenticator app:</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    6-digit code
                  </label>
                  <input
                    type="text"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none font-mono text-lg tracking-widest text-center"
                    placeholder="123456"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={isVerifying || twoFactorCode.length !== 6}
                  className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isVerifying ? 'Verifying...' : 'Verify and Enable 2FA'}
                </button>
              </form>
            </div>
          )}

          {user.twoFactorEnabled && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <p className="font-medium">Two-factor authentication is enabled</p>
              </div>
              
              <form onSubmit={handleDisable2FA} className="border-t pt-4 space-y-4">
                <p className="text-sm text-gray-600">
                  To disable two-factor authentication, please confirm your password.
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm your password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
                    placeholder="Enter your password"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                >
                  Disable 2FA
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Active Sessions Card */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Active Sessions
            </h3>
            <button
              onClick={loadSessions}
              disabled={isLoadingSessions}
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              {isLoadingSessions ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {sessions.length === 0 ? (
            <p className="text-gray-600">No active sessions</p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-start justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {session.deviceInfo?.browser || 'Unknown Browser'} on {session.deviceInfo?.os || 'Unknown OS'}
                    </p>
                    <p className="text-sm text-gray-600">
                      Last active: {new Date(session.lastAccessedAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${session.isValid ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                    {session.isValid ? 'Active' : 'Expired'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={handleLogoutAll}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Logout All Devices
            </button>
            <button
              onClick={logout}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
            >
              Logout This Device
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
