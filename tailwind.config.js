/** @type {import('tailwindcss').Config} */
export default {
  content: [
    // HTML under src/ is included so Tailwind classes added to the sidepanel
    // shell aren't silently purged (there is no root index.html).
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        // RGB-channel tokens + <alpha-value> so /N opacity modifiers
        // (border-line/60, bg-accent-softer/50 …) compile correctly.
        // Plain var() colors silently break under opacity modifiers.
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface-rgb) / <alpha-value>)',
          muted: 'rgb(var(--surface-muted-rgb) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken-rgb) / <alpha-value>)',
        },
        line: { DEFAULT: 'rgb(var(--line-rgb) / <alpha-value>)', strong: 'rgb(var(--line-strong-rgb) / <alpha-value>)' },
        ink: {
          DEFAULT: 'rgb(var(--ink-rgb) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft-rgb) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint-rgb) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover-rgb) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft-rgb) / <alpha-value>)',
          softer: 'rgb(var(--accent-softer-rgb) / <alpha-value>)',
          on: 'rgb(var(--on-accent-rgb) / <alpha-value>)',
        },
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        'danger-soft': 'rgb(var(--danger-soft-rgb) / <alpha-value>)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        'success-soft': 'rgb(var(--success-soft-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        'warn-soft': 'rgb(var(--warn-soft-rgb) / <alpha-value>)',
      },
      fontFamily: {
        serif: 'var(--font-serif)',
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        pop: 'var(--shadow-pop)',
      },
      transitionTimingFunction: {
        out: 'var(--ease)',
      },
      fontSize: {
        body: ['13px', '1.55'],
        meta: ['11px', '1.45'],
      },
    },
  },
  plugins: [],
}
