import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import {
  LayoutDashboard,
  CreditCard,
  Gift,
  Activity,
  Radio,
  Webhook,
  Settings,
  TestTube,
  User,
  LogOut,
  Bell,
  Shield,
  Zap,
} from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth-context'
import { hasRole } from './lib/access'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import PaymentGateway from './pages/PaymentGateway'
import BonusService from './pages/BonusService'
import HealthMonitor from './pages/HealthMonitor'
import RealtimeTest from './pages/RealtimeTest'
import GraphQLPlayground from './pages/GraphQLPlayground'
import Webhooks from './pages/Webhooks'
import SettingsPage from './pages/Settings'
import Login from './pages/Login'
import Register from './pages/Register'
import Profile from './pages/Profile'
import AuthCallback from './pages/AuthCallback'
import Notifications from './pages/Notifications'
import UserManagement from './pages/UserManagement'
import UseCases from './pages/UseCases'

function AppContent() {
  const { isAuthenticated, user, logout, isLoading } = useAuth()

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  // Public routes (no auth required)
  const publicRoutes = (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )

  // Authenticated routes
  if (!isAuthenticated) {
    return publicRoutes
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">B2</div>
            <span>Platform</span>
          </div>
        </div>
        
        {/* User Info */}
        <div className="sidebar-user">
          <div className="user-avatar">
            <User className="w-5 h-5" />
          </div>
          <div className="user-info">
            <div className="user-name">{user?.email || user?.username}</div>
            <div className="user-role">{Array.isArray(user?.roles) && typeof user.roles[0] === 'string' ? user.roles[0] : (user?.roles?.[0] as any)?.role || 'User'}</div>
          </div>
          <button onClick={logout} className="user-logout" title="Logout">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-section">
            <div className="nav-section-title">Overview</div>
            <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <LayoutDashboard />
              <span>Dashboard</span>
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <User />
              <span>Profile</span>
            </NavLink>
            <NavLink to="/health" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Activity />
              <span>Health Monitor</span>
            </NavLink>
          </div>
          
          <div className="nav-section">
            <div className="nav-section-title">Services</div>
            <NavLink to="/payment" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <CreditCard />
              <span>Payment Gateway</span>
            </NavLink>
            <NavLink to="/bonus" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Gift />
              <span>Bonus Service</span>
            </NavLink>
            <NavLink to="/use-cases" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Zap />
              <span>Use Cases</span>
            </NavLink>
            <NavLink to="/notifications" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Bell />
              <span>Notifications</span>
            </NavLink>
          </div>

          {hasRole(user?.roles, 'system') && (
            <div className="nav-section">
              <div className="nav-section-title">System</div>
              <NavLink to="/users" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <Shield />
                <span>User Management</span>
              </NavLink>
            </div>
          )}

          <div className="nav-section">
            <div className="nav-section-title">Integration</div>
            <NavLink to="/webhooks" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Webhook />
              <span>Webhooks</span>
            </NavLink>
            <NavLink to="/realtime" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Radio />
              <span>Realtime (SSE/WS)</span>
            </NavLink>
          </div>
          
          <div className="nav-section">
            <div className="nav-section-title">Tools</div>
            <NavLink to="/playground" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <TestTube />
              <span>GraphQL Playground</span>
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Settings />
              <span>Settings</span>
            </NavLink>
          </div>
        </nav>
      </aside>
      
      <main className="main">
        <Routes>
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/health" element={<ProtectedRoute><HealthMonitor /></ProtectedRoute>} />
          <Route path="/payment" element={<ProtectedRoute><PaymentGateway /></ProtectedRoute>} />
          <Route path="/bonus" element={<ProtectedRoute><BonusService /></ProtectedRoute>} />
          <Route path="/use-cases" element={<ProtectedRoute><UseCases /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute requireRoles={['system']}><UserManagement /></ProtectedRoute>} />
          <Route path="/webhooks" element={<ProtectedRoute requireRoles={['system']}><Webhooks /></ProtectedRoute>} />
          <Route path="/realtime" element={<ProtectedRoute><RealtimeTest /></ProtectedRoute>} />
          <Route path="/playground" element={<ProtectedRoute><GraphQLPlayground /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
