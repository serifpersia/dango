import React from 'react'
import styles from './DangoLoader.module.css'

interface DangoLoaderProps {
  className?: string
}

const BODY =
  'm 7,0 c -3.9372984,0 -7.10030437,2.4883888 -7,6 0.13572675,4.751733 5.0802847,4.156395 7,4.156395 1.2538994,0 6.530451,0.392468 6.584946,-4.168088 C 13.622023,2.8853946 10.937298,0 7,0 Z'
const EYE_L =
  'm 4.9623825,3.416 c -0.5858889,0 -0.6520292,2.3368563 -0.024765,2.3368563 0.6604959,0 0.6704653,-2.3368563 0.024765,-2.3368563 z'
const EYE_R =
  'M 8.588001,3.416 C 8.0021121,3.416 7.9359718,5.7528563 8.563236,5.7528563 9.2237319,5.7528563 9.2337013,3.416 8.588001,3.416 Z'
const FACE_PET = 'M 4.85,5.15 Q 5.285,4.0 5.72,5.15 M 8.25,5.15 Q 8.618,4.0 8.99,5.15'

const Dango = () => (
  <span className={styles.ball}>
    <svg viewBox="0 0 13.6 10.2" className={styles.svg} focusable="false">
      <path className={styles.body} d={BODY} />
      <g className={`${styles.face} ${styles.faceNormal}`}>
        <path className={styles.eye} d={EYE_L} />
        <path className={styles.eye} d={EYE_R} />
      </g>
      <g className={`${styles.face} ${styles.facePet}`}>
        <path className={styles.line} d={FACE_PET} />
      </g>
    </svg>
  </span>
)

const DangoLoader: React.FC<DangoLoaderProps> = ({ className }) => (
  <span className={className ? `${styles.loader} ${className}` : styles.loader} aria-hidden="true">
    <Dango />
    <Dango />
    <Dango />
  </span>
)

export default DangoLoader
