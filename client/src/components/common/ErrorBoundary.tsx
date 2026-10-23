import { Component, type ErrorInfo, type ReactNode } from 'react'
import Icon from './Icon'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

async function reportClientError(error: Error, info: ErrorInfo): Promise<void> {
  const payload = {
    message: error.message,
    stack: error.stack,
    componentStack: info.componentStack,
    url: typeof window !== 'undefined' ? window.location.href : '',
    timestamp: new Date().toISOString(),
  }
  const body = JSON.stringify(payload)
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/internal/client-error',
        new Blob([body], { type: 'application/json' })
      )
      return
    }
  } catch {
    // ignore
  }
  fetch('/api/internal/client-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo)
    void reportClientError(error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className={styles.screen}>
          <Icon name="exclamation-triangle" className={styles.icon} />
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.text}>The application encountered an unexpected error.</p>
          <button
            onClick={() => {
              this.setState({ hasError: false })
              window.location.href = '/'
            }}
            className={styles.button}
          >
            <Icon name="home" />
            Go back Home
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
