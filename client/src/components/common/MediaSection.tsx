import React from 'react'
import { Link } from 'react-router'
import Icon from './Icon'
import SkeletonGrid from './SkeletonGrid'
import styles from './MediaSection.module.css'
import { useLowEndMode } from '../../contexts/LowEndModeContext'
import { useCarousel } from '../../hooks/useCarousel'

interface MediaSectionProps {
  title: string
  eyebrow?: string
  titleLink?: string
  loading?: boolean
  emptyState?: React.ReactNode
  carousel?: boolean
  layout?: 'vertical' | 'horizontal'
  collapsible?: boolean
  defaultExpanded?: boolean
  onReachThreshold?: () => void
  scrollThreshold?: number
  isFetchingNextPage?: boolean
  resetScrollOnShrink?: boolean
  itemCount?: number
  highlight?: boolean
  headerActions?: React.ReactNode
  loadingSkeleton?: React.ReactNode
  skeletonCount?: number
  children: React.ReactNode
}

const MediaSection: React.FC<MediaSectionProps> = ({
  title,
  eyebrow,
  titleLink,
  loading,
  emptyState,
  carousel,
  layout,
  collapsible,
  defaultExpanded = true,
  onReachThreshold,
  scrollThreshold,
  isFetchingNextPage,
  resetScrollOnShrink,
  itemCount = 0,
  highlight,
  headerActions,
  loadingSkeleton,
  skeletonCount = 7,
  children,
}) => {
  const { lowEndMode } = useLowEndMode()
  const { emblaRef, stepBy, scrollToStart } = useCarousel({
    onReachThreshold,
    threshold: scrollThreshold,
  })
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)

  React.useEffect(() => {
    setIsExpanded(defaultExpanded)
  }, [defaultExpanded])

  const prevCount = React.useRef(0)
  React.useEffect(() => {
    if (resetScrollOnShrink && itemCount > 0 && isExpanded) {
      if (itemCount <= prevCount.current || prevCount.current === 0) {
        scrollToStart()
      }
    }
    if (itemCount > 0) {
      prevCount.current = itemCount
    }
  }, [itemCount, resetScrollOnShrink, isExpanded, scrollToStart])

  if (!loading && itemCount === 0 && !emptyState && !collapsible) return null

  return (
    <section className={`${styles.sectionWrapper} ${highlight ? styles['continue-watching'] : ''}`}>
      <div className={styles['section-header']}>
        <div className={styles['title-wrapper']}>
          <div className="title-stack">
            {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
            {titleLink ? (
              <Link to={titleLink} className={styles['title-link']}>
                <div className={`section-title ${styles.sectionTitleNoMargin}`}>{title}</div>
              </Link>
            ) : (
              <div className={`section-title ${styles.sectionTitleNoMargin}`}>{title}</div>
            )}
          </div>
          {carousel && itemCount > 0 && isExpanded && (
            <div className={styles['nav-arrows']}>
              <button
                className={styles['nav-button']}
                type="button"
                aria-label="Scroll left"
                onClick={(e) => {
                  e.preventDefault()
                  stepBy('left', lowEndMode)
                }}
              >
                <Icon name="chevron-left" />
              </button>
              <button
                className={styles['nav-button']}
                type="button"
                aria-label="Scroll right"
                onClick={(e) => {
                  e.preventDefault()
                  stepBy('right', lowEndMode)
                }}
              >
                <Icon name="chevron-right" />
              </button>
            </div>
          )}
        </div>
        <div className={styles['header-controls']}>
          {headerActions}
          {collapsible && (
            <button
              className={styles['collapse-button']}
              type="button"
              onClick={() => setIsExpanded((open) => !open)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${title}` : `Expand ${title}`}
            >
              {isExpanded ? <Icon name="chevron-up" /> : <Icon name="chevron-down" />}
            </button>
          )}
        </div>
      </div>

      {isExpanded &&
        (carousel ? (
          !loading && itemCount === 0 && emptyState ? (
            <div>{emptyState}</div>
          ) : (
            <div className={styles['carousel-container']}>
              <div className={styles.carousel} ref={emblaRef}>
                <div className={styles['carousel-inner']}>
                  {loading && itemCount === 0
                    ? Array.from({ length: skeletonCount }).map((_, i) => (
                        <div key={i} className={styles['carousel-card']}>
                          {loadingSkeleton}
                        </div>
                      ))
                    : React.Children.map(children, (child, i) => (
                        <div
                          key={
                            React.isValidElement(child) && child.key != null
                              ? child.key
                              : `slide-${i}`
                          }
                          className={styles['carousel-card']}
                        >
                          {child}
                        </div>
                      ))}
                  {isFetchingNextPage && loadingSkeleton && (
                    <div className={styles['carousel-card']}>{loadingSkeleton}</div>
                  )}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="grid-container">
            {loading && itemCount === 0 ? (
              <SkeletonGrid count={6} layout={layout} />
            ) : itemCount > 0 ? (
              children
            ) : !loading ? (
              <div style={{ gridColumn: '1 / -1' }}>{emptyState}</div>
            ) : null}
          </div>
        ))}
    </section>
  )
}

export default MediaSection
