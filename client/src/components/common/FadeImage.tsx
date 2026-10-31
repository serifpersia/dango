import React, { useState } from 'react'
import styles from './FadeImage.module.css'

type FadeImageProps = React.ImgHTMLAttributes<HTMLImageElement>

const FadeImage: React.FC<FadeImageProps> = ({ className, onLoad, onError, ...props }) => {
  const src = props.src as string | undefined
  const [loadedSrc, setLoadedSrc] = useState<string | undefined | null>(null)
  const loaded = loadedSrc !== null && loadedSrc === src
  return (
    <img
      {...props}
      className={`${className ?? ''} ${styles.fadeImage} ${loaded ? styles.loaded : ''}`}
      onLoad={(e) => {
        setLoadedSrc(src)
        onLoad?.(e)
      }}
      onError={(e) => {
        setLoadedSrc(src)
        onError?.(e)
      }}
    />
  )
}

export default FadeImage
