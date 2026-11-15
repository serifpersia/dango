import { useEffect } from 'react'
import { Link } from 'react-router'
import DangoMascot from '../components/common/DangoMascot'
import styles from './NotFound.module.css'

const NotFound = () => {
  useEffect(() => {
    document.title = 'Page not found - dango'
  }, [])

  return (
    <div className={styles.page}>
      <DangoMascot size={180} />
      <div className="title-stack">
        <div className="section-eyebrow">404</div>
        <h1 className={styles.title}>Page not found</h1>
      </div>
      <p className={styles.copy}>The page you are looking for does not exist or has moved.</p>
      <Link to="/" className={styles.button}>
        Back to home
      </Link>
    </div>
  )
}

export default NotFound
