import React, { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle, XCircle, Bell, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
  channel?: string
  body?: string
}

interface ToastContextValue {
  toasts: Toast[]
  showToast: (type: ToastType, message: string, channel?: string, body?: string) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((
    type: ToastType,
    message: string,
    channel?: string,
    body?: string
  ) => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev, { id, message, type, channel, body }])
    
    // Auto-remove after 5 seconds (longer for notifications with body)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, body ? 8000 : 5000)
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" style={{ maxWidth: '400px' }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`p-4 rounded-lg shadow-lg border-l-4 flex items-start gap-3 animate-slideDown ${
              toast.type === 'success' 
                ? 'bg-green-50 border-green-500 text-green-800' 
                : toast.type === 'error'
                ? 'bg-red-50 border-red-500 text-red-800'
                : 'bg-blue-50 border-blue-500 text-blue-800'
            }`}
          >
            {toast.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            {toast.type === 'error' && <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            {toast.type === 'info' && <Bell className="w-5 h-5 flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm break-words">{toast.message}</p>
              {toast.body && (
                <p className="text-xs mt-1 opacity-75 break-words line-clamp-2">{toast.body}</p>
              )}
              {toast.channel && (
                <p className="text-xs mt-1 opacity-60">Via {toast.channel}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-current opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }
  return context
}
