import { useEffect, useState } from 'react'
import './TopProgressBar.css'

export default function TopProgressBar() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 120)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null
  return <div className="top-progress-bar" role="progressbar" aria-label="Loading" />
}
