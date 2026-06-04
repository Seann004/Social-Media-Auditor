/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Bump every tier up one step so the whole UI reads larger
        xs:   ['0.8125rem', { lineHeight: '1.25rem' }],   // was 0.75
        sm:   ['0.9375rem', { lineHeight: '1.5rem'  }],   // was 0.875
        base: ['1.0625rem', { lineHeight: '1.75rem' }],   // was 1
        lg:   ['1.1875rem', { lineHeight: '1.875rem'}],   // was 1.125
        xl:   ['1.3125rem', { lineHeight: '2rem'    }],   // was 1.25
        '2xl':['1.5625rem', { lineHeight: '2.125rem'}],   // was 1.5
        '3xl':['1.9375rem', { lineHeight: '2.375rem'}],   // was 1.875
      },
      colors: {
        // ── Brand / Primary ──────────────────────────────
        primary:             'var(--color-primary)',
        'primary-hover':     'var(--color-primary-hover)',
        'primary-light':     'var(--color-primary-light)',
        'primary-border':    'var(--color-primary-border)',
        'primary-text':      'var(--color-primary-text)',
        'primary-muted':     'var(--color-primary-muted)',

        // ── Status semantic ───────────────────────────────
        success:             'var(--color-success)',
        'success-hover':     'var(--color-success-hover)',
        'success-light':     'var(--color-success-light)',
        'success-border':    'var(--color-success-border)',
        'success-text':      'var(--color-success-text)',

        danger:              'var(--color-danger)',
        'danger-hover':      'var(--color-danger-hover)',
        'danger-light':      'var(--color-danger-light)',
        'danger-border':     'var(--color-danger-border)',
        'danger-text':       'var(--color-danger-text)',

        warning:             'var(--color-warning)',
        'warning-hover':     'var(--color-warning-hover)',
        'warning-light':     'var(--color-warning-light)',
        'warning-border':    'var(--color-warning-border)',
        'warning-text':      'var(--color-warning-text)',

        // ── Surfaces ──────────────────────────────────────
        'page-bg':           'var(--color-page-bg)',
        card:                'var(--color-card)',
        'card-hover':        'var(--color-card-hover)',
        'input-bg':          'var(--color-input-bg)',

        // ── Sidebar ───────────────────────────────────────
        'sidebar-bg':        'var(--color-sidebar-bg)',
        'sidebar-text':      'var(--color-sidebar-text)',
        'sidebar-text-hover':'var(--color-sidebar-text-hover)',
        'sidebar-item-active':'var(--color-sidebar-item-active)',
        'sidebar-muted':     'var(--color-sidebar-muted)',
        'sidebar-border':    'var(--color-sidebar-border)',

        // ── Borders ───────────────────────────────────────
        border:              'var(--color-border)',
        'border-light':      'var(--color-border-light)',
        'border-focus':      'var(--color-border-focus)',

        // ── Text ──────────────────────────────────────────
        heading:             'var(--color-text-heading)',
        body:                'var(--color-text-body)',
        secondary:           'var(--color-text-secondary)',
        muted:               'var(--color-text-muted)',
        placeholder:         'var(--color-text-placeholder)',
        'on-dark':           'var(--color-text-on-dark)',

        // ── Login ─────────────────────────────────────────
        'login-bg':          'var(--color-login-bg)',

        // ── Role colors ───────────────────────────────────
        'role-head':         'var(--color-role-head-auditor)',
        'role-auditor':      'var(--color-role-auditor)',
        'role-admin':        'var(--color-role-admin)',

        // ── Severity ──────────────────────────────────────
        'severity-critical': 'var(--color-severity-critical)',
        'severity-major':    'var(--color-severity-major)',
        'severity-minor':    'var(--color-severity-minor)',

        // ── Platforms ─────────────────────────────────────
        'platform-tiktok':   'var(--color-platform-tiktok)',
        'platform-instagram':'var(--color-platform-instagram)',
        'platform-facebook': 'var(--color-platform-facebook)',
        'platform-snapchat': 'var(--color-platform-snapchat)',
        'platform-youtube':  'var(--color-platform-youtube)',
        'platform-discord':  'var(--color-platform-discord)',
        'platform-bereal':   'var(--color-platform-bereal)',
        'platform-twitter':  'var(--color-platform-twitter)',
      },
    },
  },
  plugins: [],
}
