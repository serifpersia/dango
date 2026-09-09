import { useState, type CSSProperties } from 'react'
import useIsMobile from '../../hooks/useIsMobile'
import styles from './SynopsisText.module.css'

interface SynopsisTextProps {
  text?: string | null
  emptyText?: string
  collapsedLines?: number
}

const COLLAPSE_THRESHOLD = 180

export default function SynopsisText({
  text,
  emptyText = 'No description available.',
  collapsedLines = 2,
}: SynopsisTextProps) {
  const isMobile = useIsMobile()
  const cleanedText = text?.trim() || ''
  const shouldCollapse = isMobile && cleanedText.length > COLLAPSE_THRESHOLD
  const [userExpanded, setUserExpanded] = useState(false)
  const isExpanded = !shouldCollapse || userExpanded

  if (!cleanedText) {
    return <p className={styles.description}>{emptyText}</p>
  }

  return (
    <div className={styles.synopsisBlock}>
      <p
        className={`${styles.description} ${!isExpanded && shouldCollapse ? styles.clamped : ''}`}
        style={{ '--synopsis-lines': String(collapsedLines) } as CSSProperties}
      >
        {cleanedText}
      </p>

      {shouldCollapse && (
        <button
          type="button"
          className={styles.toggleButton}
          onClick={() => setUserExpanded((value) => !value)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}
