import React from 'react'
import styles from './ErrorMessage.module.css'
import Icon from './Icon'

interface ErrorMessageProps {
  message: string
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message }) => {
  return (
    <div className={styles.errorBox}>
      <Icon name="exclamation-triangle" className={styles.icon} />
      <span>{message}</span>
    </div>
  )
}

export default ErrorMessage
