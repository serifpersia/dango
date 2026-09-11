import { useEffect, useState } from 'react'
import styles from './ScrollToTopButton.module.css'

const ScrollToTopButton = () => {
  const [isVisible, setIsVisible] = useState(false)

  const toggleVisibility = () => {
    const next = window.scrollY > 300
    setIsVisible((prev) => (prev === next ? prev : next))
  }

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    window.addEventListener('scroll', toggleVisibility, { passive: true })
    return () => window.removeEventListener('scroll', toggleVisibility)
  }, [])

  return (
    <div className={styles.scrollToTop}>
      <button
        onClick={scrollToTop}
        className={`${styles.scrollButton} ${isVisible ? styles.visible : ''}`}
        aria-label="Scroll to top"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          width="20"
          height="20"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
        </svg>
      </button>
    </div>
  )
}

export default ScrollToTopButton
