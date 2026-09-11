import React from 'react'
import { THEMES, useTheme } from '../../contexts/ThemeContext'

const ThemeSettings: React.FC = () => {
  const { theme, setTheme, loading } = useTheme()

  return (
    <div>
      <h4 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Palette</h4>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Taro is the default. Pick a palette that suits you.
      </p>
      <div
        role="radiogroup"
        aria-label="Palette"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.6rem',
        }}
      >
        {THEMES.map((t) => {
          const active = theme === t.id
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={active}
              disabled={loading}
              onClick={() => setTheme(t.id)}
              style={{
                display: 'flex',
                gap: '0.6rem',
                alignItems: 'center',
                textAlign: 'left',
                padding: '0.65rem 0.75rem',
                borderRadius: '10px',
                cursor: 'pointer',
                background: active ? 'var(--accent-subtle)' : 'var(--bg-tertiary)',
                border: active ? '1px solid var(--accent)' : '1px solid var(--border-primary)',
                color: 'var(--text-primary)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  flex: 'none',
                  background: t.swatch,
                  border: '1px solid rgba(0,0,0,0.35)',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700 }}>
                  {t.label}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t.blurb}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ThemeSettings
