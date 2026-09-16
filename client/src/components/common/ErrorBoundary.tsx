import { Component, type ErrorInfo, type ReactNode } from 'react'
import Icon from './Icon'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
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
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            width: '100%',
            backgroundColor: '#1a1b1c',
            color: '#fff',
            textAlign: 'center',
            padding: '2rem',
          }}
        >
          <Icon
            name="exclamation-triangle"
            style={{ fontSize: '4rem', color: '#ff4d4d', marginBottom: '1rem' }}
          />
          <h1 style={{ marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ color: '#aaa', marginBottom: '2rem' }}>
            The application encountered an unexpected error.
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false })
              window.location.href = '/'
            }}
            style={{
              padding: '0.8rem 1.5rem',
              backgroundColor: 'var(--accent, #3d5afe)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '1rem',
              transition: 'background-color 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#536dfe')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent, #3d5afe)')}
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
