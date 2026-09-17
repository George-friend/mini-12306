/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 语义色：以「中国铁路蓝」为主色，铁路红为强调色
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#2f7df6',
          600: '#1f6feb',
          700: '#1a5fd0',
          800: '#1e4fa8',
          900: '#1e3a8a',
        },
        rail: {
          red: '#e5484d',
          amber: '#f59e0b',
          green: '#0f9d58',
          ink: '#0f172a',
          muted: '#64748b',
          line: '#e2e8f0',
        },
      },
      fontFamily: {
        sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Noto Sans CJK SC"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Consolas', '"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.12)',
        pop: '0 12px 40px rgba(15,23,42,.16)',
        focus: '0 0 0 3px rgba(31,111,235,.22)',
        glow: '0 0 0 1px rgba(255,255,255,.14), 0 18px 50px -18px rgba(8,47,116,.6)',
      },
      keyframes: {
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        floaty: 'floaty 6s ease-in-out infinite',
        shimmer: 'shimmer 3.5s linear infinite',
      },
      backgroundImage: {
        'hero-glow': 'radial-gradient(60% 60% at 20% 0%, rgba(56,189,248,.35) 0%, transparent 60%), radial-gradient(50% 50% at 90% 10%, rgba(31,111,235,.45) 0%, transparent 65%)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
      },
    },
  },
  plugins: [],
};
