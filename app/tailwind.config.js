/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0a0f',
          secondary: '#12121a',
          tertiary: '#1a1a24',
          card: '#16161f',
          hover: '#1e1e2a',
        },
        border: {
          DEFAULT: '#2a2a3a',
          subtle: '#1f1f2a',
        },
        text: {
          primary: '#e8e8ed',
          secondary: '#9898a8',
          muted: '#5a5a6a',
        },
        accent: {
          cyan: '#00d4ff',
          'cyan-glow': 'rgba(0, 212, 255, 0.15)',
          green: '#00ff88',
          'green-glow': 'rgba(0, 255, 136, 0.15)',
          orange: '#ff9500',
          'orange-glow': 'rgba(255, 149, 0, 0.15)',
          red: '#ff4757',
          'red-glow': 'rgba(255, 71, 87, 0.15)',
          purple: '#a855f7',
          'purple-glow': 'rgba(168, 85, 247, 0.15)',
          yellow: '#fbbf24',
        },
        status: {
          success: '#00ff88',
          'success-bg': 'rgba(0, 255, 136, 0.15)',
          error: '#ff4757',
          'error-bg': 'rgba(255, 71, 87, 0.15)',
          warning: '#ff9500',
          'warning-bg': 'rgba(255, 149, 0, 0.15)',
        },
      },
      fontFamily: {
        sans: ['Outfit', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        lg: '12px',
      },
      animation: {
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shake': 'shake 0.5s ease-in-out',
        'slideDown': 'slideDown 0.3s ease-out',
        'spin': 'spin 1s linear infinite',
      },
      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        slideDown: {
          'from': { opacity: '0', transform: 'translateY(-10px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
