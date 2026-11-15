import React from 'react'
import { THEMES, seasonForDate, seasonalThemeForDate, useTheme } from '../../contexts/ThemeContext'
import styles from './ThemeSettings.module.css'

const SEASON_LABEL: Record<ReturnType<typeof seasonForDate>, string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
}

const ThemeSettings: React.FC = () => {
  const { theme, setTheme, loading } = useTheme()
  const season = seasonForDate()
  const seasonalId = seasonalThemeForDate()
  const seasonal = THEMES.find((item) => item.id === seasonalId)

  return (
    <div>
      <h4 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>Theme</h4>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Choose a color theme.
      </p>
      <div role="radiogroup" aria-label="Theme" className={styles.grid}>
        {THEMES.map((t) => {
          const active = theme === t.id
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={active}
              disabled={loading}
              onClick={() => setTheme(t.id)}
              className={`${styles.option} ${active ? styles.optionActive : ''}`}
            >
              <span className={styles.swatch} style={{ background: t.color }} aria-hidden="true" />
              <span className={styles.label}>{t.label}</span>
            </button>
          )
        })}
      </div>

      <div className={styles.seasonal}>
        <span className={styles.seasonalText}>
          <span className={styles.seasonalTitle}>Seasonal theme</span>
          <span className={styles.seasonalCopy}>
            Current season: {SEASON_LABEL[season]}. Suggested: {seasonal?.label ?? 'Sakura'}.
          </span>
        </span>
        <button
          type="button"
          className={styles.seasonalBtn}
          onClick={() => setTheme(seasonalId)}
          disabled={loading || theme === seasonalId}
        >
          {theme === seasonalId ? 'Already set' : `Use ${seasonal?.label ?? 'Sakura'}`}
        </button>
      </div>
    </div>
  )
}

export default ThemeSettings
