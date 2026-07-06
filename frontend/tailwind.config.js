/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // MD3-based primary green palette
        primary: {
          DEFAULT: '#006e2f',
          container: '#22c55e',
          'fixed': '#6bff8f',
          'fixed-dim': '#4ae176',
        },
        'on-primary': '#ffffff',
        'on-primary-container': '#004b1e',
        'on-primary-fixed': '#002109',
        'on-primary-fixed-variant': '#005321',

        // Secondary orange palette
        secondary: {
          DEFAULT: '#9d4300',
          container: '#fd761a',
          fixed: '#ffdbca',
          'fixed-dim': '#ffb690',
        },
        'on-secondary': '#ffffff',
        'on-secondary-container': '#5c2400',
        'on-secondary-fixed': '#341100',
        'on-secondary-fixed-variant': '#783200',

        // Tertiary slate palette
        tertiary: {
          DEFAULT: '#565e74',
          container: '#a4abc4',
          fixed: '#dae2fd',
          'fixed-dim': '#bec6e0',
        },
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#383f54',
        'on-tertiary-fixed': '#131b2e',
        'on-tertiary-fixed-variant': '#3f465c',

        // Error
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
        },
        'on-error': '#ffffff',
        'on-error-container': '#93000a',

        // Surface / Background
        background: '#f7f9fb',
        surface: '#f7f9fb',
        'surface-bright': '#f7f9fb',
        'surface-dim': '#d8dadc',
        'surface-variant': '#e0e3e5',
        'surface-container': '#eceef0',
        'surface-container-low': '#f2f4f6',
        'surface-container-lowest': '#ffffff',
        'surface-container-high': '#e6e8ea',
        'surface-container-highest': '#e0e3e5',

        // Text colors
        'on-surface': '#191c1e',
        'on-surface-variant': '#3d4a3d',
        'on-background': '#191c1e',

        // Borders
        outline: '#6d7b6c',
        'outline-variant': '#bccbb9',

        // Tint
        'surface-tint': '#006e2f',

        // Inverse
        'inverse-surface': '#2d3133',
        'inverse-on-surface': '#eff1f3',
        'inverse-primary': '#4ae176',

        // Semantic colors (backwards compatibility)
        success: {
          50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7',
          400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857',
          800: '#065f46', 900: '#064e3b',
        },
        warning: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d',
          400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
          800: '#92400e', 900: '#78350f',
        },
        danger: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
          400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c',
          800: '#991b1b', 900: '#7f1d1d',
        },
      },

      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        'headline-lg': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'headline-md': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'headline-sm': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'body-lg': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'body-md': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'body-sm': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        'label-sm': ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
      },

      fontSize: {
        'headline-lg': ['42px', { lineHeight: '50px', letterSpacing: '-0.03em', fontWeight: '700' }],
        'headline-lg-mobile': ['32px', { lineHeight: '38px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['28px', { lineHeight: '34px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-sm': ['22px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['17px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '400' }],
        'body-md': ['15px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'label-sm': ['13px', { lineHeight: '18px', letterSpacing: '0.04em', fontWeight: '600' }],
      },

      spacing: {
        'margin-mobile': '20px',
        'margin-desktop': '48px',
        gutter: '28px',
        'container-max': '1600px',
        unit: '8px',
        sidebar: '320px',
      },

      borderRadius: {
        DEFAULT: '0.375rem',
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.375rem',
        full: '9999px',
      },

      animation: {
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'float': 'float 6s ease-in-out infinite',
      },

      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
          '100%': { transform: 'translateY(0px)' },
        },
      },
    },
  },
  plugins: [],
};
